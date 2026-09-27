/**
 * N7 (plan 2.9) — requeue infers resume position from worktree/branch state.
 *
 * Before this module, `forge requeue` (and the bridge recovery route) always
 * wiped the failed cycle's worktree + branch for a fresh-from-main re-run
 * unless the operator explicitly passed `--resume-from=integrate` — even when
 * the failure was ENVIRONMENTAL (rate-limit death mid-WI, gate timeout,
 * lint-lock contention) and the branch carried perfectly good committed WI
 * work. That is the destroy-per-WI-work failure mode: the operator either
 * knew the magic flag or forge threw the work away.
 *
 * This module makes the requeue infer the resume position, mirroring the
 * ADR-019 resume machinery (no new runtime mechanism):
 *
 *   - prior failure classified `environment: true` (G3/N9 classifier)
 *     AND the preserved worktree still exists
 *     AND the initiative branch carries commits beyond main
 *     AND the preserved `.forge/work-items/` specs are readable
 *       → RESUME:
 *           · every WI `complete`  → `resume_from: integrate` (ADR 019 — the
 *             post-develop band re-runs at the `integrate` node against the
 *             preserved branch; no WI is rebuilt)
 *           · some WIs incomplete  → NO marker; the worktree + branch are
 *             preserved and the scheduler's preserved-work-items reuse path
 *             (`decideWorktreeStrategy`) re-runs the dev-loop in place —
 *             complete WIs take the iter-0 already-complete shortcut,
 *             pending ones build.
 *   - anything else → fresh full re-run (wipe worktree + branch), exactly
 *     the pre-N7 behaviour.
 *
 * All helpers are read-only; the caller (`runRequeue`) owns every mutation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readWorkItemsFromDir } from './work-item.ts';

export type RequeueResumeDecision =
  | { resume: false; reason: string }
  | {
      resume: true;
      /**
       * `'integrate'` → stamp `resume_from: integrate` (ADR 019). `null` →
       * preserve the worktree with NO marker; the scheduler's preserved
       * work-items reuse path re-runs the dev-loop in place.
       */
      resume_from: 'integrate' | null;
      reason: string;
    };

/** WI status summary read from the preserved worktree. */
export type WorkItemStatusSummary = { total: number; complete: number };

/**
 * M7 row 150 addendum (ruling 1794, round 3): whether the prior cycle was an
 * ENVIRONMENT failure (N7, unchanged), PLUS whether it was a CLEAN-BOUNDARY
 * HALT — an operator-stop or a cost-ceiling stop, neither an environment
 * failure (both classify `environment: false` in failure-classifier.ts —
 * neither is API pressure, it is the flow's own halt firing) but resumable
 * for the identical WI-completion reason. Both fields are read STRUCTURED,
 * off `FailureClassification.environment` / `.cleanBoundaryHalt`
 * (failure-classifier.ts) as the classifier itself computed them — never by
 * re-sniffing the classifier's own re-authored `reason` prose here, which is
 * free-text meant for a human, not a parser.
 */
export type PriorFailureSignal = {
  environment: boolean;
  cleanBoundaryHalt: boolean;
};

const NO_PRIOR_FAILURE_SIGNAL: PriorFailureSignal = { environment: false, cleanBoundaryHalt: false };

/**
 * Read the prior cycle's `failure_classification` event (stamped by
 * `runCycle` on every failed cycle). Missing log / cycle id / classification
 * event all yield the all-false signal — the requeue then behaves exactly as
 * before (fresh re-run).
 */
export function readPriorFailureSignal(
  forgeRoot: string,
  cycleId: string | undefined,
): PriorFailureSignal {
  if (!cycleId) return NO_PRIOR_FAILURE_SIGNAL;
  const logPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
  if (!existsSync(logPath)) return NO_PRIOR_FAILURE_SIGNAL;
  try {
    const lines = readFileSync(logPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      let e: { message?: string; metadata?: Record<string, unknown> };
      try {
        e = JSON.parse(line) as typeof e;
      } catch {
        continue;
      }
      if (e.message === 'failure_classification') {
        return {
          environment: e.metadata?.environment === true,
          cleanBoundaryHalt: e.metadata?.cleanBoundaryHalt === true,
        };
      }
    }
  } catch {
    return NO_PRIOR_FAILURE_SIGNAL;
  }
  return NO_PRIOR_FAILURE_SIGNAL;
}

/**
 * True iff `branch` exists in the project repo AND carries at least one
 * commit beyond its merge-base with main/master — i.e. there is committed
 * work to salvage. Any git failure (missing branch, missing base, not a
 * repo) yields false.
 */
