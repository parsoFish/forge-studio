/**
 * forge-nk1y.16 — `/projects/[id]` measured 8,318 px at S3 beat 5 against a
 * scrolling-page budget of 3 viewports (dev/UI-CONSTRAINTS.md §1). The page
 * grew with three unbounded things; each is bounded here (§3: paginate a list
 * that can grow, contain a long list or raw text in a `--pane-*` box):
 *
 *   1. the cycle ledger — paginated (`pageSize`, `ledger-show-more`);
 *   2. the contract rail (the aside: readiness, resolution, drift, checklist,
 *      onboarding, open sessions) — its own viewport-tall scroller, so it no
 *      longer sets the page height;
 *   3. the long lists inside it and the raw instruction text — each in a
 *      `var(--pane-*)` max-height scroller.
 *
 * KILLS: dropping `pageSize` (every cycle rendered), an aside that grows the
 * page again, a drift/checklist list or the instructions file view back to an
 * unbounded or off-scale height. The stories read these rows by attribute, so
 * containment (never pagination) keeps every row in the DOM.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Cycle } from '@/lib/bridge-client';
import { ProjectCycleLedger } from '@/components/studio/project-builder/ProjectCycleLedger';

const STUDIO = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(STUDIO, rel), 'utf8');
const FIXED_NOW = Date.parse('2026-07-11T09:00:00Z');

function cycles(n: number): Cycle[] {
  return Array.from({ length: n }, (_, i) => ({
    cycleId: `2026-07-${String(10 + (i % 18)).padStart(2, '0')}T07-29-${String(i % 60).padStart(2, '0')}_INIT-${i}`,
    initiativeId: `INIT-${i}`,
    project: 'gitpulse',
    status: 'merged',
    startedAt: '2026-07-11T07:29:19Z',
    endedAt: '2026-07-11T08:15:00Z',
  }));
}

/** The style text of the element whose opening tag carries `marker`. */
function styleOf(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, `${marker} present`).toBeGreaterThan(-1);
  const end = src.indexOf('>', i);
  const start = src.lastIndexOf('<', i);
  return src.slice(start, end);
}

test('the cycle ledger pages: n+1 cycles render one page plus "show more"', () => {
  const html = renderToStaticMarkup(
    React.createElement(ProjectCycleLedger, { cycles: cycles(11), nowMs: FIXED_NOW, pageSize: 10 }),
  );
  expect(html.match(/data-ledger-row=/g)?.length).toBe(10);
  expect(html).toContain('data-action="ledger-show-more"');
});

test('the page mounts the ledger with a page size', () => {
  expect(read('app/projects/[id]/page.tsx')).toMatch(/<ProjectCycleLedger[^>]*pageSize=\{PROJECT_LEDGER_PAGE_SIZE\}/);
});

test('the contract rail is its own viewport-tall scroller, never the page height', () => {
  const style = styleOf(read('app/projects/[id]/page.tsx'), 'data-page-section="contract"');
  expect(style).toMatch(/position: 'sticky'/);
  expect(style).toMatch(/maxHeight: '100vh'/);
  expect(style).toMatch(/overflowY: 'auto'/);
});

test.each([
  ['components/studio/project-builder/RebuildContractPanel.tsx', 'data-section="contract-drift-rows"'],
  ['components/studio/project-builder/ProjectContractPanel.tsx', 'data-section="contract-checklist"'],
  ['components/studio/project-builder/Instructions.tsx', 'data-section="instructions-file-view"'],
  ['components/studio/project-builder/SkillsBind.tsx', 'data-section="skills-catalog"'],
])('%s: %s is contained on the pane scale', (file, marker) => {
  const style = styleOf(read(file), marker);
  expect(style).toMatch(/maxHeight: 'var\(--pane-(xs|sm|md|lg|xl)\)'/);
  expect(style).toMatch(/overflow(Y)?: 'auto'/);
});
