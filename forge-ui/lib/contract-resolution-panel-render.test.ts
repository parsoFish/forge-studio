/**
 * DOM regression tests for `ContractResolutionPanel.tsx`
 * (forge-ui/components/studio/project-builder/ContractResolutionPanel.tsx) —
 * pins that the initial-render markup for each resolution tier carries the
 * HONEST label this pass introduces, not the old "Resolve with agent" /
 * "Apply decision" strings.
 *
 * Renders the REAL component via `react-dom/server`'s `renderToStaticMarkup`
 * (no jsdom in this repo — see run-panel-render.test.ts's header for the
 * established convention this mirrors). `ContractResolutionPanel` calls
 * `useRouter()` (next/navigation), which throws outside an app-router
 * provider under `renderToStaticMarkup` — mocked here exactly as
 * `components/StudioNav.test.ts` already does for `usePathname()`.
 *
 * Label text is static per clause/props at initial render (no `useEffect`
 * dependency), so this IS reachable without simulating a click — only the
 * click's own side effect (dispatch + navigation) needs the pure-logic
 * `contract-resolution-view.test.ts` coverage instead.
 *
 * RUN: npx vitest run lib/contract-resolution-panel-render.test.ts   (from forge-ui/)
 */

import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractResolutionPanel } from '@/components/studio/project-builder/ContractResolutionPanel';
import type { PreflightClause } from '@/lib/studio-client';

function clause(overrides: Partial<PreflightClause>): PreflightClause {
  return {
    id: 'C8', title: 'Test clause', hard: true, pass: false, detail: 'detail',
    ...overrides,
  };
}

function render(clauses: PreflightClause[]): string {
  return renderToStaticMarkup(
    React.createElement(ContractResolutionPanel as any, { projectId: 'gitpulse', clauses }),
  );
}

test('agent-tier instructions clause: the resolve button reads honestly, never "Resolve with agent"', () => {
  const html = render([clause({ id: 'C8', resolution: 'agent', route: 'instructions' })]);
  expect(html).toContain('data-action="resolve-clause-agent"');
  expect(html).not.toMatch(/Resolve with agent/);
  expect(html).toMatch(/instructions builder/i);
});

test('agent-tier demo-builder clause: the resolve button names the demo builder', () => {
  const html = render([clause({ id: 'DEMO', resolution: 'agent', route: 'demo-builder' })]);
  expect(html).not.toMatch(/Resolve with agent/);
  expect(html).toMatch(/demo builder/i);
});

test('agent-tier brain-fix clause: the resolve button names Knowledge, not a fake in-place resolve', () => {
  const html = render([clause({ id: 'BRAIN', resolution: 'agent', route: 'brain-fix' })]);
  expect(html).not.toMatch(/Resolve with agent/);
  expect(html).toMatch(/Knowledge/i);
});

test('user-tier clause: the apply button honestly says "Apply with agent" (this tier genuinely dispatches + polls one)', () => {
  const html = render([clause({ id: 'C1', resolution: 'user', route: undefined })]);
  expect(html).toContain('data-action="apply-clause-decision"');
  expect(html).toMatch(/Apply with agent/);
  expect(html).not.toMatch(/>Apply decision</);
});
