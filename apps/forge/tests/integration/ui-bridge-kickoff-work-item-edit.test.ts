/**
 * Bead forge-nk1y.32 (D-48 amended) — the Kickoff gate's full edit through the
 * real bridge (port 0, tmp forge root holding gitweave I2 as it stands live,
 * no spawn, no network):
 *
 *   - `PATCH /api/kickoff/work-items/<wiId>` takes summary, acceptanceCriteria,
 *     qualityGateCmd, filesInScope, creates and dependsOn (each optional; body
 *     validated at the boundary naming the field); a plan work item takes
 *     dependsOn only (409 `not-a-kickoff-work-item`);
 *   - every scope entry is one relative path, on the add too (400 `invalid`);
 *   - the roadmap serves each kickoff-added work item's editable fields at the gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
type Send = (method: 'POST' | 'PATCH', path: string, b: unknown) => Promise<Reply>;
type Client = { url: string; root: string; paths: I2Paths; send: Send };

async function withBridge(fn: (c: Client) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'kickoff-edit-route-'));
  const paths = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  const send: Send = async (method, path, b) => {
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
const build = (c: Client) => {
  const wi1 = wi(c.paths.wiDir, 'WI-1');
  writeFileSync(join(c.paths.wiDir, 'WI-1.md'), serializeWorkItem({ ...wi1, status: 'complete' }));
};

// ---- PATCH: the full editable set -------------------------------------------------

test('PATCH 200: WI-14\'s files_in_scope fixed + creates → worktree and snapshot rewritten', () => withBridge(async (c) => {
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
  assert.ok(String(r.body.detail).includes(`files_in_scope entry "${WI14_ENTRY}" refused: contains whitespace`));
}));

test('PATCH 409: a plan work item takes dependsOn only; dependsOn alone still edits it', () => withBridge(async (c) => {
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

// ---- POST: the path rule and creates ------------------------------------------------

test('POST 400: WI-14\'s whitespace entry is refused naming it; creates must be a string list', () => withBridge(async (c) => {
  const ADD = {
    initiativeId: I2_INIT,
    summary: 's',
    acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
    qualityGateCmd: ['pytest'],
  };
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

type RoadmapBody = {
  roadmap: { initiatives: Array<{ initiativeId: string; workItems?: Array<{ id: string; kickoff?: Record<string, unknown> }> }> };
};

test('the roadmap serves kickoff-added WIs\' editable fields at the gate — WI-13/14 only', () => withBridge(async (c) => {
  const res = await fetch(`${c.url}/api/studio/projects/gitweave/roadmap`);
  const body = (await res.json()) as RoadmapBody;
  const wis = body.roadmap.initiatives.find((i) => i.initiativeId === I2_INIT)?.workItems ?? [];
  assert.deepEqual(wis.filter((w) => w.kickoff).map((w) => w.id), ['WI-13', 'WI-14']);
  const k = wis.find((w) => w.id === 'WI-14')!.kickoff!;
  assert.deepEqual(k.filesInScope, [WI14_ENTRY]);
  assert.equal(k.summary, 'No Terraform references left in agent context or docs');
  assert.deepEqual(k.creates, []);
  assert.deepEqual(k.qualityGateCmd, ['python3', '-m', 'pytest', 'tests/test_docs_no_terraform_tokens.py']);
}));
