/**
 * `api-before-after`, path driver (forge-mfv5.1.19): the orchestrator GETs a
 * declared path on each capture tree's OWN server and records status + body as
 * JSON; the control then compares the two under JSON normalisation. Positive
 * cases run against real fixture servers on 127.0.0.1:0 (one per tree);
 * refusal cases use an injected fetch that records calls, so a broken refusal
 * still cannot reach any network (M7-COMMON §6.16).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { captureApiGet } from './demo-api-capture.ts';
import { computeCheckpointDeltas } from '@forge/stations/demo-delta.ts';
import type { DemoModel } from '@forge/stations/demo-model.ts';

async function fixtureServer(routes: Record<string, unknown>): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    const body = routes[req.url ?? ''];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { message: 'Not Found' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, hits, close: () => new Promise((r) => server.close(() => r())) };
}

function spyFetch(): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  return { calls, fetchImpl: (async (u: string | URL | Request) => { calls.push(String(u)); throw new Error('spy fetch must never be reached'); }) as typeof fetch };
}

test('records status + JSON body from the tree\'s own server', async () => {
  const srv = await fixtureServer({ '/api/org': { id: 1, login: 'dave-parso' } });
  try {
    const out = JSON.parse(await captureApiGet(srv.url, '/api/org'));
    assert.deepEqual(out, { status: 200, body: { id: 1, login: 'dave-parso' } });
    assert.deepEqual(srv.hits, ['/api/org']);
  } finally {
    await srv.close();
  }
});

test('before/after servers → .out files → the control: volatile-only change is unchanged, a new field is changed, a new endpoint is changed', async () => {
  const before = await fixtureServer({ '/api/org': { id: 1, login: 'x', updated_at: '2026-10-09T01:00:00Z' } });
  const after = await fixtureServer({
    '/api/org': { id: 2, login: 'x', updated_at: '2026-10-09T02:00:00Z' },
    '/api/rulesets': [{ id: 9, name: 'main-protect' }],
  });
  const dir = mkdtempSync(join(tmpdir(), 'demo-api-capture-'));
  mkdirSync(join(dir, 'before'));
  mkdirSync(join(dir, 'after'));
  try {
    for (const [label, path] of [['org', '/api/org'], ['rulesets', '/api/rulesets']] as const) {
      writeFileSync(join(dir, 'before', `${label}.out`), await captureApiGet(before.url, path));
      writeFileSync(join(dir, 'after', `${label}.out`), await captureApiGet(after.url, path));
    }
    const model: DemoModel = {
      title: 'T', essence: 'E', project: 'p', diffStat: 'd',
      checkpoints: [
        { label: 'org', caption: 'c', form: 'api-before-after', apiPath: '/api/org' },
        { label: 'rulesets', caption: 'c', form: 'api-before-after', apiPath: '/api/rulesets' },
      ],
    };
    const [org, rulesets] = computeCheckpointDeltas(model, dir).checkpoints;
    assert.equal(org?.delta, 'unchanged');
    assert.equal(rulesets?.delta, 'changed');
    assert.match(readFileSync(join(dir, 'before', 'rulesets.out'), 'utf8'), /"status":404/);
  } finally {
    await before.close();
    await after.close();
  }
});

for (const apiPath of ['//evil.example/x', 'https://evil.example/x', '/a/../../b', 'api/org']) {
  test(`refuses ${apiPath} without fetching anything`, async () => {
    const spy = spyFetch();
    const out = await captureApiGet('http://127.0.0.1:9/', apiPath, spy.fetchImpl);
    assert.match(out, /^\[request refused: /);
    assert.deepEqual(spy.calls, []);
  });
}

test('a server that cannot be reached is recorded as a failure, never as a body', async () => {
  const failing = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  assert.match(await captureApiGet('http://127.0.0.1:9/', '/api/org', failing), /^\[request failed: ECONNREFUSED\]/);
});
