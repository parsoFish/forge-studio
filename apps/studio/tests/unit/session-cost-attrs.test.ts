/**
 * S9 beat 8 — "cost recorded" on the session page (M6-A exit row 2).
 *
 * The session read route derives the session's own spend from its
 * `events.jsonl` through the kernel's ONE event-cost rule and carries it as
 * `costUsd`. The shell publishes it under `data-ledger-cost-usd` — the one key
 * forge publishes a cost under anywhere in its DOM contract — in the same bare
 * `.toFixed(2)` format `HistoryLedger` uses, so an operator reading a session
 * page and an operator reading the Monitor read the same shaped number.
 *
 * `null` is honest-absent and the attribute is OMITTED, never zeroed: that is
 * `HistoryLedger`'s own ratified discipline, and it is what let S9 run 4 report
 * `spend: UNMEASURED` instead of a fabricated `$0.00`.
 *
 * Its own file rather than an append to `session-shell-view.test.ts`: that file
 * carries an 800-line exemption, and an exemption is a ceiling, not a licence.
 */
import { test, expect } from 'vitest';
import { sessionShellState } from '../../lib/session-shell-view.ts';
import type { SessionShellPayload } from '../../lib/session-client.ts';

/** The minimum a ready payload needs; every field the shell reads is present,
 *  so a future required field fails here loudly instead of silently. */
const PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'authoring',
  title: 'Create a Studio Object',
  sessionId: '2026-09-07T00-00-00-abcdef',
  project: 'mdtoc',
  phase: 'analyzing',
  stages: ['authoring'],
  defaultStage: 'authoring',
  turns: [],
  artifact: { kind: 'file-package', label: 'Created object', files: [] },
  affordances: [],
  finalized: null,
  transcriptError: null,
  modelTier: 'opus', costUsd: null, sdk: 'claude',
  terminal: false,
  transcriptSources: [],
  lifecycle: { state: 'working' as const, needsYou: false, error: null, idleMs: null, cancellable: true },
  legacy: false,
};

test('a session with a recorded cost publishes it as data-ledger-cost-usd', () => {
  const state = sessionShellState({ ...PAYLOAD, costUsd: 1.5 } as SessionShellPayload);
  expect(state.dataAttrs['data-ledger-cost-usd']).toBe('1.50');
});

test('a session with no recorded cost omits the attribute rather than showing 0.00', () => {
  const state = sessionShellState({ ...PAYLOAD, costUsd: null } as SessionShellPayload);
  expect(state.dataAttrs['data-ledger-cost-usd']).toBeUndefined();
});

test('a session that genuinely cost nothing publishes 0.00 — a fact, not an absence', () => {
  const state = sessionShellState({ ...PAYLOAD, costUsd: 0 } as SessionShellPayload);
  expect(state.dataAttrs['data-ledger-cost-usd']).toBe('0.00');
});
