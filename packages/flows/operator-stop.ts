/**
 * operator-stop.ts — the non-destructive `stop-run` signal (bead
 * forge-8vfn.8.1.39, rulings 1771 + 1774; D-11 amendment "operator stop is
 * a second trigger on the clean-boundary halt").
 *
 * WHY A FILE, NOT A LIVE HANDLE. The bridge and the daemon (`forge serve`)
 * are separate OS processes (D-04) and there is no cycle registry the
 * bridge can reach into — ruling 1774 rejected building one (that is the
 * process isolator R-03 rules out). The cost ceiling already halts a
 * running cycle at a clean boundary via a value the runner polls
 * (`CostTracker`, flow-budgets.ts); an operator stop reuses exactly that
 * shape as a SECOND trigger on the same halt, via a flag FILE instead of an
 * in-memory counter — consistent with D-04's "the filesystem is the
 * protocol": presence, not contents, is the signal, same as every other
 * flag file in this package.
 *
 * WHO WRITES IT. The bridge's `POST /api/recovery/:id/stop` route, for an
 * ACTIVE (in-flight) run only — `bridge-recovery.ts`. A GATED (ready-for-review)
 * run has no live agent to signal at all; that path moves the manifest
 * straight to `failed/` instead (see `bridge-recovery.ts`'s `recoveryStop`).
 *
 * WHO READS IT, AND HOW OFTEN. The flow runner, at the SAME two boundaries
 * `CostTracker` already checks (`flow-runner.ts`'s node-boundary check,
 * `CycleInput.shouldStopBeforeWorkItem`'s WI-boundary check) — non-destructive,
 * existence-only reads. `executor-table.ts`'s `runWithWedge` ALSO polls it from
 * the SAME 100ms interval `raceWithWedge` already runs for wedge detection
 * (never a second poller thread), so a run with a wedge budget configured
 * aborts its live turn via the SAME AbortController the wedge-kill uses.
 *
 * WHO DELETES IT (M7 row 150 round 4). The queue primitives themselves,
 * unconditionally, so a stale flag can never outlive the halt it belongs to
 * or meet a fresh cycle of the same initiative id: `queue.ts`'s `moveTo`
 * removes it on every in-flight → terminal transition (the SAME move that
 * already clears the `.heartbeat` sidecar), and `queue.ts`'s `claim` removes
 * any pre-existing one BEFORE renaming pending → in-flight, in case a prior
 * cycle's flag somehow survived. `forge-requeue.ts`'s stale-sidecar sweep and
 * `recoveryAbandon` also clear it on their own paths, but neither is the
 * backstop any more — the queue primitives are. No new cleanup timer, no new
 * queue state.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OPERATOR_STOP_MESSAGE_PREFIX } from '@forge/contracts';

export const OPERATOR_STOP_REASON = 'operator-stop' as const;

/** The flag file's name for a given initiative — `<id>.stop`, a sibling of the
 *  manifest in whichever queue dir currently holds it. */
export function operatorStopFilename(initiativeId: string): string {
  return `${initiativeId}.stop`;
}

/** The flag file's full path inside `inFlightDir` (`_queue/in-flight/`). */
export function operatorStopPath(inFlightDir: string, initiativeId: string): string {
  return join(inFlightDir, operatorStopFilename(initiativeId));
}

export type OperatorStopRequest = {
  reason: typeof OPERATOR_STOP_REASON;
  /** ISO timestamp the bridge wrote, best-effort — empty when unavailable. */
  ts: string;
  /** Single-operator system (no auth layer) — always 'operator' today; kept
   *  as a field (not a literal) so a future multi-operator identity has
   *  somewhere to land without a shape change. */
  actor: string;
};

/**
 * Non-destructive, existence-based check — presence is the signal, same as
 * every other flag file this package reads. A malformed file still halts the
 * run (only the bridge's own stop route ever
 * writes one); `null` means no stop was requested.
 */
export function readOperatorStopRequest(
  inFlightDir: string,
  initiativeId: string,
): OperatorStopRequest | null {
  const path = operatorStopPath(inFlightDir, initiativeId);
  if (!existsSync(path)) return null;
  const fallback: OperatorStopRequest = { reason: OPERATOR_STOP_REASON, ts: '', actor: 'operator' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<OperatorStopRequest>;
    return {
      reason: OPERATOR_STOP_REASON,
      ts: typeof parsed.ts === 'string' ? parsed.ts : fallback.ts,
      actor: typeof parsed.actor === 'string' ? parsed.actor : fallback.actor,
    };
  } catch {
    return fallback;
  }
}

