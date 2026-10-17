/**
 * Scheduler background sweeps (bead forge-8vfn.15 size split — see design.md).
 * Every function is BEST-EFFORT: none may throw out of a `setInterval` tick.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger, isSafeSegment, readHalt } from '@forge/kernel';
import { getPaths, recover, type QueuePaths, type RecoveryResult } from './queue.ts';
import * as worktree from './worktree.ts';
import { finalizeMergedReadyForReview } from './finalize-merged.ts';
import { drainPendingFixWorkItems } from './drain-fix-loop.ts';
import type { PhaseWiring } from './phase-wiring.ts';
import { drainFlowRunRequests } from './flow-run-requests.ts';
import { syncCronTriggers } from './cron-triggers.ts';
import { notify, type NotifyConfig } from './notify.ts';
import { strandedFailureClassification } from './requeue-resume.ts';

/**
 * F-W5-7 sweep: finalize ready-for-review cycles whose PR the operator has
 * merged — closure aligns local↔remote + deletes the branch + moves to done/,
 * and the reflector fires (reflection becomes available in the UI). Best-effort.
 */
export async function runFinalizeSweep(wiring: PhaseWiring): Promise<void> {
  try {
    for (const r of await finalizeMergedReadyForReview({ runReflector: wiring.runReflector })) {
      if (r.status === 'finalized') {
        console.log(`[serve] finalized ${r.initiativeId} — operator merged the PR → done + reflection`);
      } else if (r.status === 'error') {
        console.error(`[serve] finalize ${r.initiativeId} failed: ${r.detail}`);
      }
    }
  } catch {
    /* sweep is best-effort — never throw out of setInterval */
  }
}

/**
 * D-20 fix-loop drain sweep: re-enter any ready-for-review cycle that has
 * pending fix work-items (a review send-back compiled them onto the
 * initiative's own queue) in the SAME cycle — reusing the persisted cycle_id,
 * the worktree, and the open PR; the develop agent is the single fix executor.
 * Runs AFTER the finalize sweep so a freshly-merged PR is finalized first (the
 * drain skips merged PRs — a merge always wins). Best-effort — never throws
 * out of the timer.
 */
export async function runDrainSweep(
  wiring: PhaseWiring,
  queueRoot: string,
  scope: { only?: string; logsRoot?: string } = {},
): Promise<void> {
  if (readHalt(queueRoot) !== null) return; // the emergency halt (D-03): re-entry is a claim
  try {
    for (const r of await drainPendingFixWorkItems({ queueRoot, ...scope, notify: (m) => console.log(`[serve] ${m}`), phaseWiring: wiring })) {
      if (r.status === 'drained') {
        console.log(`[serve] fix loop ${r.initiativeId} — fix work items run in the same cycle (${r.detail})`);
      } else if (r.status === 'error') {
        console.error(`[serve] fix-loop drain ${r.initiativeId} failed: ${r.detail}`);
      }
    }
  } catch {
    /* sweep is best-effort — never throw out of setInterval */
  }
}

/**
 * Stage C flow-trigger sweep: dispatch any flow-run requests staged by an
 * `on: complete` trigger (repoint the source initiative at the target flow +
 * make it claimable). Best-effort — never throws out of the timer. No seed flow
 * declares an `on: complete` trigger today, so this is usually a no-op.
 */
export function runFlowTriggerSweep(): void {
  try {
    const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    for (const r of drainFlowRunRequests({ forgeRoot, notify: (m) => console.log(`[serve] ${m}`) })) {
      if (r.status === 'dispatched') {
        console.log(`[serve] flow-trigger dispatched ${r.target?.kind}:${r.target?.ref}${r.sourceInitiativeId ? ` on ${r.sourceInitiativeId}` : ' (originated)'}`);
      } else if (r.status === 'error') {
        console.error(`[serve] flow-trigger ${r.target?.kind}:${r.target?.ref} failed: ${r.detail}`);
      }
    }
  } catch {
    /* sweep is best-effort — never throw out of the timer */
  }
}

/**
 * R2-04 (D-23): sync the scheduler's armed cron triggers against every
 * flow's declared `on: cron` set (stop what's no longer declared, arm what's
 * newly declared). Best-effort, mirroring the other sweeps — a broken flow or
 * an invalid schedule is reported inside `syncCronTriggers` via `notify` and
 * must never throw out of the startup path or the recover-timer tick. A fire
 * only ever stages a claimable flow-run request (never dispatches, never
 * spawns); `onFire` is the in-process nudge that re-runs the flow-trigger
 * drain sweep promptly instead of waiting for the next poll.
 */
