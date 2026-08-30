/**
 * W8-C3 WI-3 — pure filter / sort / search derivation for the `/projects`
 * index (projects-08 / forge-j1e / bead forge-6gv.13.2).
 *
 * RED at branch base (`d17b4251`): the index had no filter, no sort and no
 * search — a static mirror of the bridge's id-order with no operator lever at
 * all. This is the same defect `home-sessions-07` closed for `/sessions` in
 * W7-B1, and this module deliberately mirrors `./sessions-index-filter.ts`'s
 * shape so the two indexes behave identically.
 *
 * Two rules carried over from that precedent, both earned:
 *  · the DEFAULT sort is the SERVER's order, untouched — a filter only removes
 *    rows. Re-sorting by default would silently reorder three live journeys'
 *    expectations and hide the bridge's own ordering contract.
 *  · `filterOptions` keeps an ACTIVE filter value in the option list even after
 *    a refetch removes its last row, so a controlled `<select>` can never
 *    display "all …" while a stale constraint keeps filtering.
 *
 * Every predicate here derives from `./projects-index-health.ts` and
 * `./projects-index-activity.ts` — the SAME functions the cards call. A filter
 * with its own copy of "what broken means" is a second source of truth.
 *
 * RUN: npx vitest run lib/projects-index-filter.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }));

import { ProjectsIndexBody } from '@/components/studio/ProjectsIndex';

import {
  NO_PROJECT_FILTERS,
  applyProjectFilters,
  hasActiveProjectFilters,
  projectNeedsYou,
  filterOptions,
  PROJECT_SORTS,
} from './projects-index-filter.ts';
import type { Project } from './studio-client.ts';
import type { Cycle, ProjectAttentionItem } from './bridge-client.ts';

function p(id: string, over: Partial<Project> = {}): Project {
  return { id, name: id, skills: [], configHealth: { state: 'ok' }, ...over } as Project;
}
function attn(projectId: string, over: Partial<ProjectAttentionItem> = {}): ProjectAttentionItem {
  return { projectId, name: projectId, link: `/projects/${projectId}`, planned: 0, inFlight: 0, gated: 0, merged: 0, flagged: 0, ...over };
}
function cyc(cycleId: string, project: string, startedAt: string, status: Cycle['status'] = 'done'): Cycle {
  return { cycleId, initiativeId: 'INIT', project, startedAt, status };
}

const ROSTER = [
  p('alpha', { name: 'Alpha', northStar: 'ship the thing' }),
  p('bravo', { name: 'Bravo', configHealth: { state: 'invalid', reason: 'flat gate keys' } }),
  p('charlie', { name: 'Charlie', configHealth: { state: 'unconfigured', reason: 'no .forge/project.json' } }),
  p('delta', { name: 'Delta', configHealth: undefined }),
];
const SOURCES = {
  attention: [attn('alpha', { gated: 1 }), attn('bravo'), attn('charlie', { flagged: 2 }), attn('delta')],
  cycles: [cyc('c1', 'alpha', '2026-01-01T00:00:00Z'), cyc('c2', 'bravo', '2026-06-01T00:00:00Z')],
};

const ids = (rows: Project[]) => rows.map((r) => r.id);

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('no filters: every project passes, in the SERVER\'s order, untouched', () => {
  expect(ids(applyProjectFilters(ROSTER, NO_PROJECT_FILTERS, SOURCES))).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
});

test('hasActiveProjectFilters is false for the defaults and true for each single constraint', () => {
  expect(hasActiveProjectFilters(NO_PROJECT_FILTERS)).toBe(false);
  expect(hasActiveProjectFilters({ ...NO_PROJECT_FILTERS, search: 'a' })).toBe(true);
  expect(hasActiveProjectFilters({ ...NO_PROJECT_FILTERS, health: 'broken' })).toBe(true);
  expect(hasActiveProjectFilters({ ...NO_PROJECT_FILTERS, sort: 'name' })).toBe(true);
  expect(hasActiveProjectFilters({ ...NO_PROJECT_FILTERS, needsYouOnly: true })).toBe(true);
});

test('applyProjectFilters never mutates the input roster', () => {
  const snapshot = JSON.stringify(ROSTER);
  applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, sort: 'name', search: 'a' }, SOURCES);
  expect(JSON.stringify(ROSTER)).toBe(snapshot);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test('search matches the project ID, not just the display name — an operator types what the URL shows', () => {
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, search: 'brav' }, SOURCES))).toEqual(['bravo']);
});

test('search matches the display name and the north star, case-insensitively', () => {
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, search: 'ALPHA' }, SOURCES))).toEqual(['alpha']);
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, search: 'ship the' }, SOURCES))).toEqual(['alpha']);
});

test('a whitespace-only search is NOT a constraint — it must not empty the roster', () => {
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, search: '   ' }, SOURCES))).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  expect(hasActiveProjectFilters({ ...NO_PROJECT_FILTERS, search: '   ' })).toBe(false);
});

test('a search matching nothing returns [] — the component renders an honest "no match" line, never the zero-state', () => {
  expect(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, search: 'zzz' }, SOURCES)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Health filter — derived, never a second definition of "broken"
// ---------------------------------------------------------------------------

test('the health filter uses deriveProjectHealth\'s levels verbatim', () => {
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, health: 'broken' }, SOURCES))).toEqual(['bravo']);
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, health: 'attention' }, SOURCES))).toEqual(['charlie']);
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, health: 'unknown' }, SOURCES))).toEqual(['delta']);
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, health: 'healthy' }, SOURCES))).toEqual(['alpha']);
});

// ---------------------------------------------------------------------------
// needs-you
// ---------------------------------------------------------------------------

test('projectNeedsYou is true for a gated initiative, a flagged plan, or a non-healthy contract — and false for a quiet healthy project', () => {
  expect(projectNeedsYou(p('a'), { queue: { planned: 0, inFlight: 0, gated: 1, merged: 0, flagged: 0 }, openCount: 1, progress: null, lastActivityIso: null, projectId: 'a' })).toBe(true);
  expect(projectNeedsYou(p('a'), { queue: { planned: 0, inFlight: 0, gated: 0, merged: 0, flagged: 3 }, openCount: 0, progress: null, lastActivityIso: null, projectId: 'a' })).toBe(true);
  expect(projectNeedsYou(p('a', { configHealth: { state: 'invalid', reason: 'x' } }), { queue: null, openCount: null, progress: null, lastActivityIso: null, projectId: 'a' })).toBe(true);
  expect(projectNeedsYou(p('a'), { queue: { planned: 2, inFlight: 1, gated: 0, merged: 0, flagged: 0 }, openCount: 3, progress: null, lastActivityIso: null, projectId: 'a' })).toBe(false);
});

test('needsYouOnly keeps exactly the projects projectNeedsYou admits', () => {
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, needsYouOnly: true }, SOURCES))).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  const quiet = [p('quiet')];
  expect(applyProjectFilters(quiet, { ...NO_PROJECT_FILTERS, needsYouOnly: true }, { attention: [attn('quiet')], cycles: [] })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

test('the sort vocabulary is exactly server-order / name / activity / health', () => {
  expect([...PROJECT_SORTS]).toEqual(['', 'name', 'activity', 'health']);
});

test('sort=name is A-Z on the DISPLAY name, case-insensitively', () => {
  const rows = [p('z', { name: 'apple' }), p('a', { name: 'Banana' }), p('m', { name: 'cherry' })];
  expect(ids(applyProjectFilters(rows, { ...NO_PROJECT_FILTERS, sort: 'name' }, { attention: [], cycles: [] }))).toEqual(['z', 'a', 'm']);
});

test('sort=activity is most-recent-first, and a project with NO usable activity sorts LAST — never first', () => {
  const rows = [p('none'), p('old'), p('new')];
  const sources = { attention: [], cycles: [cyc('c1', 'old', '2026-01-01T00:00:00Z'), cyc('c2', 'new', '2026-09-01T00:00:00Z')] };
  expect(ids(applyProjectFilters(rows, { ...NO_PROJECT_FILTERS, sort: 'activity' }, sources))).toEqual(['new', 'old', 'none']);
});

test('sort=health is worst-first (broken, attention, unknown, healthy), tie-broken by name so the order is deterministic', () => {
  expect(ids(applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, sort: 'health' }, SOURCES))).toEqual(['bravo', 'charlie', 'delta', 'alpha']);
});

test('sort composes with filter: the filter removes, then the sort orders what is left', () => {
  const out = applyProjectFilters(ROSTER, { ...NO_PROJECT_FILTERS, search: 'a', sort: 'health' }, SOURCES);
  expect(ids(out)).toEqual(['bravo', 'charlie', 'delta', 'alpha']);
});

// ---------------------------------------------------------------------------
// filterOptions — the W7-B1 stale-constraint guard, reused verbatim
// ---------------------------------------------------------------------------

test('filterOptions keeps an ACTIVE value that has vanished from the live set, so the select always shows the constraint it applies', () => {
  expect(filterOptions(['healthy'], 'broken')).toEqual(['healthy', 'broken']);
  expect(filterOptions(['healthy', 'broken'], 'broken')).toEqual(['healthy', 'broken']);
  expect(filterOptions(['healthy'], '')).toEqual(['healthy']);
});

// ---------------------------------------------------------------------------
// Render — the filter bar's DOM contract (journeys drive structured state,
// never scraped text)
// ---------------------------------------------------------------------------

test('the filter bar renders its four controls with a stable data-* contract once there is a roster', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: ROSTER, kbs: [], ready: true, ...SOURCES }));
  expect(html).toContain('data-section="projects-filters"');
  expect(html).toContain('data-field="filter-search"');
  expect(html).toContain('data-field="filter-health"');
  expect(html).toContain('data-field="sort"');
  expect(html).toContain('data-action="filter-needs-you"');
});

test('the filter bar is absent when the roster is empty — nothing to filter', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: [], kbs: [], ready: true }));
  expect(html).not.toContain('data-section="projects-filters"');
});

test('the grid declares the ACTIVE constraints and both counts, so a journey never has to scrape text', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: ROSTER, kbs: [], ready: true, ...SOURCES }));
  expect(html).toContain('data-count="4"');
  expect(html).toContain('data-total="4"');
  expect(html).toContain('data-filter-search=""');
  expect(html).toContain('data-filter-health=""');
  expect(html).toContain('data-sort=""');
  expect(html).toContain('data-filter-needs-you="false"');
});

test('the health-filter options come from the roster that is actually present, never a hardcoded list', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, {
    projects: [p('only', { configHealth: { state: 'ok' } })], kbs: [], ready: true, attention: [], cycles: [],
  }));
  expect(html).toContain('>healthy<');
  expect(html).not.toContain('>broken<');
});

test('the default render is unfiltered and in server order — the pre-existing grid contract is untouched', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: ROSTER, kbs: [], ready: true, ...SOURCES }));
  const order = [...html.matchAll(/data-card-id="([a-z]+)"/g)].map((m) => m[1]);
  expect(order).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
});
