/**
 * W7-B3 render pins for SessionLifecycleBar's crashed state (community-01 /
 * sessions-kinds-32, historical origin: the operator's stuck community-refresh
 * session 2026-08-18T12-54-32-abdfd26b gave this fixture its shape — that
 * session kind is retired (W8-B5b WI-3), so the fixture is re-pointed at
 * `kb-cleanup`, a surviving generic-panel kind, to keep pinning live behavior
 * rather than a route that now 404s):
 *
 *  - a crashed session renders the runner's own error verbatim (A2's
 *    contract, re-pinned here against THIS fixture), and
 *  - offers a "start a new session" way forward — `[data-action=
 *    "start-new-session"]` linking to /sessions/<kind>/new — so the operator
 *    standing in front of a dead session is one click from a fresh one
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
const CRASHED_SESSION: SessionLifecycle = {
  state: 'crashed',
  needsYou: true,
  error:
    'InteractiveRunnerError: runInteractiveTurn: session kind "kb-cleanup" phase "gathering" declares writes: [staging], but the turn produced no files there — refusing to advance the session with an empty package',
  idleMs: 2_100_000,
  cancellable: true,
};

function render(lifecycle: SessionLifecycle, kind = 'kb-cleanup', phase = 'gathering'): string {
  return renderToStaticMarkup(
    React.createElement(SessionLifecycleBar, {
      lifecycle,
      phase,
      kind,
      sessionId: '2026-08-18T12-54-32-abdfd26b',
      project: '.kb-forge-dev',
    }),
  );
}

test('crashed session: error verbatim + a start-new-session link to the kind kickoff', () => {
  const html = render(CRASHED_SESSION);
  expect(html).toContain('data-lifecycle-state="crashed"');
  expect(html).toContain('produced no files there');
  expect(html).toContain('data-action="start-new-session"');
  expect(html).toContain('href="/sessions/kb-cleanup/new"');
});

test('working session renders NO start-new-session link (crash/stall/terminal only — never noise on a healthy run)', () => {
  const html = render({ state: 'working', needsYou: false, error: null, idleMs: 4_000, cancellable: true });
  expect(html).not.toContain('data-action="start-new-session"');
});

test('terminal session offers the start-new-session way forward too', () => {
  const html = render({ state: 'terminal', needsYou: false, error: null, idleMs: null, cancellable: false });
  expect(html).toContain('data-action="start-new-session"');
});

// ---------------------------------------------------------------------------
// WI-1b (ON-7) — GAP 3: a session whose own phase genuinely FAILED
// (rejected/abandoned/cancelled/failed — SESSION_STOPPED_PHASES) used to
// bucket into the SAME `terminal` lifecycle state as one that completed
// successfully — only the free-text `describeLifecycle` copy differed; the
// QUERYABLE state did not. Fixed ADDITIVELY: `data-lifecycle-state` still
// reads exactly `terminal` in every case (the documented DOM contract the
// journeys assert on, unchanged), and a NEW `data-lifecycle-terminal-outcome`
// attribute — "succeeded"|"failed"|"cancelled" — carries the real outcome,
// present ONLY when state === 'terminal'.
// ---------------------------------------------------------------------------

const TERMINAL_LIFECYCLE: SessionLifecycle = { state: 'terminal', needsYou: false, error: null, idleMs: null, cancellable: false };

test('WI-1b terminal-SUCCEEDED (phase "committed"): data-lifecycle-terminal-outcome="succeeded", and data-lifecycle-state still reads "terminal" (protects the journeys this lane cannot run)', () => {
  const html = render(TERMINAL_LIFECYCLE, 'kb-cleanup', 'committed');
  expect(html).toContain('data-lifecycle-state="terminal"');
  expect(html).toContain('data-lifecycle-terminal-outcome="succeeded"');
});

test('WI-1b terminal-FAILED (phase "failed"): data-lifecycle-terminal-outcome="failed", and data-lifecycle-state STILL reads "terminal" — the exact ON-7 gap (a failed session used to be indistinguishable, in the queryable DOM, from a succeeded one)', () => {
  const html = render(TERMINAL_LIFECYCLE, 'kb-cleanup', 'failed');
  expect(html).toContain('data-lifecycle-state="terminal"');
  expect(html).toContain('data-lifecycle-terminal-outcome="failed"');
});

test('WI-1b terminal-CANCELLED (phase "cancelled"): data-lifecycle-terminal-outcome="cancelled" — a DISTINCT outcome from "failed" (an operator-chosen stop is not a system failure — kills a fix that folds cancelled into the failed bucket)', () => {
  const html = render(TERMINAL_LIFECYCLE, 'kb-cleanup', 'cancelled');
  expect(html).toContain('data-lifecycle-terminal-outcome="cancelled"');
  expect(html).not.toContain('data-lifecycle-terminal-outcome="failed"');
});

test('WI-1b terminal "rejected"/"abandoned" also classify as "failed" (the remaining SESSION_STOPPED_PHASES members, once "cancelled" is carved out)', () => {
  for (const phase of ['rejected', 'abandoned']) {
    const html = render(TERMINAL_LIFECYCLE, 'kb-cleanup', phase);
    expect(html, `phase=${phase}`).toContain('data-lifecycle-terminal-outcome="failed"');
  }
});

test('WI-1b: data-lifecycle-terminal-outcome is ADDITIVE — present ONLY on a terminal row, never on working/crashed/stalled/awaiting-operator (kills a fix that always renders the attribute, e.g. blank/"n/a", instead of omitting it)', () => {
  const working = render({ state: 'working', needsYou: false, error: null, idleMs: 4_000, cancellable: true });
  expect(working).not.toContain('data-lifecycle-terminal-outcome');
  const crashed = render(CRASHED_SESSION);
  expect(crashed).not.toContain('data-lifecycle-terminal-outcome');
  const awaiting = render({ state: 'awaiting-operator', needsYou: true, error: null, idleMs: null, cancellable: true });
  expect(awaiting).not.toContain('data-lifecycle-terminal-outcome');
  const stalled = render({ state: 'stalled', needsYou: true, error: null, idleMs: 300_000, cancellable: true });
  expect(stalled).not.toContain('data-lifecycle-terminal-outcome');
});

test('WI-1b: a terminal-FAILED session with a real lifecycle.error shows that reason verbatim — never a log-file path instead (the exact defect class this lane exists to remove)', () => {
  const withError: SessionLifecycle = { state: 'terminal', needsYou: false, error: 'the review verdict rejected the plan: missing AC-3 coverage', idleMs: null, cancellable: false };
  const html = render(withError, 'kb-cleanup', 'failed');
  expect(html).toContain('missing AC-3 coverage');
  expect(html).not.toMatch(/_logs\//);
  expect(html).not.toMatch(/stderr\.log/i);
});

test('WI-1b: a terminal-FAILED session with NO lifecycle.error (the normal case — the bridge never populates .error for a terminal row) shows only the honest phase-aware sentence, never a fabricated reason', () => {
  const html = render(TERMINAL_LIFECYCLE, 'kb-cleanup', 'failed');
  expect(html).toContain('Failed — nothing further to do here.');
});

// ---------------------------------------------------------------------------
// W8-F6 (bead forge-6gv.27), adversarial review round 2 finding 2 — a LEGACY
// session (working files gone, only the central event log survives) is ALWAYS
// `state: 'terminal'`, and its `phase` is whatever its log last recorded
// MID-FLIGHT, not a terminal token. `sessionTerminalOutcome` fails CLOSED over
// a closed vocabulary, so every one of the seven real legacy architect sessions
// on the reference host (`phase: 'finalizing'`) would have rendered
// `data-lifecycle-terminal-outcome="failed"` — a fabricated verdict, directly
// under a banner saying "Read-only history … Last recorded phase: finalizing".
// KILLS: `state === 'terminal' ? sessionTerminalOutcome(phase) : null`.
// ---------------------------------------------------------------------------

function renderLegacy(phase: string, legacy: boolean): string {
  return renderToStaticMarkup(
    React.createElement(SessionLifecycleBar, {
      lifecycle: TERMINAL_LIFECYCLE,
      phase,
      kind: 'architect',
      sessionId: '2026-07-11T17-22-24',
      project: 'gitpulse',
      legacy,
    } as never),
  );
}

test('F6-BAR-1: a LEGACY terminal session emits NO data-lifecycle-terminal-outcome — its outcome is genuinely unknown, never guessed as "failed"', () => {
  const html = renderLegacy('finalizing', true);
  expect(html).toContain('data-lifecycle-state="terminal"');
  expect(html).not.toContain('data-lifecycle-terminal-outcome');
  expect(html).toContain('Read-only history — last recorded phase: finalizing');
});

test('F6-BAR-2: the SAME phase on a NON-legacy terminal session still classifies — the fix is scoped, not a blanket removal', () => {
  const html = renderLegacy('finalizing', false);
  expect(html).toContain('data-lifecycle-terminal-outcome="failed"');
});

test('F6-BAR-3: a legacy session whose log recorded NO phase reads as a sentence, never a dangling one', () => {
  const html = renderLegacy('', true);
  expect(html).toContain('Read-only history — this session ended and its working files are gone');
  expect(html).not.toContain('data-lifecycle-terminal-outcome');
});
