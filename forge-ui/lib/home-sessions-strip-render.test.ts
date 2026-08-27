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
    state: 'working',
    // `error`/`idleMs` are REQUIRED on SessionIndexRow (W7-A2); a
    // `Partial<SessionIndexRow>` spread cannot satisfy a required field, so
    // the base fixture carries the honest not-crashed / no-log-dir defaults.
    error: null,
    idleMs: null,
    modelTier: null,
    updatedAt: '2026-08-15T10:00:00.000Z',
    href: `/sessions/${overrides.kind}/${overrides.sessionId}?project=${project}`,
    ...overrides,
  };
}

function render(strip: HomeSessionsStripData): string {
  return renderToStaticMarkup(React.createElement(HomeSessionsStrip, { strip }));
}

// ---- zero-state (W7-B1, home-sessions-31): the strip is Home's ONLY link --
// ---- to /sessions — navigation must survive an empty data set. ------------

test('W7-B1 (home-sessions-31): totalCount === 0 keeps the section, the header, and the "all sessions" link — an honest empty line, never a vanished route', () => {
  const html = render(buildHomeSessionsStrip([]));
  expect(html).toContain('data-section="sessions-needing-you"');
  expect(html).toContain('data-active-session-count="0"');
  expect(html).toContain('data-action="view-all-sessions"');
  expect(html).toContain('href="/sessions"');
  expect(html).toContain('data-component="sessions-strip-empty"');
  expect(html).toContain('data-action="start-a-session"');
  // But no fabricated cards. (`data-session-card=`, with the `=`, so the
  // section's own `data-session-cards-shown` attribute can't collide.)
  expect(html).not.toContain('data-session-card=');
});

// ---- section + counts -----------------------------------------------------

test('a non-empty strip renders section[data-section="sessions-needing-you"] carrying data-active-session-count and data-needs-you-count (W7-B1 named-strip contract)', () => {
  const sessions = [
    makeRow({ kind: 'instructions', sessionId: 's1', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 's2', needsYou: false }),
  ];
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-section="sessions-needing-you"');
  expect(html).toContain('data-active-session-count="2"');
  expect(html).toContain('data-needs-you-count="1"');
  // W7-B1 (home-sessions-01/02): the strip is NAMED on screen, not just in
  // the DOM contract. W8-F4: the name is "Active sessions" — this fixture is
  // exactly why. Two sessions are listed and only ONE needs the operator, so
  // a heading reading "Sessions needing you" would describe the chip, not the
  // list. The needs-you subset stays visible as its own count.
  expect(html).toContain('Active sessions');
  expect(html).not.toContain('Sessions needing you');
  expect(html).toContain('1 need you');
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

// ===========================================================================
// W7-B1 — Home strip IA (docs/roadmaps/wave-7-walkthrough-findings.md)
// ===========================================================================

test('W7-B1 (home-sessions-32): a truncated strip SAYS so — "showing 4 of 7" + a "+3 more" overflow link, so the header count and the visible cards reconcile on screen', () => {
  const sessions = Array.from({ length: 7 }, (_, i) => makeRow({ kind: 'instructions', sessionId: `s${i}`, needsYou: true }));
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-session-cards-shown="4"');
  expect(html).toContain('showing 4 of 7');
  expect(html).toContain('+3 more');
});

test('W7-B1 (home-sessions-32): an untruncated strip renders no "showing"/"+N more" noise', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1' })];
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-session-cards-shown="1"');
  expect(html).not.toContain('showing 1 of 1');
  expect(html).not.toContain('more');
});

test('W7-B1 (home-sessions-20 on Home): a card names its kind by the descriptor title ("KB cleanup session"), with the raw id intact on data-session-kind', () => {
  const sessions = [makeRow({ kind: 'kb-cleanup', sessionId: 's1' })];
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('KB cleanup session');
  expect(html).toContain('data-session-kind="kb-cleanup"');
});

test('W7-B1 (home-sessions-03): a needs-you card renders the labelled chip with its OWN status token — no data-status="retrying" anywhere', () => {
  const sessions = [makeRow({ kind: 'instructions', sessionId: 's1', needsYou: true, state: 'awaiting-operator' })];
  const html = render(buildHomeSessionsStrip(sessions));
  expect(html).toContain('data-needs-you-chip');
  expect(html).toContain('aria-label="needs you"');
  expect(html).toContain('data-status="needs-you"');
  expect(html).not.toContain('data-status="retrying"');
});

test('review round 1 — an UNSETTLED zero (ready=false) renders a loading line, never the settled "Nothing in flight" claim or a start CTA', () => {
  const html = renderToStaticMarkup(React.createElement(HomeSessionsStrip, { strip: buildHomeSessionsStrip([]), ready: false }));
  expect(html).toContain('data-section="sessions-needing-you"');
  expect(html).toContain('data-component="sessions-strip-loading"');
  expect(html).toContain('Loading sessions');
  expect(html).not.toContain('Nothing in flight');
  expect(html).not.toContain('data-action="start-a-session"');
  // The navigation link survives loading too.
  expect(html).toContain('data-action="view-all-sessions"');
});
