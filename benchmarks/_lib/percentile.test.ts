import { test } from 'node:test';
import assert from 'node:assert/strict';

import { p95, percentile } from './percentile.ts';

test('p95: empty array returns 0', () => {
  assert.equal(p95([]), 0);
});

test('p95: single value returns that value', () => {
  assert.equal(p95([42]), 42);
});

test('p95: of 1..100 is 95.05 with linear interpolation', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  // rank = 0.95 * 99 = 94.05; sorted[94]=95, sorted[95]=96 → 95.05
  assert.ok(Math.abs(p95(values) - 95.05) < 1e-9);
});

test('percentile: 50th percentile of 1..5 is 3', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
});
