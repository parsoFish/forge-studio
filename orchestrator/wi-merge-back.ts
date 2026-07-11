/**
 * Phase 4 step 5 — per-WI merge-back fan-in.
 *
 * A per-WI Ralph loop runs in its OWN worktree/branch
 * (`forge/<initiativeId>/wi/<workItemId>`, see `wi-worktree.ts`) and never
 * touches the shared cycle worktree's working tree while it runs. This
 * module owns the ONE point where that isolated work re-joins the cycle
 * branch: a `git merge --no-ff` of the WI branch into the cycle worktree.
 *
 * Serialized through `createMergeQueue()` — load-bearing since Phase 4 step 6
 * (concurrent WI dispatch): only one merge may touch the cycle worktree's
 * working tree at a time. `mergeAndPublish` (below) folds the status write +
 * origin push into the SAME queued critical section as the merge itself
 * (Phase 4 step 6 review fix): every operation that touches the shared cycle
 * worktree's working tree/branch for a landed WI — merge, status file,
 * push — happens inside ONE `mergeQueue.enqueue()` turn, so "only one op
 * touches the cycle worktree at a time" is structural (the queue itself
 * enforces it) rather than an emergent property of the caller never
 * `await`-ing between the merge resolving and the push completing.
 *
 * A merge conflict is reported here, not retried — `git merge --abort`
 * restores the cycle worktree to a clean state before returning, so the
 * cycle worktree is never left mid-conflict for the next WI's merge
 * attempt. Phase 4 step 7's bounded requeue (one retry against a fresh
 * cycle-branch tip before a conflict is terminal for the WI) is a caller
 * concern, layered on top in `developer-loop.ts`'s `runWiDispatchTask` —
 * this module has no notion of "attempt" and stays a single merge try.
 *
 * Conflict-context injection (2026-07-12, live cycle 2026-07-11T14-57-10_
 * INIT-2026-07-11-csv-output-flag): a blind requeue against a deterministic
 * conflict can never succeed — a fresh per-WI worktree forks from the new
 * cycle tip with the same spec and zero knowledge of what sibling work just
 * landed, so ralph reproduces the same overlapping edit. `mergeWiIntoCycle`
 * now captures WHY a conflict happened — the unmerged files, the WI branch's
 * own last commit, and the sibling commits that touched those files since
 * the WI's fork point — BEFORE `git merge --abort` discards the conflicted
 * state (`--diff-filter=U` only resolves while a merge is in progress). The
 * caller (`developer-loop.ts`) feeds this into the requeued attempt's fresh
 * worktree via the same `.forge/last-gate-failure.md` seam the dev prompt
 * already reads first.
 */

import { execFileSync } from 'node:child_process';
import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from './config.ts';
import { pushInitiativeBranch, type PushResult } from './pr.ts';
import { writeWorkItemStatus } from './work-item.ts';

// Bounds on the conflict-detail capture below — a pathological conflict
// (huge rename, generated-file blowup) must never produce an unbounded
// feedback payload. Named per CLAUDE.md's no-hardcoded-values rule so the
// bound is a single edit, and so unit tests can assert against it directly
// rather than a magic number.
export const MERGE_CONFLICT_MAX_FILES = 20;
export const MERGE_CONFLICT_MAX_SIBLING_COMMITS = 20;
export const MERGE_CONFLICT_MAX_LINE_CHARS = 300;

/**
 * WHY a fan-in merge conflicted: the unmerged files, the WI branch's own tip
 * (what it was trying to land), and the sibling commits already merged into
 * the cycle branch (since the WI's fork point) that touched the same files —
 * i.e. the concrete "someone else already changed this" evidence a requeued
 * attempt needs to avoid reproducing the identical overlapping edit.
 */
export type MergeConflictDetail = {
  /** Files git reports as unmerged (`diff --diff-filter=U`), bounded to `MERGE_CONFLICT_MAX_FILES`. */
  conflictingFiles: string[];
  /** True when more files were unmerged than `MERGE_CONFLICT_MAX_FILES` captured. */
  filesTruncated: boolean;
  /** The WI branch's own last commit subject — best-effort, `''` if it cannot be read. */
  wiBranchTipSubject: string;
  /**
   * `git log --oneline <startPointRef>..HEAD -- <conflictingFiles>` — sibling
   * commits landed on the cycle branch after the WI's fork point that touched
   * the conflicting files, bounded to `MERGE_CONFLICT_MAX_SIBLING_COMMITS`.
   * Empty when `startPointRef` isn't supplied or no files conflicted.
   */
  siblingCommits: string[];
  /** True when more sibling commits touched the files than the bound captured. */
  commitsTruncated: boolean;
};

