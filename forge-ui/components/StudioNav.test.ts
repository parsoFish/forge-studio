/**
 * Acceptance tests for the six-pillar Studio nav (R6-03-F3).
 *
 * Immutable-gate, RED-first: pins the nav contract BEFORE the 5->6 change.
 * Which wrong implementation each assertion kills is named inline.
 *
 * `StudioNav` calls `usePathname()` (next/navigation). Under
 * `renderToStaticMarkup` there is no app-router provider, so the render test
 * mocks it. The data-contract assertions import the exported `NAV_ITEMS`
 * directly — no render, no router — so the pillar set/order/hrefs are pinned
 * as a plain value, not scraped from markup.
 *
 * RUN: npx vitest run components/StudioNav.test.ts   (from forge-ui/)
 */

import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/library',
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioNav, NAV_ITEMS } from './StudioNav';

// ── data contract (kills: "still 5 pillars", "no Home", "Library still on /") ──

test('NAV_ITEMS is exactly the six pillars, in order', () => {
  // Kills a 5-item nav and any reordering.
  expect(NAV_ITEMS.map((i) => i.id)).toEqual([
    'home', 'flows', 'agents', 'projects', 'library', 'knowledge',
  ]);
});

test('Home is the first pillar and points at /', () => {
  // Kills: no Home pillar, or Home pointing anywhere but the freed root slot.
  const home = NAV_ITEMS.find((i) => i.id === 'home');
  expect(home).toBeDefined();
  expect(home?.href).toBe('/');
  expect(NAV_ITEMS[0].id).toBe('home');
});

test('Library has moved OFF / onto its own pillar route', () => {
  // Kills the as-built defect this initiative removes: Library squatting `/`.
  const library = NAV_ITEMS.find((i) => i.id === 'library');
  expect(library).toBeDefined();
  expect(library?.href).toBe('/library');
  expect(library?.href).not.toBe('/');
});

test('only Home owns the root slot (no two pillars share /)', () => {
  // Kills a half-migration where both Home and Library resolve to `/`.
  const rootOwners = NAV_ITEMS.filter((i) => i.href === '/');
  expect(rootOwners.map((i) => i.id)).toEqual(['home']);
});

// ── render contract (kills: item exists in data but never rendered) ──

test('renders six nav links with their data-nav ids and hrefs', () => {
  const html = renderToStaticMarkup(React.createElement(StudioNav));
  for (const item of NAV_ITEMS) {
    expect(html).toContain(`data-nav="${item.id}"`);
  }
  // Library link carries the moved href in the actual rendered markup, not
  // just the data value.
  expect(html).toMatch(/href="\/library"[^>]*data-nav="library"|data-nav="library"[^>]*href="\/library"/);
  // Home link carries the root href.
  expect(html).toMatch(/href="\/"[^>]*data-nav="home"|data-nav="home"[^>]*href="\/"/);
});