export function runCronSync(): void {
  try {
    const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    syncCronTriggers({
      forgeRoot,
      notify: (m) => console.log(`[serve] ${m}`),
      onFire: () => runFlowTriggerSweep(),
    });
  } catch {
    /* sweep is best-effort — never throw out of setInterval or startup */
  }
}

export async function runRecoverySweep(
  cfg: { queueRoot: string; staleHeartbeatMs: number; notify: NotifyConfig; logsRoot?: string },
  isLive: (filename: string) => boolean,
): Promise<void> {
  try {
    const paths = getPaths(cfg.queueRoot);
    const recoveries = recover({ paths, staleHeartbeatMs: cfg.staleHeartbeatMs, worktreeExists: worktree.exists, isLive });
    for (const r of recoveries) await announceRecovery(r, paths, cfg.notify, recoveryLogsRoot(paths, cfg.logsRoot));
  } catch {
    /* sweep is best-effort — never throw out of setInterval */
  }
}

/** The logs root a recovery event lands in: the configured one, else `<forgeRoot>/_logs` beside the queue. */
export function recoveryLogsRoot(paths: QueuePaths, logsRoot: string | undefined): string {
  return logsRoot ? resolve(logsRoot) : join(dirname(paths.root), '_logs');
}

/**
 * Announce one `recover()` result (forge-mfv5.1.47): every manifest was parked in failed/, none is
 * re-dispatched or cleaned up (D-06). Each stranded one gets a `recovery.stranded-classified` event in
 * its own cycle log naming the reason, the operator-stop flag and the last cycle event, then the
 * `failure_classification` that strand stands for (forge-mfv5.1.54).
 */
export async function announceRecovery(r: RecoveryResult, paths: QueuePaths, cfg: NotifyConfig, logsRoot: string): Promise<void> {
  for (const c of r.classified) {
    const logId = c.cycleId !== null && isSafeSegment(c.cycleId) ? c.cycleId : c.initiativeId;
    if (!isSafeSegment(logId)) { console.error(`[serve] recovery.stranded-classified not logged: unsafe log id for ${c.filename}`); continue; }
    const metadata = { reason: c.reason, stop_flag: c.stopFlag, heartbeat_age_ms: c.heartbeatAgeMs, resume_from: c.resumeFrom, last_event: lastCycleEvent(join(logsRoot, logId, 'events.jsonl')), queue_state: 'failed', needs: 'operator' };
    const log = createLogger(logId, logsRoot);
    log.emit({ initiative_id: c.initiativeId, phase: 'orchestrator', skill: 'scheduler', event_type: 'error', input_refs: [join(paths.failed, c.filename)], output_refs: [], message: 'recovery.stranded-classified', metadata });
    // forge-mfv5.1.54: the same strand as the reader's own contract, so a Requeue resumes instead of re-running fresh.
    const cls = strandedFailureClassification({ reason: c.reason, stopFlag: c.stopFlag });
    if (cls) log.emit({ initiative_id: c.initiativeId, phase: 'orchestrator', skill: 'cycle', event_type: 'log', input_refs: [join(paths.failed, c.filename)], output_refs: [], message: 'failure_classification', metadata: { cycle_id: logId, ...cls, evidence_event_ids: [] } });
  }
  const refused = r.reason === 'worktree-path-refused';
  const title = refused ? `Refused ${r.recovered.length} manifest(s): worktree_path not the initiative's own` : `Parked ${r.recovered.length} stranded run(s) in failed/ — needs operator`;
  await notify({ type: 'failed', title, body: `Reason: ${r.reason}. Items: ${r.recovered.join(', ')}.${refused ? '' : ' Resume or requeue from the initiative card; nothing was re-run or cleaned up.'}` }, cfg);
}

/** The last parseable event of a cycle log (a torn SIGKILL line is skipped), or null. */
function lastCycleEvent(logPath: string): { message: string; phase: string | null; at: string | null } | null {
  const lines = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean) : [];
  for (const line of lines.reverse()) {
    try {
      const e = JSON.parse(line) as { message?: unknown; phase?: unknown; started_at?: unknown };
      if (typeof e.message === 'string') return { message: e.message, phase: typeof e.phase === 'string' ? e.phase : null, at: typeof e.started_at === 'string' ? e.started_at : null };
    } catch { /* torn line */ }
  }
  return null;
}