function truncateLine(s: string): string {
  return s.length > MERGE_CONFLICT_MAX_LINE_CHARS ? `${s.slice(0, MERGE_CONFLICT_MAX_LINE_CHARS)}…` : s;
}

/**
 * Best-effort capture of WHY a merge conflicted, run BEFORE `git merge
 * --abort` discards the conflict state (`--diff-filter=U` and a mid-merge
 * `MERGE_HEAD` only exist while the merge is actually in progress). Never
 * throws — every git call is independently tolerant of failure so a capture
 * problem (e.g. no `startPointRef`, or a merge that failed before entering a
 * conflicted state at all, like an unknown revision) can never prevent the
 * abort/cleanup that follows it.
 */
function captureMergeConflictDetail(opts: {
  cycleWorktreePath: string;
  wiBranch: string;
  startPointRef?: string;
}): MergeConflictDetail {
  let conflictingFiles: string[] = [];
  try {
    const out = execFileSync(
      'git',
      ['-C', opts.cycleWorktreePath, 'diff', '--name-only', '--diff-filter=U'],
      { stdio: 'pipe', encoding: 'utf8' },
    );
    conflictingFiles = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    /* best-effort — a merge failure that never entered a conflicted state
       (e.g. unknown revision) leaves nothing to diff */
  }
  const filesTruncated = conflictingFiles.length > MERGE_CONFLICT_MAX_FILES;
  // Unbounded pathspec used for the sibling-commit lookup below (bounded,
  // untruncated file names — the truncated/ellipsised display form is only
  // for the returned/rendered value, never for a git argument).
  const boundedFiles = conflictingFiles.slice(0, MERGE_CONFLICT_MAX_FILES);

  let wiBranchTipSubject = '';
  try {
    wiBranchTipSubject = execFileSync(
      'git',
      ['-C', opts.cycleWorktreePath, 'log', '-1', '--format=%s', opts.wiBranch],
      { stdio: 'pipe', encoding: 'utf8' },
    ).trim();
  } catch {
    /* best-effort — branch ref may not resolve on a non-conflict merge failure */
  }

  let siblingCommits: string[] = [];
  if (opts.startPointRef && boundedFiles.length > 0) {
    try {
      const out = execFileSync(
        'git',
        ['-C', opts.cycleWorktreePath, 'log', '--oneline', `${opts.startPointRef}..HEAD`, '--', ...boundedFiles],
        { stdio: 'pipe', encoding: 'utf8' },
      );
      siblingCommits = out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      /* best-effort — a bad/unresolvable startPointRef must not break capture */
    }
  }
  const commitsTruncated = siblingCommits.length > MERGE_CONFLICT_MAX_SIBLING_COMMITS;

  return {
    conflictingFiles: boundedFiles.map(truncateLine),
    filesTruncated,
    wiBranchTipSubject: truncateLine(wiBranchTipSubject),
    siblingCommits: siblingCommits.slice(0, MERGE_CONFLICT_MAX_SIBLING_COMMITS).map(truncateLine),
    commitsTruncated,
  };
}

export type MergeBackResult =
  | { merged: true }
  | { merged: false; detail: string; conflict: MergeConflictDetail };

/**
 * Merge `wiBranch` into the cycle worktree's currently-checked-out branch
 * with `--no-ff`, so the fan-in is always its own commit in history (never a
 * fast-forward that would hide which WI contributed what). Any failure —
 * content conflict or otherwise — aborts the merge so the working tree is
 * left clean, and is reported uniformly as `{ merged: false, detail }`; this
 * step treats every merge failure as terminal for the WI (conflict-specific
 * recovery is a later step).
 *
 * Pure git plumbing — NOT single-flight itself. Callers serialize concurrent
 * invocations against the SAME cycle worktree through `createMergeQueue()`.
 */
