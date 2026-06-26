/**
 * Stage C — generic, declaration-driven flow-trigger firing.
 *
 * A flow declares zero or more `triggers: [{ on, flow }]` in its flow.yaml. This
 * module is the SINGLE path that fires them — there is no hardcoded "on merge run
 * reflect" anywhere. Two event sites route through `fireFlowTriggers`:
 *
 *   - the flow-runner fires `on: complete` triggers on a flow's terminal success
 *     (dispatch = stage a claimable flow-run request), and
 *   - orchestrator/finalize-merged.ts fires `on: merged` triggers once a merged PR
 *     is confirmed (dispatch = run the target inline with the merged cycle's
 *     context — e.g. forge-develop's `{on: merged, flow: forge-reflect}`).
 *
 * The dispatcher is injected, so the same generic firing logic serves both the
 * "enqueue a fresh run" and the "run inline with cycle context" cases, and unit
 * tests assert firing without touching the queue or spawning an agent.
 */
import type { FlowDefinition, FlowTrigger } from './studio/types.ts';

/**
 * The lifecycle events a flow's declared triggers can fire on.
 * - `complete` — the flow reached terminal SUCCESS (fired by the flow-runner).
 * - `merged` — the flow's PR was merged + finalized (fired by finalize-merged,
 *   async + post-run; the flow itself terminated earlier at `ready-for-review`).
 */
export const FLOW_TRIGGER_EVENTS = ['complete', 'merged'] as const;
export type FlowTriggerEvent = (typeof FLOW_TRIGGER_EVENTS)[number];

export type FireFlowTriggersDeps = {
  /**
   * Dispatch one matching trigger. Injected — the flow-runner stages a claimable
   * run; finalize-merged runs the target inline with the merged cycle context.
   */
  dispatch: (trigger: FlowTrigger, event: FlowTriggerEvent) => void | Promise<void>;
  /** Observability hook fired just before each matching trigger dispatches. */
  onFire?: (trigger: FlowTrigger) => void;
};

/**
 * Fire the triggers a flow declares for `event`. Reads `flow.triggers`, selects
 * those whose `on` matches `event`, dispatches each via the injected `dispatch`
 * (awaited in declaration order), and returns the triggers that fired. A flow
 * with no matching trigger fires nothing — the empty, expected case.
 */
export async function fireFlowTriggers(
  flow: Pick<FlowDefinition, 'id' | 'triggers'>,
  event: FlowTriggerEvent,
  deps: FireFlowTriggersDeps,
): Promise<FlowTrigger[]> {
  const fired: FlowTrigger[] = [];
  for (const trigger of flow.triggers) {
    if (trigger.on !== event) continue;
    deps.onFire?.(trigger);
    await deps.dispatch(trigger, event);
    fired.push(trigger);
  }
  return fired;
}
