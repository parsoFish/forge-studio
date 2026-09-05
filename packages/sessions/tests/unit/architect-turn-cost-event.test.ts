/**
 * bead forge-8vfn.18, half 2 — the architect must EMIT what the turn now returns.
 *
 * `architect-session.ts:359` has always summed `cost_usd` across the session's
 * events; nothing was ever emitted for it to sum, so the ceiling could not bound
 * stage 1 and two funded G1 runs reported a stage-2/3 figure as their total.
 *
 * The emitted event must be AUTHORITATIVE under `kernel/event-cost.ts`'s rule:
 * the `architect` phase emits no `iteration` events, so a plain per-turn event
 * counts once and `sumAuthoritativeCostUsd` totals the session correctly. That
 * rule is asserted here rather than assumed, because getting it wrong is how a
 * naive sum overcounts 2.35× — the reason the rule exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sumAuthoritativeCostUsd, type EventLogEntry } from '@forge/kernel';

/** The shape `runStructured` emits, as an event-log row. */
function architectCostEvent(costUsd: number): EventLogEntry {
  return {
    event_id: 'e', cycle_id: 'c', started_at: new Date().toISOString(),
    initiative_id: 'INIT-x', phase: 'architect', skill: 'architect',
    event_type: 'end', input_refs: [], output_refs: [],
    cost_usd: costUsd, message: 'architect.turn-cost',
  } as unknown as EventLogEntry;
}

test('per-turn architect cost events are AUTHORITATIVE and sum across a session', () => {
  const events = [architectCostEvent(0.40), architectCostEvent(0.25), architectCostEvent(1.10)];
  assert.equal(Number(sumAuthoritativeCostUsd(events).toFixed(2)), 1.75,
    'three interview turns must total, not collapse to one or double-count');
});

test('a zero-cost turn contributes nothing and breaks nothing', () => {
  assert.equal(sumAuthoritativeCostUsd([architectCostEvent(0), architectCostEvent(0.5)]), 0.5);
});

test('the architect phase must NOT emit iteration events, or these rows stop counting', () => {
  // The authoritative rule is: if a phase emits `iteration` events, ONLY those
  // count for that phase. Were the architect ever to gain one, every per-turn
  // cost row here would be silently dropped from the total — a regression that
  // would look exactly like "the architect is free" again.
  const withIteration = [
    architectCostEvent(0.40),
    { ...architectCostEvent(0), event_type: 'iteration' } as EventLogEntry,
  ];
  assert.equal(sumAuthoritativeCostUsd(withIteration), 0,
    'this asserts the TRAP, not the desired behaviour: adding an iteration event to the architect phase zeroes its turn costs');
});
