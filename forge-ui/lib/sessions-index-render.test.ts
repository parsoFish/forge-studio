/**
 * Acceptance tests — the /sessions in-flight index (W6-B11).
 *
 * `components/studio/SessionsIndex.tsx`'s `SessionsIndexBody` — a pure,
 * props-driven presentational component (no fetch, no `useEffect`) — is
 * rendered via `react-dom/server`'s `renderToStaticMarkup`, mirroring
 * `./projects-index-render.test.ts`'s own precedent exactly (same
 * `next/navigation` mock rationale — `StudioPage` always renders
 * `StudioNav`, which calls `usePathname()`, `null` outside a mounted
 * Next.js app router — see that file's header for the full explanation).
 *
 * RUN: npx vitest run lib/sessions-index-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  usePathname: () => '/sessions',
}));

import { SessionsIndexBody } from '@/components/studio/SessionsIndex';
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

// ---- data-page attr — always present, whether or not the first fetch has
// ---- settled (the loading state must still identify the route). ----------

test('data-page="sessions-index" is present before the first fetch settles (ready=false)', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: false }));
  expect(html).toContain('data-page="sessions-index"');
});

test('data-page="sessions-index" is present once ready, alongside data-page-ready="true" and the real session count', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-page="sessions-index"');
  expect(html).toContain('data-page-ready="true"');
  expect(html).toContain('data-session-count="1"');
});

// ---- table rows — every session gets its own row, carrying the DOM ------
// ---- contract data-session-kind / data-session-phase / data-needs-you. ---

test('every session renders its own table row with data-session-kind, data-session-phase, and data-needs-you', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 's1', phase: 'awaiting-verdict', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 's2', phase: 'generating', needsYou: false }),
  ];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-section="sessions-table"');
  expect(html).toContain('data-session-kind="instructions"');
  expect(html).toContain('data-session-phase="awaiting-verdict"');
  expect(html).toContain('data-needs-you="true"');
  expect(html).toContain('data-session-kind="demo"');
  expect(html).toContain('data-session-phase="generating"');
  expect(html).toContain('data-needs-you="false"');
  expect((html.match(/data-session-kind=/g) ?? []).length).toBe(2);
});

test('renders the sessions in the order given (the bridge already returns needs-you-first-then-updated — this component never re-sorts)', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 'first', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 'second', needsYou: false }),
  ];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  const firstIdx = html.indexOf('data-session-kind="instructions"');
  const secondIdx = html.indexOf('data-session-kind="demo"');
  expect(firstIdx).toBeGreaterThan(-1);
  expect(secondIdx).toBeGreaterThan(firstIdx);
});

test('a row carries its own real href for the "Resume" link', () => {
  const sessions = [makeRow({ kind: 'kb-cleanup', sessionId: '2026-08-15T10-00-00', project: 'gitpulse' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('href="/sessions/kb-cleanup/2026-08-15T10-00-00?project=gitpulse"');
  expect(html).toContain('data-action="resume-session"');
});

test('modelTier renders when present, and an honest placeholder when null (never a fabricated tier)', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 's1', modelTier: 'opus' }),
    makeRow({ kind: 'demo', sessionId: 's2', modelTier: null }),
  ];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('opus');
  expect(html).toContain('—'); // the null-modelTier placeholder
});

// ---- zero-state: honest, never terminal, always the kickoff CTAs ---------

test('zero-state (ready, no sessions): renders "No sessions in flight" plus kickoff CTAs for ALL six generic kickoff kinds + architect (W7-B1 home-sessions-19: community-refresh included)', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: true }));
  expect(html).toContain('data-section="sessions-empty"');
  expect(html).toContain('No sessions in flight');
  expect(html).toContain('href="/architect/new"');
  expect(html).toContain('href="/sessions/instructions/new"');
  expect(html).toContain('href="/sessions/demo/new"');
  expect(html).toContain('href="/sessions/project-brain/new"');
  expect(html).toContain('href="/sessions/kb-cleanup/new"');
  expect(html).toContain('href="/sessions/authoring/new"');
  expect(html).toContain('href="/sessions/community-refresh/new"');
  // A real session set must never ALSO render the zero-state dead end.
  expect(html).not.toContain('data-section="sessions-table"');
});

test('loading (not ready) + no sessions yet does NOT show the zero-state — avoids a false "no sessions" flash before the first fetch resolves', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: false }));
  expect(html).not.toContain('data-section="sessions-empty"');
});

// ---- W7-A1 (home-sessions-29): a FAILED fetch renders the shared failure ---
// ---- state, never the "No sessions in flight" zero-state. -----------------

test('W7-A1: error → data-fetch-status="error" on the root, [data-component="fetch-error"] with the bridge text + retry, and NO sessions-empty section (never "nothing is waiting on you")', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, {
    sessions: [], ready: true, error: { message: 'bridge unreachable (Failed to fetch)' }, onRetry: () => {},
  }));
  expect(html).toContain('data-page="sessions-index"');
  expect(html).toContain('data-page-ready="true"');
  expect(html).toContain('data-fetch-status="error"');
  expect(html).toContain('data-component="fetch-error"');
  expect(html).toContain('bridge unreachable (Failed to fetch)');
  expect(html).toContain('data-action="retry-fetch"');
  expect(html).not.toContain('data-section="sessions-empty"');
  expect(html).not.toContain('Nothing is waiting on you');
  expect(html).not.toContain('data-section="sessions-table"');
});

test('W7-A1: a reachable-bridge failure (status 500) frames "refused" with the HTTP status, never "could not reach"', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, {
    sessions: [], ready: true, error: { message: 'boom', status: 500 },
  }));
  expect(html).toContain('data-fetch-http-status="500"');
  expect(html).toContain('refused to read sessions');
  expect(html).not.toContain('Could not reach');
});

test('W7-A1: data-fetch-status="loading" before the first fetch settles, "ok" once it settles without error', () => {
  expect(renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: false }))).toContain('data-fetch-status="loading"');
  expect(renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: true }))).toContain('data-fetch-status="ok"');
});

test('W7-A1: error AFTER a successful read (rows already known) keeps the last-known table visible UNDER the failure state — real data is not hidden, and the zero-state still never renders', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, {
    sessions, ready: true, error: { message: 'bridge unreachable (Failed to fetch)' },
  }));
  expect(html).toContain('data-fetch-status="error"');
  expect(html).toContain('data-component="fetch-error"');
  expect(html).toContain('data-section="sessions-table"');
  expect(html).toContain('data-session-count="1"');
  expect(html).not.toContain('data-section="sessions-empty"');
});

// ===========================================================================
// W7-B1 — Home + /sessions IA (docs/roadmaps/wave-7-walkthrough-findings.md)
// ===========================================================================

// ---- crosscut-13: the kickoff CTAs render with rows PRESENT too — the ----
// ---- normal steady state must never lose the only way to start one. ------

test('W7-B1 (crosscut-13): the kickoff section renders in the POPULATED state — all seven entries, alongside the table', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-section="sessions-table"');
  expect(html).toContain('data-section="sessions-kickoff"');
  expect(html).toContain('data-action="kickoff-architect"');
  expect(html).toContain('data-action="kickoff-instructions"');
  expect(html).toContain('data-action="kickoff-demo"');
  expect(html).toContain('data-action="kickoff-project-brain"');
  expect(html).toContain('data-action="kickoff-kb-cleanup"');
  expect(html).toContain('data-action="kickoff-authoring"');
  expect(html).toContain('data-action="kickoff-community-refresh"');
});

// ---- home-sessions-20 / community-21: the Kind cell is the descriptor's ---
// ---- own authored title, and it links into the session (row-level target).

test('W7-B1 (home-sessions-20/community-21): the Kind cell renders the descriptor title ("KB cleanup session", never capitalize-mangled "Kb-Cleanup") and links to the session', () => {
  const sessions = [makeRow({ kind: 'kb-cleanup', sessionId: 's1', project: 'gitpulse' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('KB cleanup session');
  expect(html).toContain('data-action="open-session"');
  // The raw registry id still rides the DOM contract untouched.
  expect(html).toContain('data-session-kind="kb-cleanup"');
  // The old capitalize-the-id treatment is gone.
  expect(html).not.toContain('text-transform:capitalize');
});

test('W7-B1 (community-21): a community-refresh row reads "Community refresh session" — the declared title, same as the session page', () => {
  const sessions = [makeRow({ kind: 'community-refresh', sessionId: 's1', project: '.community-registry' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('Community refresh session');
});

// ---- home-sessions-03/-24, community-24: the needs-you signal is a --------
// ---- labelled chip with its OWN status token — never "retrying", never ----
// ---- colour-only. ---------------------------------------------------------

test('W7-B1 (home-sessions-03/24, community-24): needs-you renders a text chip with aria-label and data-status="needs-you" — no "retrying" anywhere on an index of waiting sessions', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1', needsYou: true, state: 'awaiting-operator', phase: 'awaiting-verdict' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-needs-you-chip');
  expect(html).toContain('aria-label="needs you"');
  expect(html).toContain('needs you');
  expect(html).toContain('data-status="needs-you"');
  expect(html).not.toContain('data-status="retrying"');
});

test('W7-B1: a row that does NOT need the operator renders no needs-you chip', () => {
  const sessions = [makeRow({ kind: 'demo', sessionId: 's1', needsYou: false })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).not.toContain('data-needs-you-chip');
  expect(html).not.toContain('data-status="needs-you"');
});

// ---- home-sessions-07: the filter bar --------------------------------------

test('W7-B1 (home-sessions-07): the filter bar renders with kind/project/state selects + a needs-you toggle, offering only values present in the set', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 's1', project: 'gitpulse', needsYou: true, state: 'awaiting-operator' }),
    makeRow({ kind: 'kb-cleanup', sessionId: 's2', project: '.kb-cycles', state: 'crashed', error: 'boom' }),
  ];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-section="sessions-filters"');
  expect(html).toContain('data-field="filter-kind"');
  expect(html).toContain('data-field="filter-project"');
  expect(html).toContain('data-field="filter-state"');
  expect(html).toContain('data-action="filter-needs-you"');
  // Kind options are labelled by the descriptor title.
  expect(html).toContain('Instructions session');
  expect(html).toContain('KB cleanup session');
  // State options come from the rows' own bridge-derived states.
  expect(html).toContain('value="crashed"');
  expect(html).toContain('value="awaiting-operator"');
});

test('W7-B1: the table section carries the current filter state as data-filter-* attributes (all-empty by default) and the FILTERED count', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1' })];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-filter-kind=""');
  expect(html).toContain('data-filter-project=""');
  expect(html).toContain('data-filter-state=""');
  expect(html).toContain('data-filter-needs-you="false"');
});

test('W7-B1: the filter bar does not render in the zero-state (nothing to filter) or the error state', () => {
  const empty = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: true }));
  expect(empty).not.toContain('data-section="sessions-filters"');
  const errored = renderToStaticMarkup(React.createElement(SessionsIndexBody, {
    sessions: [], ready: true, error: { message: 'bridge unreachable (Failed to fetch)' },
  }));
  expect(errored).not.toContain('data-section="sessions-filters"');
});

// ---- error + zero rows: the kickoff section stays out of the failure view -

test('W7-B1: a failed read with no rows renders neither table, zero-state, nor kickoff row — the failure state is the whole body (A1 discipline preserved)', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, {
    sessions: [], ready: true, error: { message: 'bridge unreachable (Failed to fetch)' },
  }));
  expect(html).not.toContain('data-section="sessions-kickoff"');
  expect(html).not.toContain('data-section="sessions-table"');
  expect(html).not.toContain('data-section="sessions-empty"');
});
