/**
 * DOM regression tests for `OnboardWithAgent.tsx`
 * (forge-ui/components/studio/project-builder/OnboardWithAgent.tsx) — W6-B14's
 * extraction out of `app/projects/[id]/page.tsx` (a page-route file can only
 * export the reserved Next.js route symbols; a named export would fail
 * `next build` — same reasoning `run-panel-render.test.ts`'s header documents
 * for RunPanel.tsx).
 *
 * Renders the REAL component via `react-dom/server`'s `renderToStaticMarkup`
 * (no jsdom in this repo). `useEffect` (the reattach fetch, the poll) does
 * not run under `renderToStaticMarkup`, so this file only pins the FIRST-
 * paint markup: the pre-existing `data-onboard-run-id`/`data-onboard-run-
 * status`/`data-onboard-session-id`/`data-action="run-onboarding-agent"`
 * contract (an existing journey beat asserts these — must stay
 * byte-identical), and that `data-poll-state` is ABSENT on a fresh mount
 * (never a fabricated idle value).
 *
 * RUN: npx vitest run lib/onboard-with-agent-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardWithAgent } from '@/components/studio/project-builder/OnboardWithAgent';

function render(projectId = 'gitpulse'): string {
  return renderToStaticMarkup(React.createElement(OnboardWithAgent, { projectId }));
}

test('REGRESSION: data-section="onboard-with-agent", data-onboard-run-id/-status/-session-id, and data-action="run-onboarding-agent" all present with idle values — the pre-existing journey contract', () => {
  const html = render();
  expect(html).toContain('data-section="onboard-with-agent"');
  expect(html).toContain('data-onboard-run-id=""');
  expect(html).toContain('data-onboard-run-status="idle"');
  expect(html).toContain('data-onboard-session-id=""');
  expect(html).toContain('data-action="run-onboarding-agent"');
});

test('W6-B14: fresh mount (no run dispatched, no reattach resolved yet) -> NO data-poll-state attribute at all', () => {
  const html = render();
  expect(html).not.toContain('data-poll-state=');
});

test('W6-B14: fresh mount -> NO [data-action="re-check"] button', () => {
  const html = render();
  expect(html).not.toContain('data-action="re-check"');
});

test('W6-B14: data-onboard-attaching="true" on a fresh mount (the reattach check has not resolved yet under renderToStaticMarkup) — the Run button itself stays enabled (never blocks a real click on the attach check\'s own timing)', () => {
  const html = render();
  expect(html).toContain('data-onboard-attaching="true"');
  const idx = html.indexOf('data-action="run-onboarding-agent"');
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  const tag = html.slice(start, end + 1);
  expect(tag).not.toContain('disabled');
});
