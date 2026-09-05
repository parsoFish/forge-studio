/**
 * Acceptance test for shc's review FINDING 1 (BLOCKER,
 * silent-default-as-operator-intent) against `RoadmapView`'s "Start
 * development" ceiling lever (forge-ui/app/projects/[id]/page.tsx).
 *
 * THE DEFECT: `defaultCeilingUsd` seeds from the run-level
 * `resolveDefaultKickoffCeilingUsd` (orchestrator/config.ts, effectively 10 —
 * never 0/undefined), fetched in a `useEffect` the instant the roadmap tab
 * mounts — before the operator has looked at, let alone touched, the ceiling
 * field. The pre-fix `startOne` computed `ceilingToSend` straight off the
 * DISPLAYED field value with no opt-in gate, so opening the tab and clicking
 * "Start development" on a card ALWAYS sent `costCeilingUsd`, silently
 * stamping the generic per-run default (10) onto a manifest whose own
 * `cost_budget_usd`-derived ceiling (`readManifestCostCeiling`'s budget x
 * (1 + `DERIVED_CEILING_MARGIN_SHARE`)) could be dramatically higher (e.g. a
 * 100-budget initiative's 150 derived ceiling silently clamped to 10) —
 * worse than the zero-writer state this WI set out to close.
 *
 * THE FIX: `resolveDevelopStartCeilingToSend(fieldValue, ceilingTouched)`
 * gates on a REAL operator opt-in boolean — mirrors RunPanel's
 * `costCeilingEnforceable`-gated `resolveCostCeilingForDispatch`
 * (./run-panel-view.ts): the boolean is checked FIRST, then the usual
 * finite/positive shape check. `ceilingTouched` is set `true` by the input's
 * own `onChange` (ANY edit, including blanking) and never reset — NOT
 * derived from `manualCeilingUsd !== undefined`, since blanking the field
 * sets `manualCeilingUsd` back to `undefined`, which would silently re-arm
 * "untouched" the moment the operator clears it.
 *
 * This file imports the REAL exported function straight off `page.tsx`
 * (rather than re-implementing the formula here) so a regression in the
 * shipped gate — not just this test's own copy of it — is what goes red.
 * `page.tsx` compiles standalone under vitest (confirmed: 'use client' +
 * `next/navigation` imports are inert until the page component itself is
 * rendered, which this file never does) via the same `oxc.jsx`/`resolve.alias`
 * config `run-panel-render.test.ts` already established.
 *
 * RUN: npx vitest run lib/roadmap-develop-start-ceiling.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';

import { resolveDevelopStartCeilingToSend } from './roadmap-develop-start-ceiling.ts';

// ---------------------------------------------------------------------------
// (1) RED pin — the headline defect: opening the tab (default seeded, never
// touched) must send NO ceiling at all, so the manifest's own derived
// budget+margin fallback stands. Pre-fix: the function doesn't even accept a
// `ceilingTouched` argument's worth of gating — it returns the seeded
// default unconditionally.
// ---------------------------------------------------------------------------

test('untouched field (tab just opened, default seeded) sends NO ceiling override, regardless of the seeded default value', () => {
  const SEEDED_DEFAULT = 10; // resolveDefaultKickoffCeilingUsd's real-world fallback
  const result = resolveDevelopStartCeilingToSend(SEEDED_DEFAULT, false);
  expect(result).toBeUndefined();
});

test('untouched field: even a LARGE seeded default must not leak through', () => {
  const result = resolveDevelopStartCeilingToSend(140, false);
  expect(result).toBeUndefined();
});

// ---------------------------------------------------------------------------
// (2) COMPANION — once the operator has explicitly touched the field, a
// valid positive value DOES send, exactly as the pre-fix code intended for
// an operator who actually engaged with the lever. This must stay green
// across the fix — the gate gains a check, it doesn't remove the existing
// finite/positive validity check.
// ---------------------------------------------------------------------------

test('touched field with a valid positive value sends exactly that value', () => {
  expect(resolveDevelopStartCeilingToSend(25, true)).toBe(25);
});

test('touched field with a non-positive/non-finite value still degrades to "no override" (never a fabricated fallback)', () => {
  expect(resolveDevelopStartCeilingToSend(0, true)).toBeUndefined();
  expect(resolveDevelopStartCeilingToSend(-5, true)).toBeUndefined();
  expect(resolveDevelopStartCeilingToSend(Number.NaN, true)).toBeUndefined();
  expect(resolveDevelopStartCeilingToSend(Number.POSITIVE_INFINITY, true)).toBeUndefined();
});
