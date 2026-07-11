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
 */

import { execFileSync } from 'node:child_process';
import { pushInitiativeBranch, type PushResult } from './pr.ts';
import { writeWorkItemStatus } from './work-item.ts';

export type MergeBackResult = { merged: true } | { merged: false; detail: string };

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
}): MergeBackResult {
  try {
    execFileSync(
      'git',
      ['-C', opts.cycleWorktreePath, 'merge', '--no-ff', opts.wiBranch, '-m', `wi(${opts.workItemId}): merge`],
      { stdio: 'pipe' },
    );
    return { merged: true };
  } catch (err) {
    const detail = extractStderr(err);
    try {
      execFileSync('git', ['-C', opts.cycleWorktreePath, 'merge', '--abort'], { stdio: 'pipe' });
    } catch {
      /* best-effort — a merge that failed before entering conflict state (e.g.
         the branch ref didn't resolve) leaves nothing to abort; the working
         tree is already clean in that case. */
    }
    return { merged: false, detail };
  }
}

export type MergeAndPublishResult =
  | { merged: true; push: PushResult }
  | { merged: false; detail: string };

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
}): MergeAndPublishResult {
  const mergeResult = mergeWiIntoCycle({
    cycleWorktreePath: opts.cycleWorktreePath,
    wiBranch: opts.wiBranch,
    workItemId: opts.workItemId,
  });
  if (!mergeResult.merged) {
    return { merged: false, detail: mergeResult.detail };
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
