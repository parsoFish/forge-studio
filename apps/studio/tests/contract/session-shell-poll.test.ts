/**
 * forge-d5ib (W8-F6 follow-up) — a legacy session keeps polling its
 * always-empty per-kind summary endpoint.
 *
 * `app/sessions/[kind]/[sessionId]/page.tsx` polled the bespoke per-kind
 * summary endpoint every `SUMMARY_POLL_MS` unconditionally. For a LEGACY
 * session (working dir gone, only the central event log survives) that
 * endpoint reads the same project-side `status.json` the shell route no
 * longer needs, so it can only ever resolve to nothing — harmless, purely
 * wasted poll traffic. `shouldPollSessionSummary` (lib/session-shell-view.ts)
 * is the pure gate the page's poll effect now checks.
 *
 * A dedicated file (not appended to `./session-shell-view.test.ts`, which
 * sits at this repo's 800-line file-size ratchet) — see that file for the
 * full `sessionShellState`/`deriveSessionShellViewState` acceptance suite
 * this one deliberately does not duplicate.
 *
 * RUN: npx vitest run --root apps/studio tests/contract/session-shell-poll.test.ts
 */
import { test, expect } from 'vitest';
import {
  sessionShellState,
  deriveSessionShellViewState,
  shouldPollSessionSummary,
} from '../../lib/session-shell-view.ts';
import type { SessionShellPayload } from '../../lib/session-client.ts';

const READY_PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'architect',
  title: 'Planning session',
  sessionId: '2026-09-25T00-00-00',
  project: 'gitpulse',
  phase: 'awaiting-verdict',
  stages: ['roadmap'],
  defaultStage: 'roadmap',
  turns: [],
  artifact: { kind: 'roadmap-draft', label: 'Roadmap draft', rows: [], sourcesScanned: [] },
  affordances: [],
  finalized: null,
  transcriptError: null,
  modelTier: null, costUsd: null, sdk: 'claude',
  terminal: false,
  transcriptSources: [],
  lifecycle: { state: 'awaiting-operator' as const, needsYou: true, error: null, idleMs: null, cancellable: true },
  legacy: false,
};

test('RED forge-d5ib: a settled ready state for a LEGACY session must NOT poll the summary', () => {
  const legacyReady = sessionShellState({ ...READY_PAYLOAD, legacy: true });
  expect(shouldPollSessionSummary(legacyReady)).toBe(false);
});

test('forge-d5ib: a settled ready state for a NON-legacy session still polls the summary', () => {
  const liveReady = sessionShellState({ ...READY_PAYLOAD, legacy: false });
  expect(shouldPollSessionSummary(liveReady)).toBe(true);
});

test('forge-d5ib: an unsettled (loading) state still polls — legacy is unknown until the shell resolves', () => {
  expect(shouldPollSessionSummary(deriveSessionShellViewState(null))).toBe(true);
});

test('forge-d5ib: a no-session / error state still polls — neither is known to be legacy', () => {
  const noSession = deriveSessionShellViewState({ ok: false, errorKind: 'not-found', error: 'gone' });
  const errored = deriveSessionShellViewState({ ok: false, errorKind: 'server-error', error: 'boom' });
  expect(shouldPollSessionSummary(noSession)).toBe(true);
  expect(shouldPollSessionSummary(errored)).toBe(true);
});
