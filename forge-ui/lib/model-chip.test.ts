/**
 * W7-C3 (sessions-kinds-31) — the provenance model chip never fabricates.
 *
 * `ProvenanceStrip` rendered `model: {modelTier ?? 'default'}` — "default"
 * is not a tier the picker offers and does not say what ran; on a
 * cost-review pass an opus session was indistinguishable from a haiku one.
 * `modelChipLabel` is the one rule: a recorded tier renders verbatim, an
 * unrecorded (legacy) session says so honestly.
 *
 * RUN: cd forge-ui && npx vitest run lib/model-chip.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modelChipLabel } from './model-chip';

test('a recorded tier renders verbatim', () => {
  expect(modelChipLabel('sonnet')).toBe('sonnet');
  expect(modelChipLabel('opus')).toBe('opus');
});

test('a session with no recorded tier says "not recorded" — never "default"', () => {
  expect(modelChipLabel(null)).toBe('not recorded');
  expect(modelChipLabel(null)).not.toMatch(/default/);
});

test('SessionInteractivePanel renders the chip through modelChipLabel (source pin)', () => {
  const src = readFileSync(resolve(__dirname, '../components/studio/session/SessionInteractivePanel.tsx'), 'utf8');
  expect(src).toMatch(/modelChipLabel/);
  expect(src).not.toMatch(/modelTier \?\? 'default'/);
});
