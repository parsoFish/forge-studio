/**
 * Acceptance tests for WI-3 (R6-04)'s INTERACTION-dependent RunPanel logic —
 * the client-side materials gate mirror and the cost-ceiling dispatch
 * decision. These behaviours cannot be pinned by
 * `./run-panel-render.test.ts` (which renders RunPanel via
 * `renderToStaticMarkup` and can only observe the INITIAL markup — no
 * jsdom/`@testing-library/react` is installed in this repo, so a simulated
 * file-select or button click is out of reach here). Following this
 * codebase's established convention (agent-builder-view.ts,
 * connection-library-view.ts, session-shell-view.ts — pure logic extracted
 * from a component, unit-tested here, then thinly wired into JSX), this file
 * pins a NEW pure module, `./run-panel-view.ts`, that does not exist yet.
 * Every import below is therefore a legitimate RED (module not found) until
 * the implementer creates it with the exact exports this file names.
 *
 * ASSUMED EXPORTS from `./run-panel-view.ts` (mirrors the precedent set by
 * cli/ui-bridge-agent-run-ceiling.test.ts's header, which pins
 * `buildAgentDispatchArgs`/`parseAgentDispatchArgs` the same way):
 *
 *   export function validateMaterialsClientSide(
 *     entries: { filename: string; sizeBytes: number }[],
 *     declaredKinds: string[],
 *     slug: string,
 *   ): { ok: true } | { ok: false; error: string }
 *
 *   export function resolveCostCeilingForDispatch(
 *     inputValue: number,
 *     enforceable: boolean,
 *   ): number | undefined
 *
 *   export function resolveCeilingFieldValue(
 *     defaultCostCeilingUsd: number,
 *     manualOverride: number | undefined,
 *   ): number
 *
 * WHY these three, and not a single monolithic "buildDispatchOptions": each is
 * independently the exact decision point the task brief calls out —
 * (1) "refusing an undeclared kind client-side with the SAME MESSAGE SHAPE
 * the server uses" (mirrors cli/ui-bridge.ts's `materialsNoKindMessage` /
 * `materialsUndeclaredKindMessage` / the three cap messages — message text
 * pinned CHARACTER-FOR-CHARACTER below, matching that file's own "wording is
 * pinned character-for-character... do not reword" convention),
 * (2) "an operator never submits a ceiling that will be refused" — the
 * function signature itself makes "just always pass the raw input through"
 * impossible to satisfy without inspecting `enforceable`, hardened below to
 * also refuse a value the server's own bounds check would 400 on
 * (non-finite / NaN / <= 0), and
 * (3) THE REAL DEFECT a full-gate journey run found (round 2 of this WI's
 * acceptance tests): `RunPanel.tsx` seeded its cost-ceiling field with
 * `useState(defaultCostCeilingUsd)`. `defaultCostCeilingUsd` arrives
 * ASYNCHRONOUSLY (the parent page fetches it after mount and starts it at
 * `0`) — a `useState` initializer runs ONLY on first mount and never re-syncs
 * when the prop later changes, so the field stayed stuck at `0` forever, and
 * `resolveCostCeilingForDispatch(0, true)` (pre-hardening: `0` was treated as
 * a valid value) sent `costCeilingUsd: 0` to the wire, which the server
 * correctly 400s (`v <= 0`) — breaking dispatch outright for every one-shot
 * agent, `project-manager` included. `resolveCeilingFieldValue` pins the FIX
 * CONTRACT: the displayed value must be a function of the CURRENT
 * `defaultCostCeilingUsd` argument on every call (never a value captured
 * once), unless the operator has manually typed something — and once they
 * have, that edit must never be silently clobbered by a later-arriving
 * default. Fix (2)'s hardening and fix (3)'s anti-staleness contract are
 * BOTH required and neither substitutes for the other: (3) alone, without
 * (2), would still ship `0` to the wire in the remaining instant before the
 * real default arrives; (2) alone, without (3), makes the journey beat pass
 * by silently sending NO ceiling at all once `resolveCostCeilingForDispatch`
 * starts refusing `0` — which discards the operator's real ceiling
 * (assuming it's ever a real non-zero one) even AFTER `defaultCostCeilingUsd`
 * has arrived, a WORSE bug than the one this round started from (a silent
 * downgrade instead of a loud 400). Do not "simplify" (3) away because (2)
 * alone makes the beat green.
 *
 * RESIDUAL GAP (disclosed, not closed): `resolveCeilingFieldValue` pins the
 * DECISION function only. It cannot prove `RunPanel.tsx` actually stores its
 * local state as `manualOverride: number | undefined` (undefined until the
 * operator types) and recomputes the displayed/dispatched value from this
 * function on every render, instead of keeping the `useState(prop)` shape
 * that caused the defect. `renderToStaticMarkup` (run-panel-render.test.ts)
 * renders once per call with no persistent component instance across calls —
 * there is no React reconciler here (no jsdom/`@testing-library/react`), so
 * a "mount with prop A, then re-render the SAME instance with prop B"
 * scenario — the literal shape of this defect — is not expressible in this
 * suite. Only a real-browser journey beat (or jsdom + testing-library, a
 * new-dependency decision not this test-writer's to make) can close that
 * wiring gap; this file closes everything reachable without one.
 *
 * The numeric caps mirrored here (8 materials / 262144 bytes per file /
 * 524288 bytes total) are orchestrator/studio/materials.ts's
 * MAX_MATERIALS_COUNT / MAX_MATERIAL_BYTES / MAX_MATERIALS_TOTAL_BYTES,
 * duplicated as literals because forge-ui cannot import orchestrator/ TS
 * directly (the same constraint SHIPPED_TRIGGER_KINDS documents for itself
 * in forge-ui/lib/studio-client.ts) — a drift test at the bottom of this
 * file pins the literals against a comment-documented value so a future
 * server-side cap change is at least discoverable here, mirroring
 * materials.ts's OWN drift-test convention for MAX_MATERIALS_TOTAL_BYTES vs
 * MAX_BODY_BYTES.
 *
 * RUN: npx vitest run lib/run-panel-view.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';

import {
  validateMaterialsClientSide,
  resolveCostCeilingForDispatch,
  resolveCeilingFieldValue,
} from './run-panel-view';

// ---------------------------------------------------------------------------
// resolveCostCeilingForDispatch — "an operator never submits a ceiling that
// will be refused" (the WI-3 cost-ceiling pin).
// ---------------------------------------------------------------------------

test('resolveCostCeilingForDispatch: enforceable=true -> returns the input value (as a number)', () => {
  expect(resolveCostCeilingForDispatch(12.5, true)).toBe(12.5);
});

// Kills "always sends whatever is in the field, enforceable or not" — the
// exact defect the task brief calls out ("an operator never submits a
// ceiling that will be refused").
test('resolveCostCeilingForDispatch: enforceable=false -> returns undefined REGARDLESS of the input value — never silently submits a ceiling the server will 400', () => {
  expect(resolveCostCeilingForDispatch(12.5, false)).toBeUndefined();
  expect(resolveCostCeilingForDispatch(0, false)).toBeUndefined();
  expect(resolveCostCeilingForDispatch(500, false)).toBeUndefined();
});

test('resolveCostCeilingForDispatch: enforceable=true, a normal positive value -> the enforceability gate does not ALSO reject a perfectly valid value', () => {
  expect(resolveCostCeilingForDispatch(0.01, true)).toBe(0.01);
  expect(resolveCostCeilingForDispatch(500, true)).toBe(500);
});

// ---------------------------------------------------------------------------
// resolveCostCeilingForDispatch — VALIDITY HARDENING (round-2 defense in
// depth). AMENDS this file's earlier "value 0 -> still returns 0" pin, which
// is now WRONG: the server's own bounds check (cli/ui-bridge.ts,
// `v <= 0 || v > MAX_KICKOFF_COST_CEILING_USD`) refuses `0` — it was never a
// legitimate ceiling, only a truthiness-check red herring at the time that
// test was written. `0` is exactly the value the real defect (see this
// file's header) put on the wire, because the panel's `useState(prop)` field
// went stale at its initial value before the real default ever arrived.
// Kills "the client mirror only knows about enforceability, not validity" —
// the same pattern already established for materials (a convenience mirror
// of the server's rules, never the authority, but present so a bad value
// degrades to "nothing sent" instead of a round-tripped 400).
// ---------------------------------------------------------------------------

test('resolveCostCeilingForDispatch: enforceable=true, value 0 -> undefined (0 is <= 0, refused by the server\'s own bounds check)', () => {
  expect(resolveCostCeilingForDispatch(0, true)).toBeUndefined();
});

test('resolveCostCeilingForDispatch: enforceable=true, a negative value -> undefined', () => {
  expect(resolveCostCeilingForDispatch(-5, true)).toBeUndefined();
});

test('resolveCostCeilingForDispatch: enforceable=true, NaN -> undefined (never puts a NaN literal on the wire)', () => {
  expect(resolveCostCeilingForDispatch(NaN, true)).toBeUndefined();
});

test('resolveCostCeilingForDispatch: enforceable=true, Infinity/-Infinity -> undefined (non-finite, mirrors the server\'s Number.isFinite gate)', () => {
  expect(resolveCostCeilingForDispatch(Infinity, true)).toBeUndefined();
  expect(resolveCostCeilingForDispatch(-Infinity, true)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// resolveCeilingFieldValue — THE ACTUAL DEFECT (round 2). Pins the
// anti-staleness contract: the returned value is a function of the CURRENT
// `defaultCostCeilingUsd` argument on every call, never a value captured
// once — see this file's header for the full defect writeup and the
// disclosed residual (this pins the decision function, not the component's
// actual re-render wiring, which this harness cannot observe).
// ---------------------------------------------------------------------------

test('resolveCeilingFieldValue: no manual override -> returns defaultCostCeilingUsd verbatim', () => {
  expect(resolveCeilingFieldValue(0, undefined)).toBe(0);
  expect(resolveCeilingFieldValue(10, undefined)).toBe(10);
});

// THE key pin: kills `useState(defaultCostCeilingUsd)` (a value captured
// ONCE). Calling this pure function twice with two DIFFERENT
// defaultCostCeilingUsd arguments — mirroring "the async fetch resolved,
// defaultCostCeilingUsd changed from 0 to 10" — and the SAME "no manual
// override yet" state must reflect EACH call's OWN current argument, not a
// value memoized from the first call. A `useState`-shaped implementation
// wrapped in a same-named function could only get this right by accident;
// this is what actually distinguishes "recomputed fresh" from "captured
// once and stale".
test('resolveCeilingFieldValue: reflects a LATER-arriving default, not a value frozen from an earlier call — kills "captured once at mount" (useState(prop))', () => {
  const beforeFetchResolves = resolveCeilingFieldValue(0, undefined);
  const afterFetchResolves = resolveCeilingFieldValue(10, undefined);
  expect(beforeFetchResolves).toBe(0);
  expect(afterFetchResolves).toBe(10);
  expect(afterFetchResolves).not.toBe(beforeFetchResolves);
});

test('resolveCeilingFieldValue: a manual override wins over the default, even when the default is later than the override', () => {
  expect(resolveCeilingFieldValue(10, 25)).toBe(25);
});

// The other half of "never discards the operator's ceiling" (this WI's
// standing concern, also load-bearing for the fix-2-alone failure mode this
// file's header calls out): once the operator has typed a value, a
// LATER-arriving (or later-changing) default must never silently overwrite
// it.
test('resolveCeilingFieldValue: a manual override is never clobbered by a default that arrives (or changes) AFTER the override was set', () => {
  const beforeDefaultArrives = resolveCeilingFieldValue(0, 25);
  const afterDefaultArrives = resolveCeilingFieldValue(10, 25);
  expect(beforeDefaultArrives).toBe(25);
  expect(afterDefaultArrives).toBe(25);
});

test('resolveCeilingFieldValue: a manual override of exactly 0 still wins over the default (0 is a legitimate FIELD value the operator typed, even though resolveCostCeilingForDispatch will separately refuse to dispatch it) — the field-display decision and the dispatch-validity decision are deliberately separate functions', () => {
  expect(resolveCeilingFieldValue(10, 0)).toBe(0);
});

// ---------------------------------------------------------------------------
// validateMaterialsClientSide — kind gate, mirroring the server's EXACT
// message shape (cli/ui-bridge.ts materialsNoKindMessage /
// materialsUndeclaredKindMessage). "declares: (none)" is the server's own
// literal for an empty declared-kinds list (declaredMaterialKindsClause).
// ---------------------------------------------------------------------------

test('validateMaterialsClientSide: a declared, acceptable kind -> {ok:true}', () => {
  const result = validateMaterialsClientSide([{ filename: 'photo.png', sizeBytes: 1000 }], ['images'], 'onboarding-agent');
  expect(result).toEqual({ ok: true });
});

test('validateMaterialsClientSide: an extension mapping to NO kind at all -> refused with the server\'s EXACT "maps to no material kind" message shape', () => {
  const result = validateMaterialsClientSide([{ filename: 'archive.zip', sizeBytes: 1000 }], ['images'], 'onboarding-agent');
  expect(result).toEqual({
    ok: false,
    error: 'materials: "archive.zip" maps to no material kind; agent "onboarding-agent" declares: images',
  });
});

test('validateMaterialsClientSide: a kind the agent has NOT declared -> refused with the server\'s EXACT "is <kind>; agent declares" message shape — kills "refuses silently with no reason" and "invents its own wording"', () => {
  const result = validateMaterialsClientSide([{ filename: 'notes.mp3', sizeBytes: 1000 }], ['images'], 'onboarding-agent');
  expect(result).toEqual({
    ok: false,
    error: 'materials: "notes.mp3" is audio; agent "onboarding-agent" declares: images',
  });
});

test('validateMaterialsClientSide: an agent that declares NOTHING -> the refusal message says "declares: (none)", the server\'s exact literal for an empty list', () => {
  const result = validateMaterialsClientSide([{ filename: 'photo.png', sizeBytes: 1000 }], [], 'no-materials-agent');
  expect(result).toEqual({
    ok: false,
    error: 'materials: "photo.png" is images; agent "no-materials-agent" declares: (none)',
  });
});

// Kills "declared kinds come from a hardcoded list" — the SAME filename +
// extension is accepted or refused purely based on the declaredKinds
// ARGUMENT, proving the gate is driven by the descriptor's data, not a
// baked-in vocabulary.
test('validateMaterialsClientSide: acceptance is driven by the declaredKinds ARGUMENT, not a hardcoded vocabulary', () => {
  const withImages = validateMaterialsClientSide([{ filename: 'photo.png', sizeBytes: 1000 }], ['images'], 'agent-a');
  const withoutImages = validateMaterialsClientSide([{ filename: 'photo.png', sizeBytes: 1000 }], ['audio'], 'agent-a');
  expect(withImages.ok).toBe(true);
  expect(withoutImages.ok).toBe(false);
});

// The deliberate .svg exclusion (orchestrator/studio/materials.ts's
// documented security rationale — SVG is active content, never bucketed
// with inert raster images) must survive the client mirror too, or the
// client would show "accepted" for a file the server refuses.
test('validateMaterialsClientSide: .svg maps to NO kind (mirrors the server\'s deliberate active-content exclusion, even when "images" is declared)', () => {
  const result = validateMaterialsClientSide([{ filename: 'icon.svg', sizeBytes: 1000 }], ['images', 'documents', 'audio', 'data-files'], 'agent-a');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain('maps to no material kind');
  }
});

// ---------------------------------------------------------------------------
// validateMaterialsClientSide — the three server caps, same message shape
// (orchestrator/studio/materials.ts MAX_MATERIALS_COUNT=8,
// MAX_MATERIAL_BYTES=262144, MAX_MATERIALS_TOTAL_BYTES=524288).
// ---------------------------------------------------------------------------

test('validateMaterialsClientSide: more than 8 entries -> refused with the count-cap message shape, mirroring MAX_MATERIALS_COUNT', () => {
  const entries = Array.from({ length: 9 }, (_, i) => ({ filename: `f${i}.png`, sizeBytes: 10 }));
  const result = validateMaterialsClientSide(entries, ['images'], 'agent-a');
  expect(result).toEqual({ ok: false, error: 'materials: at most 8 materials per request (got 9)' });
});

test('validateMaterialsClientSide: exactly 8 entries -> the count cap does not fire (boundary, inclusive)', () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({ filename: `f${i}.png`, sizeBytes: 10 }));
  const result = validateMaterialsClientSide(entries, ['images'], 'agent-a');
  expect(result.ok).toBe(true);
});

test('validateMaterialsClientSide: a single file over 262144 bytes -> refused with the per-file cap message shape', () => {
  const result = validateMaterialsClientSide([{ filename: 'big.png', sizeBytes: 262145 }], ['images'], 'agent-a');
  expect(result).toEqual({ ok: false, error: 'materials: "big.png" exceeds the per-file size cap (262144 bytes)' });
});

test('validateMaterialsClientSide: files summing over 524288 bytes (each individually AT OR UNDER the per-file cap) -> refused with the total-cap message shape, not the per-file one', () => {
  // Mirrors the server's per-entry, running-total order exactly
  // (validateMaterialsField in cli/ui-bridge.ts): two files sitting exactly
  // AT the 262144-byte per-file cap (never exceeding it individually) sum to
  // exactly 524288 — the total boundary itself, not yet exceeding — so a
  // third, tiny file is what actually pushes the running total over. If any
  // single entry in this fixture exceeded 262144 on its own, the per-file
  // message would fire FIRST and this would stop pinning the total cap at
  // all (a mistake this file's own author caught and fixed while writing it).
  const result = validateMaterialsClientSide(
    [
      { filename: 'a.png', sizeBytes: 262144 },
      { filename: 'b.png', sizeBytes: 262144 },
      { filename: 'c.png', sizeBytes: 1 },
    ],
    ['images'],
    'agent-a',
  );
  expect(result).toEqual({ ok: false, error: 'materials: total size exceeds the request cap (524288 bytes)' });
});

// ---------------------------------------------------------------------------
// Ordering: the kind gate must fire ONLY on entries that pass the caps —
// mirrors the server's own per-entry, first-failure-wins order
// (validateMaterialsField in cli/ui-bridge.ts).
// ---------------------------------------------------------------------------

test('validateMaterialsClientSide: an oversized file with an undeclared kind is refused for its SIZE, not its kind — caps are checked before the kind gate, same order as the server', () => {
  const result = validateMaterialsClientSide([{ filename: 'huge.mp3', sizeBytes: 300000 }], ['images'], 'agent-a');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain('exceeds the per-file size cap');
    expect(result.error).not.toContain('is audio');
  }
});
