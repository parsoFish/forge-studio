/**
 * Defect fix (F-09 gap) — a merged cycle's worktree cleanup was NEVER wired
 * up: scheduler-run-one.ts's `preserveWorktree` keeps the cycle worktree
 * alive through `ready-for-review`/`pr-open` on the promise "cleanup happens
 * when the operator merges the PR", but nothing on the merge path ever
 * redeemed that promise. `finalize-merged.ts`'s `pruneMergedWorktrees` is the
 * fix: on the success path of `makeDefaultFinalizeOne`, after closure has
 * confirmed the merge and the manifest has landed in `done/`, it prunes the
 * cycle worktree (`worktree.cleanup`) and the initiative's per-WI scratch
 * (`pruneStaleWiWorktrees` + the now-empty `wi/<initiativeId>/` dir).
 *
 * SIBLING FILE (not appended to finalize-merged.test.ts): the parent suite is
 * already near the 800-line file cap; these tests are self-contained here
 * with their own small fixtures rather than pushing that file over it.
 *
 * Like the "real runClosure + promoteMergedToDone round-trip" test in the
 * parent suite, these use REAL temp git repos + REAL `git worktree add`
 * (worktree.test.ts / wi-worktree.test.ts's own pattern) rather than mocks:
 * the property under test IS "did the real git state get cleaned up", which
 * a call-count spy on an injected stub cannot prove.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { finalizeMergedReadyForReview } from '../../finalize-merged.ts';
import { runClosure as realRunClosure } from '../../phases/closure.ts';
import { add as worktreeAdd, list as worktreeList } from '../../worktree.ts';
import { createWiWorktree } from '../../wi-worktree.ts';
import { UNREACHED_RUN_REFLECTOR } from '../test-fixtures/phase-wiring.ts';

// Captured ONCE at module load — mirrors finalize-merged.test.ts's own
// MODULE_CWD: the real-runClosure test below chdirs into its fixture root
// (real `runClosure`/`promoteMergedToDone` default to a cwd-relative `_queue`)
// and must restore this afterwards.
const MODULE_CWD = process.cwd();

/** Mirrors finalize-merged.test.ts's own `setup()` — a bare queue fixture. */
function setup(): { root: string; queueRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'finalize-prune-fx-'));
  const queueRoot = join(root, '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  mkdirSync(join(root, '_worktrees'), { recursive: true });
  mkdirSync(join(root, 'projects', 'demo'), { recursive: true });
  return { root, queueRoot };
}

/** Mirrors finalize-merged.test.ts's own `writeManifest()`. */
function writeManifest(queueRoot: string, state: string, id: string, worktreePath: string): void {
  const projectRepoPath = join(dirname(queueRoot), 'projects', 'demo');
  const body = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${projectRepoPath}`,
    "created_at: '2026-05-30T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'class: code',
    'phase: pending',
    'origin: architect',
    `worktree_path: ${worktreePath}`,
    '---',
    `# ${id}`,
    '',
  ].join('\n');
  writeFileSync(join(queueRoot, state, `${id}.md`), body);
}

/** Mirrors finalize-merged.test.ts's own `writeManifestFields()` — independently-settable path fields. */
function writeManifestFields(
  queueRoot: string,
  state: string,
  id: string,
  fields: { worktreePath: string; projectRepoPath: string; cycleId: string },
): void {
  const body = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${fields.projectRepoPath}`,
    "created_at: '2026-05-30T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'class: code',
    'phase: pending',
    'origin: architect',
    `worktree_path: ${fields.worktreePath}`,
    `cycle_id: ${fields.cycleId}`,
    '---',
    `# ${id}`,
    '',
  ].join('\n');
  writeFileSync(join(queueRoot, state, `${id}.md`), body);
}

function initRepoForPrune(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'finalize-prune-'));
  // SEC-02 round 3's containment guard requires `project_repo_path` under
  // `<forgeRoot>/projects/` (same shape `setup()`'s fixture uses) — `dir`
  // itself is the `forgeRoot` finalizeMergedReadyForReview derives from
  // `queueRoot`'s parent below.
  const repo = join(dir, 'projects', 'demo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'], { stdio: 'pipe' });
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { stdio: 'pipe' });
  return { dir, repo };
}

