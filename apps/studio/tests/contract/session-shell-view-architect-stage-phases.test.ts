/**
 * forge-8vfn.8.1.14 — the architect's new `critiquing`/`revising` phases pass
 * through `sessionShellState` VERBATIM, exactly like AT-46
 * (`session-shell-view.test.ts`) pins for every other phase.
 *
 * A NEW file rather than an addition to `session-shell-view.test.ts` on
 * purpose: that file is already at its 1.0.md §0 file-size exemption ceiling
 * (812 lines) — "an exemption is a ceiling, not a licence" — so growing it
 * further is its own violation regardless of the general 800-line cap.
 *
 * `phase` is untyped (`string`) on the wire on purpose — `sessionShellState`
 * never filters it against a per-kind enum — and the page's own root spreads
 * `'data-session-phase': viewState.phase` straight from this value
 * (`app/sessions/[kind]/[sessionId]/page.tsx`), so this passthrough IS the
 * DOM contract: whatever `state.phase` reads here is byte-identical to what
 * `data-session-phase` renders. The companion render-level proof (the actual
 * element carrying the attribute) is
 * `apps/studio/tests/regression/architect-session-phase-critiquing-revising.test.ts`.
 */
import { test, expect } from 'vitest';
import { sessionShellState } from '../../lib/session-shell-view.ts';
import type { SessionShellPayload } from '../../lib/session-client.ts';

// A minimal single-stage architect payload — only the fields this module
// actually reads to derive `phase`/`dataAttrs` matter here.
const PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'architect',
  title: 'Planning session',
  sessionId: '2026-09-26T06-35-53-c47340dc',
  project: 'story-s1',
  phase: 'drafting',
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
  lifecycle: { state: 'working' as const, needsYou: false, error: null, idleMs: null, cancellable: true },
  legacy: false,
};

test('a `critiquing` phase (the completeness critic, ruling 380) passes through verbatim — never filtered, never collapsed', () => {
  const state = sessionShellState({ ...PAYLOAD, phase: 'critiquing' });
  expect(state.status).toBe('ready');
  expect(state.phase).toBe('critiquing');
  expect(state.dataAttrs['data-session-kind']).toBe('architect');
});

test('a `revising` phase (a draft round the critic bounced back) passes through verbatim — never filtered, never collapsed', () => {
  const state = sessionShellState({ ...PAYLOAD, phase: 'revising' });
  expect(state.status).toBe('ready');
  expect(state.phase).toBe('revising');
});
