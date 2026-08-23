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

test('W7-C3 review: a BLANK tier is unrecorded too — never a blank chip', () => {
  // `?? 'not recorded'` does not catch '', so a status.json with a blank
  // tier rendered "model: " with nothing after it — worse than either honest
  // answer. Whitespace is the same non-answer.
  for (const blank of ['', '   ', '\t', undefined]) {
    expect(modelChipLabel(blank), `${JSON.stringify(blank)} must read as unrecorded`).toBe('not recorded');
  }
});

test('the shared ProvenanceStrip renders the chip through modelChipLabel (source pin)', () => {
  // W8-B3 (sessions-kinds-R02): the strip was extracted out of
  // SessionInteractivePanel into its own component so SessionProjectBrainPanel
  // — the one kind that had no provenance strip at all — renders the SAME one
  // rather than a second copy. This pin follows it, and is now STRONGER: there
  // is exactly one file that could regress instead of one per panel.
  const src = readFileSync(resolve(__dirname, '../components/studio/session/ProvenanceStrip.tsx'), 'utf8');
  expect(src).toMatch(/modelChipLabel/);
  expect(src).not.toMatch(/modelTier \?\? 'default'/);
});
