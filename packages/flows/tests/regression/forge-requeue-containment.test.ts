/**
 * ACCEPTANCE TESTS (must be RED until SEC-02 lands) — defence-in-depth pin at
 * `runRequeue` (`packages/flows/forge-requeue.ts`) itself, the actual destructive call
 * site (`rmSync(worktreePath, {recursive:true, force:true})` /
 * `git -C <projectRepoPath> branch -D` / `push origin --delete`).
 *
 * `POST /api/initiatives` is only ONE way a manifest reaches disk. This file
 * plants the manifest DIRECTLY with `writeFileSync` into
 * `<forgeRoot>/_queue/pending/<id>.md`, bypassing ingest entirely — this
 * simulates a future ingest path that forgets to validate, or a manifest
 * poisoned by some other writer. `runRequeue` re-serializes via
 * `serializeManifest` without validating anything today, so this is a
 * genuinely independent choke point from the bridge-route fix in
 * `packages/flows/bridge-recovery-manifest-containment.test.ts`.
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
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runRequeue } from '../../forge-requeue.ts';

let forgeRoot: string;
const outsideDirs: string[] = [];

function newOutsideDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  outsideDirs.push(d);
  return d;
}

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'forge-requeue-containment-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

/** Raw manifest markdown, planted directly on disk — bypasses ingest/validateManifest entirely. */
function rawManifest(overrides: Record<string, unknown>): string {
  const id = overrides.initiative_id as string;
  const data: Record<string, unknown> = {
    initiative_id: id,
    project: 'test-project',
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

function plantManifest(id: string, overrides: Record<string, unknown>): void {
  writeFileSync(join(forgeRoot, '_queue', 'pending', `${id}.md`), rawManifest({ initiative_id: id, ...overrides }));
}

// ---------------------------------------------------------------------------
// worktree_path outside forgeRoot — the headline rmSync repro, at the
// destructive call site directly (no HTTP layer involved at all).
// ---------------------------------------------------------------------------

test('(RED) worktree_path outside forgeRoot (sentinel directory): runRequeue THROWS, and the sentinel dir + nested file + bytes survive', () => {
  const outside = newOutsideDir('frq-sentinel-outside-');
  const nestedDir = join(outside, 'nested');
  mkdirSync(nestedDir, { recursive: true });
  const sentinelFile = join(nestedDir, 'secret.txt');
  const sentinelBytes = 'SENTINEL-DIRECT-PLANT-BYTES-9d31c7a2\n';
  writeFileSync(sentinelFile, sentinelBytes);

  const id = 'INIT-2026-08-06-frq-sentinel';
  plantManifest(id, { worktree_path: outside });

  assert.throws(
    () => runRequeue(id, { forgeRoot }),
    Error,
    'runRequeue must throw rather than rmSync an out-of-root worktree_path',
  );

  assert.equal(existsSync(outside), true, 'the sentinel directory itself must still exist');
  assert.equal(existsSync(sentinelFile), true, 'the nested sentinel file must still exist');
  assert.equal(readFileSync(sentinelFile, 'utf8'), sentinelBytes, 'the sentinel file bytes must be BYTE-IDENTICAL');
});

// ---------------------------------------------------------------------------
// project_repo_path outside projects/ — reaches `git -C <path> branch -D` /
// `push origin --delete`. Proven with a REAL git repo + a REAL bare "origin"
// remote so a wrongly-permissive fix would actually delete the branch
// locally and/or on the remote, not just fail to read a mock.
// ---------------------------------------------------------------------------

function realGitRepoWithPushedBranch(root: string, initiativeId: string): { repoDir: string; bareDir: string } {
  const bareDir = join(root, 'bare-origin.git');
  mkdirSync(bareDir, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', bareDir], { stdio: 'pipe' });

  const repoDir = join(root, 'attacker-repo');
  mkdirSync(repoDir, { recursive: true });
  const git = (args: string[]): void => { execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' }); };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@forge.local']);
  git(['config', 'user.name', 'forge-test']);
  writeFileSync(join(repoDir, 'README.md'), '# attacker repo\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  git(['remote', 'add', 'origin', bareDir]);
  git(['push', '-q', 'origin', 'main']);
  git(['checkout', '-q', '-b', `forge/${initiativeId}`]);
  writeFileSync(join(repoDir, 'sentinel.txt'), 'SENTINEL-BRANCH-BYTES\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'sentinel commit']);
  git(['push', '-q', 'origin', `forge/${initiativeId}`]);
  git(['checkout', '-q', 'main']);
  return { repoDir, bareDir };
}

test('(RED) project_repo_path outside projects/: runRequeue THROWS, and the branch survives BOTH locally and on the "origin" remote', () => {
  const outsideRoot = newOutsideDir('frq-repo-outside-');
  const id = 'INIT-2026-08-06-frq-repo';
  const { repoDir, bareDir } = realGitRepoWithPushedBranch(outsideRoot, id);

  // worktree_path deliberately absent — isolates this case to the
  // project_repo_path escape only (a nonexistent default under
  // <forgeRoot>/_worktrees/<id> never gets close to a real fs mutation).
  plantManifest(id, { project_repo_path: repoDir });

  assert.throws(
    () => runRequeue(id, { forgeRoot }),
    Error,
    'runRequeue must throw rather than run git -C <path> branch -D / push --delete against an out-of-root project_repo_path',
  );

  // The branch must survive LOCALLY in the attacker/outside repo.
  execFileSync('git', ['-C', repoDir, 'rev-parse', '--verify', `refs/heads/forge/${id}`], { stdio: 'pipe' });

  // The branch must ALSO survive on the "origin" remote — proving
  // `push origin --delete` never ran.
  const remoteBranches = execFileSync('git', ['-C', bareDir, 'branch', '--list', `forge/${id}`], { encoding: 'utf8' });
  assert.ok(remoteBranches.includes(`forge/${id}`), `expected the branch to survive on the origin remote — got: ${JSON.stringify(remoteBranches)}`);
});

// ---------------------------------------------------------------------------
// Positive control: a legitimate forge-managed worktree IS still removed.
// Proves the fix does not simply disable the requeue feature.
// ---------------------------------------------------------------------------

test('positive control: a legitimate _worktrees/<id> worktree IS still removed, and runRequeue reports worktreeRemoved:true', () => {
  const id = 'INIT-2026-08-06-frq-legit';
  const wt = join(forgeRoot, '_worktrees', id);
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, 'leftover.txt'), 'from a prior cycle');

  plantManifest(id, { worktree_path: wt });

  const r = runRequeue(id, { forgeRoot });

  assert.equal(r.worktreeRemoved, true, `expected worktreeRemoved:true for a legitimate forge-managed worktree — got ${JSON.stringify(r)}`);
  assert.equal(existsSync(wt), false, 'the legitimate forge-managed worktree must actually be removed on disk');
});
