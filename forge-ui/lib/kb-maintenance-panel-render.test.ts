/**
 * DOM regression tests for `KbMaintenancePanel.tsx`
 * (forge-ui/components/studio/knowledge/KbMaintenancePanel.tsx) — W6-B14's
 * extraction of `KbMaintenance` out of `app/knowledge/page.tsx` (a page-route
 * file can only export the reserved Next.js route symbols; a named export
 * would fail `next build` — same reasoning `run-panel-render.test.ts`'s
 * header documents for RunPanel.tsx).
 *
 * Renders the REAL component via `react-dom/server`'s `renderToStaticMarkup`
 * (no jsdom in this repo — see run-panel-render.test.ts's header for the
 * established convention this mirrors). `KbMaintenance` calls `useRouter()`
 * (next/navigation), mocked here the same way ContractResolutionPanel's own
 * render test does.
 *
 * `useEffect` (the reattach fetch, the poll) does not run under
 * `renderToStaticMarkup`, so this file only pins the FIRST-paint markup: the
 * five action buttons always present, and that `data-consolidate-state` /
 * `data-poll-state` are ABSENT on a fresh mount (no run attached yet — never
 * a fabricated idle value). The poll-state DERIVATION itself
 * (`pollDisplayState`) and the label mapping (`consolidateResultLabel`) are
 * pure functions covered directly in `agent-dispatch.test.ts` /
 * `kb-consolidate.test.ts`.
 *
 * RUN: npx vitest run lib/kb-maintenance-panel-render.test.ts   (from forge-ui/)
 */

import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KbMaintenance } from '@/components/studio/knowledge/KbMaintenancePanel';

function render(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(KbMaintenance as any, { kbId: 'gitpulse' }));
}

test('REGRESSION: all five action buttons render with their pre-existing data-action hooks — a contract journeys already depend on', () => {
  const html = render();
  for (const action of ['kb-index', 'kb-maintain-session', 'start-kb-cleanup', 'kb-delete']) {
    expect(html).toContain(`data-action="${action}"`);
  }
});

test('W6-B13 REGRESSION: data-action="kb-lint" is REMOVED (superseded source-text pin — knowledge-page-kb-maintenance.test.ts, deleted W6-B14 when this component became directly render-testable) — sweep finding C4#7, the Health tab\'s KbDrainPanel is the scan result now', () => {
  const html = render();
  expect(html).not.toContain('data-action="kb-lint"');
});

test('REGRESSION: data-component="kb-maintenance" root renders', () => {
  const html = render();
  expect(html).toContain('data-component="kb-maintenance"');
});

test('fresh mount: NO data-consolidate-state and NO data-poll-state attribute — a run has neither been dispatched nor reattached yet (renderToStaticMarkup never runs the reattach effect), so the panel must not fabricate an idle value for either', () => {
  const html = render();
  expect(html).not.toContain('data-consolidate-state=');
  expect(html).not.toContain('data-poll-state=');
});

test('fresh mount: NO [data-action="re-check"] button — only rendered once a poll has actually timed out', () => {
  const html = render();
  expect(html).not.toContain('data-action="re-check"');
});

test('fresh mount: the Consolidate button reads "Consolidate", not a stale "Consolidating…"', () => {
  const html = render();
  expect(html).toMatch(/data-action="kb-maintain-session"[^>]*>\s*Consolidate\s*</);
});
