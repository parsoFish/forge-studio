/**
 * forge-nk1y.5 — the session's spend ceiling on the session surface.
 *
 * The shell publishes `data-session-ceiling-usd` (+ `-source`). Unlike the
 * cost attr (omitted when unrecorded), the ceiling attr is NEVER omitted: an
 * operator reading a missing attribute would take it for "uncapped", so a
 * session that recorded none says `none` out loud.
 */
import { test, expect } from 'vitest';
import { sessionShellState } from '../../lib/session-shell-view.ts';
import { parseSessionShellPayload, type SessionShellPayload } from '../../lib/session-client.ts';

const PAYLOAD: SessionShellPayload = {
  ok: true,
  kind: 'instructions',
  title: 'Instructions',
  sessionId: '2026-10-09T00-00-00',
  project: 'mdtoc',
  phase: 'drafting',
  stages: ['instructions'],
  defaultStage: 'instructions',
  turns: [],
  artifact: { kind: 'file-package', label: 'Created object', files: [] },
  affordances: [],
  finalized: null,
  transcriptError: null,
  modelTier: 'opus', costUsd: null, sdk: 'claude',
  ceiling: null,
  terminal: false,
  transcriptSources: [],
  lifecycle: { state: 'working' as const, needsYou: false, error: null, idleMs: null, cancellable: true },
  legacy: false,
};

test('a recorded ceiling publishes data-session-ceiling-usd (2dp) and its source', () => {
  const state = sessionShellState({ ...PAYLOAD, ceiling: { usd: 3, source: 'agent-budget' } });
  expect(state.dataAttrs['data-session-ceiling-usd']).toBe('3.00');
  expect(state.dataAttrs['data-session-ceiling-source']).toBe('agent-budget');
  expect(state.ceiling).toEqual({ usd: 3, source: 'agent-budget' });
});

test('a session with no recorded ceiling says "none" — the attribute is never omitted', () => {
  const state = sessionShellState({ ...PAYLOAD, ceiling: null });
  expect(state.dataAttrs['data-session-ceiling-usd']).toBe('none');
  expect(state.dataAttrs['data-session-ceiling-source']).toBeUndefined();
});

test('a stage switch keeps the ceiling attrs (session-level fact)', async () => {
  const { selectStage } = await import('../../lib/session-shell-view.ts');
  const base = sessionShellState({ ...PAYLOAD, stages: ['a', 'b'], defaultStage: 'a', ceiling: { usd: 1.5, source: 'env' } });
  const res = selectStage(base, 'b');
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.state.dataAttrs['data-session-ceiling-usd']).toBe('1.50');
    expect(res.state.dataAttrs['data-session-ceiling-source']).toBe('env');
  }
});

const WIRE = { ...PAYLOAD, ceiling: { usd: 3, source: 'operator' } };

test('parseSessionShellPayload: ceiling {usd, source} round-trips; null is accepted', () => {
  expect(parseSessionShellPayload(WIRE).ceiling).toEqual({ usd: 3, source: 'operator' });
  expect(parseSessionShellPayload({ ...WIRE, ceiling: null }).ceiling).toBeNull();
});

test('parseSessionShellPayload: a MISSING "ceiling" key throws by name (null is honest, absence is not)', () => {
  const { ceiling: _drop, ...missing } = WIRE;
  expect(() => parseSessionShellPayload(missing)).toThrow(/ceiling/);
});

test('parseSessionShellPayload: a wrong-shaped "ceiling" throws', () => {
  for (const bad of ['3', 3, { usd: 3 }, { usd: '3', source: 'env' }, { usd: 3, source: 'vibes' }, { usd: 0, source: 'env' }, { usd: -1, source: 'env' }, { usd: Number.NaN, source: 'env' }, []]) {
    expect(() => parseSessionShellPayload({ ...WIRE, ceiling: bad }), JSON.stringify(bad)).toThrow(/ceiling/);
  }
});

test('sessionCeilingLine names the amount and the source of each kind; null says "not recorded"', async () => {
  const { sessionCeilingLine } = await import('../../lib/session-shell-view.ts');
  expect(sessionCeilingLine({ usd: 3, source: 'agent-budget' })).toBe('Session spend ceiling $3.00 (agent budget)');
  expect(sessionCeilingLine({ usd: 7, source: 'env' })).toBe('Session spend ceiling $7.00 (FORGE_COST_CEILING_USD)');
  expect(sessionCeilingLine({ usd: 12.5, source: 'operator' })).toBe('Session spend ceiling $12.50 (set at kickoff)');
  expect(sessionCeilingLine(null)).toBe("Session spend ceiling not recorded (the agent's own budget applies)");
});
