/**
 * D-20 — drain a ready-for-review cycle's pending fix work-items in place.
 *
 * A review send-back compiles fix WIs onto the initiative's own
 * `.forge/work-items/` queue (`fix-work-items.ts`, via the verdict handler) and
 * stamps `resume_from: 'develop'`. This module is the consumer: a scheduler
 * sweep (sibling of `finalize-merged`, replacing the D-20
 * `drain-unifier-items` sweep) that, for each `ready-for-review/` manifest with
 * PENDING fix WIs and an UNMERGED PR, re-claims the manifest threading the SAME
 * `cycle_id` (mechanism B) and re-enters `runCycle({ resumeFrom: 'develop' })`:
 * the dev-loop RUNS (prior WIs fast-exit via the iter-0 already-complete
 * shortcut, fix WIs build), then the develop flow's integrate node re-authors
 * demo.json + the PR description against the fixed branch and the spine
 * re-presents (R4-10-F1 — no re-armed unifier UWI; the integrate node owns the
 * re-demo). One cycleId ⇒ one `_logs` dir ⇒ cost/status lineage + WI hexes
 * never fork.
 *
 * Mutual exclusion (D-20): the atomic in-flight rename is the claim; the
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
import type { PhaseWiring } from './phase-wiring.ts';
import { latestCycleId } from './finalize-merged.ts';
import { createLogger } from '@forge/kernel';
import { isContainedProjectRepoPath, isContainedWorktreePath, isSafeCycleId } from './manifest-path-guard.ts';
import { resolveReviewLoopCaps } from '@forge/kernel';
import {
  failedFixWorkItemIds,
  fixWorkItemCount,
  hasMergeGateConfigErrorMarker,
  hasReviewCapExhaustedMarker,
  pendingFixWorkItems,
  supersededFixWorkItems,
} from './fix-work-items.ts';
import type { CycleInput } from './cycle-context.ts';
import { drainParkAlreadySaid, fixRoundHeadRefusal, haltedRoundRefusal, recordedRoundHalt, roundHaltFromLog, supersessionAlreadySaid } from './requeue-resume.ts';
import { annotateManifest } from './scheduler-run-one.ts';
import { normaliseLegacyFixGatesAtReentry } from './legacy-fix-gate.ts';

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
  | 'halted'
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
  runDrainCycle?: (input: CycleInput, wiring: PhaseWiring) => Promise<{ status: string }>;
  /** The installed factory's phase wiring (D-32) — threaded to `runCycle`, never imported. */
  phaseWiring: PhaseWiring;
  notify?: (msg: string) => void;
  /** forge-mfv5.1.27: drain ONE `ready-for-review/` manifest (its filename) — runOne's immediate re-entry. */
  only?: string;
};

