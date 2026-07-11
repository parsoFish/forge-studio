/**
 * Tests for `plan-gate-state.ts` — the ArchitectPlanGate approval-reset logic.
 *
 * Bug: the gate's optimistic `approved` flag survived a completeness-critic
 * block because the reset effect assumed finalizing never returns directly to
 * `awaiting-verdict`. When the critic blocks promotion, the session round-trips
 * finalizing → awaiting-verdict (same round, findings on status) — and if the
 * poll never observes the short-lived `finalizing` phase, the stale `approved`
 * flag kept rendering the false "Approved — building it now" payoff banner
 * next to a gate that is actually re-armed and waiting for a re-approve.
 */
import { test, expect } from 'vitest';

import { isCriticBlocked, shouldResetApproval, planGateKey } from './plan-gate-state.ts';
import type { CompletenessCriticStatus } from './bridge-client.ts';

const withFindings: CompletenessCriticStatus = {
  ranAt: '2026-07-11T10:00:00.000Z',
  findings: [{ severity: 'high', gap: 'data_source_x is never covered by any initiative.' }],
};
const clean: CompletenessCriticStatus = { ranAt: '2026-07-11T10:00:00.000Z', findings: [] };
const crashed: CompletenessCriticStatus = {
  ranAt: '2026-07-11T10:00:00.000Z',
  findings: [],
  crashed: true,
};

test('isCriticBlocked: awaiting-verdict + findings → blocked', () => {
  expect(isCriticBlocked('awaiting-verdict', withFindings)).toBe(true);
});

test('isCriticBlocked: awaiting-verdict with no critic run yet → not blocked', () => {
  expect(isCriticBlocked('awaiting-verdict', null)).toBe(false);
  expect(isCriticBlocked('awaiting-verdict', undefined)).toBe(false);
});

test('isCriticBlocked: a clean or crashed critic result never blocks', () => {
  expect(isCriticBlocked('awaiting-verdict', clean)).toBe(false);
  expect(isCriticBlocked('awaiting-verdict', crashed)).toBe(false);
});

test('isCriticBlocked: findings outside awaiting-verdict do not block (gate is not mounted)', () => {
  expect(isCriticBlocked('finalizing', withFindings)).toBe(false);
  expect(isCriticBlocked('committed', withFindings)).toBe(false);
});

test('shouldResetApproval: working phases reset the optimistic approval (pre-existing behavior)', () => {
  for (const phase of ['interviewing', 'awaiting-answers', 'drafting', 'finalizing', 'rejected']) {
    expect(shouldResetApproval(phase, null)).toBe(true);
  }
});

test('shouldResetApproval: committed keeps the payoff — even with acknowledged findings on status', () => {
  expect(shouldResetApproval('committed', null)).toBe(false);
  // Re-approve after acknowledging findings: status keeps the findings but the
  // session IS committed — the payoff must not be reset away.
  expect(shouldResetApproval('committed', withFindings)).toBe(false);
});

test('shouldResetApproval: plain awaiting-verdict (no critic) does not reset', () => {
  expect(shouldResetApproval('awaiting-verdict', null)).toBe(false);
});

test('shouldResetApproval: THE BUG — a critic block round-trip back to awaiting-verdict resets', () => {
  expect(shouldResetApproval('awaiting-verdict', withFindings)).toBe(true);
});

test('planGateKey: changes when the critic result lands so the submitted gate remounts fresh', () => {
  expect(planGateKey(2, null)).not.toBe(planGateKey(2, withFindings));
});

test('planGateKey: stable for identical inputs, distinct across rounds', () => {
  expect(planGateKey(2, withFindings)).toBe(planGateKey(2, withFindings));
  expect(planGateKey(2, null)).not.toBe(planGateKey(3, null));
});
