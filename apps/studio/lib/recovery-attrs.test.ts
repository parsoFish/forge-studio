/**
 * Tests for the pure recovery-affordance helpers (R4-11-T3): the roadmap's
 * `InitiativeCard` gates its inspect/requeue/abandon affordances on the same
 * "recoverable" state set the retired standalone `/recovery` page used
 * (`in-flight` / `ready-for-review` / `failed` — NOT `merged`, a deliberately
 * transient pass-through state), and looks up per-initiative attempt info
 * from the grouped cycle list rather than the roadmap fetch (which doesn't
 * carry `attemptCount` natively). See `recovery-attrs.ts` for the functions
 * under test.
 */
import { test, expect } from 'vitest';
import { isRecoverableStatus, attemptInfoFor, RECOVERABLE_STATUSES } from './recovery-attrs.ts';
import type { InitiativeGroup } from './cycle-grouping.ts';

function group(overrides: Partial<InitiativeGroup> & { initiativeId: string }): InitiativeGroup {
  return {
    status: 'in-flight',
    activeCycleId: `${overrides.initiativeId}-cycle`,
    attemptCount: 1,
    priorCycleIds: [],
    ...overrides,
  };
}

test('RECOVERABLE_STATUSES is exactly in-flight / ready-for-review / failed', () => {
  expect([...RECOVERABLE_STATUSES].sort()).toEqual(['failed', 'in-flight', 'ready-for-review']);
});

test('isRecoverableStatus true for in-flight / ready-for-review / failed', () => {
  expect(isRecoverableStatus('in-flight')).toBe(true);
  expect(isRecoverableStatus('ready-for-review')).toBe(true);
  expect(isRecoverableStatus('failed')).toBe(true);
});

test('isRecoverableStatus false for merged / done / pending', () => {
  expect(isRecoverableStatus('merged')).toBe(false);
  expect(isRecoverableStatus('done')).toBe(false);
  expect(isRecoverableStatus('pending')).toBe(false);
});

test('attemptInfoFor returns the matching group\'s attemptCount + priorCycleIds', () => {
  const groups = [
    group({ initiativeId: 'INIT-a', attemptCount: 3, priorCycleIds: ['c1', 'c2'] }),
    group({ initiativeId: 'INIT-b' }),
  ];
  expect(attemptInfoFor('INIT-a', groups)).toEqual({ attemptCount: 3, priorCycleIds: ['c1', 'c2'] });
});

test('attemptInfoFor falls back to a single-attempt default when the initiative has no cycle group', () => {
  expect(attemptInfoFor('INIT-missing', [])).toEqual({ attemptCount: 1, priorCycleIds: [] });
});