async function defaultRunDrainCycle(input: CycleInput, wiring: PhaseWiring): Promise<{ status: string }> {
  const result = await runCycle(input, wiring);
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
  deps: FixLoopDrainDeps,
): Promise<FixLoopDrainResult[]> {
  const paths = getPaths(deps.queueRoot);
  const logsRoot = deps.logsRoot ? resolve(deps.logsRoot) : resolve(FORGE_ROOT, '_logs');
  const confirmMerge = deps.confirmMerge ?? confirmPrMerged;
  const runDrainCycle = deps.runDrainCycle ?? defaultRunDrainCycle;
  const caps = resolveReviewLoopCaps();

  const out: FixLoopDrainResult[] = [];
  if (!existsSync(paths.readyForReview)) return out;

  for (const file of readdirSync(paths.readyForReview)) {
    if (!file.endsWith('.md') || (deps.only !== undefined && file !== deps.only)) continue;
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
      // (`runCycle({resumeFrom:'develop'})`: dev-loop, PM, integrate,
      // adversarial-review) against these two values, plus `spawnSync('git',
      // …, {cwd: worktreePath})`. The check must precede the `existsSync`
      // probe below, because every later use — `hasReviewCapExhaustedMarker`,
      // `hasMergeGateConfigErrorMarker`, `failedFixWorkItemIds`,
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
      // Mechanism B (carried over from D-20): reuse the SAME cycle_id so the
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
      const logPath = join(logsRoot, cycleId, 'events.jsonl');
      const round = m.review_rounds ?? 0;
      // forge-mfv5.1.57: every park is said — one error event + one notify per distinct detail since the last cycle.start.
      const park = (detail: string): void => {
        if (!drainParkAlreadySaid(logPath, detail)) {
          createLogger(cycleId, logsRoot).emit({ initiative_id: initiativeId, phase: 'review-loop', skill: 'fix-loop-drain', event_type: 'error', input_refs: [manifestPath], output_refs: [], message: 'fix-loop.needs-operator', metadata: { round, detail } });
          deps.notify?.(`${initiativeId} · fix round ${round} parked (needs operator): ${detail}`);
        }
        out.push({ initiativeId, status: 'needs-operator', detail });
      };

      // Operator territory — never auto-retry. Both marker writers respect the
      // marker, so its presence means no fresh fix WI was enqueued behind it.
      if (hasReviewCapExhaustedMarker(worktreePath)) {
        park('review-cap-exhausted marker present');
        continue;
      }
      if (hasMergeGateConfigErrorMarker(worktreePath)) {
        park('merge-gate-config-error marker present');
        continue;
      }
      // forge-mfv5.1.57: a failed fix WI a later send-back appended behind is superseded — only the others park the drain.
      const failed = failedFixWorkItemIds(worktreePath);
      if (failed.length > 0) {
        park(`failed fix work-item ${failed.join(', ')} — send back a new fix work item to supersede it, or take the worktree over`);
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
      // forge-mfv5.1.27: a gate-fix round re-enters only on the head it was parked on — checked BEFORE the claim.
      const headRefusal = fixRoundHeadRefusal({ worktreePath, logPath, projectRepoPath, branch: `forge/${initiativeId}` });
      if (headRefusal !== null) {
        if (!drainParkAlreadySaid(logPath, headRefusal)) createLogger(cycleId, logsRoot).emit({ initiative_id: initiativeId, phase: 'review-loop', skill: 'fix-loop-drain', event_type: 'error', input_refs: [manifestPath], output_refs: [], message: 'fix-round.head-moved', metadata: { detail: headRefusal } });
        park(headRefusal);
        continue;
      }

      // forge-mfv5.1.39: a round that halted on this pending set stays halted until the operator's Requeue (a new cycle.start).
      const haltRefusal = haltedRoundRefusal(logPath, pending.map((p) => p.work_item_id));
      if (haltRefusal !== null) {
        if (!haltRefusal.alreadyRefused) createLogger(cycleId, logsRoot).emit({ initiative_id: initiativeId, phase: 'review-loop', skill: 'fix-loop-drain', event_type: 'error', input_refs: [manifestPath], output_refs: [], message: 'sendback.loop-halt-refused', metadata: { detail: haltRefusal.detail } });
        park(haltRefusal.detail);
        continue;
      }

      // Merge-vs-loop (D-20): a MERGED PR is finalize-merged's domain — the
      // merge always wins; finalize surfaces the dropped fix WIs non-silently.
      if (await confirmMerge(worktreePath)) {
        out.push({ initiativeId, status: 'pr-merged' });
        continue;
      }

      // Caps (defence in depth — the verdict handler enforces them at append).
      const totalFix = fixWorkItemCount(worktreePath);
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

      // R4-10-F1: no UWI re-arm — the develop flow's integrate node re-authors
      // demo.json + the PR description against the fixed branch on every
      // re-entry (resume_from:'develop' runs dev→integrate→adversarial-review→verdict).
      // The unifier node (and its static UWI-1) is off the live flow; the
      // re-demo is the integrate node's own job now, not a re-armed unifier mission.

      // Heartbeat the claimed manifest so a daemon crash mid-drain leaves a
      // STALE heartbeat the recovery sweep reclaims — and resumes correctly
      // (the send-back stamped resume_from:'develop' on the manifest).
      writeHeartbeat(file, paths);
      const heartbeat = setInterval(() => { try { writeHeartbeat(file, paths); } catch { /* best-effort */ } }, DRAIN_HEARTBEAT_MS);

      // forge-mfv5.1.57: the round runs over the failed fix WIs it supersedes — recorded once, by name.
      const { superseded, by } = supersededFixWorkItems(worktreePath);
      if (by !== null && !supersessionAlreadySaid(logPath, superseded, by)) {
        createLogger(cycleId, logsRoot).emit({ initiative_id: initiativeId, phase: 'review-loop', skill: 'fix-loop-drain', event_type: 'log', input_refs: [inFlightPath], output_refs: [], message: 'sendback.superseded', metadata: { round, superseded, by } });
      }

      // forge-nk1y.22: a pre-#1172 gate-fix WI carries the no-op gate ['true'] — give it the failing gate's own command.
      normaliseLegacyFixGatesAtReentry({ worktreePath, initiativeId, cycleId, logsRoot });

      const input: CycleInput = {
        initiativeId,
        manifestPath: inFlightPath,
        projectRepoPath,
        worktreePath,
        cycleId,
        resumeFrom: 'develop',
        ...(deps.logsRoot ? { logsRoot } : {}),
      };
      let inFailed = false;
      const headBefore = worktreeHeadSha(worktreePath);
      try {
        // A THROWN cycle (runCycle classifies and returns every failure inside its own try) keeps the pinned
        // `status:'error'` + return-to-ready-for-review contract (drain-fix-loop.test.ts).
        const result = await runDrainCycle(input, deps.phaseWiring);
        // forge-mfv5.1.39: a failed run that left the round untouched (same pending WIs, same head) and did not
        // classify transient re-fails identically every tick — halt it by name in failed/, never back to ready-for-review.
        const after = pendingFixWorkItems(worktreePath).map((p) => p.work_item_id).sort();
        const headAfter = worktreeHeadSha(worktreePath);
        const untouched = after.join(',') === pending.map((p) => p.work_item_id).sort().join(',') && headAfter === headBefore;
        // forge-mfv5.1.56: a round whose fix WIs failed is halted by the dev loop itself (recorded, before integrate).
        const recorded = result.status === 'failed' ? recordedRoundHalt(logPath) : null;
        const halt = recorded ?? (result.status === 'failed' && untouched ? roundHaltFromLog(logPath) : null);
        if (halt !== null) {
          if (recorded === null) createLogger(cycleId, logsRoot).emit({ initiative_id: initiativeId, phase: 'review-loop', skill: 'fix-loop-drain', event_type: 'error', input_refs: [inFlightPath], output_refs: [], message: 'sendback.loop-halted', metadata: { round, classification: halt.classification, reason: halt.reason, pending_work_items: after, head_sha: headAfter } });
          try { // the event is the record the surfaces read; the manifest copy never blocks the move to failed/
            annotateManifest(inFlightPath, { round_halt: halt.classification, round_halt_reason: JSON.stringify(halt.reason).replace(/\$/g, '\\u0024') }); // `$` is a String.replace pattern there
          } catch (err) { deps.notify?.(`${initiativeId} · halted round's manifest record not written: ${err instanceof Error ? err.message : String(err)}`); }
          try { moveTo(file, 'failed', paths); } catch (err) { throw new Error(`fix round halted, but the move to failed/ failed: ${err instanceof Error ? err.message : String(err)}`); }
          inFailed = true;
          deps.notify?.(`${initiativeId} · fix round ${round} halted (${halt.classification}): ${halt.reason} — fix the worktree, then Requeue`);
          out.push({ initiativeId, status: 'halted', detail: halt.reason });
          continue;
        }
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
        // forge-mfv5.1.62: a failed round that leaves no fix WI pending (gitweave I4: the fix WI delivered, the review
        // failed) has nothing the drain can re-run — it lands in failed/, the scheduler's own placement for a failed
        // cycle, where Requeue resumes it; ready-for-review/ is for a round that reached its verdict gate.
        if (result.status === 'failed' && after.length === 0) {
          try { moveTo(file, 'failed', paths); } catch (err) { throw new Error(`fix round failed with no fix work item pending, but the move to failed/ failed: ${err instanceof Error ? err.message : String(err)}`); }
          inFailed = true;
        }
        out.push({ initiativeId, status: 'drained', detail: result.status });
      } finally {
        clearInterval(heartbeat);
        // Closure is the single terminal-move authority. If the cycle
        // threw/crashed before closure, the manifest is stranded in in-flight —
        // return it to ready-for-review so it's never lost.
        if (!inFailed && existsSync(inFlightPath)) {
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
