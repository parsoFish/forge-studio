/**
 * W7-B3 render pins for SessionLifecycleBar's crashed state (community-01 /
 * sessions-kinds-32, the operator's stuck community-refresh session
 * 2026-08-18T12-54-32-abdfd26b as the fixture shape):
 *
 *  - a crashed session renders the runner's own error verbatim (A2's
 *    contract, re-pinned here against THIS fixture), and
 *  - offers a "start a new session" way forward — `[data-action=
 *    "start-new-session"]` linking to /sessions/<kind>/new — so the operator
 *    standing in front of a dead refresh is one click from a fresh one
 *    instead of a dead end.
 *
 * `renderToStaticMarkup` over the component (repo render-test convention —
 * no jsdom).
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionLifecycleBar } from '@/components/studio/session/SessionLifecycleBar';
import type { SessionLifecycle } from './session-lifecycle-client';

/** The operator's real stuck session, as A2's lifecycle derivation reads it
 *  from disk: runner crashed with the containment refusal, phase still
 *  `gathering`. */
const CRASHED_COMMUNITY_REFRESH: SessionLifecycle = {
  state: 'crashed',
  needsYou: true,
  error:
    'InteractiveRunnerError: runInteractiveTurn: session kind "community-refresh" phase "gathering" declares writes: [staging], but the turn produced no files there — refusing to advance the session with an empty package',
  idleMs: 2_100_000,
  cancellable: true,
};

function render(lifecycle: SessionLifecycle, kind = 'community-refresh'): string {
  return renderToStaticMarkup(
    React.createElement(SessionLifecycleBar, {
      lifecycle,
      phase: 'gathering',
      kind,
      sessionId: '2026-08-18T12-54-32-abdfd26b',
      project: '.community-registry',
    }),
  );
}

test('crashed community-refresh: error verbatim + a start-new-session link to the kind kickoff', () => {
  const html = render(CRASHED_COMMUNITY_REFRESH);
  expect(html).toContain('data-lifecycle-state="crashed"');
  expect(html).toContain('produced no files there');
  expect(html).toContain('data-action="start-new-session"');
  expect(html).toContain('href="/sessions/community-refresh/new"');
});

test('working session renders NO start-new-session link (crash/stall/terminal only — never noise on a healthy run)', () => {
  const html = render({ state: 'working', needsYou: false, error: null, idleMs: 4_000, cancellable: true });
  expect(html).not.toContain('data-action="start-new-session"');
});

test('terminal session offers the start-new-session way forward too', () => {
  const html = render({ state: 'terminal', needsYou: false, error: null, idleMs: null, cancellable: false });
  expect(html).toContain('data-action="start-new-session"');
});
