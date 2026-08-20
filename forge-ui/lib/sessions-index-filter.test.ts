/**
 * Pinned tests — W7-B1 (home-sessions-07): pure filter derivation for the
 * `/sessions` index. See `./sessions-index-filter.ts`'s header.
 *
 * RUN: npx vitest run lib/sessions-index-filter.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';

import {
  NO_SESSION_FILTERS,
  hasActiveSessionFilters,
  filterSessionRows,
  filterOptions,
  distinctSessionKinds,
  distinctSessionProjects,
  distinctSessionStates,
} from './sessions-index-filter.ts';
import type { SessionIndexRow } from './studio-client.ts';

function makeRow(overrides: Partial<SessionIndexRow> & { kind: string; sessionId: string }): SessionIndexRow {
  const project = overrides.project ?? 'p';
  return {
    project,
    phase: 'drafting',
    terminal: false,
    needsYou: false,
    state: 'working',
    error: null,
    idleMs: null,
    modelTier: null,
    updatedAt: '2026-08-15T10:00:00.000Z',
    href: `/sessions/${overrides.kind}/${overrides.sessionId}?project=${project}`,
    ...overrides,
  };
}

const ROWS: SessionIndexRow[] = [
  makeRow({ kind: 'instructions', sessionId: 's1', project: 'gitpulse', needsYou: true, state: 'awaiting-operator' }),
  makeRow({ kind: 'demo', sessionId: 's2', project: 'gitpulse', state: 'working' }),
  makeRow({ kind: 'kb-cleanup', sessionId: 's3', project: '.kb-cycles', state: 'crashed', needsYou: true, error: 'boom' }),
  makeRow({ kind: 'instructions', sessionId: 's4', project: 'trafficGame', state: 'stalled', needsYou: true, idleMs: 900000 }),
];

test('NO_SESSION_FILTERS passes every row through unchanged, in the order given', () => {
  const out = filterSessionRows(ROWS, NO_SESSION_FILTERS);
  expect(out.map((r) => r.sessionId)).toEqual(['s1', 's2', 's3', 's4']);
  expect(hasActiveSessionFilters(NO_SESSION_FILTERS)).toBe(false);
});

test('kind filter keeps only that kind, preserving order', () => {
  const out = filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, kind: 'instructions' });
  expect(out.map((r) => r.sessionId)).toEqual(['s1', 's4']);
});

test('project filter matches the anchor verbatim — pseudo-anchors (.kb-<id>) included', () => {
  expect(filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, project: 'gitpulse' }).map((r) => r.sessionId)).toEqual(['s1', 's2']);
  expect(filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, project: '.kb-cycles' }).map((r) => r.sessionId)).toEqual(['s3']);
});

test('state filter covers crashed and stalled (the goal-pack-named states), matching the bridge-derived state verbatim', () => {
  expect(filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, state: 'crashed' }).map((r) => r.sessionId)).toEqual(['s3']);
  expect(filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, state: 'stalled' }).map((r) => r.sessionId)).toEqual(['s4']);
  expect(filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, state: 'working' }).map((r) => r.sessionId)).toEqual(['s2']);
});

test('needsYouOnly keeps only rows whose bridge-derived needsYou is true — never re-derived client-side', () => {
  const out = filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, needsYouOnly: true });
  expect(out.map((r) => r.sessionId)).toEqual(['s1', 's3', 's4']);
});

test('filters compose (AND semantics)', () => {
  const out = filterSessionRows(ROWS, { kind: 'instructions', project: 'trafficGame', state: 'stalled', needsYouOnly: true });
  expect(out.map((r) => r.sessionId)).toEqual(['s4']);
  expect(hasActiveSessionFilters({ kind: 'instructions', project: '', state: '', needsYouOnly: false })).toBe(true);
});

test('a filter combination matching nothing returns [] — the component renders an honest "no match" line, never the zero-state', () => {
  const out = filterSessionRows(ROWS, { ...NO_SESSION_FILTERS, kind: 'demo', needsYouOnly: true });
  expect(out).toEqual([]);
});

test('distinct* helpers return present values only, first-seen order, no duplicates', () => {
  expect(distinctSessionKinds(ROWS)).toEqual(['instructions', 'demo', 'kb-cleanup']);
  expect(distinctSessionProjects(ROWS)).toEqual(['gitpulse', '.kb-cycles', 'trafficGame']);
  expect(distinctSessionStates(ROWS)).toEqual(['awaiting-operator', 'working', 'crashed', 'stalled']);
});

test('review round 1 — filterOptions keeps an ACTIVE value that vanished from the live set (a controlled select must always show the constraint it is applying)', () => {
  expect(filterOptions(['instructions', 'kb-cleanup'], 'demo')).toEqual(['instructions', 'kb-cleanup', 'demo']);
  // Present or empty active values change nothing.
  expect(filterOptions(['instructions', 'demo'], 'demo')).toEqual(['instructions', 'demo']);
  expect(filterOptions(['instructions'], '')).toEqual(['instructions']);
});
