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

test('zero-state (ready, no sessions): renders "No sessions in flight" plus kickoff CTAs for the 5 kickoff kinds + architect', () => {
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions: [], ready: true }));
  expect(html).toContain('data-section="sessions-empty"');
  expect(html).toContain('No sessions in flight');
  expect(html).toContain('href="/architect/new"');
  expect(html).toContain('href="/sessions/instructions/new"');
  expect(html).toContain('href="/sessions/demo/new"');
  expect(html).toContain('href="/sessions/project-brain/new"');
  expect(html).toContain('href="/sessions/kb-cleanup/new"');
  expect(html).toContain('href="/sessions/authoring/new"');
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