export function mergeWiIntoCycle(opts: {
  cycleWorktreePath: string;
  wiBranch: string;
  workItemId: string;
  /**
   * The WI's fork point (the cycle-branch tip at WI dispatch time) — used
   * only to bound the sibling-commit lookup on a conflict to commits
   * genuinely concurrent with this WI's isolated work. Optional: when
   * omitted, conflict capture still runs but `siblingCommits` stays empty.
   */
  startPointRef?: string;
}): MergeBackResult {
  try {
    execFileSync(
      'git',
      [
        '-C',
        opts.cycleWorktreePath,
        ...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY),
        'merge',
        '--no-ff',
        opts.wiBranch,
        '-m',
        `wi(${opts.workItemId}): merge`,
      ],
      { stdio: 'pipe' },
    );
    return { merged: true };
  } catch (err) {
    const detail = extractStderr(err);
    // Capture WHY before aborting — `--diff-filter=U` only resolves while
    // the merge is still in progress.
    const conflict = captureMergeConflictDetail({
      cycleWorktreePath: opts.cycleWorktreePath,
      wiBranch: opts.wiBranch,
      startPointRef: opts.startPointRef,
    });
    try {
      execFileSync('git', ['-C', opts.cycleWorktreePath, 'merge', '--abort'], { stdio: 'pipe' });
    } catch {
      /* best-effort — a merge that failed before entering conflict state (e.g.
         the branch ref didn't resolve) leaves nothing to abort; the working
         tree is already clean in that case. */
    }
    return { merged: false, detail, conflict };
  }
}

export type MergeAndPublishResult =
  | { merged: true; push: PushResult }
  | { merged: false; detail: string; conflict: MergeConflictDetail };

/**
 * The full "land a WI" sequence, run as ONE turn inside the shared merge
 * queue: merge the WI branch into the cycle worktree, and — only on a clean
 * merge — write the WI's status file to `complete` and push the cycle branch
 * to origin, all before the queue frees up for the next WI. On a failed
 * merge, nothing is published: `writeWorkItemStatus`/`pushInitiativeBranch`
 * are the caller's job for that path (there is nothing new on the cycle
 * branch to publish, and the caller may want a different status than a bare
 * `failed`, e.g. distinguishing a merge conflict from a plain ralph
 * failure).
 *
 * Phase 4 step 6 review fix: previously the status write + push ran in the
 * caller AFTER `mergeQueue.enqueue(() => mergeWiIntoCycle(...))` had already
 * resolved — safe only because every statement in between happened to be a
 * synchronous, non-`await`-ing call, an invariant nothing enforced or
 * tested. Folding all three operations into the SAME queued callback makes
 * "only one op touches the cycle worktree's working tree/branch at a time"
 * structural: the merge queue's serialization guarantee now covers the
 * entire landed-WI sequence, not just the merge.
 *
 * Callers still own serialization: like `mergeWiIntoCycle`, this is pure
 * plumbing — pass it to `createMergeQueue().enqueue()`.
 */
export function mergeAndPublish(opts: {
  cycleWorktreePath: string;
  wiBranch: string;
  workItemId: string;
  specPath: string;
  /** See `mergeWiIntoCycle`'s `startPointRef` — threaded through unchanged. */
  startPointRef?: string;
}): MergeAndPublishResult {
  const mergeResult = mergeWiIntoCycle({
    cycleWorktreePath: opts.cycleWorktreePath,
    wiBranch: opts.wiBranch,
    workItemId: opts.workItemId,
    startPointRef: opts.startPointRef,
  });
  if (!mergeResult.merged) {
    return { merged: false, detail: mergeResult.detail, conflict: mergeResult.conflict };
  }
  writeWorkItemStatus(opts.specPath, 'complete');
  return { merged: true, push: pushInitiativeBranch(opts.cycleWorktreePath) };
}

/**
 * `git merge` writes its most useful diagnostics — "CONFLICT (content):
 * ...", "Automatic merge failed..." — to STDOUT, not stderr (stderr is
 * empty on a conflict). Prefer stderr when present (e.g. "unknown revision"
 * for a nonexistent branch goes there), else fall back to stdout, else the
 * thrown error's own message.
 */
function extractStderr(err: unknown): string {
  const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
  const stderr = typeof e?.stderr === 'string' ? e.stderr : e?.stderr?.toString();
  if (stderr && stderr.length > 0) return stderr;
  const stdout = typeof e?.stdout === 'string' ? e.stdout : e?.stdout?.toString();
  if (stdout && stdout.length > 0) return stdout;
  return err instanceof Error ? err.message : String(err);
}

export type MergeQueue = { enqueue: <T>(fn: () => T | Promise<T>) => Promise<T> };

/**
 * A minimal async mutex: `enqueue` chains callers so only one runs its
 * function at a time, in call order, regardless of how quickly they were
 * scheduled. One queue instance must be shared by every WI dispatch that
 * merges into the SAME cycle worktree — create it once per dev-loop run.
 */
export function createMergeQueue(): MergeQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
      const started = tail.then(fn);
      // The queue's own chain must never stall on a caller's rejection —
      // only the `started` promise returned to that caller carries it.
      tail = started.then(
        () => undefined,
        () => undefined,
      );
      return started;
    },
  };
}
