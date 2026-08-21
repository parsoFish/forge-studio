/**
 * W7-C3 (crosscut-19) — the ONE shared Breadcrumbs component.
 *
 * Before this, the deepest pages (project, flow monitor, agent builder, run,
 * KB) had neither a breadcrumb nor a back link, and where a trail existed it
 * was an unlabelled `<div>` (three ad-hoc patterns across two shells).
 * `components/Breadcrumbs.tsx` is the single semantic trail:
 *
 *   <nav aria-label="Breadcrumb" data-component="breadcrumbs">
 *     <ol><li><a …>parent</a></li>…<li aria-current="page">leaf</li></ol>
 *   </nav>
 *
 * Renders the REAL component via react-dom/server (renderToStaticMarkup) —
 * the run-panel-render.test.ts precedent, no new dependency.
 *
 * RUN: cd forge-ui && npx vitest run lib/breadcrumbs-render.test.ts
 */
import { test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumbs } from '../components/Breadcrumbs';

const html = renderToStaticMarkup(
  createElement(Breadcrumbs, {
    items: [
      { label: 'Projects', href: '/projects' },
      { label: 'gitpulse', href: '/projects/gitpulse' },
      { label: 'Showcase' },
    ],
  }),
);

test('semantic trail: labelled <nav> wrapping an ordered list', () => {
  expect(html).toMatch(/<nav[^>]*aria-label="Breadcrumb"/);
  expect(html).toMatch(/data-component="breadcrumbs"/);
  expect(html).toMatch(/<ol/);
  expect(html.match(/<li/g)?.length).toBe(3);
});

test('parents are links; the current page is aria-current text, never a link', () => {
  expect(html).toMatch(/<a[^>]*href="\/projects"[^>]*>Projects<\/a>/);
  expect(html).toMatch(/<a[^>]*href="\/projects\/gitpulse"[^>]*>gitpulse<\/a>/);
  expect(html).toMatch(/aria-current="page"/);
  expect(html).not.toMatch(/<a[^>]*>Showcase<\/a>/);
});

test('an items list with a single entry still renders a valid trail', () => {
  const single = renderToStaticMarkup(createElement(Breadcrumbs, { items: [{ label: 'Flows' }] }));
  expect(single).toMatch(/aria-current="page"/);
  expect(single.match(/<li/g)?.length).toBe(1);
});
