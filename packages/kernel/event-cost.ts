/**
 * Shared cost-summation rule for cycle event logs (plan item 1.8 — cost truth).
 *
 * `cost_usd` appears on MULTIPLE event types for the same spend. Phases that
 * run an iteration loop (developer-loop, unifier) emit the authoritative
 * per-turn cost on their `iteration` events, then RESTATE the same dollars on
 * the per-work-item `end` event AND the phase-level rollup `end` event —
 * naively summing every row double/triple-counts those phases. Verified in
 * docs/investigations/2026-07-holistic-review/cost-autopsy.md §0.
 *
 * The rule (single source of truth — used by `cli/metrics.ts::aggregate()`,
 * `orchestrator/run-model.ts::buildRun()` and
 * `orchestrator/run-model-derive.ts::buildNodeMeta()` / `deriveWorkItems()`):
 *   - a phase that emitted ≥1 `iteration` event → count ONLY its `iteration`
 *     events (every other row restates dollars already counted);
 *   - otherwise → count every event (single-call phases carry cost on `end`,
 *     and a phase rejected before completing carries it on a terminal
 *     `error` event — cost-autopsy §4.1).
 */

import type { EventLogEntry } from './logging.ts';

/** Phases that emitted at least one `iteration` event in the given stream. */
export function phasesWithIterationEvents(
  events: readonly EventLogEntry[],
): ReadonlySet<string> {
  const phases = new Set<string>();
  for (const e of events) {
    if (e.event_type === 'iteration') phases.add(e.phase);
  }
  return phases;
}

/**
 * True when this event's `cost_usd` is authoritative spend — not a rollup
 * restating dollars already carried by the phase's iteration events.
 *
 * `iterationPhases` must be derived from the widest stream available (the
 * whole cycle log) so that summing a sub-bucket (one node, one work item)
 * stays consistent with the cycle-level totals.
 */
export function isAuthoritativeCostEvent(
  e: EventLogEntry,
  iterationPhases: ReadonlySet<string>,
): boolean {
  return iterationPhases.has(e.phase) ? e.event_type === 'iteration' : true;
}

/**
 * Sum authoritative `cost_usd` over `events` under the rule above. Pass
 * `iterationPhases` when summing a sub-bucket of a larger stream; it defaults
 * to deriving the set from `events` itself.
 */
export function sumAuthoritativeCostUsd(
  events: readonly EventLogEntry[],
  iterationPhases: ReadonlySet<string> = phasesWithIterationEvents(events),
): number {
  let sum = 0;
  for (const e of events) {
    if (isAuthoritativeCostEvent(e, iterationPhases)) sum += e.cost_usd ?? 0;
  }
  return sum;
}
