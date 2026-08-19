/**
 * S7 / DEC-3 — the "start development" trigger.
 *
 * The architect flow (forge-architect) decomposes an initiative into work items;
 * the operator then presses "start development" on the roadmap. Since R2-04-F1
 * (ADR-041) this module is a thin delegate over the generic per-flow claimable
 * enqueue (`enqueue-flow-run.ts`) with the target pinned to `forge-develop` —
 * it keeps its own result vocabulary (`already-developing`) for its existing
 * callers (`POST /api/develop/start`, the trigger drain, tests).
 *
 * DEC-2 lineage, the develop-ability state guards, and the known-gaps §9
 * `not-planned` gate all live in the generic module now.
 */
import { enqueueFlowRun, DEVELOP_FLOW_ID, type EnqueueFlowRunResult } from './enqueue-flow-run.ts';
import type { QueuePaths } from './queue.ts';

export { DEVELOP_FLOW_ID };

export type EnqueueDevelopStatus =
  | 'enqueued'
  | 'not-found'
  | 'already-developing'
  /** W7-FIX-A3 (round-2 finding 6): the manifest is in `_queue/done` — a
   *  shipped initiative is never re-run from an operator action. */
  | 'already-done'
  | 'not-planned'
  | 'error';

export type EnqueueDevelopResult = {
  status: EnqueueDevelopStatus;
  initiativeId: string;
  /** Present on `enqueued` — the threaded cycle id (architect-minted or fresh). */
  cycleId?: string;
  /** Present on `enqueued` — always `forge-develop`. */
  flowId?: string;
  detail?: string;
};

/** Enqueue a develop run — `enqueueFlowRun(id, 'forge-develop')` with the
 *  historical `already-developing` status name preserved. Never throws. */
export function enqueueDevelopRun(
  initiativeId: string,
  opts: { queueRoot?: string; allowFinishedSource?: boolean } = {},
): EnqueueDevelopResult {
  const r: EnqueueFlowRunResult = enqueueFlowRun(initiativeId, DEVELOP_FLOW_ID, opts);
  return { ...r, status: r.status === 'already-running' ? 'already-developing' : r.status };
}

/** Re-exported for callers that need the queue layout (the bridge route). */
export type { QueuePaths };
