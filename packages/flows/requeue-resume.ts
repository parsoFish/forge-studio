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
 * D-06 resume machinery (no new runtime mechanism):
 *
 *   - prior failure classified `environment: true` (G3/N9 classifier)
 *     AND the preserved worktree still exists
 *     AND the initiative branch carries commits beyond main
 *     AND the preserved `.forge/work-items/` specs are readable
 *       → RESUME:
 *           · every WI `complete`  → `resume_from: integrate` (D-06 — the
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
 * Row 122 (bead forge-8vfn.8.1.55) adds a narrower case ahead of the one
 * above: a failure classified AT the review node's PR-open call resumes
 * `resume_from: pr-open` — the whole post-develop band already succeeded, so
 * only the review node re-enters, not the generic `'integrate'` case above.
 *
 * All helpers are read-only; the caller (`runRequeue`) owns every mutation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readWorkItemsFromDir } from './work-item.ts';
import { isSafeCycleId } from './manifest-path-guard.ts';
import { readPendingFixWorkItems } from './fix-work-items.ts';
import { fixRoundDeliveredHead, fixRoundHeadVerdict } from '@forge/contracts';

export type RequeueResumeDecision =
  | { resume: false; reason: string }
  | {
      resume: true;
      /**
       * `'integrate'` → stamp `resume_from: integrate` (D-06). `'plan'` →
       * stamp `resume_from: plan` (row 157, ruling 1873) — the PM node
       * RE-RUNS (it is the phase that failed), unlike the other two markers.
       * `'pr-open'` → stamp `resume_from: pr-open` (row 122) — narrower than
       * `'integrate'`: the failure was AT the review node's PR-open call.
       * `null` → preserve the worktree with NO marker; the scheduler's
       * preserved work-items reuse path re-runs the dev-loop in place.
       */
      resume_from: 'integrate' | 'plan' | 'pr-open' | 'develop' | null;
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
  /** Row 157 (ruling 1873): `'plan'` when the classifier named the plan
   *  node; row 122: `'pr-open'` when it named the review node instead — both
   *  read structured, off `failure_classification`'s `resume_from`
   *  metadata, never by re-sniffing `reason` prose. */
  resumeFrom?: 'plan' | 'pr-open';
};

const NO_PRIOR_FAILURE_SIGNAL: PriorFailureSignal = { environment: false, cleanBoundaryHalt: false };

/**
 * Read the prior cycle's `failure_classification` event straight from its
 * `events.jsonl` path. Missing log / classification event both yield the
 * all-false signal — the caller then behaves exactly as it would for an
 * unclassified failure (fresh re-run / no special-casing).
 *
 * row 163 (S10 run 42, ruling 1899): factored out of `readPriorFailureSignal`
 * so `scheduler-run-one.ts`'s own end-of-attempt cleanup can read the SAME
 * classification straight off `CycleResult.log_path` — the exact path
 * `createLogger` already wrote it to — without re-deriving a `<root>/_logs/
 * <cycleId>/` join that only holds for the DEFAULT logs root, not a caller
 * (tests; a future multi-tenant logsRoot) that configured its own.
 */
export function readPriorFailureSignalFromLog(logPath: string): PriorFailureSignal {
  const events = readLogEvents(logPath) ?? [];
  const e = events[lastIndex(events, (ev) => ev.message === 'failure_classification')];
  if (!e) return NO_PRIOR_FAILURE_SIGNAL;
  return {
    environment: e.metadata?.environment === true,
    cleanBoundaryHalt: e.metadata?.cleanBoundaryHalt === true,
    ...(e.metadata?.resume_from === 'plan'
      ? { resumeFrom: 'plan' as const }
      : e.metadata?.resume_from === 'pr-open'
        ? { resumeFrom: 'pr-open' as const }
        : {}),
  };
}

type LogEvent = { phase?: string; skill?: string; event_type?: string; message?: string; metadata?: Record<string, unknown> };

const lastIndex = (events: LogEvent[], pred: (e: LogEvent) => boolean): number => {
  for (let i = events.length - 1; i >= 0; i--) if (pred(events[i]!)) return i;
  return -1;
};

