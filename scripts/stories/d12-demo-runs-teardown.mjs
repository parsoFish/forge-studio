/**
 * d12-demo-runs-teardown.mjs — exact-path residue removal for the control +
 * positive demo-pipeline runs (bead `forge-1rk5.3`): the git worktree this
 * run created, the local branch it created, and the `_queue/` manifest it
 * wrote — each removed by the EXACT path/name this run itself produced,
 * never a glob or a pattern (a pattern-based removal is how one run's
 * teardown reaches another run's worktree/branch/manifest).
 *
 * `_logs/<cycleId>` is deliberately NOT touched here — it is the run's
 * evidence, named in the JSON report instead (`d12-demo-runs.mjs`).
 *
 * None of `scripts/stories/sweep-teardown.mjs`'s exports fit: every one of
 * them operates across the WHOLE census (every worktree the scheduler
 * currently owns, every swept path this serve pass touched) — there is no
 * single-path "remove this one worktree/branch/manifest" primitive there to
 * reuse. These three are that primitive, each independently unit-testable
 * against a real tmp git repo (no mocks).
 *
 * Each function returns `{removed: false, reason: 'already absent'}` rather
 * than throwing when there is nothing to remove (an already-gone resource is
 * not a failure — the same convention `fixture-ground.mjs`'s
 * `teardownFixtureGround` uses); a REAL removal failure throws, so the
 * caller's own named-step wrapper (`d12-demo-runs.mjs`'s `runTeardown`)
 * reports it rather than swallowing it.
 */
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { getPaths } from '@forge/flows';

/**
 * Remove the git worktree at EXACTLY `worktreePath` (`git worktree remove
 * --force`, run from `projectRepoPath` — worktree state lives in the main
 * repo's `.git/worktrees/`, not in the worktree dir itself), then prune the
 * registry. `--force` because this run never merges, so the worktree's
 * branch is (by design) never "fully merged" — the one case `git worktree
 * remove` would otherwise refuse.
 *
 * @param {string} projectRepoPath
 * @param {string} worktreePath
 * @returns {{removed: boolean, reason?: string}}
 */
export function removeInitiativeWorktree(projectRepoPath, worktreePath) {
  if (!existsSync(worktreePath)) return { removed: false, reason: 'already absent' };
  execFileSync('git', ['-C', projectRepoPath, 'worktree', 'remove', '--force', worktreePath], { stdio: 'pipe' });
  try {
    execFileSync('git', ['-C', projectRepoPath, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch {
    /* best-effort registry catch-up — the remove above already succeeded */
  }
  return { removed: true };
}

/**
 * Delete EXACTLY `branch` (`git branch -D`) from `projectRepoPath`'s local
 * branch namespace. `-D`, not `-d`: this run's branch is never merged (it
 * never approves, never merges), so `-d`'s "not fully merged" refusal would
 * fire on every single call — the forced delete is the correct one, not a
 * shortcut around a real warning.
 *
 * MUST run after the worktree that had it checked out is already removed —
 * git refuses to delete a branch that is checked out in a worktree.
 *
 * @param {string} projectRepoPath
 * @param {string} branch
 * @returns {{removed: boolean, reason?: string}}
 */
export function deleteLocalBranch(projectRepoPath, branch) {
  try {
    execFileSync('git', ['-C', projectRepoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      stdio: 'pipe',
    });
  } catch {
    return { removed: false, reason: 'already absent' };
  }
  execFileSync('git', ['-C', projectRepoPath, 'branch', '-D', branch], { stdio: 'pipe' });
  return { removed: true };
}

/**
 * Remove this run's `<initiativeId>.md` manifest from WHICHEVER `_queue/`
 * state dir it is currently sitting in (`pending`/`in-flight`/
 * `ready-for-review`/`merged`/`done`/`failed` — the develop flow's own state
 * machine, `packages/flows/queue.ts`) — an exact single-file `rmSync`, never
 * a directory or a glob.
 *
 * @param {string} forgeRoot
 * @param {string} initiativeId
 * @returns {{removed: boolean, state?: string, path?: string, reason?: string}}
 */
export function removeQueueManifest(forgeRoot, initiativeId) {
  const paths = getPaths(join(forgeRoot, '_queue'));
  const filename = `${initiativeId}.md`;
  const states = /** @type {const} */ (['pending', 'inFlight', 'readyForReview', 'merged', 'done', 'failed']);
  for (const state of states) {
    const full = join(paths[state], filename);
    if (existsSync(full)) {
      rmSync(full, { force: true });
      return { removed: true, state, path: full };
    }
  }
  return { removed: false, reason: 'not found in any _queue/ state dir' };
}
