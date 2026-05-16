/**
 * PR + remote-sync boundary — the only place forge shells `git push` /
 * `gh pr ...` for the initiative branch.
 *
 * Extracted from cycle.ts (Phase 3 simplification) so the reviewer's
 * responsibility shrinks to assess + demo + open-PR, and the PR/merge
 * boundary is one named module. The create/merge split lets bench-mode
 * use a `gh` shim that records the operations locally without touching
 * real GitHub.
 *
 * Phase 6 (review-phase redesign) added the local↔remote sync primitives:
 *   - `pushInitiativeBranch` — dev-loop pushes per WI (G8 precondition).
 *   - `assertLocalRemoteSynced` — the G8 invariant: origin == local HEAD,
 *      main == merge-base. Throws on divergence.
 *   - `confirmPrMerged` — `gh pr view --json state` == MERGED. The ONLY
 *      gate for reflection (G10) + the `_queue/done/` move (G1).
 *   - `alignLocalToRemote` — on confirmed merge, ff local `main` and
 *      prune the initiative branch (closure aligns local↔remote).
 *
 * `mergePullRequest` is intentionally NOT called by any product code path
 * after Phase 6 (G9): the GitHub PR is the operator's merge surface. It is
 * retained only for bench/operator-tool use and is unreachable from
 * `runReviewer` / `runCycle` / the scheduler.
 */

import { execFileSync } from 'node:child_process';

/**
 * Best-effort PR creation via `gh pr create`. Returns the PR URL on success,
 * or null on failure. The reviewer's PR-description draft lives at
 * `<worktree>/.forge/pr-description.md` and is passed via `--body-file`.
 *
 * Pushes the local branch to the remote first; `gh pr create` requires the
 * branch to exist on origin. W4 trial caught this — pre-fix, openPullRequest
 * called `gh pr create` without a push, which fails with "no pull requests
 * found" since the branch wasn't published.
 */
export function openPullRequest(
  worktreePath: string,
  prDescriptionPath: string,
  title: string,
): string | null {
  try {
    // Determine the current branch in the worktree.
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    if (!branch || branch === 'HEAD') return null;

    // Push to origin (set-upstream so gh pr create knows the head ref).
    // Failures here propagate to the catch — a non-pushable branch is a
    // genuine merge blocker, not a soft warning.
    execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });

    const out = execFileSync(
      'gh',
      ['pr', 'create', '--body-file', prDescriptionPath, '--title', title],
      { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' },
    );
    const match = out.match(/https:\S+/);
    return match ? match[0] : out.trim() || null;
  } catch (err) {
    // Surface the failure on stderr so the operator sees what went wrong;
    // openPullRequest's nullable return is otherwise opaque.
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    if (stderr) process.stderr.write(`[openPullRequest] ${stderr}\n`);
    else if (e.message) process.stderr.write(`[openPullRequest] ${e.message}\n`);
    return null;
  }
}

/**
 * Best-effort `gh pr merge` for the approved PR. Returns true on success.
 *
 * Notably does NOT pass `--delete-branch`: that flag makes `gh` switch the
 * project repo's HEAD to main and `git branch -D` the merged branch, which
 * fails when the project repo already has main checked out at
 * `projects/<name>/` (a forge worktree was added off the same repo). Branch
 * cleanup is owned by `worktree.cleanup()` in the scheduler's finally
 * block (F-09) — local branch deleted there, remote branch lingers
 * unless the GitHub repo has "auto-delete head branches" enabled.
 */
