/**
 * Tests for strategy:range model routing (M6-3, ADR-029).
 *
 * Uses the catalog fixture shape (CatalogModel array) rather than loading the
 * real catalog.yaml, so the tests are hermetic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rangeTiers } from '../../model-range.ts';
import type { Catalog } from '@forge/contracts/studio/types.ts';

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
  guards: [],
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
