/**
 * ACCEPTANCE TESTS (must be RED until SEC-02 lands) — real-client-path pin
 * for the manifest-path-fields defect (`forge-d1f`).
 *
 * T2 reproduced this live: `POST /api/initiatives` (`cli/bridge-recovery.ts`)
 * accepts frontmatter `worktree_path` / `project_repo_path` / `cycle_id` /
 * `project` with ZERO validation (`validateManifest`, `orchestrator/
 * manifest.ts`, never checks these fields). `POST /api/recovery/:id/requeue`
 * then calls `runRequeue` (`cli/forge-requeue.ts`), whose default
 * `resume:false` -> `preserveWorktree=false` -> an unconditional
 * `rmSync(worktreePath, {recursive:true, force:true})` on whatever string the
 * attacker put in the manifest. T2's live probe:
 *   POST /api/initiatives          -> 201 {"ok":true}
 *   POST /api/recovery/:id/requeue -> 200 {"ok":true,"worktreeRemoved":true}
 *   sentinel dir survives -> false ; sentinel bytes identical -> false
 *
 * This file drives the REAL bridge over real HTTP (`startBridge` from
 * `./ui-bridge.ts`) — a hand-constructed call into `runRequeue` would not
 * exercise the client's manifest serialization at all, which is exactly
 * where this defect lives (the ingest route never validates what it writes).
 *
 * The fix under test is `cli/manifest-path-guard.ts` (does not exist yet as
 * of this writing — every negative case below is expected to fail RED for
 * that reason: the ingest route currently performs no path validation at
 * all, so `POST /api/initiatives` 201s every one of these attacker manifests
 * today).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../cli/ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
const outsideDirs: string[] = [];

function newOutsideDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  outsideDirs.push(d);
  return d;
}

/**
 * Builds manifest markdown frontmatter from a field map. Every string value
 * is emitted via `JSON.stringify` (a valid YAML double-quoted scalar) so an
 * attacker-shaped value (leading dots, `..`, embedded punctuation) round-trips
 * through `gray-matter`/js-yaml exactly as written — never accidentally
 * mangled or silently reinterpreted by an unquoted-scalar edge case.
 */
