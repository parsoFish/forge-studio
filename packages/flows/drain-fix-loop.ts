/**
 * ADR 040 — drain a ready-for-review cycle's pending fix work-items in place.
 *
 * A review send-back compiles fix WIs onto the initiative's own
 * `.forge/work-items/` queue (`fix-work-items.ts`, via the verdict handler) and
 * stamps `resume_from: 'develop'`. This module is the consumer: a scheduler
 * sweep (sibling of `finalize-merged`, replacing the ADR-026
 * `drain-unifier-items` sweep) that, for each `ready-for-review/` manifest with
 * PENDING fix WIs and an UNMERGED PR, re-claims the manifest threading the SAME
 * `cycle_id` (mechanism B) and re-enters `runCycle({ resumeFrom: 'develop' })`:
 * the dev-loop RUNS (prior WIs fast-exit via the iter-0 already-complete
 * shortcut, fix WIs build), then the develop flow's demo node re-authors
 * demo.json + the PR description against the fixed branch and the spine
 * re-presents (R4-10-F1 — no re-armed unifier UWI; the demo node owns the
 * re-demo). One cycleId ⇒ one `_logs` dir ⇒ cost/status lineage + WI hexes
 * never fork.
 *
 * Mutual exclusion (ADR 040): the atomic in-flight rename is the claim; the
 * drain skips a MERGED PR (finalize's domain — a merged PR always wins), a
 * queue with any `failed` fix WI, and a cap-exhausted park marker (both
 * operator territory — never auto-retry). The verdict-append lock is taken for
 * the read checks so a concurrent send-back doesn't race the pending read.
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel';
import lockfile from 'proper-lockfile';

import { parseManifest } from './manifest.ts';
import { getPaths, moveTo, writeHeartbeat } from './queue.ts';
import { confirmPrMerged } from './pr.ts';
import { runCycle } from './cycle.ts';
import { latestCycleId } from './finalize-merged.ts';
import { createLogger } from '@forge/kernel';
import { isContainedProjectRepoPath, isContainedWorktreePath, isSafeCycleId } from './manifest-path-guard.ts';
import { resolveReviewLoopCaps } from '@forge/kernel';
import {
  fixWorkItemCount,
  hasFailedFixWorkItem,
  hasMergeGateConfigErrorMarker,
  hasReviewCapExhaustedMarker,
  pendingFixWorkItems,
} from './fix-work-items.ts';
import type { CycleInput } from './cycle-context.ts';

/** Keep the claimed manifest's heartbeat fresh during a (possibly long) drain so
 *  a crashed daemon leaves a STALE heartbeat the recovery sweep can reclaim. */
const DRAIN_HEARTBEAT_MS = 30_000;

export type FixLoopDrainStatus =
  | 'drained'
  | 'no-pending'
  | 'pr-merged'
  | 'no-worktree'
  | 'needs-operator'
  | 'cap-exceeded'
  | 'locked'
  | 'claimed-elsewhere'
  | 'error';
export type FixLoopDrainResult = {
  initiativeId: string;
  status: FixLoopDrainStatus;
  detail?: string;
};

export type FixLoopDrainDeps = {
  /** Queue root. Defaults to the cwd-based queue (matches the scheduler). */
  queueRoot?: string;
  /** `<forge>/_logs`. Defaults to `<cwd>/_logs` (the cycle_id fallback). */
  logsRoot?: string;
  /** Merge probe. Defaults to `confirmPrMerged` (gh pr view state == MERGED). */
  confirmMerge?: (worktreePath: string) => boolean | Promise<boolean>;
  /**
   * Re-enter the cycle for one re-claimed manifest. Returns the cycle's
   * terminal status. Injectable for tests; defaults to the real `runCycle`
   * with `resumeFrom: 'develop'` threading the persisted `cycle_id`.
   */
  runDrainCycle?: (input: CycleInput) => Promise<{ status: string }>;
  notify?: (msg: string) => void;
};

async function defaultRunDrainCycle(input: CycleInput): Promise<{ status: string }> {
  const result = await runCycle(input);
  return { status: result.status };
}

/** Best-effort branch tip of the worktree — the round's headSha evidence. */
function worktreeHeadSha(worktreePath: string): string | null {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf8' });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  } catch {
    /* best-effort */
  }
  return null;
}

