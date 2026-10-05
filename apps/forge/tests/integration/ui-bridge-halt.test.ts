/**
 * The one emergency halt (D-03) at the bridge: `POST /api/halt`,
 * `POST /api/halt/release`, the `serve.halt` health field, and the 409
 * `{ error: 'halted' }` refusal on every dispatch caller family. The record is
 * `<forgeRoot>/_queue/halt.json`, the same file `forge serve` reads.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { startBridge } from '../../ui-bridge.ts';
import { spawnPreflightFix } from '../../bridge-studio-writes.ts';
import { BRIDGE_ROUTE_CLASSIFICATION } from '../../dry-bridge.ts';
import { makePreflightWriteHandlers } from '../../../../packages/projects/bridge-studio-project-preflight-write.ts';
import { claim, getPaths } from '../../../../packages/flows/queue.ts';
import { readHalt } from '@forge/kernel';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
const savedDry = process.env.FORGE_DRY_BRIDGE;
const roots: string[] = [];

after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  if (savedNoSpawn !== undefined) process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn; else delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (savedDry !== undefined) process.env.FORGE_DRY_BRIDGE = savedDry; else delete process.env.FORGE_DRY_BRIDGE;
});

function mkRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'ui-bridge-halt-'));
  roots.push(r);
  mkdirSync(join(r, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(r, '_queue', 'in-flight'), { recursive: true });
  return r;
}

type Health = { serve: { state: string; halt: { since: string | null; actor: string | null; active: number; queued: number } | null } };

test('health reports serve.halt null; POST /api/halt writes the record and returns counts; release clears it', async () => {
  const forgeRoot = mkRoot();
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-a.md'), 'x');
  writeFileSync(join(forgeRoot, '_queue', 'pending', 'INIT-b.md'), 'x');
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', 'INIT-c.md'), 'x');
  writeFileSync(join(forgeRoot, '_queue', 'in-flight', 'INIT-c.md.heartbeat'), '');
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const h0 = (await (await fetch(`${url}/api/health`)).json()) as Health;
    assert.equal(h0.serve.halt, null);

    const res = await fetch(`${url}/api/halt`, { method: 'POST', headers: CSRF, body: '{}' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { halt: { since: string; actor: string; active: number; queued: number } };
    assert.equal(body.halt.actor, 'operator');
    assert.equal(body.halt.active, 1);
    assert.equal(body.halt.queued, 2);
    assert.deepEqual(JSON.parse(readFileSync(join(forgeRoot, '_queue', 'halt.json'), 'utf8')), { since: body.halt.since, actor: 'operator' });

    const again = (await (await fetch(`${url}/api/halt`, { method: 'POST', headers: CSRF, body: '{}' })).json()) as typeof body;
    assert.equal(again.halt.since, body.halt.since, 'a second press keeps the first since');

    const h1 = (await (await fetch(`${url}/api/health`)).json()) as Health;
    assert.deepEqual(h1.serve.halt, { since: body.halt.since, actor: 'operator', active: 1, queued: 2 });
    assert.equal(h1.serve.state, 'unsupervised', 'the supervisor fields ride along unchanged');

    // Same file, same root: the queue claim kernel+flows read refuses.
    assert.equal(claim('INIT-a.md', getPaths(join(forgeRoot, '_queue'))), null);
    assert.ok(readHalt(join(forgeRoot, '_queue')) !== null);

    const rel = await fetch(`${url}/api/halt/release`, { method: 'POST', headers: CSRF, body: '{}' });
    assert.equal(rel.status, 200);
    assert.deepEqual(await rel.json(), { halt: null });
    assert.equal(existsSync(join(forgeRoot, '_queue', 'halt.json')), false);
    assert.equal(((await (await fetch(`${url}/api/health`)).json()) as Health).serve.halt, null);
    const relAgain = await fetch(`${url}/api/halt/release`, { method: 'POST', headers: CSRF, body: '{}' });
    assert.equal(relAgain.status, 200, 'release when not halted is a no-op');
  } finally {
    await close();
  }
});

test('POST /api/halt without the CSRF header is refused 403 and writes nothing', async () => {
  const forgeRoot = mkRoot();
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const res = await fetch(`${url}/api/halt`, { method: 'POST' });
    assert.equal(res.status, 403);
    assert.equal(existsSync(join(forgeRoot, '_queue', 'halt.json')), false);
  } finally {
    await close();
  }
});

test('health reads an unreadable record as halted (since null)', async () => {
  const forgeRoot = mkRoot();
  writeFileSync(join(forgeRoot, '_queue', 'halt.json'), '{broken');
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const h = (await (await fetch(`${url}/api/health`)).json()) as Health;
    assert.deepEqual(h.serve.halt, { since: null, actor: null, active: 0, queued: 0 });
  } finally {
    await close();
  }
});

test('POST /api/architect/rerun under halt: 409 { error: "halted" }, nothing spawned, session dir untouched', async () => {
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  const forgeRoot = mkRoot();
  mkdirSync(join(forgeRoot, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'apps', 'forge', 'cli.ts'),
    `import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; writeFileSync(join(import.meta.dirname, '..', '..', 'spawned.json'), '1');`,
  );
  const sid = '2026-05-29T21-00-00';
  const dir = join(forgeRoot, '_logs', '_sessions', 'demo', '_architect', sid);
  mkdirSync(join(forgeRoot, 'projects', 'demo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  const status = JSON.stringify({ session_id: sid, project: 'demo', project_repo_path: dir, phase: 'drafting', round: 1, idea: 'i', updated_at: '2026-01-01T00:00:00.000Z' });
  writeFileSync(join(dir, 'status.json'), status);
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    await fetch(`${url}/api/halt`, { method: 'POST', headers: CSRF, body: '{}' });
    const res = await fetch(`${url}/api/architect/rerun`, { method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demo', sessionId: sid }) });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; since: string };
    assert.equal(body.error, 'halted');
    assert.ok(typeof body.since === 'string');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(existsSync(join(forgeRoot, 'spawned.json')), false, 'no child was born');
    assert.equal(readFileSync(join(dir, 'status.json'), 'utf8'), status, 'session status untouched');
    assert.equal(existsSync(join(forgeRoot, '_logs', `_architect-${sid}`, 'turn.pid')), false, 'no claim written');
  } finally {
    await close();
  }
});

test('preflight fix-agent (spawnPreflightFix family) under halt: 409 { error: "halted" }, no log dir', async () => {
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  const forgeRoot = mkRoot();
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });
  writeFileSync(join(forgeRoot, '_queue', 'halt.json'), JSON.stringify({ since: '2026-10-04T10:00:00.000Z', actor: 'operator' }));
  const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers({ spawnPreflightFix });
  const captured = { status: null as number | null, body: '' };
  const res = {
    writeHead(s: number) { captured.status = s; return res; },
    end(p?: string) { if (p !== undefined) captured.body = p; return res; },
  } as unknown as ServerResponse;
  const answered = await handleProjectPreflightFixAgent(
    { headers: {} } as unknown as IncomingMessage, res,
    { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => ({ clauseId: 'C1', instruction: 'use npm test' }) },
    '/api/studio/projects/demoproj/preflight/fix-agent', 'POST',
  );
  assert.equal(answered, true);
  assert.equal(captured.status, 409, captured.body);
  assert.deepEqual(JSON.parse(captured.body), { error: 'halted', since: '2026-10-04T10:00:00.000Z' });
  assert.equal(existsSync(join(forgeRoot, '_logs')), false, 'nothing written under _logs');
});

test('dry-bridge classifies POST /api/halt and /api/halt/release as exempt-local', () => {
  for (const route of ['/api/halt', '/api/halt/release']) {
    const row = BRIDGE_ROUTE_CLASSIFICATION.find((r) => r.method === 'POST' && r.route === route);
    assert.ok(row, `${route} has a classification row`);
    assert.equal(row.classification, 'exempt-local');
  }
});
