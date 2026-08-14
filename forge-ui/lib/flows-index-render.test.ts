/**
 * Acceptance tests — the `/flows` index route (W6-IA-2).
 *
 * Ground truth this pins: before this initiative no `forge-ui/app/flows/
 * page.tsx` existed at all — the flows pillar had no browse index of its
 * own, only `/flows/[id]` (monitor+build) and `/flows/new`. Nav still
 * deep-links straight to `/flows/forge-develop` (`StudioNav.tsx:26`) — that
 * repoint is a LATER lane (IA-5); this file does not touch it.
 *
 * TWO render surfaces, tested two different ways:
 *
 *  - `FlowsIndexBody` (`components/studio/FlowsIndexBody.tsx`) — the
 *    presentational grid/zero-state body — is rendered directly via
 *    `react-dom/server`'s `renderToStaticMarkup`, exactly like
 *    `./library-card-render.test.ts` and `./run-view-render.test.ts` (no
 *    jsdom/@testing-library; react/react-dom are already forge-ui deps; the
 *    `resolve.alias['@']` + `oxc.jsx: {runtime:'automatic'}` this needs are
 *    already in `forge-ui/vitest.config.ts`). It is props-driven and never
 *    fetches, so it renders its real, final markup synchronously — no mocks
 *    needed.
 *
 *  - The connected `app/flows/page.tsx` default export DOES need one mock:
 *    its sibling `<StudioNav/>` calls `usePathname()` from `next/navigation`,
 *    which throws ("Cannot read properties of null") under bare
 *    `renderToStaticMarkup` with no app-router context mounted (confirmed by
 *    hand before writing this file — the same "KNOWN GAP" `run-view-render.
 *    test.ts`'s header describes for `useParams()`). `next/navigation` is
 *    mocked to a fixed pathname so the shell's OWN literal `data-page`
 *    contract can still be asserted directly off the real file, without
 *    reimplementing it as a decoy constant. The page's `useEffect` data
 *    fetch does not run under SSR-style rendering (same known gap), so this
 *    only proves the pre-fetch shell shape (`data-page`, `data-page-ready=
 *    "false"`, the nav) — the grid/zero-state CONTRACT is pinned on
 *    `FlowsIndexBody` above instead.
 *
 * RUN: npx vitest run lib/flows-index-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowsIndexBody } from '@/components/studio/FlowsIndexBody';
import type { Flow, Project, Run } from '@/lib/studio-client';

// ---- fixtures ---------------------------------------------------------------

function makeFlow(overrides: Partial<Flow> & { id: string }): Flow {
  return { id: overrides.id, name: overrides.id, goal: '', nodes: [], edges: [], triggers: [], ...overrides };
}

// ---- FlowsIndexBody: zero-state ----------------------------------------------

test('FlowsIndexBody: zero flows renders the zero-state with a "New flow" CTA pointing at /flows/new', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowsIndexBody, { flows: [], runs: [], projects: [] } satisfies { flows: Flow[]; runs: Run[]; projects: Project[] }),
  );
  expect(html).toContain('data-component="flows-zero-state"');
  expect(html).toContain('data-action="new-flow"');
  expect(html).toContain('href="/flows/new"');
  expect(html).not.toContain('data-component="flows-grid"');
});

// ---- FlowsIndexBody: grid rows -----------------------------------------------

test('FlowsIndexBody: one or more flows renders a card-grid row per flow, reusing the REAL FlowCard (data-card-type="flow")', () => {
  const flows = [
    makeFlow({ id: 'forge-develop', name: 'Forge Develop' }),
    makeFlow({ id: 'onboard-project', name: 'Onboard Project' }),
  ];
  const html = renderToStaticMarkup(React.createElement(FlowsIndexBody, { flows, runs: [], projects: [] }));
  expect(html).toContain('data-component="flows-grid"');
  expect((html.match(/data-card-type="flow"/g) ?? []).length).toBe(2);
  expect(html).toContain('href="/flows/forge-develop"');
  expect(html).toContain('href="/flows/onboard-project"');
  expect(html).not.toContain('data-component="flows-zero-state"');
});

test('FlowsIndexBody: each flow card links to its OWN /flows/<id> monitor route, not back to the shared /flows index', () => {
  const flows = [makeFlow({ id: 'my-scratch-flow' })];
  const html = renderToStaticMarkup(React.createElement(FlowsIndexBody, { flows, runs: [], projects: [] }));
  expect(html).toContain('href="/flows/my-scratch-flow"');
});

// ---- connected page shell: data-page ----------------------------------------

vi.mock('next/navigation', () => ({
  usePathname: () => '/flows',
}));

test('app/flows/page.tsx: the connected shell renders data-page="flows-index" on <main>, and mounts StudioNav', async () => {
  const { default: FlowsIndexPage } = await import('@/app/flows/page');
  const html = renderToStaticMarkup(React.createElement(FlowsIndexPage));
  expect(html).toContain('data-page="flows-index"');
  // useEffect never runs under renderToStaticMarkup — this is the honest
  // pre-fetch shell, not a claim the grid has loaded.
  expect(html).toContain('data-page-ready="false"');
  expect(html).toContain('data-component="studio-nav"');
  expect(html).toContain('data-action="new-flow"');
  expect(html).toContain('href="/flows/new"');
});