/** One reader of a cycle's events.jsonl: unparseable lines skipped; null when the log is missing or unreadable. */
function readLogEvents(logPath: string): LogEvent[] | null {
  try {
    if (!existsSync(logPath)) return null;
    return readFileSync(logPath, 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l) as LogEvent] : []; } catch { return []; } });
  } catch {
    return null;
  }
}

/**
 * D-49 row 5: a manifest that failed on PM set validation BEFORE D-49 recorded
 * no `pm_validation_errors`. Derive them from the latest attempt's own
 * project-manager error event (structured `set_errors` / `acceptance_gate_violation`
 * / `parse_errors` / coupling), only when that attempt's `cycle.end` failed in the
 * project-manager phase. [] = nothing derivable → the standard requeue.
 */
export function derivePmValidationErrors(logPath: string): string[] {
  const events = readLogEvents(logPath) ?? [];
  const endAt = lastIndex(events, (e) => e.phase === 'orchestrator' && e.skill === 'cycle' && e.event_type === 'end');
  const end = events[endAt]?.metadata;
  if (!end || end.status !== 'failed' || !String(end.error ?? '').includes('project-manager phase failed:')) return [];
  const attempt = events.slice(Math.max(0, lastIndex(events, (e) => e.message === 'cycle.start')), endAt);
  const pm = attempt[lastIndex(attempt, (e) => e.phase === 'project-manager' && e.event_type === 'error' && Array.isArray(e.metadata?.set_errors))]?.metadata;
  if (!pm) return [];
  const coupling = (pm.hidden_coupling_violations as Array<{ a: string; b: string; sharedFiles: string[] }> | undefined) ?? [];
  return [
    ...Object.entries((pm.parse_errors as Record<string, string> | undefined) ?? {}).map(([file, msg]) => `${file}: unparseable — ${msg}`),
    ...(pm.set_errors as string[]),
    ...(typeof pm.per_item_error_count === 'number' && pm.per_item_error_count > 0 ? [`${pm.per_item_error_count} per-item validation error(s) (the repair turn re-derives them)`] : []),
    ...coupling.map((c) => `hidden coupling: ${c.a}↔${c.b} share ${c.sharedFiles.join(',')}`),
    ...(typeof pm.acceptance_gate_violation === 'string' ? [pm.acceptance_gate_violation] : []),
  ];
}

/** D-49: the errors a FAILED manifest's Requeue repairs on — recorded, else derived (row 5). */
export function recordedPmValidationErrors(forgeRoot: string, m: { pm_validation_errors?: string[]; cycle_id?: string }): string[] {
  if (m.pm_validation_errors?.length) return m.pm_validation_errors;
  // The cycle id becomes a path segment: an unsafe one derives nothing (standard requeue), never a read outside _logs.
  return m.cycle_id && isSafeCycleId(m.cycle_id) ? derivePmValidationErrors(join(forgeRoot, '_logs', m.cycle_id, 'events.jsonl')) : [];
}

/**
 * `forge requeue`'s own entry point: it only ever has a `forgeRoot` +
 * `cycleId` (from the manifest), never the exact log path — it always writes
 * under the default `<forgeRoot>/_logs/<cycleId>/events.jsonl`, so the join
 * is reconstructed here rather than threaded as a parameter everywhere.
 */
