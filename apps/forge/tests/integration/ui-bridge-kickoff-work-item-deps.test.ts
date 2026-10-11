/**
 * Bead forge-mfv5.1.36 (D-48 amended) — dependencies at the Kickoff gate
 * through the real bridge (port 0, tmp forge root holding the live gitweave I2
 * set, no spawn, no network):
 *
 *   - `POST /api/kickoff/work-items` takes an optional `dependsOn` (validated at
 *     the boundary, naming the field); absent = the plan's leaf work items;
 *   - `PATCH /api/kickoff/work-items/<wiId>` `{ initiativeId, dependsOn }` edits
 *     one work item's dependencies: 200 / 400 / 404 / 409, under the manifest
 *     lock the add takes;
 *   - the roadmap serves the work items in natural id order, with `dependsOn`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import lockfile from 'proper-lockfile';

import { startBridge } from '../../ui-bridge.ts';
import { enqueueDevelopRun, parseWorkItem, serializeWorkItem } from '@forge/flows';
import { I2_INIT, I2_PLAN_LEAVES, plantI2Kickoff, type I2Paths } from '../../../../packages/flows/tests/test-fixtures/kickoff-deps-i2.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const ROUTE = '/api/kickoff/work-items';
const ADD = {
  initiativeId: I2_INIT,
  summary: 'Live proof that gw apply --json resets before applying',
  acceptanceCriteria: [{ given: 'a stray prefixed team', when: 'the reset test runs', then: 'the team is gone' }],
  qualityGateCmd: ['python3', '-m', 'pytest', 'tests/acceptance/test_gw_reset_before_apply.py'],
  filesInScope: ['tests/acceptance/test_gw_reset_before_apply.py'],
};

type Reply = { status: number; body: Record<string, unknown> };
type Client = {
  url: string; root: string; paths: I2Paths;
  send: (method: 'POST' | 'PATCH', path: string, b: unknown) => Promise<Reply>;
};

async function withBridge(fn: (c: Client) => Promise<void>, opts: { withKickoffAdds: boolean } = { withKickoffAdds: true }): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'kickoff-deps-route-'));
  const paths = plantI2Kickoff(root, opts);
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  const send = async (method: 'POST' | 'PATCH', path: string, b: unknown): Promise<Reply> => {
    const res = await fetch(`${url}${path}`, { method, headers: CSRF, body: JSON.stringify(b) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try { await fn({ url, root, paths, send }); } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

const deps = (dir: string, id: string) => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8')).depends_on;
const patch = (c: Client, wiId: string, b: unknown) => c.send('PATCH', `${ROUTE}/${wiId}`, b);

// ---- POST: dependsOn -------------------------------------------------------

test('POST without dependsOn: 200, the new WI depends on the plan\'s leaves', () => withBridge(async (c) => {
  const r = await c.send('POST', ROUTE, ADD);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.workItemId, 'WI-13');
  assert.deepEqual(deps(c.paths.wiDir, 'WI-13'), I2_PLAN_LEAVES);
}, { withKickoffAdds: false }));

test('POST with dependsOn: [] is honoured (a root); with ids, written as given', () => withBridge(async (c) => {
  assert.equal((await c.send('POST', ROUTE, { ...ADD, dependsOn: [] })).status, 200);
  assert.deepEqual(deps(c.paths.wiDir, 'WI-13'), []);
  assert.equal((await c.send('POST', ROUTE, { ...ADD, dependsOn: ['WI-8', 'WI-13'] })).status, 200);
  assert.deepEqual(deps(c.paths.wiDir, 'WI-14'), ['WI-8', 'WI-13']);
}, { withKickoffAdds: false }));

const BAD_DEPS: Array<[string, unknown]> = [
  ['dependsOn', 'WI-8'],
  ['dependsOn', Array.from({ length: 51 }, (_, i) => `WI-${i + 1}`)],
  ['dependsOn[1]', ['WI-8', 'WI-8 ']],
  ['dependsOn[0]', [7]],
  ['dependsOn[0]', ['wi-8']],
];

test('POST 400: a malformed dependsOn is refused naming the field; nothing written', () => withBridge(async (c) => {
  for (const [field, dependsOn] of BAD_DEPS) {
    const r = await c.send('POST', ROUTE, { ...ADD, dependsOn });
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.body)}`);
    assert.ok(String(r.body.error).startsWith(`${field} `), `names ${field}: ${String(r.body.error)}`);
  }
  assert.throws(() => deps(c.paths.wiDir, 'WI-13'), /ENOENT/);
}, { withKickoffAdds: false }));

test('POST 400: an unknown dependency is refused by the set validation, named', () => withBridge(async (c) => {
  const r = await c.send('POST', ROUTE, { ...ADD, dependsOn: ['WI-99'] });
  assert.equal(r.status, 400);
  assert.equal(r.body.status, 'invalid');
  assert.match(String(r.body.detail), /depends_on references unknown work item: WI-99/);
}, { withKickoffAdds: false }));

// ---- PATCH: edit one work item's dependencies --------------------------------

test('PATCH 200: WI-13 re-pointed after the CLI; worktree and snapshot both rewritten', () => withBridge(async (c) => {
  const r = await patch(c, 'WI-13', { initiativeId: I2_INIT, dependsOn: ['WI-8'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, workItemId: 'WI-13', dependsOn: ['WI-8'] });
  assert.deepEqual(deps(c.paths.wiDir, 'WI-13'), ['WI-8']);
  assert.deepEqual(deps(c.paths.snapshotDir, 'WI-13'), ['WI-8']);
}));

const BAD_PATCH: Array<[string, string, Record<string, unknown>]> = [
  ['initiativeId', 'WI-13', { dependsOn: [] }],
  ['dependsOn', 'WI-13', { initiativeId: I2_INIT }],
  ['dependsOn[0]', 'WI-13', { initiativeId: I2_INIT, dependsOn: ['WI-8a1'] }],
  ['workItemId', 'not-a-wi', { initiativeId: I2_INIT, dependsOn: [] }],
];

test('PATCH 400: a malformed body or work-item id is refused naming the field', () => withBridge(async (c) => {
  for (const [field, wiId, body] of BAD_PATCH) {
    const r = await patch(c, wiId, body);
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.body)}`);
    assert.ok(String(r.body.error).startsWith(`${field} `), `names ${field}: ${String(r.body.error)}`);
  }
}));

test('PATCH 400: a cycle is refused by the set validation, named; nothing rewritten', () => withBridge(async (c) => {
  const r = await patch(c, 'WI-1', { initiativeId: I2_INIT, dependsOn: ['WI-2'] });
  assert.equal(r.status, 400);
  assert.equal(r.body.status, 'invalid');
  assert.match(String(r.body.detail), /work-item dependency cycle/);
  assert.deepEqual(deps(c.paths.wiDir, 'WI-1'), []);
}));

test('PATCH 404: an unknown work item, or an initiative not at ready-for-review', () => withBridge(async (c) => {
  const a = await patch(c, 'WI-99', { initiativeId: I2_INIT, dependsOn: [] });
  assert.equal(a.status, 404);
  assert.equal(a.body.status, 'not-found');
  assert.match(String(a.body.detail), /WI-99/);
  const b = await patch(c, 'WI-13', { initiativeId: 'INIT-2026-10-09-nowhere', dependsOn: [] });
  assert.equal(b.status, 404);
}));

test('PATCH 409: once anything is built, refused by name', () => withBridge(async (c) => {
  writeFileSync(join(c.paths.wiDir, 'WI-1.md'), serializeWorkItem({ ...parseWorkItem(readFileSync(join(c.paths.wiDir, 'WI-1.md'), 'utf8')), status: 'complete' }));
  const r = await patch(c, 'WI-13', { initiativeId: I2_INIT, dependsOn: ['WI-8'] });
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'not-at-kickoff');
  assert.match(String(r.body.detail), /a work item is complete/);
  assert.deepEqual(deps(c.paths.wiDir, 'WI-13'), []);
}));

test('PATCH takes the manifest lock the add takes: Start landing while it waits is refused 409, nothing rewritten', () => withBridge(async (c) => {
  await lockfile.lock(c.paths.manifestPath, { realpath: false });
  const pending = patch(c, 'WI-13', { initiativeId: I2_INIT, dependsOn: ['WI-8'] }); // outer check passes, then it waits on the lock
  await new Promise((r) => setTimeout(r, 120)); // inside the lock's retry backoff (50 ms, then 100 ms, …)
  lockfile.unlockSync(c.paths.manifestPath, { realpath: false });
  assert.equal(enqueueDevelopRun(I2_INIT, { queueRoot: join(c.root, '_queue') }).status, 'enqueued');
  const r = await pending;
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.status, 'not-at-kickoff');
  assert.deepEqual(deps(c.paths.wiDir, 'WI-13'), []);
}));

// ---- the roadmap serves the set in natural order, with dependsOn -------------

test('the roadmap serves I2\'s work items in natural id order with their dependsOn', () => withBridge(async (c) => {
  const res = await fetch(`${c.url}/api/studio/projects/gitweave/roadmap`);
  const body = (await res.json()) as { roadmap: { initiatives: Array<{ initiativeId: string; workItems?: Array<{ id: string; dependsOn: string[] }> }> } };
  const wis = body.roadmap.initiatives.find((i) => i.initiativeId === I2_INIT)?.workItems ?? [];
  assert.deepEqual(wis.map((w) => w.id), ['WI-1', 'WI-2', 'WI-3a', 'WI-3b', 'WI-4', 'WI-5a', 'WI-5b', 'WI-6', 'WI-7', 'WI-8', 'WI-9a', 'WI-9b', 'WI-10', 'WI-11', 'WI-12', 'WI-13', 'WI-14']);
  assert.deepEqual(wis.find((w) => w.id === 'WI-9b')?.dependsOn, ['WI-8', 'WI-3b', 'WI-9a']);
}));

test('the CORS preflight admits PATCH (Studio on its own port sends the edit cross-origin)', () => withBridge(async (c) => {
  const res = await fetch(`${c.url}${ROUTE}/WI-13`, { method: 'OPTIONS', headers: { origin: 'http://localhost:4124', 'access-control-request-method': 'PATCH' } });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /\bPATCH\b/);
}));
