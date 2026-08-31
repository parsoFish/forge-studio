/**
 * Phase 4 / Step 3 (2026-07-10 false-total-failure race,
 * brain/cycles/themes/): wiOutcomes moved from a push-array to a
 * Map<work_item_id, WiOutcome> with two hard invariants:
 *
 *   1. `settleWiOutcome` — a WI settles EXACTLY ONCE; a second settle for the
 *      same id is an internal-invariant violation (double-settle guard).
 *   2. `assertOutcomesSettled` — the aggregate phase-end event and the
 *      total-failure verdict must never derive complete/failed counts from a
 *      PARTIAL snapshot; a missing WI throws, naming it, BEFORE any count is
 *      computed.
 *
 * Tests drive the exported pure functions directly, following the repo
 * pattern established by developer-loop.prereq-cascade.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertOutcomesSettled, settleWiOutcome, type WiOutcome } from './developer-loop.ts';
import type { WorkItem } from '../work-item.ts';

function wi(id: string): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-10-fixture',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [],
    files_in_scope: [],
    estimated_iterations: 3,
    body: '',
  };
}

test('settleWiOutcome: first settle for an id records the outcome', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  assert.equal(outcomes.size, 1);
  assert.deepEqual(outcomes.get('WI-1'), { id: 'WI-1', status: 'complete', result: null });
});

test('settleWiOutcome: a second settle for the SAME id throws (double-settle guard)', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  assert.throws(
    () => settleWiOutcome(outcomes, { id: 'WI-1', status: 'failed', result: null }),
    /WI-1.*settled twice|double-settle/i,
  );
  // The original outcome is untouched — a double-settle never silently
  // overwrites a prior outcome before throwing.
  assert.deepEqual(outcomes.get('WI-1'), { id: 'WI-1', status: 'complete', result: null });
});

test('settleWiOutcome: distinct ids settle independently without conflict', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  settleWiOutcome(outcomes, { id: 'WI-2', status: 'failed', result: null });
  assert.equal(outcomes.size, 2);
});

test('assertOutcomesSettled: a fully-settled snapshot passes silently', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  settleWiOutcome(outcomes, { id: 'WI-2', status: 'failed', result: null });
  assert.doesNotThrow(() => assertOutcomesSettled(outcomes, [wi('WI-1'), wi('WI-2')]));
});

test('assertOutcomesSettled: an artificially missing outcome throws, naming the missing WI', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  // WI-2 never settled (simulates a code path that forgot to settle before
  // the loop moved on) — the invariant must catch this BEFORE any
  // complete/failed count is derived from the partial map.
  assert.throws(
    () => assertOutcomesSettled(outcomes, [wi('WI-1'), wi('WI-2')]),
    /WI-2/,
  );
});

test('assertOutcomesSettled: an empty snapshot against an empty run-list passes (unifier-only resume, toRun = [])', () => {
  const outcomes = new Map<string, WiOutcome>();
  assert.doesNotThrow(() => assertOutcomesSettled(outcomes, []));
});

test('end-event counts: complete/failed are only derived after assertOutcomesSettled passes', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  settleWiOutcome(outcomes, { id: 'WI-2', status: 'failed', result: null });
  settleWiOutcome(outcomes, { id: 'WI-3', status: 'complete', result: null });

  const wisRun = [wi('WI-1'), wi('WI-2'), wi('WI-3')];
  assertOutcomesSettled(outcomes, wisRun);

  // Mirrors the exact derivation at the runDeveloperLoop call site.
  const completeCount = [...outcomes.values()].filter((o) => o.status === 'complete').length;
  assert.equal(completeCount, 2);
  assert.equal(wisRun.length - completeCount, 1);
});

test('end-event counts: a partial snapshot never reaches count derivation — it throws first', () => {
  const outcomes = new Map<string, WiOutcome>();
  settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null });
  // WI-2 and WI-3 never settled.
  const wisRun = [wi('WI-1'), wi('WI-2'), wi('WI-3')];

  let reachedCountDerivation = false;
  assert.throws(() => {
    assertOutcomesSettled(outcomes, wisRun);
    reachedCountDerivation = true;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    [...outcomes.values()].filter((o) => o.status === 'complete').length;
  }, /WI-2|WI-3/);
  assert.equal(reachedCountDerivation, false, 'count derivation must never run on a partial snapshot');
});
