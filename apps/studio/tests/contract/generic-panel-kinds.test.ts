/**
 * W7-B3 pin (sessions-kinds-06 / community-14): every session kind that
 * declares a `turnSpec` in studio/session-kinds.yaml — the generic
 * phase-table kinds whose ONLY interaction surface is the generic
 * `SessionInteractivePanel` — must be present in the session page's
 * GENERIC_PANEL_KINDS set. community-refresh was declared in the registry
 * (W6-CR-3) but never added to the page's hand-kept literal, so its
 * approve/reject verdict had NO UI at all and the whole refresh loop was
 * unreachable even on the happy path.
 *
 * This is deliberately a PARITY pin over the live registry file, not a
 * one-off "contains community-refresh" check — the defect class is "a new
 * descriptor renders a blank page", and the next declared kind must fail
 * this test the moment it is authored, not after its own walkthrough
 * finding. architect and project-brain are the two kinds with bespoke
 * panels (ADR-043 amendment §4) — the ONLY legitimate absences.
 *
 * forge-r594: the pin originally filtered on `turnSpec` alone, but a kind
 * can ALSO drive the generic panel via a `panel:` phase table (ADR-043
 * 2026-08-15 amendment §2 — demo/onboarding/instructions all use this shape
 * and never gain a turnSpec, amendment §1) — that half of the vocabulary
 * passed this pin even while missing from GENERIC_PANEL_KINDS. Every
 * currently-shipped `panel:`-only kind already happens to be in the
 * literal, so widening the real-data assertion below stays green; the
 * synthetic fixture test proves the WIDENED derivation (not the old
 * turnSpec-only one) is what actually catches a future `panel:`-only kind
 * that escapes the literal.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const UI_ROOT = resolve(__dirname, '..', '..');
const PAGE_SOURCE = readFileSync(resolve(UI_ROOT, 'app/sessions/[kind]/[sessionId]/page.tsx'), 'utf8');
const SESSION_KINDS = yaml.load(readFileSync(resolve(UI_ROOT, '..', '..', 'studio', 'session-kinds.yaml'), 'utf8')) as Array<{
  id: string;
  turnSpec?: unknown;
  panel?: unknown;
}>;

/** Kinds with their own bespoke panel — the only legitimate absences. */
const BESPOKE_PANEL_KINDS = new Set(['architect', 'project-brain']);

function parseGenericPanelKinds(): Set<string> {
  const m = PAGE_SOURCE.match(/GENERIC_PANEL_KINDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
  if (!m) throw new Error('could not locate the GENERIC_PANEL_KINDS literal in app/sessions/[kind]/[sessionId]/page.tsx');
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''))
      .filter(Boolean),
  );
}

/**
 * The set of kind ids that MUST be wired into GENERIC_PANEL_KINDS: anything
 * that drives the generic panel, via EITHER a `turnSpec` OR a `panel:` phase
 * table, excluding the bespoke kinds. A kind with neither is not a generic-
 * panel consumer at all (there is none such today, but the shape allows it).
 */
function coveredKindIds(kinds: readonly { id: string; turnSpec?: unknown; panel?: unknown }[], bespoke: ReadonlySet<string>): string[] {
  return kinds.filter((d) => (d.turnSpec !== undefined || d.panel !== undefined) && !bespoke.has(d.id)).map((d) => d.id);
}

test('every turnSpec- or panel-declared session kind is wired into GENERIC_PANEL_KINDS (derived from SESSION_KINDS, so community-refresh left it when W8-B5b WI-3 retired the descriptor)', () => {
  const panelKinds = parseGenericPanelKinds();
  const required = coveredKindIds(SESSION_KINDS, BESPOKE_PANEL_KINDS);
  expect(required.length).toBeGreaterThan(0);
  for (const kind of required) {
    expect(panelKinds.has(kind), `session kind "${kind}" declares a turnSpec or panel but is missing from GENERIC_PANEL_KINDS — its operator affordances (verdicts included) would render as a blank page`).toBe(true);
  }
});

test('coveredKindIds requires a panel-only kind too, not just a turnSpec one (forge-r594 — the old turnSpec-only filter let this escape)', () => {
  const syntheticKinds = [
    { id: 'turn-only', turnSpec: {} },
    { id: 'panel-only', panel: { phases: [] } },
    { id: 'bespoke-one' }, // neither turnSpec nor panel: never required
  ];
  const required = coveredKindIds(syntheticKinds, new Set(['bespoke-one']));
  // Under the pre-fix filter (`d.turnSpec !== undefined` alone) this would
  // be `['turn-only']` — 'panel-only' silently escapes. Quoted assertion:
  // expected [ 'turn-only' ] to deeply equal [ 'turn-only', 'panel-only' ].
  expect(required).toEqual(['turn-only', 'panel-only']);
});
