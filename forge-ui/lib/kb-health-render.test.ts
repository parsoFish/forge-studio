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
// (4) REGRESSION companion — the EXISTING prose rendering (lint error/warning
// counts) this WI must not break while adding the data-* hooks above.
// ---------------------------------------------------------------------------
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
