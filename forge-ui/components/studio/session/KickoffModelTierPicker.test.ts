/**
 * DOM regression tests for `KickoffModelTierPicker.tsx` (W6-B6 fix —
 * wave-6 final gate, journey demo-builder DB-4).
 *
 * Mirrors `SessionInteractivePanel.test.ts`'s own pattern: renders the REAL
 * component via `react-dom/server`'s `renderToStaticMarkup` and asserts on
 * the resulting markup string.
 *
 * This file pins the regression directly: BEFORE the fix, the kickoff page
 * derived its picker from the FILTERED `/api/studio/agents` roster, which
 * excludes every `library:false` agent (demo-builder and its four
 * siblings) — so `capability` was always `null` for those five kinds and
 * the picker always rendered the fixed chip, never the range radio group,
 * even for a real `strategy:range` SKILL.md. These tests drive the picker
 * purely off the `capability` PROP (the UNFILTERED per-slug descriptor
 * `fetchAgentCapability` now supplies), independent of that fetch plumbing.
 *
 * RUN: npx vitest run components/studio/session/KickoffModelTierPicker.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KickoffModelTierPicker, allowedTiersFromCapability } from './KickoffModelTierPicker';
import type { AgentCapability } from '@/lib/studio-client';

function render(props: { capability: AgentCapability | null; modelTier?: string }): string {
  return renderToStaticMarkup(
    React.createElement(KickoffModelTierPicker, {
      modelTier: '',
      onChange: () => {},
      ...props,
    }),
  );
}

function rangeCapability(): AgentCapability {
  // Mirrors demo-builder's real, post-B5 shape: strategy:range, library:false
  // — the exact agent the DB-4 journey beat exercises.
  return {
    interactive: true,
    runtimeSdks: ['claude'],
    fanoutCapable: false,
    materials: [],
    costCeilingEnforceable: false,
    allowedTiers: ['sonnet', 'opus'],
  };
}

function fixedCapability(): AgentCapability {
  return {
    interactive: false,
    runtimeSdks: ['claude'],
    fanoutCapable: false,
    materials: [],
    costCeilingEnforceable: false,
  };
}

// ---------------------------------------------------------------------------
// Range state — the DEFECT this fix closes: a real strategy:range agent's
// capability must render a real radio group, not the fixed chip.
// ---------------------------------------------------------------------------

test('a strategy:range capability (mirrors demo-builder) renders a REAL radio group, not the fixed chip', () => {
  const html = render({ capability: rangeCapability() });
  expect(html).toContain('data-model-tier-picker="range"');
  expect(html).toContain('role="radiogroup"');
  expect(html).not.toContain('data-field="kickoff-model-fixed-chip"');
});

test('every allowed tier is offered as a real radio option, cheapest-first order preserved', () => {
  const html = render({ capability: rangeCapability() });
  const sonnetIdx = html.indexOf('value="sonnet"');
  const opusIdx = html.indexOf('value="opus"');
  expect(sonnetIdx).toBeGreaterThanOrEqual(0);
  expect(opusIdx).toBeGreaterThanOrEqual(0);
  expect(sonnetIdx).toBeLessThan(opusIdx);
  expect((html.match(/data-field="kickoff-model-tier-option"/g) ?? []).length).toBe(2);
});

test('the picked tier renders its radio as checked', () => {
  const html = render({ capability: rangeCapability(), modelTier: 'opus' });
  const opusLabelStart = html.indexOf('value="opus"');
  const opusInputTag = html.slice(Math.max(0, opusLabelStart - 80), opusLabelStart + 20);
  expect(opusInputTag).toContain('checked=""');
});

// ---------------------------------------------------------------------------
// Fixed / absent states — the read-only chip, honestly rendered
// ---------------------------------------------------------------------------

test('a strategy:fixed capability (no allowedTiers key) renders the read-only fixed chip, never a radio group', () => {
  const html = render({ capability: fixedCapability() });
  expect(html).toContain('data-model-tier-picker="fixed"');
  expect(html).toContain('data-field="kickoff-model-fixed-chip"');
  expect(html).not.toContain('role="radiogroup"');
});

test('capability: null (not yet loaded / unknown slug) renders the SAME honest fixed chip — never a fabricated range', () => {
  const html = render({ capability: null });
  expect(html).toContain('data-model-tier-picker="fixed"');
  expect(html).toContain('data-field="kickoff-model-fixed-chip"');
});

test('an allowedTiers array of length 0 (should never occur on the wire, but defensively) renders the fixed chip, not an empty radiogroup', () => {
  const html = render({ capability: { ...rangeCapability(), allowedTiers: [] } });
  expect(html).toContain('data-model-tier-picker="fixed"');
});

// ---------------------------------------------------------------------------
// allowedTiersFromCapability — the shared derivation the kickoff page reuses
// for its onSubmit tier-resolution logic (must stay in lockstep with the
// component's own isRangeTier condition, not a second, divergent copy).
// ---------------------------------------------------------------------------

test('allowedTiersFromCapability: a range capability returns its tiers verbatim', () => {
  expect(allowedTiersFromCapability(rangeCapability())).toEqual(['sonnet', 'opus']);
});

test('allowedTiersFromCapability: fixed / null / undefined all return []', () => {
  expect(allowedTiersFromCapability(fixedCapability())).toEqual([]);
  expect(allowedTiersFromCapability(null)).toEqual([]);
  expect(allowedTiersFromCapability(undefined)).toEqual([]);
});

// ---------------------------------------------------------------------------
// W8-B3 (sessions-kinds-R06) — a fixed-tier agent still HAS a tier; name it.
// This chip printed the literal string "fixed · read-only" for every
// fixed-strategy agent, which is why the three fixed-tier session kinds
// (architect, project-brain, onboarding) never named their model anywhere in
// the product — "fixed · read-only" at kickoff, "not recorded" on the session,
// "—" in the index.
// ---------------------------------------------------------------------------

test('R06: a fixed-strategy capability NAMES its tier in the read-only chip, and exposes it as a data attribute', () => {
  const html = render({
    capability: { interactive: true, runtimeSdks: ['claude-code'], fanoutCapable: false, materials: [], costCeilingEnforceable: true, fixedTier: 'opus' },
  });
  expect(html).toContain('data-model-tier-picker="fixed"');
  expect(html).toContain('data-model-tier="opus"');
  expect(html).toContain('opus');
  expect(html).not.toContain('fixed · read-only');
});

test('R06: a capability with no resolvable tier keeps the honest read-only chip — never an invented tier', () => {
  const html = render({
    capability: { interactive: true, runtimeSdks: ['claude-code'], fanoutCapable: false, materials: [], costCeilingEnforceable: true },
  });
  expect(html).toContain('fixed · read-only');
  expect(html).toContain('data-model-tier=""');
});

test('R06: a NOT-YET-LOADED capability keeps the read-only chip — the picker must not claim a tier it has not been told', () => {
  const html = render({ capability: null });
  expect(html).toContain('fixed · read-only');
});
