/**
 * Tests for strategy:range model routing (M6-3, ADR-029).
 *
 * Uses the catalog fixture shape (CatalogModel array) rather than loading the
 * real catalog.yaml, so the tests are hermetic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rangeTiers, resolveRangeModel } from './model-range.ts';
import type { Catalog } from './studio/types.ts';

// ---------------------------------------------------------------------------
// Minimal catalog fixture (haiku < sonnet < opus by cost)
// ---------------------------------------------------------------------------

const CATALOG: Catalog = {
  sdks: [{ id: 'claude', name: 'Claude', available: true }],
  models: [
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku', sdk: 'claude', tier: 'haiku', costIn: 1, costOut: 5 },
    { id: 'claude-sonnet-4-6', name: 'Sonnet', sdk: 'claude', tier: 'sonnet', costIn: 3, costOut: 15 },
    { id: 'claude-opus-4-8', name: 'Opus', sdk: 'claude', tier: 'opus', costIn: 5, costOut: 25 },
  ],
  tools: [],
  mcps: [],
  hooks: [],
  path: '/fake/catalog.yaml',
};

// ---------------------------------------------------------------------------
// rangeTiers
// ---------------------------------------------------------------------------

test('rangeTiers: orders haiku < sonnet < opus by cost', () => {
  const tiers = rangeTiers(
    ['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
    CATALOG,
  );
  assert.deepEqual(tiers, ['haiku', 'sonnet', 'opus']);
});

test('rangeTiers: single-model range returns that model tier', () => {
  const tiers = rangeTiers(['claude-sonnet-4-6'], CATALOG);
  assert.deepEqual(tiers, ['sonnet']);
});

test('rangeTiers: [haiku, opus] → [haiku, opus] cheapest first', () => {
  const tiers = rangeTiers(['claude-opus-4-8', 'claude-haiku-4-5-20251001'], CATALOG);
  assert.deepEqual(tiers, ['haiku', 'opus']);
});

test('rangeTiers: throws on empty range', () => {
  assert.throws(() => rangeTiers([], CATALOG), /at least one model id/);
});

// ---------------------------------------------------------------------------
// resolveRangeModel
// ---------------------------------------------------------------------------

test('resolveRangeModel: escalationLevel 0 → cheapest (haiku) from [haiku, opus]', () => {
  const model = resolveRangeModel(
    ['claude-opus-4-8', 'claude-haiku-4-5-20251001'],
    CATALOG,
    0,
  );
  assert.equal(model, 'claude-haiku-4-5-20251001');
});

test('resolveRangeModel: escalationLevel 1 → opus from [haiku, opus]', () => {
  const model = resolveRangeModel(
    ['claude-haiku-4-5-20251001', 'claude-opus-4-8'],
    CATALOG,
    1,
  );
  assert.equal(model, 'claude-opus-4-8');
});

test('resolveRangeModel: escalationLevel clamped at end (level ≥ len-1 → priciest)', () => {
  // haiku+opus range; escalate to level 99 → clamped at opus
  const model = resolveRangeModel(
    ['claude-haiku-4-5-20251001', 'claude-opus-4-8'],
    CATALOG,
    99,
  );
  assert.equal(model, 'claude-opus-4-8');
});

test('resolveRangeModel: single-model range returns that model at any escalation level', () => {
  assert.equal(resolveRangeModel(['claude-sonnet-4-6'], CATALOG, 0), 'claude-sonnet-4-6');
  assert.equal(resolveRangeModel(['claude-sonnet-4-6'], CATALOG, 5), 'claude-sonnet-4-6');
});

test('resolveRangeModel: default escalationLevel is 0 (cheapest)', () => {
  const model = resolveRangeModel(
    ['claude-opus-4-8', 'claude-haiku-4-5-20251001'],
    CATALOG,
  );
  assert.equal(model, 'claude-haiku-4-5-20251001');
});

test('resolveRangeModel: throws on empty range', () => {
  assert.throws(() => resolveRangeModel([], CATALOG), /at least one model id/);
});

test('resolveRangeModel: full 3-tier range escalates through haiku→sonnet→opus', () => {
  const range = ['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
  assert.equal(resolveRangeModel(range, CATALOG, 0), 'claude-haiku-4-5-20251001');
  assert.equal(resolveRangeModel(range, CATALOG, 1), 'claude-sonnet-4-6');
  assert.equal(resolveRangeModel(range, CATALOG, 2), 'claude-opus-4-8');
  // Clamped at opus
  assert.equal(resolveRangeModel(range, CATALOG, 3), 'claude-opus-4-8');
});
