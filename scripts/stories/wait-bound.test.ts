/**
 * The DERIVED wait bound — `forge-8vfn.7.6.118`, T1 ruling 1089, §15.559.
 *
 * §15.559's sentence, and the reason this module exists: **S10 beat 8's window
 * funded 25% less than the cycle it was watching.** At run 17's measured burn
 * of $3.99 over 476 s, the declared 360000 ms afforded $3.02 against a cycle
 * that spent $3.99 and finished 116 s after the beat gave up. The literal was
 * chosen when no S10 run had ever completed a cycle, so it was derived from
 * nothing — and it was the third distinct beat-8 blocker in three runs.
 *
 * SO A BOUND IS DERIVED FROM WHAT THE STORY FUNDS, never picked. Under ruling
 * 1089(c) the bound is no longer what decides a healthy cycle — `waitForCon-
 * sequence` ends on the cycle's own terminal event — so this is the OUTER
 * BACKSTOP for a cycle that never terminates at all.
 *
 * THE CLAMP IS NEVER HIDDEN. `ground.budget_usd` $35 derives 69.6 minutes and
 * `MAX_DECLARED_WAIT_MS` is 30, so the cap binds and the story parser would
 * REFUSE the derived figure outright. A silent `Math.min` there would read as
 * protection and provide none — story-file.mjs:308 already legislates against
 * exactly that shape — so BOTH numbers travel in the label and the label names
 * which constraint bound it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveWaitBoundMs, MEASURED_CYCLE_USD, MEASURED_CYCLE_MS } from './wait-bound.mjs';
import { MAX_DECLARED_WAIT_MS } from './story-file.mjs';

test('7.6.118: the bound is DERIVED FROM `ground`, not a number', () => {
  // T1 1089's door, stated as the property rather than as an expected integer:
  // a different ground funds a different bound. An assertion on a literal would
  // pass just as well against a hard-coded constant, which is the whole defect.
  const lean = deriveWaitBoundMs({ project: 'gitpulse', realSpawn: true, budget_usd: 4 });
  const rich = deriveWaitBoundMs({ project: 'gitpulse', realSpawn: true, budget_usd: 8 });
  assert.equal(rich.derivedMs, lean.derivedMs * 2, 'twice the funded money buys twice the patience');
  assert.ok(lean.derivedMs > 0);
});

test('7.6.118: run 17\'s own ground — the cap binds, and the label says so', () => {
  const got = deriveWaitBoundMs({ project: 'gitpulse', realSpawn: true, budget_usd: 35 });
  assert.equal(got.ms, MAX_DECLARED_WAIT_MS, 'the declared bound is the one the parser will accept');
  assert.ok(got.derivedMs > MAX_DECLARED_WAIT_MS, `$35 must derive past the cap, got ${got.derivedMs}`);
  assert.equal(got.boundBy, 'MAX_DECLARED_WAIT_MS');
  // BOTH numbers in the printed line, and which one bound it.
  assert.match(got.label, /MAX_DECLARED_WAIT_MS/, got.label);
  assert.match(got.label, new RegExp(String(got.derivedMs)), `the derived figure is not hidden: ${got.label}`);
  assert.match(got.label, /ground\.budget_usd/, got.label);
  assert.match(got.label, /\$35/, got.label);
});

test('7.6.118: under the cap the GROUND binds, and the label says that instead', () => {
  // The other branch has to be reachable, or the "which constraint bound it"
  // half of the door is decorative — one literal dressed as two.
  const got = deriveWaitBoundMs({ project: 'gitpulse', realSpawn: true, budget_usd: 5 });
  assert.ok(got.ms < MAX_DECLARED_WAIT_MS, `$5 must derive under the cap, got ${got.ms}`);
  assert.equal(got.ms, got.derivedMs, 'nothing clamped it');
  assert.equal(got.boundBy, 'ground.budget_usd');
  assert.match(got.label, /ground\.budget_usd/, got.label);
  assert.doesNotMatch(got.label, /binding/, `no clamp to announce: ${got.label}`);
});

test('7.6.118: the declared bound is always an integer the parser accepts', () => {
  // `upTo` is validated as `Number.isInteger(..) && 1..MAX`. A derivation that
  // returns a float or overshoots produces a story that cannot be PARSED, which
  // fails far from here and reads as a story bug rather than a bound bug.
  for (const budget_usd of [0.5, 1, 3.99, 12, 35, 1000]) {
    const got = deriveWaitBoundMs({ project: 'g', realSpawn: true, budget_usd });
    assert.ok(Number.isInteger(got.ms), `$${budget_usd} -> ${got.ms}`);
    assert.ok(got.ms >= 1 && got.ms <= MAX_DECLARED_WAIT_MS, `$${budget_usd} -> ${got.ms}`);
  }
});

test('7.6.118: the burn rate is the MEASURED one, carried as its two measurements', () => {
  // Not a bare rate constant: the numerator and denominator are what run 17
  // actually observed, so the next run that measures a different burn amends a
  // measurement rather than tuning a magic number.
  assert.equal(MEASURED_CYCLE_USD, 3.99);
  assert.equal(MEASURED_CYCLE_MS, 476_000);
  // And the defect restated: the old literal afforded less than the cycle spent.
  const afforded = 360_000 * (MEASURED_CYCLE_USD / MEASURED_CYCLE_MS);
  assert.ok(afforded < MEASURED_CYCLE_USD, `360000 ms afforded $${afforded.toFixed(2)} against a cycle that spent $${MEASURED_CYCLE_USD}`);
});

test('7.6.118: a ground with no budget is REFUSED, never silently defaulted', () => {
  // §15.504 in the derivation: an absent input is not a zero one. A default here
  // would produce a confident bound from a ground that funded nothing.
  assert.throws(() => deriveWaitBoundMs({ project: 'g', realSpawn: true }), /budget_usd/);
  assert.throws(() => deriveWaitBoundMs(null), /ground/);
});
