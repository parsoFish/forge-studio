/**
 * Acceptance tests — Home's active-sessions strip (W6-B11, review fix).
 *
 * `components/studio/HomeSessionsStrip.tsx`'s `HomeSessionsStrip` — a pure,
 * props-driven presentational component (no fetch, no `useEffect`, no
 * `StudioNav`/`next/navigation` dependency) — is rendered via
 * `react-dom/server`'s `renderToStaticMarkup`, mirroring
 * `./sessions-index-render.test.ts`'s own precedent. Unlike
 * `SessionsIndexBody` this component does NOT wrap `StudioPage`, so no
 * `next/navigation` mock is needed — only `next/link`'s `Link`, which
 * renders unmocked (same precedent `./library-card-render.test.ts` and
 * `./sessions-index-render.test.ts` both already establish).
 *
 * RUN: npx vitest run lib/home-sessions-strip-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HomeSessionsStrip } from '@/components/studio/HomeSessionsStrip';
import { buildHomeSessionsStrip, type HomeSessionsStrip as HomeSessionsStripData } from './home-view.ts';
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

function render(strip: HomeSessionsStripData): string {
  return renderToStaticMarkup(React.createElement(HomeSessionsStrip, { strip }));
}

// ---- zero-state: renders NOTHING (never an empty section shell) ----------

test('totalCount === 0 renders nothing at all — no section, no shell, never a fabricated empty state', () => {
  const html = render(buildHomeSessionsStrip([]));
  expect(html).toBe('');
});

// ---- section + counts -----------------------------------------------------

test('a non-empty strip renders section[data-section="active-sessions"] carrying data-active-session-count and data-needs-you-count', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 's1', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 's2', needsYou: false }),
  ];
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-section="active-sessions"');
  expect(html).toContain('data-active-session-count="2"');
  expect(html).toContain('data-needs-you-count="1"');
});

test('needsYouCount counts ALL needs-you sessions, not just the ones inside the 4-card budget', () => {
  const sessions = Array.from({ length: 5 }, (_, i) => makeRow({ kind: 'instructions', sessionId: `s${i}`, needsYou: true }));
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-active-session-count="5"');
  expect(html).toContain('data-needs-you-count="5"');
  // Only 4 cards actually render (the strip's own card budget).
  expect((html.match(/data-session-kind="instructions"/g) ?? []).length).toBe(4);
});

test('the "N need you" pill renders only when needsYouCount > 0', () => {
  const withNeedsYou = render(buildHomeSessionsStrip([makeRow({ kind: 'instructions', sessionId: 's1', needsYou: true })]));
  expect(withNeedsYou).toContain('need you');

  const withoutNeedsYou = render(buildHomeSessionsStrip([makeRow({ kind: 'instructions', sessionId: 's1', needsYou: false })]));
  expect(withoutNeedsYou).not.toContain('need you');
});

test('the overflow link is a real anchor carrying data-action="view-all-sessions" and href="/sessions", labelled with the real total count', () => {
  const sessions = Array.from({ length: 6 }, (_, i) => makeRow({ kind: 'instructions', sessionId: `s${i}` }));
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-action="view-all-sessions"');
  expect(html).toContain('href="/sessions"');
  expect(html).toContain('all sessions (6)');
});

// ---- cards ------------------------------------------------------------

test('every card carries data-session-kind/data-session-phase/data-needs-you and links to its own real href', () => {
  const sessions = [makeRow({ kind: 'kb-cleanup', sessionId: '2026-08-15T10-00-00', project: 'gitpulse', phase: 'awaiting-approval', needsYou: true })];
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-session-kind="kb-cleanup"');
  expect(html).toContain('data-session-phase="awaiting-approval"');
  expect(html).toContain('data-needs-you="true"');
  expect(html).toContain('href="/sessions/kb-cleanup/2026-08-15T10-00-00?project=gitpulse"');
});

test('cards render in the order given (already needs-you-first-then-newest off the bridge) — never re-sorted here', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 'first', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 'second', needsYou: false }),
  ];
  const html = render(buildHomeSessionsStrip(sessions));
  const firstIdx = html.indexOf('data-session-kind="instructions"');
  const secondIdx = html.indexOf('data-session-kind="demo"');
  expect(firstIdx).toBeGreaterThan(-1);
  expect(secondIdx).toBeGreaterThan(firstIdx);
});

test('the card budget caps at 4 even when more sessions are in flight', () => {
  const sessions = Array.from({ length: 7 }, (_, i) => makeRow({ kind: 'instructions', sessionId: `s${i}` }));
  const html = render(buildHomeSessionsStrip(sessions));
  expect((html.match(/data-session-kind="instructions"/g) ?? []).length).toBe(4);
});
