/**
 * W8-B3 (bead forge-6gv.7.1) — the Approve gate.
 *
 * The defect these kill is sessions-kinds-R01, reproduced live in the wave-7
 * re-gate: typing "Bad Id!" into an authoring session's "Skill id" field dimmed
 * Approve to 50% opacity while leaving `button.disabled === false`, no
 * `data-disabled-reason`, and pointer-events auto — so the operator clicked it
 * and bounced off a 400. Two independent derivations of "is Approve usable",
 * and only the one driving `style.opacity` knew about the bad slug.
 *
 * The component test file beside this one renders through
 * `renderToStaticMarkup`, where `useState` never runs, so the typed-id case is
 * structurally unreachable there. That is exactly why the derivation is a pure
 * module: the case that shipped broken is now the one that is easiest to pin.
 *
 * RUN: npx vitest run lib/session-verdict-gate.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';

import { deriveApproveGate } from './session-verdict-gate';

const OK_ID = 'pr-diff-summary';

test('R01: a bad slug DISABLES Approve — it does not merely dim it (one value drives disabled, data-disabled-reason and opacity alike)', () => {
  for (const bad of ['Bad Id!', '9leading', 'UPPER', 'trailing-', 'double--hyphen', 'has space']) {
    const gate = deriveApproveGate({ requires: ['id'], idValue: bad, packageShape: 'skill', busy: false });
    expect(gate.disabledReason, bad).not.toBeNull();
    expect(gate.disabledReason, bad).toContain(bad);
    expect(gate.hint, bad).toMatch(/not a valid id/);
  }
});

test('R01: a VALID slug enables Approve — the guard must not have been widened into "refuse everything"', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: OK_ID, packageShape: 'skill', busy: false });
  expect(gate.disabledReason).toBeNull();
  expect(gate.hint).toBeNull();
  expect(gate.providedFields).toEqual({ id: OK_ID });
});

test('R01: surrounding whitespace is trimmed once, by the gate, and the SAME trimmed value is what gets submitted', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: `  ${OK_ID}  `, packageShape: 'skill', busy: false });
  expect(gate.disabledReason).toBeNull();
  expect(gate.providedFields).toEqual({ id: OK_ID });
});

test('R01: an EMPTY required field disables Approve with the unmet-field reason, not the slug reason', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: '', packageShape: 'skill', busy: false });
  expect(gate.disabledReason).toBe('Fill in "id" first');
  expect(gate.hint).toMatch(/Enter a skill id/);
});

test('R01: busy outranks everything — a submit in flight cannot be double-fired by a valid id', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: OK_ID, packageShape: 'skill', busy: true });
  expect(gate.disabledReason).toBe('Submitting…');
});

// ---------------------------------------------------------------------------
// sessions-kinds-06 — the shape gate, scoped to the verdicts that need it.
// ---------------------------------------------------------------------------

test('06: a verdict that requires an id IS blocked while the draft shape is unresolved (the advisory still does its job)', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: OK_ID, packageShape: 'unknown', busy: false });
  expect(gate.shapeBlocksApprove).toBe(true);
  expect(gate.disabledReason).toMatch(/shape is still resolving/);
});

test('06: a verdict that requires NOTHING is never blocked by a draft shape it does not depend on — and asks for no id field', () => {
  // Historical motivating case (W8-B5b WI-3 retired the kind itself): the
  // community-refresh shape's awaiting-review row declared no `requires:` at
  // all, and its staging package was registry.yaml + evidence.* BY DESIGN, so
  // `packageShape` was 'unknown' forever. Keyed off the artifact kind
  // (file-package, deliberately REUSED), this rendered a "Skill id" field the
  // kind never asked for and disabled Approve permanently, with no matching
  // server-side rule. The general shape below (requires: [] with an unknown
  // packageShape) stays a live regression pin for whatever kind reuses
  // file-package the same way next.
  const gate = deriveApproveGate({ requires: [], idValue: '', packageShape: 'unknown', busy: false });
  expect(gate.idRequired).toBe(false);
  expect(gate.shapeBlocksApprove).toBe(false);
  expect(gate.disabledReason).toBeNull();
  expect(gate.providedFields).toEqual({});
});

test('06: a kind with no file-package artifact at all and no requires is clickable', () => {
  const gate = deriveApproveGate({ requires: [], idValue: '', packageShape: null, busy: false });
  expect(gate.disabledReason).toBeNull();
});

test('a requires field this panel has no UI to collect never silently satisfies — it honestly disables Approve', () => {
  const gate = deriveApproveGate({ requires: ['id', 'unsupported-field'], idValue: OK_ID, packageShape: 'skill', busy: false });
  // The button's own reason NAMES the field the panel has no input for, so a
  // requires list this panel cannot satisfy is legible rather than a dead
  // control with a generic excuse.
  expect(gate.disabledReason).toBe('Fill in "unsupported-field" first');
  expect(gate.hint).toMatch(/"unsupported-field"/);
  // …and it is not smuggled into the submit body as an empty string either.
  expect(gate.providedFields).toEqual({ id: OK_ID });
});

// ---------------------------------------------------------------------------
// W8-B4 FIX-1 — `DraftShape` (this module) must accept 'template', the
// third drafted-package shape (cli/bridge-studio-affordances.ts's
// AUTHORING_PACKAGE_SHAPES). Pre-fix, `DraftShape` was `'skill' | 'hook' |
// 'unknown' | null` — passing 'template' here is a TYPE ERROR (proven via
// `npx tsc --noEmit`, not this runtime assertion: esbuild/vitest strips
// types and does not enforce them, so the BOOLEAN logic below — keyed only
// on `=== 'unknown'`, never an allowlist of known-good shapes — already
// behaved correctly at runtime even before the type was widened; the type
// was the one place still lying about what this function actually accepts).
// ---------------------------------------------------------------------------

test('W8-B4 FIX-1: a template draft does not block Approve on the shape advisory', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: OK_ID, packageShape: 'template', busy: false });
  expect(gate.shapeBlocksApprove).toBe(false);
  expect(gate.disabledReason).toBeNull();
  expect(gate.hint).toBeNull();
});

test('W8-B4 FIX-1: a genuinely unknown shape still blocks Approve even after "template" is a recognised shape', () => {
  const gate = deriveApproveGate({ requires: ['id'], idValue: OK_ID, packageShape: 'unknown', busy: false });
  expect(gate.shapeBlocksApprove).toBe(true);
  expect(gate.disabledReason).toMatch(/shape is still resolving/);
});