export function readPriorFailureSignal(
  forgeRoot: string,
  cycleId: string | undefined,
): PriorFailureSignal {
  if (!cycleId) return NO_PRIOR_FAILURE_SIGNAL;
  return readPriorFailureSignalFromLog(join(forgeRoot, '_logs', cycleId, 'events.jsonl'));
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
  /**
   * D-49: the classifier's own `resumeFrom:'plan'` — PM set-validation
   * errors that survived the bounded repair turns. Independent of the WI-salvage
   * reasoning below: the PM failed before any per-WI work ran, so there is
   * nothing to check worktree/branch state for — the plan node just re-runs.
   */
  resumeFromPlan?: boolean;
  /**
   * Row 122: the classifier's own `resumeFrom:'pr-open'` — an environment
   * failure at the review node's PR-open call. PR-open is the flow's last
   * node, so dev/integrate/adversarial-review are guaranteed already
   * succeeded; only the preserved worktree is checked (WI counting, below,
   * does not apply).
   */
  resumeFromPrOpen?: boolean;
  worktreePresent: boolean;
  branchHasWork: boolean;
  workItems: WorkItemStatusSummary | null;
  /** forge-mfv5.1.27: compiled fix WIs still owed on the preserved worktree. */
  pendingFixWorkItems?: number;
}): RequeueResumeDecision {
  if (args.resumeFromPlan) {
    const reason =
      "prior failure was the PM's set validation, unrepaired after its bounded repair turns (D-49) — " +
      'resume at the plan node in repair mode on the errors the manifest records';
    return { resume: true, resume_from: 'plan', reason };
  }
  if ((args.pendingFixWorkItems ?? 0) > 0 && args.worktreePresent && args.branchHasWork) {
    const reason = `${args.pendingFixWorkItems} compiled fix work item(s) pending on the preserved branch — ` +
      'resume the fix round at develop; delivered work items stay complete';
    return { resume: true, resume_from: 'develop', reason };
  }
  if (args.resumeFromPrOpen) {
    if (!args.worktreePresent) {
      return {
        resume: false,
        reason:
          'prior failure was an environment failure at PR-open, but the preserved worktree is gone — ' +
          'fresh re-run',
      };
    }
    const reason =
      "prior failure was an environment failure at the review node's PR-open call — dev, integrate " +
      'and adversarial-review already succeeded; resume at the pr-open node to re-open the PR only';
    return { resume: true, resume_from: 'pr-open', reason };
  }
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
      'resume from the integrate node (D-06)';
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
  /** D-49: the manifest carries (or row 5 derived) PM validation errors → repair at plan. */
  pmValidationErrors?: boolean;
}): RequeueResumeDecision {
  const priorFailure = readPriorFailureSignal(args.forgeRoot, args.cycleId);
  return decideRequeueResume({
    environmentFailure: priorFailure.environment,
    cleanBoundaryHalt: priorFailure.cleanBoundaryHalt,
    resumeFromPlan: priorFailure.resumeFrom === 'plan' || args.pmValidationErrors === true,
    resumeFromPrOpen: priorFailure.resumeFrom === 'pr-open',
    worktreePresent: existsSync(args.worktreePath),
    branchHasWork:
      existsSync(args.projectRepoPath) &&
      branchHasCommittedWork(args.projectRepoPath, `forge/${args.initiativeId}`),
    workItems: summarizeWorkItemStatuses(args.worktreePath),
    pendingFixWorkItems: [readPendingFixWorkItems(args.worktreePath)].map((p) => (Array.isArray(p) ? p.length : 1))[0],
  });
}

/**
 * forge-mfv5.1.27 — a GATE-FIX round resumes only on the branch head it was
 * parked on (`fixRoundDeliveredHead`, read off `refs/heads/<branch>`, never a
 * same-named tag); the requeue and the drain both ask here. Review send-back
 * rounds may follow CI-fixer commits and are not checked. Null = proceed.
 */
export class FixRoundRefusedError extends Error {}

export function fixRoundHeadRefusal(a: { worktreePath: string; logPath: string; projectRepoPath: string; branch: string }): string | null {
  const pending = readPendingFixWorkItems(a.worktreePath); // unreadable fails toward checking
  if (Array.isArray(pending) && !pending.some((w) => w.origin === 'gate-fix')) return null;
  let found: string | null = null;
  try { found = execFileSync('git', ['-C', a.projectRepoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${a.branch}`], { stdio: 'pipe', encoding: 'utf8' }).trim(); } catch { /* no branch: refused by name */ }
  return fixRoundHeadVerdict(fixRoundDeliveredHead(existsSync(a.logPath) ? readFileSync(a.logPath, 'utf8').split('\n') : []), found);
}
