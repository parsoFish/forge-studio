/**
 * Acceptance tests for the six-pillar Studio nav (R6-03-F3 → W6-IA-5 repoint).
 *
 * Immutable-gate, RED-first: pins the nav contract BEFORE the repoint change.
 * Which wrong implementation each assertion kills is named inline.
 *
 * `StudioNav` calls `usePathname()` (next/navigation). Under
 * `renderToStaticMarkup` there is no app-router provider, so the render test
 * mocks it. The data-contract assertions import the exported `NAV_ITEMS`
 * directly — no render, no router — so the pillar set/order/hrefs are pinned
 * as a plain value, not scraped from markup. The active-state assertions
 * import the exported `isNavItemActive(pathname, id)` pure function directly
 * — no render, no mock — so every prefix rule is pinned as a plain value too.
 *
 * RUN: npx vitest run components/StudioNav.test.ts   (from forge-ui/)
 */

import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/library',
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioNav, NAV_ITEMS, isNavItemActive } from './StudioNav';

// ── data contract (kills: wrong pillar count, wrong order, stale hrefs) ──

test('NAV_ITEMS is exactly the six pillars, in the operator-locked order', () => {
  // Kills a 5-item nav, a reorder, or a leftover deep-link href.
  expect(NAV_ITEMS.map((i) => i.id)).toEqual([
    'home', 'projects', 'flows', 'agents', 'library', 'knowledge',
  ]);
  expect(NAV_ITEMS.map((i) => i.href)).toEqual([
    '/', '/projects', '/flows', '/agents', '/library', '/knowledge',
  ]);
});

test('Home is the first pillar and points at /', () => {
  // Kills: no Home pillar, or Home pointing anywhere but the root slot.
  const home = NAV_ITEMS.find((i) => i.id === 'home');
  expect(home).toBeDefined();
  expect(home?.href).toBe('/');
  expect(NAV_ITEMS[0].id).toBe('home');
});

test('Flows and Agents point at their own index pages, not a deep-link', () => {
  // Kills: Flows still pointing at /flows/forge-develop, Agents still
  // pointing at /agents/new (both pre-IA-5 deep-links into a specific build
  // surface rather than the pillar's own browse index).
  expect(NAV_ITEMS.find((i) => i.id === 'flows')?.href).toBe('/flows');
  expect(NAV_ITEMS.find((i) => i.id === 'agents')?.href).toBe('/agents');
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
  // Flows/Agents links carry their own index hrefs, not the retired deep-links.
  expect(html).toMatch(/href="\/flows"[^>]*data-nav="flows"|data-nav="flows"[^>]*href="\/flows"/);
  expect(html).toMatch(/href="\/agents"[^>]*data-nav="agents"|data-nav="agents"[^>]*href="\/agents"/);
});

// ── active-state contract (kills: per-id special cases that don't
// generalize, missing library-island prefixes, sessions/architect lighting
// a pillar they shouldn't) ──
//
// Table-driven: for each pathname, exactly the named pillar (or none) is
// active. Every OTHER pillar must be inactive for that same pathname — this
// catches a rule that's too greedy (e.g. a bare `.startsWith()` with no
// boundary check) as readily as one that's too narrow.

const ACTIVE_CASES: Array<{ pathname: string; active: string | null }> = [
  { pathname: '/', active: 'home' },

  { pathname: '/projects', active: 'projects' },
  { pathname: '/projects/mdtoc', active: 'projects' },

  { pathname: '/flows', active: 'flows' },
  { pathname: '/flows/forge-develop', active: 'flows' },
  { pathname: '/flows/forge-develop/run/abc-123', active: 'flows' },
  { pathname: '/flows/new', active: 'flows' },

  { pathname: '/agents', active: 'agents' },
  { pathname: '/agents/new', active: 'agents' },
  { pathname: '/agents/developer-ralph', active: 'agents' },
  { pathname: '/agents/developer-ralph/run/abc-123', active: 'agents' },

  { pathname: '/knowledge', active: 'knowledge' },
  { pathname: '/knowledge/new', active: 'knowledge' },

  // Library owns its own route AND the five-shelf "library island" —
  // skills/hooks/connections/templates/community are library sub-kinds, not
  // separate pillars.
  { pathname: '/library', active: 'library' },
  { pathname: '/library/anything', active: 'library' },
  { pathname: '/skills', active: 'library' },
  { pathname: '/skills/new', active: 'library' },
  { pathname: '/skills/brain-query', active: 'library' },
  { pathname: '/hooks', active: 'library' },
  { pathname: '/hooks/pre-pr-security-review', active: 'library' },
  { pathname: '/connections', active: 'library' },
  { pathname: '/connections/git', active: 'library' },
  { pathname: '/templates', active: 'library' },
  { pathname: '/templates/plan', active: 'library' },
  { pathname: '/community', active: 'library' },
  { pathname: '/community/skill/dependency-diff-review', active: 'library' },

  // Session-shell routes light NO pillar — they're reached from within a
  // page (e.g. a "start development" trigger), not the top nav. Current
  // /architect behavior (no pillar lights) is preserved, not changed.
  { pathname: '/architect/new', active: null },
  { pathname: '/architect/some-session-id', active: null },
  { pathname: '/sessions/some-session-id', active: null },
  { pathname: '/project-brain/some-session-id', active: null },
  { pathname: '/instructions/some-session-id', active: null },
  { pathname: '/demo/some-session-id', active: null },

  // /artifact lights no pillar.
  { pathname: '/artifact', active: null },
];

test.each(ACTIVE_CASES)('isNavItemActive: $pathname → $active', ({ pathname, active }) => {
  for (const item of NAV_ITEMS) {
    expect(isNavItemActive(pathname, item.id)).toBe(item.id === active);
  }
});

test('prefix matching respects path boundaries (no substring false positives)', () => {
  // Kills a bare `pathname.startsWith(prefix)` with no boundary check —
  // e.g. "/agentsomething" must not light the "agents" pillar just because
  // it starts with the same characters as "/agents".
  expect(isNavItemActive('/agentsomething', 'agents')).toBe(false);
  expect(isNavItemActive('/projectsfoo', 'projects')).toBe(false);
  expect(isNavItemActive('/librarything', 'library')).toBe(false);
  expect(isNavItemActive('/flowsy', 'flows')).toBe(false);
  expect(isNavItemActive('/knowledgeable', 'knowledge')).toBe(false);
});

test('isNavItemActive returns false for an unknown pillar id', () => {
  expect(isNavItemActive('/library', 'not-a-real-pillar')).toBe(false);
});
