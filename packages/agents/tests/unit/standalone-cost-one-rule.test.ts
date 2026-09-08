/**
 * Bead `forge-8vfn.7.6.7` — a standalone run's ledger row prices itself with
 * the SAME rule as every other cost surface.
 *
 * MEASURED in M6-D's S5 run 1, beat 13. The page knew the cost twice over —
 * right rail "status: done · $0.2420 · 14 events", drawer header "$0.24", and
 * the story runner independently priced the run at $0.2420 — while
 * `data-ledger-cost-usd` was ABSENT, because `HistoryLedger.tsx` omits the
 * attribute when `row.costUsd` is null and for this row it was null.
 *
 * The omit is NOT the defect and is deliberately left alone: it is what made
 * the disagreement visible instead of publishing a fabricated `0.00`. The
 * defect is upstream. `deriveStandaloneStateFromEvents` read ONE field off
 * ONE event —
 *   `typeof endEvent?.['cost_usd'] === 'number' ? endEvent['cost_usd'] : null`
 * — which is a SECOND cost formula, in a campaign that has exactly one:
 * `@forge/kernel`'s `sumAuthoritativeCostUsd`, wrapped for both readers as
 * `deriveSessionCostUsd`. Its own docstring says why it lives in the kernel:
 * "BOTH readers need it and they sit in packages that may not import each
 * other … Two copies of a two-line wrapper is how a second formula starts."
 * The sibling branch in `bridge-agents-history-rows.ts:348` already calls it.
 *
 * This is the same class as bead `forge-8vfn.7.6.1`, and the same class this
 * lane's cull ledger already cut once (`readSessionLogFacts`' naive
 * `total += cost_usd`, measured at 2.35x the true figure).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveStandaloneStateFromEvents } from '../../bridge-agents-run-state.ts';

/** A run whose spend is recorded on its priced turn rows, with an `end` event
 *  that carries no `cost_usd` of its own — the shape S5 run 1 produced. */
const PRICED_TURNS_UNPRICED_END = [
  { event_id: 'EV_1', event_type: 'start', message: 'agent run start' },
  { event_id: 'EV_2', event_type: 'log', message: 'turn 1', cost_usd: 0.1420 },
  { event_id: 'EV_3', event_type: 'log', message: 'turn 2', cost_usd: 0.1000 },
  { event_id: 'EV_4', event_type: 'end', message: 'agent run end' },
] as const;

test('a finished standalone run prices itself from its whole log, not from the end event alone', () => {
  const state = deriveStandaloneStateFromEvents(PRICED_TURNS_UNPRICED_END as unknown as Record<string, unknown>[]);
  assert.equal(state.state, 'done', 'precondition: the end event still makes this run done');
  assert.notEqual(
    state.costUsd,
    null,
    'the run spent real money on rows the log carries — a null here is what blanked data-ledger-cost-usd while the page showed $0.2420 beside it',
  );
  assert.ok(
    state.costUsd !== null && Math.abs(state.costUsd - 0.2420) < 1e-9,
    `expected the authoritative sum 0.2420, got ${String(state.costUsd)}`,
  );
});

test('a log with no priced row at all still reports NO figure — honest null, never a fabricated 0.00', () => {
  const state = deriveStandaloneStateFromEvents([
    { event_id: 'EV_1', event_type: 'start', message: 'agent run start' },
    { event_id: 'EV_2', event_type: 'end', message: 'agent run end' },
  ] as unknown as Record<string, unknown>[]);
  assert.equal(state.state, 'done');
  assert.equal(state.costUsd, null, 'a run that recorded no price has no figure — a different fact from a run that cost nothing');
});

test('the end event\'s own cost_usd is counted, not ignored — the fix must not trade one blind spot for another', () => {
  const state = deriveStandaloneStateFromEvents([
    { event_id: 'EV_1', event_type: 'start', message: 'agent run start' },
    { event_id: 'EV_2', event_type: 'end', message: 'agent run end', cost_usd: 0.5 },
  ] as unknown as Record<string, unknown>[]);
  assert.equal(state.costUsd, 0.5);
});