function manifestMd(overrides: Record<string, unknown>): string {
  const id = overrides.initiative_id as string;
  const data: Record<string, unknown> = {
    initiative_id: id,
    project: 'test-project',
    project_repo_path: '',
    created_at: '2026-08-06T00:00:00.000Z',
    iteration_budget: 5,
    cost_budget_usd: 2.0,
    ...overrides,
  };
  const yamlLines = Object.entries(data).map(
    ([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`,
  );
  return ['---', ...yamlLines, '---', '', `# ${id}`, ''].join('\n');
}

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function pendingPath(id: string): string {
  return join(forgeRoot, '_queue', 'pending', `${id}.md`);
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-recovery-manifest-containment-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  // Pre-create the two legitimate containment roots so a correct fix (which
  // must realpath-verify the root itself) is never blocked merely because
  // the root directory doesn't yet exist on a pristine forgeRoot.
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// THE HEADLINE: sentinel survival through ingest + requeue.
// ---------------------------------------------------------------------------

test('(RED) sentinel survival: a manifest whose worktree_path names a real directory OUTSIDE forgeRoot must not have that directory destroyed by ingest + requeue', async () => {
  const outside = newOutsideDir('sec02-sentinel-outside-');
  const nestedDir = join(outside, 'nested');
  mkdirSync(nestedDir, { recursive: true });
  const sentinelFile = join(nestedDir, 'secret.txt');
  const sentinelBytes = 'SENTINEL-BYTES-DO-NOT-DELETE-4f7a1e9d\n';
  writeFileSync(sentinelFile, sentinelBytes);

  const id = 'INIT-2026-08-06-sec02-sentinel';
  const manifest = manifestMd({ initiative_id: id, worktree_path: outside });

  const ingest = await postJson('/api/initiatives', { manifest });
  const requeue = await postJson(`/api/recovery/${id}/requeue`, {});

  // PRIMARY assertion — must stand on its own, independent of any status
  // code either call returns: the real, pre-existing filesystem object
  // outside forgeRoot must be completely untouched.
  assert.equal(existsSync(outside), true, `the sentinel directory itself must still exist — ingest=${ingest.status} ${JSON.stringify(ingest.json)}, requeue=${requeue.status} ${JSON.stringify(requeue.json)}`);
  assert.equal(existsSync(sentinelFile), true, 'the nested sentinel file must still exist');
  assert.equal(readFileSync(sentinelFile, 'utf8'), sentinelBytes, 'the sentinel file bytes must be BYTE-IDENTICAL to what was written before the attack');

  // SECONDARY assertion — the ingest route should itself reject an
  // out-of-bounds worktree_path outright.
  assert.equal(ingest.status, 400, `expected ingest to reject a worktree_path outside forgeRoot — got ${ingest.status}: ${JSON.stringify(ingest.json)}`);
});

// ---------------------------------------------------------------------------
// project_repo_path outside projects/
// ---------------------------------------------------------------------------

test('(RED) project_repo_path outside projects/ is rejected at ingest and never lands in _queue/pending/', async () => {
  const outsideRepo = newOutsideDir('sec02-repo-outside-');
  const id = 'INIT-2026-08-06-sec02-repopath';
  const manifest = manifestMd({ initiative_id: id, project_repo_path: outsideRepo });

  const ingest = await postJson('/api/initiatives', { manifest });

  assert.equal(ingest.status, 400, `expected ingest to reject a project_repo_path outside <forgeRoot>/projects/ — got ${ingest.status}: ${JSON.stringify(ingest.json)}`);
  assert.equal(existsSync(pendingPath(id)), false, 'the manifest must NOT be written into _queue/pending/ when the ingest guard rejects it');
});

// ---------------------------------------------------------------------------
// cycle_id traversal
// ---------------------------------------------------------------------------

test('(RED) cycle_id traversal ("../../../../etc/poisoned") is rejected at ingest', async () => {
  const id = 'INIT-2026-08-06-sec02-cycleid';
  const manifest = manifestMd({ initiative_id: id, cycle_id: '../../../../etc/poisoned' });

  const ingest = await postJson('/api/initiatives', { manifest });

  assert.equal(ingest.status, 400, `expected ingest to reject a traversal cycle_id — got ${ingest.status}: ${JSON.stringify(ingest.json)}`);
  assert.equal(existsSync(pendingPath(id)), false, 'the manifest must NOT be written into _queue/pending/ when the ingest guard rejects it');
});

// ---------------------------------------------------------------------------
// project traversal
// ---------------------------------------------------------------------------

test('(RED) project traversal ("../../../../tmp") is rejected at ingest', async () => {
  const id = 'INIT-2026-08-06-sec02-projecttrav';
  const manifest = manifestMd({ initiative_id: id, project: '../../../../tmp' });

  const ingest = await postJson('/api/initiatives', { manifest });

  assert.equal(ingest.status, 400, `expected ingest to reject a traversal project name — got ${ingest.status}: ${JSON.stringify(ingest.json)}`);
  assert.equal(existsSync(pendingPath(id)), false, 'the manifest must NOT be written into _queue/pending/ when the ingest guard rejects it');
});

// ---------------------------------------------------------------------------
// MANDATORY positive control: a legitimate manifest must still ingest.
// Without this, the suite would pass against a guard that rejects
// everything, which is not a guard.
// ---------------------------------------------------------------------------

test('a legitimate manifest (real, contained path fields) still ingests 201 and lands in _queue/pending/', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'demo'), { recursive: true });
  const id = 'INIT-2026-08-06-sec02-legit';
  const manifest = manifestMd({
    initiative_id: id,
    project: 'demo',
    project_repo_path: join(forgeRoot, 'projects', 'demo'),
    worktree_path: join(forgeRoot, '_worktrees', id),
    cycle_id: '2026-08-06T00-00-00_INIT-2026-08-06-ok',
  });

  const ingest = await postJson('/api/initiatives', { manifest });

  assert.equal(ingest.status, 201, `expected a legitimate manifest to ingest fine — got ${ingest.status}: ${JSON.stringify(ingest.json)}`);
  assert.equal(existsSync(pendingPath(id)), true, 'expected the legitimate manifest to land in _queue/pending/');
});

// ---------------------------------------------------------------------------
// A legitimate requeue still works end-to-end (proves the fix does not
// simply disable the requeue feature).
// ---------------------------------------------------------------------------

test('a legitimate requeue still removes the forge-managed worktree end-to-end', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'demo2'), { recursive: true });
  const id = 'INIT-2026-08-06-sec02-legit-requeue';
  const wt = join(forgeRoot, '_worktrees', id);
  const manifest = manifestMd({
    initiative_id: id,
    project: 'demo2',
    project_repo_path: join(forgeRoot, 'projects', 'demo2'),
    worktree_path: wt,
    cycle_id: '2026-08-06T00-00-01_INIT-2026-08-06-ok2',
  });

  const ingest = await postJson('/api/initiatives', { manifest });
  assert.equal(ingest.status, 201, `sanity: legitimate manifest must ingest fine — got ${ingest.status}: ${JSON.stringify(ingest.json)}`);

  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, 'leftover.txt'), 'from a prior cycle');

  const requeue = await postJson(`/api/recovery/${id}/requeue`, {});

  assert.equal(requeue.status, 200, `expected the legitimate requeue to succeed — got ${requeue.status}: ${JSON.stringify(requeue.json)}`);
  assert.equal(requeue.json.worktreeRemoved, true, `expected worktreeRemoved:true — got ${JSON.stringify(requeue.json)}`);
  assert.equal(existsSync(wt), false, 'the forge-managed worktree must actually have been removed');
});
