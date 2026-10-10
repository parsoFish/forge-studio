/**
 * Bead forge-nk1y.12 (D-48) — `POST /api/kickoff/work-items` through the real
 * bridge (port 0, tmp forge root, no spawn, no network): the JSON body is
 * validated at the boundary (400 naming the field), the flows outcome maps onto
 * 200/400/404/409, and the D-47 coverage is the REAL stations function.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import lockfile from 'proper-lockfile';

import { startBridge } from '../../ui-bridge.ts';
import { parseManifest, serializeManifest } from '@forge/flows';
import { STRANDED_INIT } from '../../../../packages/flows/tests/test-fixtures/stranded-kickoff.ts';
import { RETIRE_GATE, plantKickoffWorktree } from '../../../../packages/flows/tests/test-fixtures/kickoff-worktree.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const ROUTE = '/api/kickoff/work-items';
let bridgeUrl = '';
const BODY = {
  initiativeId: STRANDED_INIT,
  summary: 'Retire the legacy specs inside I1.',
  acceptanceCriteria: [{ given: 'the legacy specs', when: 'the retire test runs', then: 'none remain' }],
  qualityGateCmd: RETIRE_GATE,
  filesInScope: ['specs/legacy.md', 'tests/retire.test.ts'],
};

type Reply = { status: number; body: Record<string, unknown> };

async function withBridge(fn: (post: (b: unknown) => Promise<Reply>, root: string) => Promise<void>, plant: (root: string) => void = (r) => { plantKickoffWorktree(r); }): Promise<void> {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kickoff-wi-route-'));
  plant(forgeRoot);
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = url;
  const post = async (b: unknown): Promise<Reply> => {
    const res = await fetch(`${url}${ROUTE}`, { method: 'POST', headers: CSRF, body: JSON.stringify(b) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try { await fn(post, forgeRoot); } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
}

test('200: the WI is added and the real D-47 coverage reports the runnable AC covered', () => withBridge(async (post, root) => {
  const r = await post(BODY);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, workItemId: 'WI-6', uncoveredAcceptanceCriteria: [] });
  assert.ok(existsSync(join(root, '_worktrees', STRANDED_INIT, '.forge', 'work-items', 'WI-6.md')));
}));

test('200: a gate that does not carry the runnable AC is still added, the real stations function names it', () => withBridge(async (post) => {
  const r = await post({ ...BODY, qualityGateCmd: ['node', '--test', 'tests/other.test.ts'] });
  assert.equal(r.status, 200);
  const uncovered = r.body.uncoveredAcceptanceCriteria as string[];
  assert.equal(uncovered.length, 1);
  assert.match(uncovered[0]!, /^AC1 \(uncarried: `node --test tests\/retire\.test\.ts`/);
}));

const long = (n: number) => 'x'.repeat(n);
const ac = { given: 'g', when: 'w', then: 't' };
const BAD: Array<[string, Record<string, unknown>]> = [
  ['initiativeId', { initiativeId: 7 }],
  ['summary', { summary: '' }],
  ['summary', { summary: long(2001) }],
  ['acceptanceCriteria', { acceptanceCriteria: [] }],
  ['acceptanceCriteria', { acceptanceCriteria: Array.from({ length: 21 }, () => ac) }],
  ['acceptanceCriteria[0].then', { acceptanceCriteria: [{ given: 'g', when: 'w', then: '' }] }],
  ['acceptanceCriteria[0].given', { acceptanceCriteria: [{ ...ac, given: long(1001) }] }],
  ['qualityGateCmd', { qualityGateCmd: [] }],
  ['qualityGateCmd', { qualityGateCmd: Array.from({ length: 65 }, () => 'a') }],
  ['qualityGateCmd[1]', { qualityGateCmd: ['npm', ''] }],
  ['filesInScope', { filesInScope: 'a.ts' }],
  ['filesInScope', { filesInScope: Array.from({ length: 201 }, (_, i) => `f${i}.ts`) }],
  ['filesInScope[0]', { filesInScope: [long(501)] }],
];

test('400: every malformed body field is refused naming the field, and nothing is written', () => withBridge(async (post, root) => {
  for (const [field, patch] of BAD) {
    const r = await post({ ...BODY, ...patch });
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.body)}`);
    assert.ok(String(r.body.error).startsWith(`${field} `), `names ${field}: ${String(r.body.error)}`);
  }
  assert.ok(!existsSync(join(root, '_worktrees', STRANDED_INIT, '.forge', 'work-items', 'WI-6.md')));
}));

test('400: a WI the set validation refuses (shell-pipeline gate) carries the named error', () => withBridge(async (post) => {
  const r = await post({ ...BODY, qualityGateCmd: ['bash', '-c', 'a | b'] });
  assert.equal(r.status, 400);
  assert.equal(r.body.status, 'invalid');
  assert.match(String(r.body.detail), /NOT a shell pipeline/);
}));

test('404: an initiative not at ready-for-review', () => withBridge(async (post) => {
  const r = await post({ ...BODY, initiativeId: 'INIT-2026-10-09-nowhere' });
  assert.equal(r.status, 404);
  assert.equal(r.body.status, 'not-found');
}));

test('409: a built initiative is refused by name', () => withBridge(async (post) => {
  const r = await post(BODY);
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'not-at-kickoff');
  assert.match(String(r.body.detail), /1 review round/);
}, (root) => { plantKickoffWorktree(root, 'review-rounds'); }));

test('409: an unsafe manifest path field', () => withBridge(async (post) => {
  const r = await post(BODY);
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'unsafe');
}, (root) => {
  const { manifestPath } = plantKickoffWorktree(root);
  const m = parseManifest(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, serializeManifest({ ...m, worktree_path: join(root, '..', 'elsewhere') }));
}));

test('Start development while an add holds the manifest lock: the per-id result is the named `locked` refusal, never a silent proceed', () => withBridge(async (_post, root) => {
  const manifestPath = join(root, '_queue', 'ready-for-review', `${STRANDED_INIT}.md`);
  const release = await lockfile.lock(manifestPath, { realpath: false });
  try {
    const res = await fetch(`${bridgeUrl}/api/develop/start`, { method: 'POST', headers: CSRF, body: JSON.stringify({ initiativeIds: [STRANDED_INIT] }) });
    const body = (await res.json()) as { ok: boolean; results: Array<{ status: string; ok: boolean; detail?: string }> };
    assert.equal(body.ok, false);
    assert.equal(body.results[0]?.status, 'locked');
    assert.match(body.results[0]?.detail ?? '', /locked by another writer/);
    assert.ok(existsSync(manifestPath));
  } finally { await release(); }
}));
