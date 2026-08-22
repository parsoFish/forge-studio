/**
 * roadmap-card-state — the pure mapping from a dispatch result onto a roadmap
 * card's transient state.
 *
 * Extracted from `app/projects/[id]/page.tsx` by W8-A3 after adversarial review
 * round 2 found both mappers collapsing a REAL outcome —
 * `repoint-requires-confirm`, i.e. "this initiative is queued under another
 * flow" — into `{status:'error'}`. Downstream could then not tell it apart, so
 * the card relabelled its button "retry" and re-posted the identical
 * unconfirmed request forever. Both surfaces post exactly ONE named initiative,
 * so both can and must ask instead.
 *
 * They live here rather than inline in the page for one reason: inline they had
 * no test, and "an untested mapper silently dropped a status" is the same
 * `declared-data-fails-open` shape the rest of this lane is about.
 */
import type { DevelopCardState, PlanCardState } from '@/components/studio/RoadmapCanvas';
import type { PlanInitiativeResult } from './bridge-client';

/** One item of `POST /api/develop/start`'s per-id results array. */
export type DevelopStartItem = {
  ok: boolean;
  status?: string;
  detail?: string;
  flowId?: string;
  currentFlowId?: string;
};

/** Map a batch item result onto the per-card develop state. W7-A3
 *  (projects-32): keep the enqueue's flowId so the card links the run. */
export function developStateFromResult(
  item: DevelopStartItem | undefined,
  requestError: string | undefined,
): DevelopCardState {
  if (item?.ok) return { status: 'started', error: null, flowId: item.flowId };
  if (item?.status === 'repoint-requires-confirm') {
    return { status: 'needs-confirm', error: null, currentFlowId: item.currentFlowId ?? 'another flow' };
  }
  return { status: 'error', error: item?.detail ?? item?.status ?? requestError ?? 'failed to start development' };
}

/** Map a single plan-dispatch result onto the per-card plan state (W7-A3:
 *  flowId kept so the card links the run, projects-32). */
export function planStateFromResult(result: PlanInitiativeResult): PlanCardState {
  if (result.status === 'enqueued') return { status: 'started', error: null, flowId: result.flowId };
  if (result.status === 'repoint-requires-confirm') {
    return { status: 'needs-confirm', error: null, currentFlowId: result.currentFlowId ?? 'another flow' };
  }
  return { status: 'error', error: result.detail ?? result.status };
}
