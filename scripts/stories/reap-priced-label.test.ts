/**
 * reap-priced-label.test.ts — findings row 62, THE LABEL.
 *
 * `waitForFirstPricedEvent` records WHY nothing was measured on the reap
 * report (`reaped[].terminatedBeforeFirstPricedEvent`, `reap-priced-wait.test.ts`),
 * but a run's spend column reads `summariseRunSpend`'s own generic UNMEASURED
 * label, which knows nothing about the reap — it is computed from event rows
 * alone. `withPricedTerminationLabel` is the seam that connects them: it
 * overrides the generic label with the specific reason ONLY when the spend is
 * genuinely UNMEASURED and the reap report says why, and passes every other
 * spend reading through untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPricedTerminationLabel } from './reap.mjs';

const UNMEASURED = Object.freeze({
  measured: false, usd: null, priced: 0,
  label: 'UNMEASURED — this run dispatched a real agent and no priced event reached its log.',
});
const MEASURED = Object.freeze({ measured: true, usd: 1.5, label: '$1.5000', priced: 1 });

test('a spend that is genuinely UNMEASURED and a reap report naming why gets the SPECIFIC label', () => {
  const reap = { reaped: [{ pid: 7, dir: '/r/_logs/_a', signal: 'SIGTERM', via: 'record', terminatedBeforeFirstPricedEvent: 30000 }] };
  const spend = withPricedTerminationLabel(reap, UNMEASURED);
  assert.equal(spend.label, 'UNMEASURED — terminated before first priced event (30000 ms)');
  assert.equal(spend.measured, false);
  assert.equal(spend.usd, null, 'usd stays null — this is still not a measurement');
});

test('a MEASURED spend is never touched, even if the reap report carries the marker', () => {
  // Not a shape that should occur together (a priced turn was not terminated
  // early), but the rule is "only override an UNMEASURED reading", stated as
  // a test rather than left to accident.
  const reap = { reaped: [{ pid: 7, dir: '/r', signal: 'SIGTERM', via: 'record', terminatedBeforeFirstPricedEvent: 30000 }] };
  const spend = withPricedTerminationLabel(reap, MEASURED);
  assert.equal(spend.label, MEASURED.label);
});

test('an UNMEASURED spend with no matching reap entry keeps the generic label', () => {
  const reap = { reaped: [{ pid: 7, dir: '/r', signal: 'SIGTERM', via: 'record' }] };
  const spend = withPricedTerminationLabel(reap, UNMEASURED);
  assert.equal(spend.label, UNMEASURED.label);
});

test('an empty or missing reap report is handled without throwing', () => {
  assert.equal(withPricedTerminationLabel({ reaped: [] }, UNMEASURED).label, UNMEASURED.label);
  assert.equal(withPricedTerminationLabel({}, UNMEASURED).label, UNMEASURED.label);
});