export function mergePullRequest(worktreePath: string): boolean {
  try {
    execFileSync('gh', ['pr', 'merge', '--merge'], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return true;
  } catch (err) {
    // Surface the stderr for diagnostic visibility — the orchestrator's
    // event-log captures this via the merge-failed event_type.
    const e = err as { stderr?: Buffer | string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    if (stderr) process.stderr.write(`[mergePullRequest] ${stderr}\n`);
    return false;
  }
}

/**
 * Resolve the current branch name of a worktree. Returns null for a
 * detached HEAD or a non-git path (callers treat that as "cannot push").
 */
function currentBranch(worktreePath: string): string | null {
  try {
    const b = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return !b || b === 'HEAD' ? null : b;
  } catch {
    return null;
  }
}

function revParse(worktreePath: string, ref: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', ref], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export type PushResult =
  | { pushed: true; branch: string }
  | { pushed: false; reason: string };

/**
 * G8: push the initiative branch to `origin` so local == remote after
 * every work item. The dev-loop calls this per WI; keeping the branch
 * published every WI is the precondition the review redesign depends on
 * (no divergence → no stacked-PR merge conflicts at the boundary).
 *
 * `--set-upstream` so the first push establishes tracking; subsequent
 * pushes are fast-forwards. Best-effort by return value, not by throw:
 * a non-pushable worktree (no remote in a bench fixture without an
 * origin, detached HEAD) yields `{ pushed: false }` and the caller logs
 * it — the hard invariant is enforced separately by
 * `assertLocalRemoteSynced` at dev-loop close, which DOES throw.
 */
export function pushInitiativeBranch(worktreePath: string): PushResult {
  const branch = currentBranch(worktreePath);
  if (!branch) return { pushed: false, reason: 'detached HEAD or not a git repo' };
  try {
    execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return { pushed: true, branch };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    return { pushed: false, reason: stderr || e.message || 'git push failed' };
  }
}

export type LocalRemoteInvariant = {
  ok: boolean;
  branch: string | null;
  localHead: string | null;
  originHead: string | null;
  mergeBase: string | null;
  mainHead: string | null;
  /** Human-readable reason when `ok` is false. */
  detail: string;
};

/**
 * G8 invariant check (pure inspection — never mutates). At dev-loop close
 * the following must hold:
 *   - `origin/<branch>` == local HEAD  (the branch is fully published)
 *   - `main` == merge-base(main, <branch>)  (main has not diverged; it is
 *      still the pre-initiative state and an ancestor of the branch)
 *
 * Returns a structured result so the caller can both assert AND emit the
 * exact ref hashes into the event log for post-mortem. `assertLocalRemoteSynced`
 * wraps this and throws on `ok === false`.
 */
export function checkLocalRemoteSynced(worktreePath: string): LocalRemoteInvariant {
  const branch = currentBranch(worktreePath);
  const localHead = revParse(worktreePath, 'HEAD');
  const originHead = branch ? revParse(worktreePath, `refs/remotes/origin/${branch}`) : null;
  const mainHead =
    revParse(worktreePath, 'refs/heads/main') ?? revParse(worktreePath, 'refs/remotes/origin/main');
  let mergeBase: string | null = null;
  if (branch && mainHead) {
    try {
      mergeBase = execFileSync('git', ['merge-base', 'main', branch], {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
    } catch {
      mergeBase = null;
    }
  }
  if (!branch) {
    return { ok: false, branch, localHead, originHead, mergeBase, mainHead, detail: 'detached HEAD or not a git repo' };
  }
  if (!originHead) {
    return {
      ok: false,
      branch,
      localHead,
      originHead,
      mergeBase,
      mainHead,
      detail: `origin/${branch} does not exist — branch was never pushed`,
    };
  }
  if (originHead !== localHead) {
    return {
      ok: false,
      branch,
      localHead,
      originHead,
      mergeBase,
      mainHead,
      detail: `origin/${branch} (${originHead.slice(0, 8)}) != local HEAD (${localHead?.slice(0, 8)}) — local diverged from remote`,
    };
  }
  if (mainHead && mergeBase && mainHead !== mergeBase) {
    return {
      ok: false,
      branch,
      localHead,
      originHead,
      mergeBase,
      mainHead,
      detail: `main (${mainHead.slice(0, 8)}) != merge-base (${mergeBase.slice(0, 8)}) — main diverged from the pre-initiative state`,
    };
  }
  return { ok: true, branch, localHead, originHead, mergeBase, mainHead, detail: 'origin == local HEAD; main == merge-base' };
}

/**
 * Throwing wrapper around `checkLocalRemoteSynced`. The dev-loop calls
 * this at close so a divergence is a hard, classifiable failure (the
 * review redesign cannot proceed on a branch that isn't published).
 */
export function assertLocalRemoteSynced(worktreePath: string): LocalRemoteInvariant {
  const r = checkLocalRemoteSynced(worktreePath);
  if (!r.ok) {
    throw new Error(`local↔remote invariant violated: ${r.detail}`);
  }
  return r;
}

/**
 * G10 / G1: confirm the PR is MERGED on the remote. The ONLY signal that
 * gates `runReflector` and the `_queue/done/` move. Never trusts an
 * orchestrator-internal flag — asks GitHub via `gh pr view --json state`.
 *
 * Returns false (not throw) for every non-MERGED case (open PR, no PR,
 * `gh` unavailable, GraphQL error): a partial / unconfirmed state must
 * NOT be treated as merged. The caller routes a false to `ready-for-review/`.
 */
export function confirmPrMerged(worktreePath: string): boolean {
  try {
    const out = execFileSync('gh', ['pr', 'view', '--json', 'state'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as { state?: unknown };
    return typeof parsed.state === 'string' && parsed.state.toUpperCase() === 'MERGED';
  } catch (err) {
    const e = err as { stderr?: Buffer | string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    if (stderr) process.stderr.write(`[confirmPrMerged] ${stderr}\n`);
    return false;
  }
}

export type AlignResult = {
  aligned: boolean;
  detail: string;
};

/**
 * Closure step: once the operator has merged the PR in GitHub, align the
 * local repo to the remote — fast-forward local `main` to `origin/main`
 * (which now contains the merged initiative) and delete the initiative
 * branch. Best-effort by return value: the merge already happened on the
 * remote, so a local-alignment hiccup must not fail the cycle (it is
 * cosmetic local hygiene, surfaced via the returned detail + event log).
 *
 * Caller contract: only invoke after `confirmPrMerged` returned true.
 */
export function alignLocalToRemote(worktreePath: string, initiativeBranch: string): AlignResult {
  const steps: string[] = [];
  try {
    execFileSync('git', ['fetch', 'origin', '--prune'], { cwd: worktreePath, stdio: 'pipe' });
    steps.push('fetched origin');
  } catch {
    steps.push('fetch origin failed (non-fatal)');
  }
  // Fast-forward local main to origin/main without checking it out (the
  // project repo may have main checked out elsewhere — a forge worktree
  // is attached off the same repo). `update-ref` is safe when main is an
  // ancestor of origin/main, which it is after a clean PR merge.
  const originMain = revParse(worktreePath, 'refs/remotes/origin/main');
  const localMain = revParse(worktreePath, 'refs/heads/main');
  if (originMain && originMain !== localMain) {
    try {
      execFileSync('git', ['update-ref', 'refs/heads/main', originMain], {
        cwd: worktreePath,
        stdio: 'pipe',
      });
      steps.push(`fast-forwarded main → ${originMain.slice(0, 8)}`);
    } catch {
      steps.push('main fast-forward failed (non-fatal)');
    }
  } else {
    steps.push('main already up to date');
  }
  // Prune the initiative branch locally + on origin. The scheduler's
  // worktree.cleanup() also deletes the local branch in its finally; this
  // makes the closure self-contained for the operator-driven path.
  try {
    execFileSync('git', ['branch', '-D', initiativeBranch], { cwd: worktreePath, stdio: 'pipe' });
    steps.push(`deleted local ${initiativeBranch}`);
  } catch {
    steps.push(`local ${initiativeBranch} already gone`);
  }
  try {
    execFileSync('git', ['push', 'origin', '--delete', initiativeBranch], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    steps.push(`deleted origin ${initiativeBranch}`);
  } catch {
    steps.push(`origin ${initiativeBranch} already gone or undeletable`);
  }
  return { aligned: true, detail: steps.join('; ') };
}
