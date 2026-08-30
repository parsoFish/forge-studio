/**
 * W8-A3 — `flows-37`, adversarial review round 2 findings 1 and 2.
 *
 * THE DEFECT THESE KILL. Both mappers collapsed `repoint-requires-confirm` — a
 * real, distinct outcome meaning "this initiative is queued under another flow"
 * — into `{status: 'error'}`. Nothing downstream could tell it apart, so the
 * card relabelled its button "retry — plan" / "retry — start development" and
 * re-posted the identical unconfirmed request. Forever. That is round 1's own
 * S2-3 ("silently-corrupting became permanently 409") re-shipped one component
 * over, which is the campaign's most-measured failure mode: the fix shipping its
 * own instance of the defect it closed.
 *
 * Each test below is RED against the pre-fix mappers, which had no
 * `needs-confirm` branch and no `currentFlowId` at all.
 */
import { test, expect } from 'vitest';

import { developStateFromResult, planStateFromResult } from './roadmap-card-state.ts';
import type { PlanInitiativeResult } from './bridge-client.ts';

const ID = 'INIT-2026-08-18-alpha';

test('develop: a refused repoint is its OWN state, carrying the flow of origin — never an error', () => {
  const state = developStateFromResult(
    { ok: false, status: 'repoint-requires-confirm', currentFlowId: 'my-authored-flow', detail: '…Confirm the repoint to proceed.' },
    undefined,
  );
  expect(state.status).toBe('needs-confirm');
  expect(state.currentFlowId).toBe('my-authored-flow');
  expect(state.error, 'a confirmable refusal is not an error and must not render as one').toBeNull();
});

test('plan: same, on the sibling mapper — the one round 2 found still open after round 1 fixed its neighbour', () => {
  const result: PlanInitiativeResult = {
    status: 'repoint-requires-confirm',
    initiativeId: ID,
    currentFlowId: 'my-authored-flow',
    detail: '…Confirm the repoint to proceed.',
  };
  const state = planStateFromResult(result);
  expect(state.status).toBe('needs-confirm');
  expect(state.currentFlowId).toBe('my-authored-flow');
  expect(state.error).toBeNull();
});

test('a refusal that names NO flow is not confirmable — it is an error, not a confirmation the operator cannot satisfy', () => {
  // Review round 4, finding 8. The confirmation is a compare-and-swap against
  // the flow the operator was shown, so a refusal with nothing to show cannot be
  // confirmed. An earlier cut defaulted it to the literal 'another flow', which
  // the UI would then have DISPLAYED and SENT as `confirmRepointFrom` —
  // guaranteeing a bar the operator can click forever and never satisfy.
  //
  // KILLS: `currentFlowId: x.currentFlowId ?? 'another flow'`.
  const dev = developStateFromResult({ ok: false, status: 'repoint-requires-confirm', detail: 'queued elsewhere' }, undefined);
  expect(dev.status).toBe('error');
  expect(dev.error).toBe('queued elsewhere');
  const plan = planStateFromResult({ status: 'repoint-requires-confirm', initiativeId: ID, detail: 'queued elsewhere' });
  expect(plan.status).toBe('error');
  expect(plan.error).toBe('queued elsewhere');
});

test('every OTHER refusal is still an error, with its detail preserved — the new branch must not swallow them', () => {
  expect(developStateFromResult({ ok: false, status: 'already-done', detail: 'already shipped' }, undefined))
    .toEqual({ status: 'error', error: 'already shipped' });
  expect(developStateFromResult({ ok: false, status: 'not-planned' }, undefined))
    .toEqual({ status: 'error', error: 'not-planned' });
  expect(developStateFromResult(undefined, 'bridge unreachable'))
    .toEqual({ status: 'error', error: 'bridge unreachable' });
  expect(planStateFromResult({ status: 'already-running', initiativeId: ID, detail: 'a cycle is already in-flight' }))
    .toEqual({ status: 'error', error: 'a cycle is already in-flight' });
});

test('success is unchanged, and keeps the flowId the card links the run with', () => {
  expect(developStateFromResult({ ok: true, status: 'enqueued', flowId: 'forge-develop' }, undefined))
    .toEqual({ status: 'started', error: null, flowId: 'forge-develop' });
  expect(planStateFromResult({ status: 'enqueued', initiativeId: ID, flowId: 'forge-architect' }))
    .toEqual({ status: 'started', error: null, flowId: 'forge-architect' });
});
