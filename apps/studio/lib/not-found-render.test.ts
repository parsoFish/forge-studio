/**
 * W7-A4 — the ONE shared NotFound (findings crosscut-27, crosscut-07,
 * crosscut-02, agents-10, community-11, projects-23, flows-16,
 * sessions-kinds-18, knowledge-04, artifact-plan-07/08, crosscut-04/08).
 *
 * Contract (docs/forge-ui-dom-and-harness.md → "Not-found contract"):
 *   <main data-page="not-found" data-page-ready="true"
 *         data-not-found-kind="<kind>" data-not-found-id="<id>"
 *         data-not-found-variant="unknown"|"retired"|"unselected">
 *     <StudioNav/>                       ← nav intact, never a bare page
 *     [data-component="not-found"]       ← the honest body: names kind + id
 *       <a data-action="not-found-back" href=<backHref>>← <backLabel></a>
 *
 * Wrong implementations these pins kill:
 *   - a page that renders a DIFFERENT object for an unknown id (knowledge's
 *     first-KB fallback, agents' redirect into the blank builder);
 *   - a not-found body with no way back but the browser (community-11);
 *   - seven hand-rolled treatments with seven different shapes (crosscut-27);
 *   - a "retired flow" state that reads as an ordinary typo (flows-05).
 *
 * RUN: npx vitest run lib/not-found-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/nope',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotFound } from '@/components/NotFound';

test('NotFound: unknown-id shape — data-page="not-found", kind + id on the root, nav intact, honest body, back link', () => {
  const html = renderToStaticMarkup(
    React.createElement(NotFound, { kind: 'project', id: 'nope', backHref: '/projects', backLabel: 'Projects' }),
  );
  expect(html).toMatch(/<main[^>]*data-page="not-found"/);
  expect(html).toContain('data-page-ready="true"');
  expect(html).toContain('data-not-found-kind="project"');
  expect(html).toContain('data-not-found-id="nope"');
  expect(html).toContain('data-not-found-variant="unknown"');
  // Studio chrome stays — the top nav renders inside the not-found page.
  expect(html).toContain('data-nav="projects"');
  // The honest body names BOTH the kind and the id the operator asked for.
  expect(html).toContain('data-component="not-found"');
  expect(html).toMatch(/No project[^<]*nope/);
  // …and always offers a way back.
  expect(html).toMatch(/<a[^>]*data-action="not-found-back"[^>]*href="\/projects"/);
  expect(html).toContain('Projects');
});

test('NotFound: the id is rendered as text (escaped), never interpreted', () => {
  const html = renderToStaticMarkup(
    React.createElement(NotFound, { kind: 'flow', id: '<img src=x onerror=alert(1)>', backHref: '/flows', backLabel: 'Flows' }),
  );
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
});

test('NotFound: variant="retired" reads as retired, not as a typo, and keeps kind/id/back', () => {
  const html = renderToStaticMarkup(
    React.createElement(NotFound, {
      kind: 'flow', id: 'release-refine', backHref: '/flows', backLabel: 'Flows', variant: 'retired',
      detail: 'Its runs are still on disk — open one from a flow HISTORY ledger.',
    }),
  );
  expect(html).toContain('data-not-found-variant="retired"');
  expect(html).toMatch(/retired/i);
  expect(html).toContain('release-refine');
  expect(html).toContain('Its runs are still on disk');
  expect(html).toMatch(/data-action="not-found-back"[^>]*href="\/flows"/);
});

test('NotFound: variant="unselected" (no id at all) — never claims an id that was not given', () => {
  const html = renderToStaticMarkup(
    React.createElement(NotFound, { kind: 'run', id: '', backHref: '/flows', backLabel: 'Flows', variant: 'unselected' }),
  );
  expect(html).toContain('data-not-found-variant="unselected"');
  expect(html).toContain('data-not-found-id=""');
  expect(html).toMatch(/No run selected/);
  expect(html).not.toMatch(/No run "/);
});