export function branchHasCommittedWork(projectRepoPath: string, branch: string): boolean {
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', projectRepoPath, ...args], {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  try {
    git(['rev-parse', '--verify', '--quiet', branch]);
  } catch {
    return false;
  }
  for (const base of ['main', 'master']) {
    try {
      git(['rev-parse', '--verify', '--quiet', base]);
      const count = Number(git(['rev-list', '--count', `${base}..${branch}`]));
      return Number.isFinite(count) && count > 0;
    } catch {
      /* try the next base candidate */
    }
  }
  return false;
}

/**
 * Summarise the preserved `.forge/work-items/` statuses. Returns null when
 * the dir is missing or holds no parseable WI specs — without them the
 * dev/unifier nodes cannot run, so a resume is impossible.
 */
export function summarizeWorkItemStatuses(worktreePath: string): WorkItemStatusSummary | null {
  const dir = join(worktreePath, '.forge', 'work-items');
  if (!existsSync(dir)) return null;
  try {
    const { items } = readWorkItemsFromDir(dir);
    if (items.length === 0) return null;
    return {
      total: items.length,
      complete: items.filter((i) => i.status === 'complete').length,
    };
  } catch {
    return null;
  }
}

/**
 * The pure resume decision. Exported separately from `inferRequeueResume`
 * so the policy is unit-testable without git/filesystem fixtures.
 */
export function decideRequeueResume(args: {
  environmentFailure: boolean;
  /**
   * M7 row 150 addendum (ruling 1794): true when the prior failure was an
   * operator-stop or a cost-ceiling stop (see `PriorFailureSignal`'s own
   * doc). Resumable for the SAME WI-completion reason `environmentFailure`
   * already is, gated here as a second, independent trigger on the
   * identical downstream branching — never a second copy of it. Optional so
   * every pre-existing caller/test keeps compiling and behaving unchanged
   * when it is omitted.
   */
  cleanBoundaryHalt?: boolean;
  worktreePresent: boolean;
  branchHasWork: boolean;
  workItems: WorkItemStatusSummary | null;
}): RequeueResumeDecision {
  const resumable = args.environmentFailure || args.cleanBoundaryHalt === true;
  if (!resumable) {
    return {
      resume: false,
      reason: 'prior failure neither environment-classified nor a clean-boundary halt — fresh re-run',
    };
  }
  if (!args.worktreePresent) {
    return { resume: false, reason: 'no preserved worktree — fresh re-run' };
  }
  if (!args.branchHasWork) {
    return { resume: false, reason: 'initiative branch has no committed work beyond main — nothing to salvage' };
  }
  if (!args.workItems) {
    return { resume: false, reason: 'no readable work-item specs in the preserved worktree — fresh re-run' };
  }
  // The two triggers share the same reason vocabulary from here — the
  // downstream operator only needs "why does this branch resume", and
  // "environment failure" / "clean-boundary halt" answer that identically.
  const triggerLabel = args.environmentFailure ? 'environment failure' : 'clean-boundary halt';
  if (args.workItems.complete === args.workItems.total) {
    const allCompleteReason =
      `${triggerLabel} with all ${args.workItems.total} WIs complete on the preserved branch — ` +
      'resume from the integrate node (ADR 019)';
    return { resume: true, resume_from: 'integrate', reason: allCompleteReason };
  }
  const partialReason =
    `${triggerLabel} with ${args.workItems.complete}/${args.workItems.total} WIs complete — ` +
    'preserve worktree; dev-loop re-runs in place';
  return { resume: true, resume_from: null, reason: partialReason };
}

/**
 * Composition over the real forge root / worktree / project repo. Read-only.
 */
export function inferRequeueResume(args: {
  forgeRoot: string;
  cycleId: string | undefined;
  initiativeId: string;
  worktreePath: string;
  projectRepoPath: string;
}): RequeueResumeDecision {
  const priorFailure = readPriorFailureSignal(args.forgeRoot, args.cycleId);
  return decideRequeueResume({
    environmentFailure: priorFailure.environment,
    cleanBoundaryHalt: priorFailure.cleanBoundaryHalt,
    worktreePresent: existsSync(args.worktreePath),
    branchHasWork:
      existsSync(args.projectRepoPath) &&
      branchHasCommittedWork(args.projectRepoPath, `forge/${args.initiativeId}`),
    workItems: summarizeWorkItemStatuses(args.worktreePath),
  });
}