test('finalize: [F-09 gap] a merged cycle prunes its cycle worktree (git worktree list no longer carries it) AND its per-WI scratch dir', async () => {
  const { dir, repo } = initRepoForPrune();
  try {
    const queueRoot = join(dir, '_queue');
    for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
      mkdirSync(join(queueRoot, d), { recursive: true });
    }
    const id = 'INIT-2026-09-25-prune';
    const worktreesRoot = join(dir, '_worktrees');
    const branch = `forge/${id}`;
    const cycleWt = worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot, initiativeId: id });
    const headRef = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // A per-WI scratch worktree left behind for the same initiative — the
    // shape createWiWorktree leaves at `<worktreesRoot>/wi/<id>/<workItemId>`.
    createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId: id,
      workItemId: 'WI-1',
      startPointRef: headRef,
      cycleWorktreePath: cycleWt.path,
    });
    const wiInitiativeDir = join(worktreesRoot, 'wi', id);
    assert.ok(existsSync(cycleWt.path), 'precondition: cycle worktree present');
    assert.ok(existsSync(wiInitiativeDir), 'precondition: per-WI scratch dir present');

    writeManifestFields(queueRoot, 'ready-for-review', id, {
      worktreePath: cycleWt.path,
      projectRepoPath: repo,
      cycleId: `2026-09-25T00-00-00_${id}`,
    });

    const results = await finalizeMergedReadyForReview({
      runReflector: UNREACHED_RUN_REFLECTOR, // no declared merge trigger below → never invoked
      queueRoot,
      logsRoot: join(dir, '_logs'),
      confirmMerge: () => true,
      // Stubbed (not real closure): isolates this test to the NEW prune
      // wiring, which fires on `closure.merged === true` regardless of how
      // that confirmation was reached — the real closure→confirm chain is
      // covered by finalize-merged.test.ts's own "real runClosure" test.
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      loadFlowTriggers: () => [], // isolate to the prune path — no reflect noise
    });

    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.equal(existsSync(cycleWt.path), false, 'the cycle worktree dir must be removed');
    assert.equal(
      worktreeList(repo).some((w) => resolve(w.path) === resolve(cycleWt.path)),
      false,
      "git's own worktree registry must no longer carry the cycle worktree",
    );
    assert.equal(existsSync(wiInitiativeDir), false, 'the per-WI scratch dir for the initiative must be removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finalize: [F-09 gap] a prune failure (cleanupWorktree + pruneWiWorktrees both throw) never changes the finalize outcome — manifest still promoted to done/, failures recorded as events', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-09-25-prune-fail';
    writeManifest(queueRoot, 'ready-for-review', id, wt);

    // Real runClosure/promoteMergedToDone default to a cwd-relative `_queue`
    // (same convention as finalize-merged.test.ts's own "real runClosure"
    // round-trip test).
    process.chdir(root);
    try {
      const results = await finalizeMergedReadyForReview({
        runReflector: UNREACHED_RUN_REFLECTOR,
        queueRoot,
        logsRoot: join(root, '_logs'),
        confirmMerge: () => true,
        runClosure: (input, logger, reviewerOutcome) =>
          realRunClosure({ ...input, confirmMerge: () => true }, logger, reviewerOutcome),
        loadFlowTriggers: () => [],
        cleanupWorktree: () => {
          throw new Error('cleanup boom');
        },
        pruneWiWorktrees: () => {
          throw new Error('prune boom');
        },
      });
      assert.deepEqual(
        results.map((r) => r.status),
        ['finalized'],
        'a prune failure must not turn an already-successful finalize into an error',
      );
    } finally {
      process.chdir(MODULE_CWD);
    }

    assert.equal(
      existsSync(join(queueRoot, 'done', `${id}.md`)),
      true,
      'the manifest must still be promoted to done/ despite the prune failure',
    );

    const eventsPath = join(root, '_logs', id, 'events.jsonl');
    assert.ok(existsSync(eventsPath), 'cycle events.jsonl exists');
    const messages = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as { message?: string }).message);
    assert.ok(messages.includes('finalize.worktree-prune-failed'), `expected finalize.worktree-prune-failed — got ${JSON.stringify(messages)}`);
    assert.ok(messages.includes('finalize.wi-worktree-prune-failed'), `expected finalize.wi-worktree-prune-failed — got ${JSON.stringify(messages)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
