/**
 * Bead forge-nk1y.32 (D-48 amended) — the Kickoff gate's full edit and delete
 * through the real bridge (port 0, tmp forge root holding gitweave I2 as it
 * stands live, no spawn, no network):
 *
 *   - `PATCH /api/kickoff/work-items/<wiId>` takes summary, acceptanceCriteria,
 *     qualityGateCmd, filesInScope, creates and dependsOn (each optional; body
 *     validated at the boundary naming the field); a plan work item takes
 *     dependsOn only (409 `not-a-kickoff-work-item`);
 *   - `DELETE /api/kickoff/work-items/<wiId>` `{ initiativeId }` removes a work
 *     item added at the gate: 200 / 400 / 404 / 409 (`has-dependents`,
 *     `not-a-kickoff-work-item`, `not-at-kickoff`);
 *   - every scope entry is one relative path, on the add too (400 `invalid`);
 *   - the roadmap serves each kickoff-added work item's editable fields at the gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';
import { parseWorkItem, serializeWorkItem } from '@forge/flows';
import { I2_INIT, plantI2Kickoff, type I2Paths } from '../../../../packages/flows/tests/test-fixtures/kickoff-deps-i2.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const ROUTE = '/api/kickoff/work-items';
const WI14_ENTRY = 'tests/test_docs_no_terraform_tokens.py .github/copilot-context.md';
const FIXED = ['tests/test_docs_no_terraform_tokens.py', '.github/copilot-context.md'];

type Reply = { status: number; body: Record<string, unknown> };
type Client = { url: string; root: string; paths: I2Paths; send: (method: 'POST' | 'PATCH' | 'DELETE', path: string, b: unknown) => Promise<Reply> };

async function withBridge(fn: (c: Client) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'kickoff-edit-route-'));
  const paths = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  const send = async (method: 'POST' | 'PATCH' | 'DELETE', path: string, b: unknown): Promise<Reply> => {
    const res = await fetch(`${url}${path}`, { method, headers: CSRF, body: JSON.stringify(b) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try { await fn({ url, root, paths, send }); } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

const wi = (dir: string, id: string) => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8'));
const patch = (c: Client, id: string, b: unknown) => c.send('PATCH', `${ROUTE}/${id}`, b);
const del = (c: Client, id: string, b: unknown = { initiativeId: I2_INIT }) => c.send('DELETE', `${ROUTE}/${id}`, b);
const build = (c: Client) => writeFileSync(join(c.paths.wiDir, 'WI-1.md'), serializeWorkItem({ ...wi(c.paths.wiDir, 'WI-1'), status: 'complete' }));

// ---- PATCH: the full editable set -------------------------------------------------

test('PATCH 200: WI-14\'s files_in_scope fixed (two entries) + creates → worktree and snapshot rewritten', () => withBridge(async (c) => {
  const r = await patch(c, 'WI-14', { initiativeId: I2_INIT, filesInScope: FIXED, creates: [FIXED[0]] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, workItemId: 'WI-14', dependsOn: ['WI-9a', 'WI-10', 'WI-11'] });
  for (const dir of [c.paths.wiDir, c.paths.snapshotDir]) {
    assert.deepEqual(wi(dir, 'WI-14').files_in_scope, FIXED);
    assert.deepEqual(wi(dir, 'WI-14').creates, [FIXED[0]]);
  }
}));

test('PATCH 400: the bad entry left in place is refused by the path rule, naming it', () => withBridge(async (c) => {
  const r = await patch(c, 'WI-14', { initiativeId: I2_INIT, summary: 'x' });
  assert.equal(r.status, 400);
  assert.equal(r.body.status, 'invalid');
  assert.match(String(r.body.detail), new RegExp(`files_in_scope entry "${WI14_ENTRY.replace(/\./g, '\\.')}" refused: contains whitespace`));
}));

test('PATCH 409: a plan work item takes dependsOn only (not-a-kickoff-work-item); dependsOn alone still edits it', () => withBridge(async (c) => {
  const r = await patch(c, 'WI-12', { initiativeId: I2_INIT, summary: 'rewritten' });
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'not-a-kickoff-work-item');
  assert.equal((await patch(c, 'WI-12', { initiativeId: I2_INIT, dependsOn: [] })).status, 200);
  assert.deepEqual(wi(c.paths.wiDir, 'WI-12').depends_on, []);
}));

test('PATCH 409: once anything is built, not-at-kickoff', () => withBridge(async (c) => {
  build(c);
  const r = await patch(c, 'WI-14', { initiativeId: I2_INIT, filesInScope: FIXED });
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'not-at-kickoff');
}));

const BAD_EDIT: Array<[string, Record<string, unknown>]> = [
  ['summary', { summary: '' }],
  ['acceptanceCriteria', { acceptanceCriteria: [] }],
  ['acceptanceCriteria[0].then', { acceptanceCriteria: [{ given: 'g', when: 'w' }] }],
  ['qualityGateCmd', { qualityGateCmd: 'pytest' }],
  ['filesInScope', { filesInScope: [] }],
  ['creates', { creates: 'a.py' }],
  ['dependsOn', {}],
];

test('PATCH 400: a malformed field is refused naming it; an empty edit names dependsOn', () => withBridge(async (c) => {
  for (const [field, b] of BAD_EDIT) {
    const r = await patch(c, 'WI-14', { initiativeId: I2_INIT, ...b });
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.body)}`);
    assert.ok(String(r.body.error).startsWith(`${field} `), `names ${field}: ${String(r.body.error)}`);
  }
}));

// ---- DELETE ----------------------------------------------------------------------

test('DELETE 200: WI-14 gone from the worktree, the snapshot and the manifest specs', () => withBridge(async (c) => {
  const r = await del(c, 'WI-14');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, workItemId: 'WI-14' });
  assert.equal(existsSync(join(c.paths.wiDir, 'WI-14.md')), false);
  assert.equal(existsSync(join(c.paths.snapshotDir, 'WI-14.md')), false);
  assert.doesNotMatch(readFileSync(c.paths.manifestPath, 'utf8'), /WI-14/);
}));

test('DELETE 409: has-dependents naming them; a plan work item; once built', () => withBridge(async (c) => {
  assert.equal((await patch(c, 'WI-14', { initiativeId: I2_INIT, dependsOn: ['WI-13'] })).status, 200);
  const a = await del(c, 'WI-13');
  assert.equal(a.status, 409);
  assert.equal(a.body.status, 'has-dependents');
  assert.match(String(a.body.detail), /WI-14/);
  const b = await del(c, 'WI-12');
  assert.equal(b.status, 409);
  assert.equal(b.body.status, 'not-a-kickoff-work-item');
  build(c);
  const d = await del(c, 'WI-14');
  assert.equal(d.status, 409);
  assert.equal(d.body.status, 'not-at-kickoff');
  assert.equal(existsSync(join(c.paths.wiDir, 'WI-14.md')), true);
}));

test('DELETE 404 for an unknown work item; 400 naming initiativeId or workItemId', () => withBridge(async (c) => {
  assert.equal((await del(c, 'WI-99')).status, 404);
  const a = await del(c, 'WI-14', {});
  assert.equal(a.status, 400);
  assert.ok(String(a.body.error).startsWith('initiativeId '));
  const b = await del(c, 'nope');
  assert.equal(b.status, 400);
  assert.ok(String(b.body.error).startsWith('workItemId '));
}));

test('DELETE with an unreadable events log: refused 409 (fail closed), nothing removed', () => withBridge(async (c) => {
  rmSync(join(c.paths.logDir, 'events.jsonl'));
  const r = await del(c, 'WI-14');
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'not-a-kickoff-work-item');
  assert.equal(existsSync(join(c.paths.wiDir, 'WI-14.md')), true);
}));

// ---- POST: the path rule and creates ------------------------------------------------

test('POST 400: a whitespace entry (WI-14\'s, verbatim) is refused naming it; creates must be a string list', () => withBridge(async (c) => {
  const ADD = { initiativeId: I2_INIT, summary: 's', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }], qualityGateCmd: ['pytest'] };
  const r = await c.send('POST', ROUTE, { ...ADD, filesInScope: [WI14_ENTRY] });
  assert.equal(r.status, 400);
  assert.match(String(r.body.detail), /files_in_scope entry ".*" refused: contains whitespace/);
  const b = await c.send('POST', ROUTE, { ...ADD, filesInScope: ['a.py'], creates: 'a.py' });
  assert.equal(b.status, 400);
  assert.ok(String(b.body.error).startsWith('creates '));
  const ok = await c.send('POST', ROUTE, { ...ADD, filesInScope: ['a.py'], creates: ['a.py'] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(wi(c.paths.wiDir, String(ok.body.workItemId)).creates, ['a.py']);
}));

// ---- the roadmap serves the editable fields of kickoff-added WIs ---------------------

test('the roadmap serves kickoff-added WIs\' editable fields at the gate — WI-13/14 only', () => withBridge(async (c) => {
  const res = await fetch(`${c.url}/api/studio/projects/gitweave/roadmap`);
  const body = (await res.json()) as { roadmap: { initiatives: Array<{ initiativeId: string; workItems?: Array<{ id: string; kickoff?: Record<string, unknown> }> }> } };
  const wis = body.roadmap.initiatives.find((i) => i.initiativeId === I2_INIT)?.workItems ?? [];
  assert.deepEqual(wis.filter((w) => w.kickoff).map((w) => w.id), ['WI-13', 'WI-14']);
  const k = wis.find((w) => w.id === 'WI-14')!.kickoff!;
  assert.deepEqual(k.filesInScope, [WI14_ENTRY]);
  assert.equal(k.summary, 'No Terraform references left in agent context or docs');
  assert.deepEqual(k.creates, []);
  assert.deepEqual(k.qualityGateCmd, ['python3', '-m', 'pytest', 'tests/test_docs_no_terraform_tokens.py']);
}));

test('the CORS preflight admits DELETE on the kickoff work-item route', () => withBridge(async (c) => {
  const res = await fetch(`${c.url}${ROUTE}/WI-14`, { method: 'OPTIONS', headers: { origin: 'http://localhost:4124', 'access-control-request-method': 'DELETE' } });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /\bDELETE\b/);
}));
