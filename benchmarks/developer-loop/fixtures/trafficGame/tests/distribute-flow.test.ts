/**
 * Acceptance tests for WI-1 (multi-file routing engine). Currently fails — the
 * pieces don't exist. Each test corresponds to one acceptance criterion in
 * `.forge/work-items/WI-1.md`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributeFlow } from '../src/flow.ts';
import type { Intersection } from '../src/intersections.ts';
import { defaultCalibrator, type Calibrator } from '../src/calibration.ts';

const TWO_EDGES_EQUAL: Intersection = {
  id: 'I1',
  edgesOut: [
    { id: 'E1', fromIntersectionId: 'I1', toIntersectionId: 'I2', capacity: 10, priority: 0 },
    { id: 'E2', fromIntersectionId: 'I1', toIntersectionId: 'I3', capacity: 10, priority: 0 },
  ],
};

const TWO_EDGES_SKEWED: Intersection = {
  id: 'I1',
  edgesOut: [
    { id: 'E1', fromIntersectionId: 'I1', toIntersectionId: 'I2', capacity: 1, priority: 0 },
    { id: 'E2', fromIntersectionId: 'I1', toIntersectionId: 'I3', capacity: 9, priority: 0 },
  ],
};

const THREE_EDGES_TIGHT: Intersection = {
  id: 'I1',
  edgesOut: [
    { id: 'E1', fromIntersectionId: 'I1', toIntersectionId: 'I2', capacity: 1, priority: 0 },
    { id: 'E2', fromIntersectionId: 'I1', toIntersectionId: 'I3', capacity: 5, priority: 0 },
    { id: 'E3', fromIntersectionId: 'I1', toIntersectionId: 'I4', capacity: 4, priority: 0 },
  ],
};

const PRIORITY_TIES: Intersection = {
  id: 'I1',
  edgesOut: [
    { id: 'E_low_prio', fromIntersectionId: 'I1', toIntersectionId: 'I2', capacity: 5, priority: 5 },
    { id: 'E_high_prio', fromIntersectionId: 'I1', toIntersectionId: 'I3', capacity: 5, priority: 1 },
  ],
};

test('AC1: sum of distributed loads equals min(incomingLoad, totalCapacity)', () => {
  const out = distributeFlow(TWO_EDGES_EQUAL, 12);
  const sum = out.reduce((acc, e) => acc + e.load, 0);
  assert.ok(Math.abs(sum - 12) < 1e-9, `sum was ${sum}, expected 12`);

  const overflow = distributeFlow(TWO_EDGES_EQUAL, 100);
  const sumOver = overflow.reduce((acc, e) => acc + e.load, 0);
  assert.ok(Math.abs(sumOver - 20) < 1e-9, `sum was ${sumOver}, expected 20 (total capacity)`);
});

test('AC2: no edge exceeds its capacity', () => {
  const out = distributeFlow(TWO_EDGES_SKEWED, 100);
  for (const e of out) {
    const cap = TWO_EDGES_SKEWED.edgesOut.find((x) => x.id === e.edgeId)!.capacity;
    assert.ok(e.load <= cap + 1e-9, `${e.edgeId} load ${e.load} exceeds capacity ${cap}`);
  }
});

test('AC3: equal capacities + equal priority → equal distribution', () => {
  const out = distributeFlow(TWO_EDGES_EQUAL, 6);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0]!.load - 3) < 1e-9);
  assert.ok(Math.abs(out[1]!.load - 3) < 1e-9);
});

test('AC4: skewed capacities + equal priority → distribution preserves capacity ratio', () => {
  const out = distributeFlow(TWO_EDGES_SKEWED, 5);
  const e1 = out.find((e) => e.edgeId === 'E1')!.load;
  const e2 = out.find((e) => e.edgeId === 'E2')!.load;
  assert.ok(Math.abs(e1 - 0.5) < 1e-9, `E1 got ${e1}, expected 0.5`);
  assert.ok(Math.abs(e2 - 4.5) < 1e-9, `E2 got ${e2}, expected 4.5`);
});

test('AC5: when proportional split would saturate edges, every edge caps at its capacity', () => {
  const tight = distributeFlow(THREE_EDGES_TIGHT, 12);
  const sum = tight.reduce((acc, e) => acc + e.load, 0);
  assert.ok(Math.abs(sum - 10) < 1e-9, `sum ${sum}, expected 10 (total capacity)`);
  for (const e of tight) {
    const cap = THREE_EDGES_TIGHT.edgesOut.find((x) => x.id === e.edgeId)!.capacity;
    assert.ok(Math.abs(e.load - cap) < 1e-9, `${e.edgeId} load ${e.load}, expected cap ${cap}`);
  }
});

test('AC6: empty intersection returns empty distribution', () => {
  const out = distributeFlow({ id: 'I0', edgesOut: [] }, 10);
  assert.deepEqual(out, []);
});

test('AC7: zero incoming load returns one zero-load entry per edge', () => {
  const out = distributeFlow(TWO_EDGES_EQUAL, 0);
  assert.equal(out.length, 2);
  for (const e of out) assert.equal(e.load, 0);
});

test('AC8: output is sorted by edgeId ascending (deterministic)', () => {
  const reversed: Intersection = {
    id: 'I1',
    edgesOut: [
      { id: 'Z1', fromIntersectionId: 'I1', toIntersectionId: 'I2', capacity: 5, priority: 0 },
      { id: 'A1', fromIntersectionId: 'I1', toIntersectionId: 'I3', capacity: 5, priority: 0 },
      { id: 'M1', fromIntersectionId: 'I1', toIntersectionId: 'I4', capacity: 5, priority: 0 },
    ],
  };
  const out = distributeFlow(reversed, 6);
  assert.deepEqual(out.map((e) => e.edgeId), ['A1', 'M1', 'Z1']);
});

test('AC9: priority tiebreak — incomingLoad fits in higher-priority edges first', () => {
  // Two edges, equal capacity 5 each, but priorities 1 (high) and 5 (low). incomingLoad=5.
  // Priority-aware routing fills high-priority first → high gets 5, low gets 0.
  const out = distributeFlow(PRIORITY_TIES, 5);
  const high = out.find((e) => e.edgeId === 'E_high_prio')!.load;
  const low = out.find((e) => e.edgeId === 'E_low_prio')!.load;
  assert.ok(Math.abs(high - 5) < 1e-9, `high-priority got ${high}, expected 5`);
  assert.ok(Math.abs(low - 0) < 1e-9, `low-priority got ${low}, expected 0`);
});

test('AC10: priority tiebreak — when high-priority edge saturates, remainder flows to lower priorities', () => {
  const out = distributeFlow(PRIORITY_TIES, 8);
  const high = out.find((e) => e.edgeId === 'E_high_prio')!.load;
  const low = out.find((e) => e.edgeId === 'E_low_prio')!.load;
  assert.ok(Math.abs(high - 5) < 1e-9, `high got ${high}, expected 5`);
  assert.ok(Math.abs(low - 3) < 1e-9, `low got ${low}, expected 3`);
});

test('AC11: calibrator scales each edge\'s effective capacity', () => {
  // Calibrator returns 0.5 for E1, 1.0 for E2. Effective caps = 0.5 / 9.
  const halfCalibrator: Calibrator = {
    factor(edgeId: string): number {
      return edgeId === 'E1' ? 0.5 : 1.0;
    },
  };
  // Total effective cap = 9.5; incoming exactly equals it → both edges saturated.
  const out = distributeFlow(TWO_EDGES_SKEWED, 9.5, halfCalibrator);
  const e1 = out.find((e) => e.edgeId === 'E1')!.load;
  const e2 = out.find((e) => e.edgeId === 'E2')!.load;
  assert.ok(Math.abs(e1 - 0.5) < 1e-9, `E1 with 0.5 calibration got ${e1}, expected 0.5`);
  assert.ok(Math.abs(e2 - 9) < 1e-9, `E2 got ${e2}, expected 9`);
});

test('AC12: defaultCalibrator returns 1.0 for any edge (and is used implicitly)', () => {
  assert.equal(defaultCalibrator.factor('any'), 1.0);
  assert.equal(defaultCalibrator.factor('E1'), 1.0);

  // Calling distributeFlow without a calibrator should give the same result as passing defaultCalibrator.
  const implicit = distributeFlow(TWO_EDGES_SKEWED, 5);
  const explicit = distributeFlow(TWO_EDGES_SKEWED, 5, defaultCalibrator);
  assert.deepEqual(implicit, explicit);
});

test('AC13: input intersection is not mutated', () => {
  const input: Intersection = {
    id: 'I1',
    edgesOut: [
      { id: 'E1', fromIntersectionId: 'I1', toIntersectionId: 'I2', capacity: 5, priority: 2 },
    ],
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  distributeFlow(input, 3);
  assert.deepEqual(input, snapshot);
});
