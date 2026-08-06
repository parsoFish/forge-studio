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
 * WHY these two, and not a single monolithic "buildDispatchOptions": each is
 * independently the exact decision point the task brief calls out —
 * (1) "refusing an undeclared kind client-side with the SAME MESSAGE SHAPE
 * the server uses" (mirrors cli/ui-bridge.ts's `materialsNoKindMessage` /
 * `materialsUndeclaredKindMessage` / the three cap messages — message text
 * pinned CHARACTER-FOR-CHARACTER below, matching that file's own "wording is
 * pinned character-for-character... do not reword" convention), and
 * (2) "an operator never submits a ceiling that will be refused" — the
 * function signature itself makes "just always pass the raw input through"
 * impossible to satisfy without inspecting `enforceable`.
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

test('resolveCostCeilingForDispatch: enforceable=true, value 0 -> still returns 0, not undefined (the ENFORCEABILITY gate, not a truthiness gate on the value)', () => {
  // Kills an implementation that does `enforceable && value ? value :
  // undefined` (a truthy check on the ceiling VALUE, wrongly conflated with
  // the enforceability gate on the AGENT).
  expect(resolveCostCeilingForDispatch(0, true)).toBe(0);
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