export async function drainPendingFixWorkItems(
  deps: FixLoopDrainDeps = {},
): Promise<FixLoopDrainResult[]> {
  const paths = getPaths(deps.queueRoot);
  const logsRoot = deps.logsRoot ? resolve(deps.logsRoot) : resolve(FORGE_ROOT, '_logs');
  const confirmMerge = deps.confirmMerge ?? confirmPrMerged;
  const runDrainCycle = deps.runDrainCycle ?? defaultRunDrainCycle;
  const caps = resolveReviewLoopCaps();

  const out: FixLoopDrainResult[] = [];
  if (!existsSync(paths.readyForReview)) return out;

  for (const file of readdirSync(paths.readyForReview)) {
    if (!file.endsWith('.md')) continue;
    const manifestPath = join(paths.readyForReview, file);
    let initiativeId = file.replace(/\.md$/, '');
    let release: (() => Promise<void>) | null = null;
    try {
      const m = parseManifest(readFileSync(manifestPath, 'utf8'));
      initiativeId = m.initiative_id || initiativeId;
      const worktreePath = m.worktree_path ?? '';
      const projectRepoPath = m.project_repo_path ?? '';
      // SEC-02 round 4: the sibling of `finalize-merged`'s round-3 guard, and
      // the highest-consequence instance in this WI — an UNATTENDED daemon
      // sweep that builds a full `CycleInput` and re-enters an entire cycle
      // (`runCycle({resumeFrom:'develop'})`: dev-loop, PM, demo,
      // adversarial-review) against these two values, plus `spawnSync('git',
      // …, {cwd: worktreePath})`. The check must precede the `existsSync`
      // probe below, because every later use — `hasReviewCapExhaustedMarker`,
      // `hasMergeGateConfigErrorMarker`, `hasFailedFixWorkItem`,
      // `pendingFixWorkItems`, `confirmMerge`, `fixWorkItemCount`,
      // `worktreeHeadSha` — takes the raw value.
      // Absent (`''`) stays absent: the `no-worktree` branch owns that case.
      // Throwing lands in this loop's own per-manifest try/catch, so ONE
      // poisoned manifest degrades to `status:'error'` without aborting the
      // sweep for its legitimate siblings (pinned by its own AT).
      const forgeRoot = dirname(resolve(paths.root));
      if (worktreePath && !isContainedWorktreePath(worktreePath, { forgeRoot, initiativeId })) {
        throw new Error(`unsafe worktree_path on manifest ${manifestPath}`);
      }
      if (projectRepoPath && !isContainedProjectRepoPath(projectRepoPath, { forgeRoot })) {
        throw new Error(`unsafe project_repo_path on manifest ${manifestPath}`);
      }
      // Mechanism B (carried over from ADR 026): reuse the SAME cycle_id so the
      // loop appends to the original `_logs` dir. resumeFrom 'develop' makes PM
      // rebase-skip while the dev-loop RUNS — prior WIs fast-exit, fix WIs build.
      // Resolved and validated HERE, at the top, deliberately: `createLogger`
      // further down does `resolve(logsRoot, cycleId)` + `mkdirSync(recursive)`
      // + a write, so a traversing id lands the cycle's whole event log outside
      // `_logs`. The first placement of this check was AFTER the manifest had
      // been renamed into `in-flight/` and after the heartbeat `setInterval` —
      // whose `clearInterval` lives in a `finally` that had not been entered
      // yet. Throwing there leaked a live timer on every poisoned manifest AND
      // stranded the manifest mid-claim. Rejecting BEFORE any side effect is
      // the only placement that is both safe and clean; a guard that has to
      // unwind state it already mutated is a guard in the wrong place.
      // Both fallbacks are provably safe (`latestCycleId` returns real `_logs`
      // dirnames; `initiativeId` is pattern-gated) — the check sits on the
      // RESOLVED value anyway so no future fallback can skip it.
      const cycleId = m.cycle_id ?? latestCycleId(logsRoot, initiativeId) ?? initiativeId;
      if (!isSafeCycleId(cycleId)) {
        throw new Error(`unsafe cycle_id on manifest ${manifestPath}`);
      }
      if (!worktreePath || !existsSync(worktreePath)) {
        out.push({ initiativeId, status: 'no-worktree' });
        continue;
      }

      // Operator territory — never auto-retry. The cap marker was already
      // notified loudly at rejection time by whichever writer set it (the
      // verdict handler for a review-fix send-back, or the demo node's
      // demo-fix loop, R4-10-F1 — both fire notify()); don't re-notify every
      // sweep, just report the parked status. Both writers respect the marker,
      // so its presence means no fresh fix WI was enqueued behind it.
      if (hasReviewCapExhaustedMarker(worktreePath)) {
        out.push({ initiativeId, status: 'needs-operator', detail: 'review-cap-exhausted marker present' });
        continue;
      }
      if (hasMergeGateConfigErrorMarker(worktreePath)) {
        out.push({ initiativeId, status: 'needs-operator', detail: 'merge-gate-config-error marker present' });
        continue;
      }
      if (hasFailedFixWorkItem(worktreePath)) {
        out.push({ initiativeId, status: 'needs-operator', detail: 'failed fix work-item' });
        continue;
      }

      // Lock the manifest for the read checks so a concurrent verdict append
      // doesn't race the pending read; release before the (long) cycle runs.
      try {
        release = await lockfile.lock(manifestPath, { retries: { retries: 5, minTimeout: 50 } });
      } catch {
        out.push({ initiativeId, status: 'locked' });
        continue;
      }

      const pending = pendingFixWorkItems(worktreePath);
      if (pending.length === 0) {
        out.push({ initiativeId, status: 'no-pending' });
        continue;
      }

      // Merge-vs-loop (ADR 040): a MERGED PR is finalize-merged's domain — the
      // merge always wins; finalize surfaces the dropped fix WIs non-silently.
      if (await confirmMerge(worktreePath)) {
        out.push({ initiativeId, status: 'pr-merged' });
        continue;
      }

      // Caps (defence in depth — the verdict handler enforces them at append).
      const totalFix = fixWorkItemCount(worktreePath);
      const round = m.review_rounds ?? 0;
      if (totalFix > caps.maxTotalFixWorkItems || round > caps.maxSendBackRounds) {
        deps.notify?.(
          `${initiativeId} · fix-loop cap reached (round ${round}/${caps.maxSendBackRounds}, ` +
            `${totalFix}/${caps.maxTotalFixWorkItems} fix WIs) — operator must take over`,
        );
        out.push({ initiativeId, status: 'cap-exceeded' });
        continue;
      }

      // Atomic re-claim: ready-for-review → in-flight (the claim). Release the
      // verdict lock first; the rename is the cross-sweep mutual exclusion.
      if (release) { try { await release(); } catch { /* ignore */ } release = null; }
      const inFlightPath = join(paths.inFlight, file);
      try {
        renameSync(manifestPath, inFlightPath);
      } catch (renameErr) {
        // Another sweep (finalize) or handler claimed/removed it first — skip cleanly.
        out.push({ initiativeId, status: 'claimed-elsewhere', detail: renameErr instanceof Error ? renameErr.message : String(renameErr) });
        continue;
      }

      // R4-10-F1: no UWI re-arm — the develop flow's demo node re-authors
      // demo.json + the PR description against the fixed branch on every
      // re-entry (resume_from:'develop' runs dev→demo→adversarial-review→verdict).
      // The unifier node (and its static UWI-1) is off the live flow; the
      // re-demo is the demo node's own job now, not a re-armed unifier mission.

      // Heartbeat the claimed manifest so a daemon crash mid-drain leaves a
      // STALE heartbeat the recovery sweep reclaims — and resumes correctly
      // (the send-back stamped resume_from:'develop' on the manifest).
      writeHeartbeat(file, paths);
      const heartbeat = setInterval(() => { try { writeHeartbeat(file, paths); } catch { /* best-effort */ } }, DRAIN_HEARTBEAT_MS);

      const input: CycleInput = {
        initiativeId,
        manifestPath: inFlightPath,
        projectRepoPath,
        worktreePath,
        cycleId,
        resumeFrom: 'develop',
      };
      try {
        const result = await runDrainCycle(input);
        deps.notify?.(`${initiativeId} · fix loop ran ${pending.length} fix work-item(s) → ${result.status}`);
        // Round evidence for the verdict surface's stale-findings comparison:
        // the round that just completed + the branch tip it produced.
        try {
          const logger = createLogger(cycleId, logsRoot);
          logger.emit({
            initiative_id: initiativeId,
            phase: 'review-loop',
            skill: 'fix-loop-drain',
            event_type: 'log',
            input_refs: pending.map((p) => `.forge/work-items/${p.work_item_id}.md`),
            output_refs: [],
            message: 'sendback.loop-completed',
            metadata: { round, head_sha: worktreeHeadSha(worktreePath), cycle_status: result.status },
          });
        } catch { /* best-effort — never fail the drain on logging */ }
        out.push({ initiativeId, status: 'drained', detail: result.status });
      } finally {
        clearInterval(heartbeat);
        // Closure is the single terminal-move authority. If the cycle
        // threw/crashed before closure, the manifest is stranded in in-flight —
        // return it to ready-for-review so it's never lost.
        if (existsSync(inFlightPath)) {
          try { moveTo(file, 'ready-for-review', paths); } catch { /* best-effort */ }
        }
      }
    } catch (err) {
      out.push({ initiativeId, status: 'error', detail: err instanceof Error ? err.message : String(err) });
    } finally {
      if (release) { try { await release(); } catch { /* ignore */ } }
    }
  }
  return out;
}
