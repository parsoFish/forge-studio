/**
 * kb-health-render.test.ts — R1-06 WI-3 group B (2)+(4): `KbHealth.tsx`
 * (forge-ui/components/studio/knowledge/KbHealth.tsx) gains structural
 * `data-*` hooks so a journey can assert KB health WITHOUT scraping
 * rendered prose, and its "Suggested action" copy stops naming manual
 * ingest (operator decision 3, R1-06-F3 — ingest stays reflection-only;
 * see docs/decisions/010-brain-first.md + R1-contract-componentry.md
 * lines ~213-227). Today KbHealth.tsx:130 reads "Queue a manual ingest
 * pass or leave a guidance note." and the component's outer `<div>`
 * (line 40) carries ZERO `data-*` attributes.
 *
 * `KbHealth` is a plain presentational function component (props in,
 * markup out — no hooks, no effects), so unlike the parent `/knowledge`
 * page (see ./knowledge-page-kb-maintenance.test.ts's header for why THAT
 * one can't be render-tested) it renders faithfully and completely under
 * `react-dom/server`'s `renderToStaticMarkup` with real props. No jsdom.
 *
 * NEW `data-*` HOOKS this file pins as the contract (none exist on
 * KbHealth.tsx today — every assertion using them is a legitimate RED
 * against the current file):
 *
 *   [data-component="kb-health"]   wraps the whole panel (journey anchor)
 *   [data-lint-errors="<n>"]       == health.lintErrors
 *   [data-lint-warnings="<n>"]     == health.lintFlags
 *
 * RUN: cd forge-ui && npx vitest run lib/kb-health-render.test.ts
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KbHealth } from '@/components/studio/knowledge/KbHealth';
import type { KbHealth as KbHealthData } from '@/lib/studio-client';

function baseHealth(overrides: Partial<KbHealthData> = {}): KbHealthData {
  return {
    layerBalance: { index: 3, theme: 12, raw: 8 },
    orphans: 0,
    linkDensity: 1.4,
    staleness: { staleRawCount: 0, staleThemeCount: 0 },
    lintFlags: 0,
    lintErrors: 0,
    ...overrides,
  };
}

function render(health: KbHealthData): string {
  return renderToStaticMarkup(React.createElement(KbHealth, { health }));
}

describe('KbHealth — suggested-action copy (R1-06 WI-3 group B, 2)', () => {
  it('precondition: today\'s copy names manual ingest for a stale-raw KB (regression-anchors the fixture before asserting the RED)', () => {
    // This fixture MUST trigger the "Suggested action" branch
    // (staleRaw > 0 && layerBalance.raw > 0, KbHealth.tsx:122) — assert
    // that precondition directly before trusting any verdict drawn from it.
    const health = baseHealth({ staleness: { staleRawCount: 4, staleThemeCount: 0 }, layerBalance: { index: 3, theme: 12, raw: 8 } });
    expect(health.staleness.staleRawCount).toBeGreaterThan(0);
    expect(health.layerBalance.raw).toBeGreaterThan(0);
    const html = render(health);
    expect(html).toContain('Suggested action');
  });

  it('RED: the suggested-action copy no longer contains "manual ingest" (ingest stays reflection-only — operator decision 3)', () => {
    const health = baseHealth({ staleness: { staleRawCount: 4, staleThemeCount: 0 }, layerBalance: { index: 3, theme: 12, raw: 8 } });
    const html = render(health);
    expect(html).not.toContain('manual ingest');
  });
});

describe('KbHealth — structural data-* hooks (R1-06 WI-3 group B, 2)', () => {
  const health = baseHealth({ lintErrors: 2, lintFlags: 5 });
  const html = render(health);

  it('RED: wraps the panel in [data-component="kb-health"]', () => {
    expect(html).toContain('data-component="kb-health"');
  });

  it('RED: exposes lint error count structurally via [data-lint-errors]', () => {
    expect(html).toContain('data-lint-errors="2"');
  });

  it('RED: exposes lint warning (flag) count structurally via [data-lint-warnings]', () => {
    expect(html).toContain('data-lint-warnings="5"');
  });
});

// ---------------------------------------------------------------------------
// R6-08 WI-1 RED-D — per-check itemization rows. `buildKbHealth` (WI-1,
// packages/knowledge/bridge-studio-kbs.ts) gains a `checks: Array<{check,status,errorCount,
// flagCount}>` field (see cli/bridge-studio-kbs.test.ts's RED-A/B/C for the
// backend RED pins); this pins the F2 Health tab's RENDER of that field —
// one `[data-check="<name>"]` row per entry, carrying `data-check-status`
// and `data-check-count`. `KbHealthData` (lib/studio-client.ts) does not
// declare `checks` yet — that file is a WI-1 implementation target, not
// edited by this RED-pin pass — so the fixture below widens the type
// locally via `@ts-expect-error` (harmless at runtime: vitest's oxc
// transform strips types and never enforces this; the directive only
// matters for a separate `tsc --noEmit` pass, where it correctly suppresses
// the genuine excess-property error until studio-client.ts adds the field).
// KbHealth.tsx renders none of this today (component-source-verified: it
// destructures only layerBalance/orphans/linkDensity/staleness/lintFlags/
// lintErrors), so passing `checks` is silently ignored by the CURRENT
// component — a legitimate RED via absent markup, not a crash.
// ---------------------------------------------------------------------------
describe('KbHealth — per-check itemization rows (R6-08 WI-1 RED-D)', () => {
  // (`checks` landed on KbHealthData — the R6-08 WI-1 @ts-expect-error that
  // sat here is retired now that the tests tsc project enforces it, W7-C3.)
  const health = baseHealth({
    lintErrors: 1,
    lintFlags: 0,
    checks: [
      { check: 'checkFrontmatter', status: 'fail', errorCount: 1, flagCount: 0 },
      { check: 'checkOrphans', status: 'pass', errorCount: 0, flagCount: 0 },
    ],
  });
  const html = render(health);

  it('RED: renders one [data-check="<name>"] row per checks[] entry', () => {
    expect(html).toContain('data-check="checkFrontmatter"');
    expect(html).toContain('data-check="checkOrphans"');
  });

  it('RED: each row carries data-check-status reflecting the entry\'s status', () => {
    expect(html).toContain('data-check-status="fail"');
    expect(html).toContain('data-check-status="pass"');
  });

  it('RED: each row carries data-check-count reflecting the entry\'s finding count', () => {
    // checkFrontmatter: errorCount 1 + flagCount 0 → 1. checkOrphans: 0 + 0 → 0.
    expect(html).toContain('data-check-count="1"');
    expect(html).toContain('data-check-count="0"');
  });
});

// ---------------------------------------------------------------------------
// R6-08 4on — 'n/a' check status must render honestly: distinct data-* value,
// AND visually distinct from a real 'pass' (not a green dot) — otherwise the
// UI itself would re-introduce the declared-data-fails-open defect the
// backend fix (buildKbHealth) just closed, one layer up in the render.
// ---------------------------------------------------------------------------
describe('KbHealth — "n/a" check status renders honestly, distinct from "pass" (R6-08 4on)', () => {
  // (`checks`/'n/a' landed on the type — stale @ts-expect-error retired, W7-C3.)
  const health = baseHealth({
    lintErrors: 0,
    lintFlags: 0,
    checks: [
      { check: 'checkOrphans', status: 'pass', errorCount: 0, flagCount: 0 },
      { check: 'checkReflectorLoss', status: 'n/a', errorCount: 0, flagCount: 0 },
    ],
  });
  const html = render(health);

  it('renders data-check-status="n/a" for an n/a check', () => {
    expect(html).toContain('data-check-status="n/a"');
  });

  it('renders the n/a row with an honest, non-"pass" label (never claims a clean scan)', () => {
    // Extract the checkReflectorLoss row's own markup slice so this assertion
    // can't accidentally match text belonging to the sibling checkOrphans row.
    const rowStart = html.indexOf('data-check="checkReflectorLoss"');
    const rowEnd = html.indexOf('data-check="', rowStart + 1);
    const row = html.slice(rowStart, rowEnd === -1 ? undefined : rowEnd);
    expect(row).not.toContain('>pass<');
    expect(row.toLowerCase()).toContain('n/a');
  });

  it('gives the n/a row a visually distinct marker from a real "pass" (not the same green dot)', () => {
    const passRowStart = html.indexOf('data-check="checkOrphans"');
    const passRowEnd = html.indexOf('data-check="', passRowStart + 1);
    const passRow = html.slice(passRowStart, passRowEnd === -1 ? undefined : passRowEnd);

    const naRowStart = html.indexOf('data-check="checkReflectorLoss"');
    // Bound to the row's OWN closing tag (each check row is a single flat
    // <div>...</div> — no nested divs), not `.slice(naRowStart)` to end of
    // document, which would spuriously pick up unrelated later markup (e.g.
    // the Staleness section, which legitimately uses the same green token).
    const naRowEnd = html.indexOf('</div>', naRowStart);
    const naRow = html.slice(naRowStart, naRowEnd === -1 ? undefined : naRowEnd);

    // The pass row's marker uses the KB-green token; the n/a row's marker
    // must NOT use that same color — asserted on the actual per-row markup
    // slices, not a whole-page substring check (which could false-pass on
    // markup emitted by an unrelated part of the panel).
    expect(passRow).toContain('var(--c-kb)');
    expect(naRow).not.toContain('var(--c-kb)');
  });
});

// ---------------------------------------------------------------------------
// (4) REGRESSION companion — the EXISTING prose rendering (lint error/warning
// counts) this WI must not break while adding the data-* hooks above.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// W6-B13 — the Lint/Checks counts are ACTIONABLE (KbDrainPanel is what
// actually clears them), so they link into it rather than sitting as orphan
// numbers with no path to a fix (sweep C9, "KbHealth counts → the drain
// panel").
// ---------------------------------------------------------------------------
describe('KbHealth — lint/checks counts link to the drain panel (W6-B13)', () => {
  it('the Lint section links to #kb-drain-panel via [data-action="goto-drain-panel"]', () => {
    const html = render(baseHealth({ lintErrors: 1, lintFlags: 0 }));
    expect(html).toContain('data-action="goto-drain-panel"');
    expect(html).toContain('href="#kb-drain-panel"');
  });

  it('W7-B2 (knowledge-09): the fix affordance is ONE explicit "Fix N findings →" link on the Lint heading — the counts themselves are no longer an invisible full-width anchor', () => {
    const html = render(baseHealth({ lintErrors: 2, lintFlags: 1 }));
    const anchorStart = html.indexOf('data-action="goto-drain-panel"');
    const anchorEnd = html.indexOf('</a>', anchorStart);
    const anchorContent = html.slice(anchorStart, anchorEnd);
    expect(anchorContent).toContain('Fix 3 findings');
    // The count rows render OUTSIDE the anchor now.
    expect(anchorContent).not.toContain('2 lint errors');
    expect(html).toContain('2 lint errors');
  });

  it('W7-B2 (knowledge-09): the per-check itemization block is an INERT readout — no anchor of its own', () => {
    const html = render(baseHealth({
      lintErrors: 0, lintFlags: 0,
      checks: [{ check: 'checkFrontmatter', status: 'pass', errorCount: 0, flagCount: 0 }],
    }));
    expect(html).not.toContain('data-action="goto-drain-panel"');
    expect(html).toContain('checkFrontmatter');
  });

  it('no goto-drain-panel link renders when there is nothing to act on (zero lint counts, no checks)', () => {
    const html = render(baseHealth({ lintErrors: 0, lintFlags: 0 }));
    expect(html).not.toContain('data-action="goto-drain-panel"');
  });
});

describe('KbHealth — lint count rendering (companion, must stay green)', () => {
  it('renders the singular lint-error sentence for count === 1', () => {
    const html = render(baseHealth({ lintErrors: 1, lintFlags: 0 }));
    expect(html).toContain('1 lint error');
    expect(html).not.toContain('1 lint errors');
  });

  it('renders the plural lint-error sentence for count > 1', () => {
    const html = render(baseHealth({ lintErrors: 3, lintFlags: 0 }));
    expect(html).toContain('3 lint errors');
  });

  it('renders the singular lint-flag sentence for count === 1', () => {
    const html = render(baseHealth({ lintErrors: 0, lintFlags: 1 }));
    expect(html).toContain('1 lint flag');
    expect(html).not.toContain('1 lint flags');
  });

  it('renders the plural lint-flag sentence for count > 1', () => {
    const html = render(baseHealth({ lintErrors: 0, lintFlags: 4 }));
    expect(html).toContain('4 lint flags');
  });

  it('omits the Lint section entirely when both counts are zero', () => {
    const html = render(baseHealth({ lintErrors: 0, lintFlags: 0 }));
    expect(html).not.toContain('lint error');
    expect(html).not.toContain('lint flag');
  });
});
