/**
 * `review-budget` — the derived review ceiling (beads `forge-gefz` /
 * `forge-jb7i`, operator rulings 475 + 526).
 *
 * These pin the claims the change is FOR, not the arithmetic for its own sake:
 * that the measured failure now fits under the ceiling, that nothing becomes
 * unbounded, and that ONE ceiling serves the whole initiative so ruling 290's
 * byte-identical option bags survive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  reviewCeilingUsd,
  changedLinesFromNumstat,
  OVERSHOOT_ALLOWANCE,
  CEILING_SCALE_LINES,
} from '../../phases/review-budget.ts';

test('changedLinesFromNumstat sums added + deleted across every file', () => {
  assert.equal(changedLinesFromNumstat('10\t5\tsrc/a.ts\n3\t2\tsrc/b.ts'), 20);
});

test('a binary row contributes 0 rather than throwing', () => {
  // `git diff --numstat` writes `-\t-\t<path>` for a binary blob. A blob is not
  // review work an agent reads, and a NaN here would poison the whole ceiling.
  assert.equal(changedLinesFromNumstat('-\t-\tlogo.png\n7\t3\tsrc/a.ts'), 10);
});

test('an empty numstat is zero lines, not a crash', () => {
  assert.equal(changedLinesFromNumstat(''), 0);
});

test('the floor admits the overshoot the SDK has been measured to take', () => {
  // jb7i measured 36% over a declared 2.0. The smallest ceiling this can ever
  // produce must already cover that, or the bound fails on the very case that
  // produced it.
  const floor = reviewCeilingUsd(2, 0, 8);
  assert.ok(floor !== undefined && floor >= 2 * 1.36, `floor ${floor} must cover the measured 36% overshoot`);
  assert.equal(floor, 2 * (1 + OVERSHOOT_ALLOWANCE));
});

test('THE MEASURED FAILURE NOW FITS: the file that cost $2.7056 against a declared $2.00', () => {
  // G2 resume 4, `scripts/gates/gap-registry-wi3.sh`. gefz is exactly this: a
  // work item can be cut to its files, and a file cannot be cut, so the ceiling
  // had to move or that review could never happen. Under ruling 526 the figure
  // comes from the INITIATIVE the file belongs to, not the file alone.
  const ceiling = reviewCeilingUsd(2, 1600, 8);
  assert.ok(ceiling !== undefined && ceiling > 2.7056, `ceiling ${ceiling} must exceed the measured $2.7056`);
});

test('the class wall is a WALL — a huge initiative cannot push past it', () => {
  // Without this, "derive it from the diff" is just "unbounded", which ruling
  // 290 forbids in its other costume ("raise the budget").
  assert.equal(reviewCeilingUsd(2, 100_000, 8), 8);
  assert.equal(reviewCeilingUsd(2, 100_000, 4), 4);
});

test('the ceiling scales with the change size between floor and wall', () => {
  const small = reviewCeilingUsd(2, 0, 8)!;
  const mid = reviewCeilingUsd(2, CEILING_SCALE_LINES, 8)!;
  assert.ok(mid > small, 'a larger initiative must earn a larger ceiling');
  assert.equal(mid, small * 2, 'one scale-length doubles the floor');
});

test('ONE initiative size yields ONE figure — every chunk is handed the same number', () => {
  // Ruling 526, and the reason this is not derived per chunk: ruling 290 pins
  // that every chunk's spawn carries a byte-identical option bag, and a
  // per-chunk budget breaks that by construction.
  const a = reviewCeilingUsd(2, 900, 8);
  const b = reviewCeilingUsd(2, 900, 8);
  assert.equal(a, b);
});

test('no declared flat budget means NO invented number', () => {
  // `resolveOneShotBudgetUsd`'s share-based resolution still stands; this
  // module refuses to fabricate a ceiling it was given no floor for.
  assert.equal(reviewCeilingUsd(undefined, 500, 8), undefined);
});
