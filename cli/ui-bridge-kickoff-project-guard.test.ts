/**
 * W7-B6 WI-3 — kickoff roster guard + architect cost ceiling
 * (sessions-kinds-02, projects-15, crosscut-21, projects-14).
 *
 * Every session /start route accepted ANY project string: the containment
 * guards tolerate a not-yet-existing segment (creation mode), so a typo
 * minted `projects/<typo>/_<kind>/<sid>/` — a phantom project that then
 * appeared on /projects forever — and for the architect it also spawned a
 * real (expensive) agent turn. Killed implementation: presence-only
 * `!body.project` checks. Each unknown-project AT asserts the ARTIFACT (no
 * phantom directory), not just the 404.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-kickoff-guard-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'realproj'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

const UNKNOWN = 'no-such-xyz';

test('AT-B6-11 (RED) POST /api/architect/start with an unknown project → 404, and NO phantom projects/<typo>/ is created', async () => {
  const { status, json } = await post('/api/architect/start', { project: UNKNOWN, idea: 'a typo-launched idea' });
  assert.equal(status, 404, `expected 404 — got ${status}: ${JSON.stringify(json)}`);
  assert.match(String(json['error']), /unknown project/);
  assert.ok(!existsSync(join(forgeRoot, 'projects', UNKNOWN)), 'the phantom project directory must NOT exist');
});

test('AT-B6-12 (RED) instructions / project-brain / demo-builder /start with an unknown project → 404 + no phantom dir', async () => {
  for (const [path, body] of [
    ['/api/instructions/start', { project: UNKNOWN, mode: 'init' }],
    ['/api/project-brain/start', { project: UNKNOWN }],
    ['/api/demo-builder/start', { project: UNKNOWN, mode: 'create' }],
  ] as const) {
    const { status, json } = await post(path, body);
    assert.equal(status, 404, `${path}: expected 404 — got ${status}: ${JSON.stringify(json)}`);
    assert.match(String(json['error']), /unknown project/, path);
  }
  assert.ok(!existsSync(join(forgeRoot, 'projects', UNKNOWN)), 'no phantom project directory after any start route');
});

test('AT-B6-13 (positive control) a ROSTER project still starts: architect 200, session dir + status written', async () => {
  const { status, json } = await post('/api/architect/start', { project: 'realproj', idea: 'a real idea' });
  assert.equal(status, 200, `expected 200 — got ${status}: ${JSON.stringify(json)}`);
  const sid = String(json['sessionId']);
  const statusPath = join(forgeRoot, 'projects', 'realproj', '_architect', sid, 'status.json');
  assert.ok(existsSync(statusPath), 'session status.json must be written for a real project');
});

test('AT-B6-14 (RED) architect costCeilingUsd: invalid shapes → 400; a valid ceiling is PERSISTED into status.json', async () => {
  for (const bad of [0, -1, 'five', Number.NaN, 1e9]) {
    const { status } = await post('/api/architect/start', { project: 'realproj', idea: 'x', costCeilingUsd: bad });
    assert.equal(status, 400, `costCeilingUsd=${JSON.stringify(bad)} must 400`);
  }
  const { status, json } = await post('/api/architect/start', { project: 'realproj', idea: 'x', costCeilingUsd: 2.5 });
  assert.equal(status, 200, `valid ceiling must 200 — got ${status}: ${JSON.stringify(json)}`);
  const sid = String(json['sessionId']);
  const persisted = JSON.parse(
    readFileSync(join(forgeRoot, 'projects', 'realproj', '_architect', sid, 'status.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(persisted['costCeilingUsd'], 2.5, 'the ceiling must be persisted in the session status (the runner reads it at every turn start)');
});
