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
 * The rule (single source of truth — used by `packages/flows/metrics.ts::aggregate()`,
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
 *
 * The ITERATION rule alone, deliberately: the restatement rule below needs
 * stream identity, not a phase name, so `countsTowardCost` composes the two.
 */
export function isAuthoritativeCostEvent(
  e: EventLogEntry,
  iterationPhases: ReadonlySet<string>,
): boolean {
  return iterationPhases.has(e.phase) ? e.event_type === 'iteration' : true;
}

/**
 * The out-of-cycle architect session a synthetic `architect.end` restates into
 * the cycle log (`emitSyntheticArchitectEvents`); `null` for anything else.
 * Named narrowly on purpose — a vaguer "duplicated end event" rule would eat
 * real spend the first time a phase legitimately billed the same amount twice.
 */
function syntheticArchitectSessionKey(e: EventLogEntry): string | null {
  if (e.phase !== 'architect' || e.event_type !== 'end') return null;
  const sessionId = (e.metadata as { session_id?: unknown } | undefined)?.session_id;
  return typeof sessionId === 'string' && sessionId.length > 0 ? `architect:${sessionId}` : null;
}

/**
 * Event ids of synthetic architect rows RESTATING a session already counted —
 * bead forge-8vfn.6.10.22. `runCycle` could be entered twice for one cycle and
 * each entry emitted a fresh `architect.end` carrying the whole spend, with a
 * distinct `event_id`; the iteration rule cannot see it because the architect
 * emits no `iteration` event. Measured on G2 (2026-09-05): $26.3048 logged
 * against $23.9721 spent. The FIRST row is the spend.
 */
export function restatedSyntheticEventIds(
  events: readonly EventLogEntry[],
): ReadonlySet<string> {
  const seen = new Set<string>();
  const restated = new Set<string>();
  for (const e of events) {
    const key = syntheticArchitectSessionKey(e);
    if (key === null) continue;
    if (seen.has(key)) restated.add(e.event_id);
    else seen.add(key);
  }
  return restated;
}

/**
 * The two stream-level facts the cost rule needs, built once from the widest
 * stream and passed to every sub-bucket sum, so a per-node figure cannot
 * disagree with the total it rolls into.
 */
export type CostStreamFacts = {
  readonly iterationPhases: ReadonlySet<string>;
  readonly restatedEventIds: ReadonlySet<string>;
};

export function costStreamFacts(events: readonly EventLogEntry[]): CostStreamFacts {
  return {
    iterationPhases: phasesWithIterationEvents(events),
    restatedEventIds: restatedSyntheticEventIds(events),
  };
}

/**
 * Authoritative under the iteration rule AND not a restatement of a session the
 * stream already counted. Every summing caller uses this; `CostTracker` stays on
 * `isAuthoritativeCostEvent` — it is fed one run's events once, in order, by a
 * tracker built fresh per cycle.
 */
export function countsTowardCost(e: EventLogEntry, facts: CostStreamFacts): boolean {
  if (facts.restatedEventIds.has(e.event_id)) return false;
  return isAuthoritativeCostEvent(e, facts.iterationPhases);
}

/**
 * Sum spend over `events` under both rules above. Pass `facts` when summing a
 * sub-bucket of a larger stream; it defaults to deriving them from `events`.
 */
export function sumAuthoritativeCostUsd(
  events: readonly EventLogEntry[],
  facts: CostStreamFacts = costStreamFacts(events),
): number {
  let sum = 0;
  for (const e of events) {
    if (countsTowardCost(e, facts)) sum += e.cost_usd ?? 0;
  }
  return sum;
}
