/**
 * Spec §5 item 1's `iter0FailFirst` column, and the rule that consumes it.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per test. Before this,
 * the dev loop derived the guard from the WORK ITEM alone
 * (`!wi.behavior_preserving`) and the class column was ratified data nothing
 * read — the campaign's recurring shape, and the same one item 9 found in
 * `requiredPathsSource`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHANGE_CLASSES, CLASS_PROFILES, hollowGateGuardFor } from '../class-profiles.ts';

test('kills "the class column is decorative": an `off` class disables the guard even for a work item that is NOT behaviour-preserving', () => {
  assert.equal(hollowGateGuardFor('off', false), false);
  assert.equal(hollowGateGuardFor('off', undefined), false);
});

test('kills "the class overrides the work item": a `required` class still honours a behaviour-preserving marker', () => {
  assert.equal(hollowGateGuardFor('required', true), false, 'a rename has no failing test to write first');
  assert.equal(hollowGateGuardFor('required', false), true);
  assert.equal(hollowGateGuardFor('required', undefined), true, 'absent marker = normal discipline');
});

test('the real table drives it: `code` and `infra` guard, `docs` and `config` do not', () => {
  assert.equal(hollowGateGuardFor(CLASS_PROFILES.code.iter0FailFirst, undefined), true);
  assert.equal(hollowGateGuardFor(CLASS_PROFILES.infra.iter0FailFirst, undefined), true, 'narrowed to `required` under ruling 292 — the safe direction');
  assert.equal(hollowGateGuardFor(CLASS_PROFILES.docs.iter0FailFirst, undefined), false);
  assert.equal(hollowGateGuardFor(CLASS_PROFILES.config.iter0FailFirst, undefined), false);
});

test('every class\'s value is one the rule actually acts on — no third value survives that behaves like a second', () => {
  const seen = new Set(CHANGE_CLASSES.map((c) => CLASS_PROFILES[c].iter0FailFirst));
  assert.deepEqual([...seen].sort(), ['off', 'required'], 'the union is exactly the two values with honest consumers');
});
