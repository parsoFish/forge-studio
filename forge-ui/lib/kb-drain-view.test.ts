/**
 * kb-drain-view.test.ts (W6-B13) — pure-logic coverage for
 * KbDrainPanel.tsx's derivation helpers. No DOM/jsdom needed (see
 * lib/kb-drain-view.ts's own header for why this split exists).
 *
 * RUN: cd forge-ui && npx vitest run lib/kb-drain-view.test.ts
 */
import { test, expect } from 'vitest';
import {
  isKbDrainTerminal,
  drainStateCopy,
  findingsByTier,
  resolveUserTierStep,
  findingRounds,
  formatDrainElapsed,
  KB_DRAIN_MAX_ROUNDS_DISPLAY,
} from './kb-drain-view';
import type { KbDrainPerFinding } from './studio-client';

// ---------------------------------------------------------------------------
// isKbDrainTerminal
// ---------------------------------------------------------------------------

test('isKbDrainTerminal: every real server terminal state is terminal', () => {
  for (const s of ['green', 'needs-you', 'no-progress', 'round-cap', 'cost-ceiling', 'failed'] as const) {
    expect(isKbDrainTerminal(s)).toBe(true);
  }
});

test('isKbDrainTerminal: "timed-out" (the UI-only watch-exhaustion state) is terminal', () => {
  expect(isKbDrainTerminal('timed-out')).toBe(true);
});

test('isKbDrainTerminal: "running"/"attaching"/"idle" are NOT terminal', () => {
  expect(isKbDrainTerminal('running')).toBe(false);
  expect(isKbDrainTerminal('attaching')).toBe(false);
  expect(isKbDrainTerminal('idle')).toBe(false);
});

// ---------------------------------------------------------------------------
// drainStateCopy
// ---------------------------------------------------------------------------

test('drainStateCopy: every state produces a non-empty label and detail', () => {
  const states = ['idle', 'attaching', 'running', 'green', 'needs-you', 'no-progress', 'round-cap', 'cost-ceiling', 'failed', 'timed-out'] as const;
  for (const s of states) {
    const copy = drainStateCopy(s, 0.42);
    expect(copy.label.length).toBeGreaterThan(0);
    expect(copy.detail.length).toBeGreaterThan(0);
  }
});

test('drainStateCopy: "cost-ceiling" names the actual dollar amount spent, not a generic message', () => {
  expect(drainStateCopy('cost-ceiling', 1.5).detail).toContain('$1.50');
});

test('drainStateCopy: "round-cap" names the real max-rounds constant', () => {
  expect(drainStateCopy('round-cap', 0).detail).toContain(String(KB_DRAIN_MAX_ROUNDS_DISPLAY));
});

test('drainStateCopy: "timed-out" explicitly says the run keeps going server-side — never implies it stopped', () => {
  const detail = drainStateCopy('timed-out', 0).detail.toLowerCase();
  expect(detail).toContain('server');
  expect(detail).toContain('re-check');
});

test('drainStateCopy: "failed" points at the activity log rather than inventing an error string it does not have', () => {
  expect(drainStateCopy('failed', 0).detail.toLowerCase()).toContain('activity log');
});

// ---------------------------------------------------------------------------
// findingsByTier
// ---------------------------------------------------------------------------

function finding(tier: KbDrainPerFinding['tier'], key: string): KbDrainPerFinding {
  return { key, check: 'c', kind: 'k', file: 'f.md', message: 'm', tier, outcome: tier === 'user' ? 'needs-you' : 'cleared' };
}

test('findingsByTier: splits a flat perFinding list into auto/agent/user buckets', () => {
  const perFinding = [finding('auto', 'a1'), finding('agent', 'g1'), finding('user', 'u1'), finding('auto', 'a2')];
  const tiers = findingsByTier(perFinding);
  expect(tiers.auto.map((f) => f.key)).toEqual(['a1', 'a2']);
  expect(tiers.agent.map((f) => f.key)).toEqual(['g1']);
  expect(tiers.user.map((f) => f.key)).toEqual(['u1']);
});

test('findingsByTier: an empty list produces three empty buckets, never throws', () => {
  const tiers = findingsByTier([]);
  expect(tiers).toEqual({ auto: [], agent: [], user: [] });
});

// ---------------------------------------------------------------------------
// resolveUserTierStep — the C9#3 fix (LintResolutionPanel used to clamp the
// walkthrough index to the last item forever, so Skip past the end produced
// no visible change on every subsequent click).
// ---------------------------------------------------------------------------

test('resolveUserTierStep: idx 0 of a non-empty list shows the first finding', () => {
  const list = [finding('user', 'u1'), finding('user', 'u2')];
  expect(resolveUserTierStep(list, 0)).toEqual({ finding: list[0], done: false, total: 2 });
});

test('resolveUserTierStep: mid-walkthrough shows the current index', () => {
  const list = [finding('user', 'u1'), finding('user', 'u2'), finding('user', 'u3')];
  expect(resolveUserTierStep(list, 1).finding).toEqual(list[1]);
});

test('resolveUserTierStep: stepping PAST the last item reaches an explicit done:true, distinct from re-showing the last item (kills the C9#3 clamp-forever defect)', () => {
  const list = [finding('user', 'u1'), finding('user', 'u2')];
  const step = resolveUserTierStep(list, 2);
  expect(step.done).toBe(true);
  expect(step.finding).toBeNull();
  expect(step.total).toBe(2);
});

test('resolveUserTierStep: an idx far past the end still reaches done:true, never throws or wraps', () => {
  const list = [finding('user', 'u1')];
  expect(resolveUserTierStep(list, 99)).toEqual({ finding: null, done: true, total: 1 });
});

test('resolveUserTierStep: an EMPTY list is done:false (nothing to review at all is a different state than "reviewed everything")', () => {
  expect(resolveUserTierStep([], 0)).toEqual({ finding: null, done: false, total: 0 });
});

// ---------------------------------------------------------------------------
// W7-B2 additions — cancelled vocabulary, per-round grouping, elapsed label.
// ---------------------------------------------------------------------------

test('W7-B2: "cancelled" is a terminal state with its own honest copy', () => {
  expect(isKbDrainTerminal('cancelled')).toBe(true);
  const copy = drainStateCopy('cancelled', 0.4);
  expect(copy.label).toBe('cancelled');
  expect(copy.detail).toContain('Stopped on your request');
});

test('W7-B2 findingRounds: distinct rounds ascending; pre-W7 rows without a round tag group as 0', () => {
  const f = (round?: number) => ({ key: `k${round}`, check: 'c', kind: 'k', file: 'f', message: 'm', tier: 'agent' as const, outcome: 'cleared' as const, ...(round !== undefined ? { round } : {}) });
  expect(findingRounds([f(2), f(1), f(2)])).toEqual([1, 2]);
  expect(findingRounds([f()])).toEqual([0]);
});

test('W7-B2 formatDrainElapsed: real elapsed label; null without startedAt or for a clock running backwards', () => {
  const now = new Date('2026-08-20T10:02:05Z').getTime();
  expect(formatDrainElapsed('2026-08-20T10:00:00Z', now)).toBe('2m 5s');
  expect(formatDrainElapsed('2026-08-20T10:02:00Z', now)).toBe('5s');
  expect(formatDrainElapsed(undefined, now)).toBeNull();
  expect(formatDrainElapsed('2026-08-20T10:03:00Z', now)).toBeNull();
});
