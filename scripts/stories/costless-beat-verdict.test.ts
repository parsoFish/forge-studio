/**
 * costless-beat-verdict.test.ts — findings row 61, the enforcement half.
 *
 * A beat declaring `costless: true` asserts it dispatches nothing at all.
 * `costlessBeatVerdict` (`spend.mjs`) is the pure comparison the runner makes
 * at that beat's own boundary — a measured spend reading taken immediately
 * before the beat ran and immediately after, the same "two readings, never
 * the declaration" shape `spendCeilingVerdict` already uses for the
 * story-level ceiling. `null` on either side is UNMEASURED: nothing to say
 * moved, so this beat is never reddened on an absence (§15.504) — it is
 * `spendCeilingVerdict`'s own `known: false` shape read for a single beat
 * instead of the whole run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costlessBeatVerdict } from './spend.mjs';

test('spend unchanged across a costless beat is OK', () => {
  const v = costlessBeatVerdict(1.2500, 1.2500);
  assert.equal(v.ok, true);
  assert.equal(v.reason, null);
});

test('spend that MOVES across a declared-costless beat is RED, naming the amount', () => {
  const v = costlessBeatVerdict(1.2500, 1.7500);
  assert.equal(v.ok, false);
  assert.match(v.reason, /declared costless, spent \$0\.5000/);
});

test('spend that somehow DECREASED (a later run\'s ledger correction) is not a costless violation', () => {
  // Not a shape this harness expects to see, but the rule is "did it grow",
  // never "did it change" — a beat cannot be blamed for money it did not add.
  const v = costlessBeatVerdict(2.0000, 1.5000);
  assert.equal(v.ok, true);
});

test('UNMEASURED on either side never resolves toward RED — nothing to say moved', () => {
  assert.equal(costlessBeatVerdict(null, 1.5).ok, true);
  assert.equal(costlessBeatVerdict(1.5, null).ok, true);
  assert.equal(costlessBeatVerdict(null, null).ok, true);
});
