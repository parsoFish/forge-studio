/**
 * W7-A2 — session lifecycle UI pins (RED at branch base).
 *
 * Findings closed here (UI half): home-sessions-04/05/08/09/21 (cancel +
 * lifecycle on /sessions and Home), sessions-kinds-10/11/27/31/33/35
 * (session page banner, cancel, terminal copy, model chip, back link),
 * community-07/20, knowledge-16/25.
 *
 * Every component under test is pure/props-driven and rendered via
 * `react-dom/server`'s `renderToStaticMarkup`, mirroring
 * `sessions-index-render.test.ts` / `home-sessions-strip-render.test.ts`
 * (same `next/navigation` mock rationale — `StudioPage` renders `StudioNav`,
 * which calls `usePathname()`).
 *
 * RUN: npx vitest run lib/session-lifecycle-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  usePathname: () => '/sessions',
}));

import { SessionsIndexBody } from '@/components/studio/SessionsIndex';
import { HomeSessionsStrip } from '@/components/studio/HomeSessionsStrip';
import { SessionLifecycleBar } from '@/components/studio/session/SessionLifecycleBar';
import { SessionInteractivePanel } from '@/components/studio/session/SessionInteractivePanel';
import { buildHomeSessionsStrip } from './home-view.ts';
import { backToProjectLink } from './session-shell-view.ts';
import { parseSessionShellPayload, type SessionLifecycle } from './session-client.ts';
import { describeLifecycle, SESSION_LIFECYCLE_STATES } from './session-lifecycle-client.ts';
import type { SessionIndexRow } from './studio-client.ts';

const CRASH_TEXT = 'InteractiveRunnerError: runInteractiveTurn: session kind "kb-cleanup" phase "drafting" declares writes: [plan], but the turn produced no files there — refusing to advance the session with an empty package rather than persisting a ghost turn to status.json.';

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
    state: 'working',
    error: null,
    idleMs: null,
    ...overrides,
  };
}

function lifecycle(over: Partial<SessionLifecycle> = {}): SessionLifecycle {
  return { state: 'working', needsYou: false, error: null, idleMs: 5_000, cancellable: true, ...over };
}

// ---------------------------------------------------------------------------
// session-lifecycle-client — copy helper + vocabulary
// ---------------------------------------------------------------------------

test('SESSION_LIFECYCLE_STATES is exactly the five wire tokens', () => {
  expect([...SESSION_LIFECYCLE_STATES]).toEqual(['working', 'awaiting-operator', 'crashed', 'stalled', 'terminal']);
});

test('describeLifecycle: crashed carries the error text; stalled names the silence in minutes; awaiting-operator/working/terminal have distinct honest copy', () => {
  expect(describeLifecycle('crashed', CRASH_TEXT, 60_000)).toContain('Crashed');
  expect(describeLifecycle('crashed', CRASH_TEXT, 60_000)).toContain('declares writes: [plan]');
  expect(describeLifecycle('stalled', null, 30 * 60_000)).toMatch(/Stalled.*30 ?m/);
  expect(describeLifecycle('awaiting-operator', null, null)).toMatch(/Needs you/);
  expect(describeLifecycle('working', null, null)).toMatch(/working/i);
  expect(describeLifecycle('terminal', null, null)).toMatch(/Finished/);
  // No two states share the same copy.
  const all = SESSION_LIFECYCLE_STATES.map((s) => describeLifecycle(s, s === 'crashed' ? 'boom' : null, 60_000));
  expect(new Set(all).size).toBe(all.length);
});

// ---------------------------------------------------------------------------
// session-client — `lifecycle` is REQUIRED and hard-parsed
// ---------------------------------------------------------------------------

const BASE_PAYLOAD = {
  ok: true, kind: 'demo', title: 'Demo capability session', sessionId: '2026-08-03T12-00-00', project: 'projb',
  phase: 'generating', stages: ['demo'], defaultStage: 'demo', turns: [],
  artifact: { kind: 'generation-gallery', label: 'Demo generations', generations: [] },
  affordances: [], modelTier: null, terminal: false,
};

test('parseSessionShellPayload: a payload WITHOUT lifecycle throws naming the field (never defaulted to working)', () => {
  expect(() => parseSessionShellPayload(BASE_PAYLOAD)).toThrow(/lifecycle/);
});

test('parseSessionShellPayload: a well-formed lifecycle round-trips verbatim; an unknown state token throws naming it and the allowed set', () => {
  const ok = parseSessionShellPayload({ ...BASE_PAYLOAD, lifecycle: lifecycle({ state: 'crashed', needsYou: true, error: CRASH_TEXT, idleMs: 42 }) });
  expect(ok.lifecycle).toEqual({ state: 'crashed', needsYou: true, error: CRASH_TEXT, idleMs: 42, cancellable: true });
  expect(() => parseSessionShellPayload({ ...BASE_PAYLOAD, lifecycle: lifecycle({ state: 'zombie' as never }) })).toThrow(/zombie/);
  expect(() => parseSessionShellPayload({ ...BASE_PAYLOAD, lifecycle: { ...lifecycle(), needsYou: 'yes' } })).toThrow(/needsYou/);
});

// ---------------------------------------------------------------------------
// /sessions rows — state attr, lifecycle chip, cancel button
// ---------------------------------------------------------------------------

test('SessionsIndexBody: every row carries data-session-state and a lifecycle chip; a crashed row\'s chip shows the runner error', () => {
  const sessions = [
    makeRow({ kind: 'kb-cleanup', sessionId: 'crashed-1', project: '.kb-cycles', state: 'crashed', needsYou: true, error: CRASH_TEXT }),
    makeRow({ kind: 'demo', sessionId: 'working-1', state: 'working' }),
    makeRow({ kind: 'architect', sessionId: 'stalled-1', state: 'stalled', needsYou: true, idleMs: 25 * 60_000 }),
  ];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  expect(html).toContain('data-session-state="crashed"');
  expect(html).toContain('data-session-state="working"');
  expect(html).toContain('data-session-state="stalled"');
  expect(html).toContain('data-session-state-chip');
  expect(html).toContain('declares writes: [plan]');
});

test('SessionsIndexBody: every non-terminal row renders button[data-action="cancel-session"]; a terminal row does not', () => {
  const sessions = [
    makeRow({ kind: 'demo', sessionId: 'w1', state: 'working' }),
    makeRow({ kind: 'demo', sessionId: 't1', state: 'terminal', terminal: true, phase: 'locked' }),
  ];
  const html = renderToStaticMarkup(React.createElement(SessionsIndexBody, { sessions, ready: true }));
  const cancelButtons = html.match(/data-action="cancel-session"/g) ?? [];
  expect(cancelButtons.length).toBe(1);
});

// ---------------------------------------------------------------------------
// Home strip card — state attr + cancel button, no nested interactive
// ---------------------------------------------------------------------------

test('HomeSessionsStrip: cards carry data-session-state and a cancel button that is NOT nested inside the card link', () => {
  const strip = buildHomeSessionsStrip([
    makeRow({ kind: 'community-refresh', sessionId: 'c1', project: '.community-registry', state: 'crashed', needsYou: true, error: 'InteractiveRunnerError: boom' }),
  ]);
  const html = renderToStaticMarkup(React.createElement(HomeSessionsStrip, { strip }));
  expect(html).toContain('data-session-state="crashed"');
  expect(html).toContain('data-action="cancel-session"');
  // The button must not be a descendant of the <a>: no "<a" opened before it that is still unclosed.
  const buttonAt = html.indexOf('data-action="cancel-session"');
  const lastAnchorOpen = html.lastIndexOf('<a ', buttonAt);
  const lastAnchorClose = html.lastIndexOf('</a>', buttonAt);
  expect(lastAnchorClose).toBeGreaterThan(lastAnchorOpen);
});

test('home-view: needsYouCount counts the bridge\'s lifecycle needsYou verbatim (crashed/stalled/awaiting count; working does not)', () => {
  const strip = buildHomeSessionsStrip([
    makeRow({ kind: 'demo', sessionId: 'a', state: 'crashed', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 'b', state: 'stalled', needsYou: true }),
    makeRow({ kind: 'demo', sessionId: 'c', state: 'working', needsYou: false }),
  ]);
  expect(strip.needsYouCount).toBe(2);
});

// ---------------------------------------------------------------------------
// SessionLifecycleBar — the per-session banner + cancel, every kind
// ---------------------------------------------------------------------------

function renderBar(l: SessionLifecycle, phase = 'drafting'): string {
  return renderToStaticMarkup(React.createElement(SessionLifecycleBar, { lifecycle: l, phase, kind: 'kb-cleanup', sessionId: 's', project: '.kb-cycles' }));
}

test('SessionLifecycleBar: crashed → data-lifecycle-state="crashed", data-needs-you="true", the error text verbatim in [data-lifecycle-error], and a cancel button', () => {
  const html = renderBar(lifecycle({ state: 'crashed', needsYou: true, error: CRASH_TEXT }));
  expect(html).toContain('data-section="session-lifecycle"');
  expect(html).toContain('data-lifecycle-state="crashed"');
  expect(html).toContain('data-needs-you="true"');
  expect(html).toContain('data-lifecycle-error');
  expect(html).toContain('declares writes: [plan]');
  expect(html).toContain('data-action="cancel"');
});

test('SessionLifecycleBar: stalled → names the silence and offers cancel; working → no needs-you, cancel offered; awaiting-operator → needs-you', () => {
  const stalled = renderBar(lifecycle({ state: 'stalled', needsYou: true, idleMs: 30 * 60_000 }));
  expect(stalled).toContain('data-lifecycle-state="stalled"');
  expect(stalled).toMatch(/30 ?m/);
  expect(stalled).toContain('data-action="cancel"');
  const working = renderBar(lifecycle({ state: 'working' }));
  expect(working).toContain('data-lifecycle-state="working"');
  expect(working).toContain('data-needs-you="false"');
  expect(working).toContain('data-action="cancel"');
  const awaiting = renderBar(lifecycle({ state: 'awaiting-operator', needsYou: true }));
  expect(awaiting).toContain('data-needs-you="true"');
});

test('SessionLifecycleBar: terminal → per-phase honest copy (done vs stopped), NO cancel button, not needs-you', () => {
  const done = renderBar(lifecycle({ state: 'terminal', cancellable: false, needsYou: false }), 'committed');
  expect(done).toContain('data-lifecycle-state="terminal"');
  expect(done).not.toContain('data-action="cancel"');
  expect(done).toMatch(/Done/);
  const cancelled = renderBar(lifecycle({ state: 'terminal', cancellable: false, needsYou: false }), 'cancelled');
  expect(cancelled).not.toContain('data-action="cancel"');
  expect(cancelled).toMatch(/[Cc]ancelled/);
  expect(cancelled).not.toMatch(/Done/);
});

// ---------------------------------------------------------------------------
// SessionInteractivePanel — zero-affordance copy is lifecycle-aware; model chip honest
// ---------------------------------------------------------------------------

function renderPanel(props: { phase: string; terminal: boolean; lifecycle: SessionLifecycle; modelTier?: string | null }): string {
  return renderToStaticMarkup(
    React.createElement(SessionInteractivePanel, {
      kind: 'kb-cleanup', sessionId: 's', project: '.kb-cycles', phase: props.phase, affordances: [], artifact: null,
      modelTier: props.modelTier ?? null, events: [], terminal: props.terminal, lifecycle: props.lifecycle,
    }),
  );
}

test('SessionInteractivePanel: zero affordances + working → "agent is working" copy (data-no-affordance-reason="working"), never the old flat sentence', () => {
  const html = renderPanel({ phase: 'drafting', terminal: false, lifecycle: lifecycle({ state: 'working' }) });
  expect(html).toContain('data-no-affordance-reason="working"');
  expect(html).not.toContain('No operator action available for this session kind right now.');
});

test('SessionInteractivePanel: zero affordances + crashed/stalled → "stopped" reason; + terminal → "terminal" reason naming the phase', () => {
  const crashed = renderPanel({ phase: 'drafting', terminal: false, lifecycle: lifecycle({ state: 'crashed', needsYou: true, error: 'boom' }) });
  expect(crashed).toContain('data-no-affordance-reason="stopped"');
  const terminal = renderPanel({ phase: 'applied', terminal: true, lifecycle: lifecycle({ state: 'terminal', cancellable: false }) });
  expect(terminal).toContain('data-no-affordance-reason="terminal"');
  expect(terminal).toContain('applied');
});

test('SessionInteractivePanel: the model chip never says the literal "default" — a null tier reads "not recorded"', () => {
  const html = renderPanel({ phase: 'drafting', terminal: false, lifecycle: lifecycle(), modelTier: null });
  expect(html).toContain('model: not recorded');
  expect(html).not.toContain('model: default');
  const sonnet = renderPanel({ phase: 'drafting', terminal: false, lifecycle: lifecycle(), modelTier: 'sonnet' });
  expect(sonnet).toContain('model: sonnet');
});

// ---------------------------------------------------------------------------
// backToProjectLink — every phase, and the KB anchor resolves to the KB itself
// ---------------------------------------------------------------------------

test('backToProjectLink: renders for a NON-terminal session too (the operator most needs a way out mid-flight), and a .kb-<id> anchor resolves to that KB, not the index', () => {
  expect(backToProjectLink('mdtoc', false)).toEqual({ label: 'project', href: '/projects/mdtoc' });
  expect(backToProjectLink('.kb-forge-dev', false)).toEqual({ label: 'Knowledge base forge-dev', href: '/knowledge?id=forge-dev' });
  expect(backToProjectLink('.community-registry', false)).toEqual({ label: 'Community', href: '/community' });
  expect(backToProjectLink(null, false)).toBeNull();
  expect(backToProjectLink('.some-future-anchor', true)).toBeNull();
});
