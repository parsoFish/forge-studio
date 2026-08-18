/**
 * W7-A3 (flows-31) — pinned contract for `run-rail-collapse.ts`: the run
 * rail's group-collapse state is persisted per flow (next to the already
 * persisted run selection) and COMPLETE defaults collapsed above a threshold.
 */
import { test, expect } from 'vitest';

import { RUN_RAIL_COLLAPSE_THRESHOLD, initialCollapsed, serializeCollapsed, railStorageKey } from './run-rail-collapse.ts';

test('storage key is per flow and distinct from the run-selection key', () => {
  expect(railStorageKey('forge-develop')).toBe('forge-run-groups:forge-develop');
  expect(railStorageKey('forge-develop')).not.toBe('forge-run-sel:forge-develop');
});

test('a stored map wins verbatim (the operator\'s choice sticks across reloads)', () => {
  const c = initialCollapsed(JSON.stringify({ complete: false, failed: true }), { complete: 59, failed: 3 });
  expect(c).toEqual({ complete: false, failed: true });
});

test('nothing stored → COMPLETE collapsed only above the threshold; other groups open', () => {
  expect(RUN_RAIL_COLLAPSE_THRESHOLD).toBe(10);
  expect(initialCollapsed(null, { complete: 59 })).toEqual({ complete: true });
  expect(initialCollapsed(null, { complete: 10 })).toEqual({});
  expect(initialCollapsed(null, { complete: 3, failed: 40 })).toEqual({});
});

test('malformed storage is ignored (fail safe → the default rule)', () => {
  expect(initialCollapsed('{not json', { complete: 20 })).toEqual({ complete: true });
  expect(initialCollapsed(JSON.stringify(['array']), { complete: 20 })).toEqual({ complete: true });
  expect(initialCollapsed(JSON.stringify({ complete: 'yes' }), { complete: 20 })).toEqual({ complete: true });
});

test('serialize round-trips through initialCollapsed', () => {
  const s = serializeCollapsed({ planned: true });
  expect(initialCollapsed(s, { complete: 100 })).toEqual({ planned: true });
});