/**
 * Thrown at a clean node/WI boundary (mirrors `CostCeilingError`,
 * flow-budgets.ts) once the bridge has requested a stop. The message's
 * `operator-stop:` prefix is the signature `failure-classifier.ts` scans
 * for — classified terminal + `recoverable: false` there, same as a cost-
 * ceiling stop, so an operator stop is never silently auto-retried.
 */
export class OperatorStopError extends Error {
  constructor() {
    super(
      `${OPERATOR_STOP_MESSAGE_PREFIX} the operator requested this run stop — halting at a ` +
        'clean boundary (resumable; the worktree and branch are kept).',
    );
    this.name = 'OperatorStopError';
  }
}

/**
 * `raceWithWedge` (executor-deps.ts) aborts its ONE shared AbortController for
 * either cause and passes the winning error as `abort(reason)`'s reason, so a
 * caller holding only the resulting `signal` can still tell which one fired.
 * `developer-loop.ts`'s two abort-message sites (between-attempt and
 * mid-attempt) both read `signal.reason` through this instead of hardcoding
 * the wedge-kill text unconditionally — an operator stop must classify as
 * `operator-stop:`, not `wedge-kill:` (failure-classifier.ts keys on the
 * prefix), even though both share the same AbortSignal plumbing.
 */
export function describeNodeAbort(signal: AbortSignal | undefined, fallback: string): string {
  return signal?.reason instanceof OperatorStopError ? signal.reason.message : fallback;
}

/**
 * `developer-loop.ts`'s two abort sites (between-attempt and mid-attempt)
 * both build the identical `{ kind: 'aborted', message }` shape from
 * `describeNodeAbort` — kept as one function, beside it, so the two call
 * sites cannot drift and so the row-150 fix costs the file zero net lines
 * over its pre-existing `{ kind: 'aborted', message: '<literal>' }` shape.
 */
export function wedgeKillRunnerError(
  signal: AbortSignal | undefined,
  fallback: string,
): { kind: 'aborted'; message: string } {
  return { kind: 'aborted', message: describeNodeAbort(signal, fallback) };
}

/**
 * The GATED-run half of `stop-run` (bridge-recovery.ts's `recoveryStop`): a
 * `ready-for-review` run has no live agent to signal at all — nothing will
 * ever run `flow-runner.ts`'s node-boundary check for it again — so the
 * bridge appends the SAME two event shapes that check would otherwise have
 * produced (`flow.operator-stop` + a `failure_classification`, matching
 * `emitFailureClassification`'s own shape in `cycle.ts`) directly to the
 * cycle's own `events.jsonl`, so `deriveOperatorStop` / `findFailure`
 * (run-model-derive-status.ts) read the SAME reason regardless of which path
 * produced it. Best-effort, mirroring `scheduler-run-one.ts`'s
 * `emitOrchestratorEvent` — a logging failure must never block the manifest
 * move that already happened.
 */
export function appendOperatorStopEvents(
  logsRoot: string,
  cycleId: string,
  initiativeId: string,
): void {
  try {
    const logDir = resolve(logsRoot, cycleId);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'events.jsonl');
    const stopMessage = new OperatorStopError().message;
    const now = new Date().toISOString();
    const base = {
      cycle_id: cycleId,
      initiative_id: initiativeId,
      started_at: now,
      phase: 'orchestrator' as const,
    };
    const lines = [
      {
        ...base,
        event_id: `flow.operator-stop-${Date.now()}`,
        skill: 'flow-budgets',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'flow.operator-stop',
        metadata: { stoppedBeforeNode: null },
      },
      {
        ...base,
        event_id: `failure_classification-${Date.now()}`,
        skill: 'cycle',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'failure_classification',
        metadata: {
          cycle_id: cycleId,
          failure_mode: 'terminal',
          failure_kind: 'terminal',
          recoverable: false,
          environment: false,
          cleanBoundaryHalt: true,
          reason: stopMessage,
          evidence_event_ids: [],
        },
      },
    ];
    for (const line of lines) appendFileSync(logPath, JSON.stringify(line) + '\n');
  } catch {
    /* best-effort — the manifest move already happened; a logging failure
       must not surface as a failed stop request. */
  }
}
