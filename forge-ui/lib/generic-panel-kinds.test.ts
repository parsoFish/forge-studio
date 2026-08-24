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
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const UI_ROOT = resolve(__dirname, '..');
const PAGE_SOURCE = readFileSync(resolve(UI_ROOT, 'app/sessions/[kind]/[sessionId]/page.tsx'), 'utf8');
const SESSION_KINDS = yaml.load(readFileSync(resolve(UI_ROOT, '..', 'studio', 'session-kinds.yaml'), 'utf8')) as Array<{
  id: string;
  turnSpec?: unknown;
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

test('every turnSpec-declared session kind is wired into GENERIC_PANEL_KINDS (community-refresh included)', () => {
  const panelKinds = parseGenericPanelKinds();
  const turnSpecKinds = SESSION_KINDS.filter((d) => d.turnSpec !== undefined && !BESPOKE_PANEL_KINDS.has(d.id)).map((d) => d.id);
  expect(turnSpecKinds.length).toBeGreaterThan(0);
  for (const kind of turnSpecKinds) {
    expect(panelKinds.has(kind), `session kind "${kind}" declares a turnSpec but is missing from GENERIC_PANEL_KINDS — its operator affordances (verdicts included) would render as a blank page`).toBe(true);
  }
});
