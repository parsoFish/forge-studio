/**
 * M7-A — unit coverage for `dev-cost-bound.ts`'s three pure helpers:
 *
 *   `resolveWiCostBudgetUsd` — the real remaining cycle budget (never the
 *   hardcoded `Number.POSITIVE_INFINITY` this replaces).
 *   `makeCostCeilingCheck`   — the live, per-iteration predicate wired into
 *   `runRalph` as `LoopInput.costCeilingCheck`.
 *   `isCostCeilingHalt`      — whether a `LoopResult` stopped for the cost
 *   ceiling, reusing the existing `cost-budget` stop_reason vocabulary.
 *
 * A mutation each test kills: `resolveWiCostBudgetUsd` hardcoded back to
 * `Infinity` regardless of `remainingCostBudgetUsd` fails the "returns the
 * live figure" test; `makeCostCeilingCheck` memoizing its first read fails
 * the "re-reads on every call" test; `isCostCeilingHalt` matching on
 * `status` instead of `stop_reason` fails the "only cost-budget" test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWiCostBudgetUsd,
  makeCostCeilingCheck,
  isCostCeilingHalt,
} from '../../phases/dev-cost-bound.ts';
import type { CycleInput } from '@forge/flows';
import type { LoopResult } from '@forge/agents';

function baseInput(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    initiativeId: 'INIT-x',
    manifestPath: '/tmp/manifest.md',
    projectRepoPath: '/tmp/repo',
    worktreePath: '/tmp/wt',
    ...overrides,
  };
}

function loopResult(stop_reason: LoopResult['stop_reason']): LoopResult {
  return {
    status: 'failed',
    iterations: 1,
    cost_usd: 0,
    duration_ms: 0,
    artifacts: { agentMdPath: '', fixPlanPath: '' },
    filesChanged: [],
    stop_reason,
    toolUseTotal: 0,
  };
}

// ---------------------------------------------------------------------------
// resolveWiCostBudgetUsd
// ---------------------------------------------------------------------------

test('resolveWiCostBudgetUsd: Infinity when remainingCostBudgetUsd is absent — a TRUE "no ceiling configured" reading', () => {
  assert.equal(resolveWiCostBudgetUsd(baseInput()), Infinity);
});

test('resolveWiCostBudgetUsd: returns the live figure from CycleInput.remainingCostBudgetUsd', () => {
  const input = baseInput({ remainingCostBudgetUsd: () => 3.5 });
  assert.equal(resolveWiCostBudgetUsd(input), 3.5);
});

test('resolveWiCostBudgetUsd: re-reads on every call — never a cached snapshot', () => {
  let remaining = 5;
  const input = baseInput({ remainingCostBudgetUsd: () => remaining });
  assert.equal(resolveWiCostBudgetUsd(input), 5);
  remaining = 0.1;
  assert.equal(resolveWiCostBudgetUsd(input), 0.1, 'must reflect the CURRENT remaining budget');
});

// ---------------------------------------------------------------------------
// makeCostCeilingCheck
// ---------------------------------------------------------------------------

test('makeCostCeilingCheck: false while remaining budget is positive', () => {
  const input = baseInput({ remainingCostBudgetUsd: () => 2 });
  assert.equal(makeCostCeilingCheck(input)(), false);
});

test('makeCostCeilingCheck: true once remaining budget hits zero or goes negative', () => {
  let remaining = 1;
  const input = baseInput({ remainingCostBudgetUsd: () => remaining });
  const check = makeCostCeilingCheck(input);
  assert.equal(check(), false);
  remaining = 0;
  assert.equal(check(), true, 'zero remaining must trip the check');
  remaining = -0.5;
  assert.equal(check(), true, 'overshoot must still read as tripped');
});

test('makeCostCeilingCheck: never trips when no ceiling is configured', () => {
  const input = baseInput();
  assert.equal(makeCostCeilingCheck(input)(), false, 'Infinity remaining never reads as crossed');
});

test('makeCostCeilingCheck: built once, re-reads the LIVE accessor on every call (a sibling WI spending between calls trips it)', () => {
  let remaining = 1;
  const input = baseInput({ remainingCostBudgetUsd: () => remaining });
  const check = makeCostCeilingCheck(input); // built once, like developer-loop.ts does per WI
  assert.equal(check(), false);
  remaining -= 1.5; // a concurrently-dispatched sibling's spend crosses the shared ceiling
  assert.equal(check(), true, 'the SAME predicate instance must see the new total');
});

// ---------------------------------------------------------------------------
// isCostCeilingHalt
// ---------------------------------------------------------------------------

test('isCostCeilingHalt: true only for stop_reason "cost-budget"', () => {
  assert.equal(isCostCeilingHalt(loopResult('cost-budget')), true);
  assert.equal(isCostCeilingHalt(loopResult('iteration-budget')), false);
  assert.equal(isCostCeilingHalt(loopResult('quality-gates-pass')), false);
  assert.equal(isCostCeilingHalt(loopResult('gate-too-loose')), false);
  assert.equal(isCostCeilingHalt(loopResult('already-complete')), false);
  assert.equal(isCostCeilingHalt(loopResult('gate-errored')), false);
  assert.equal(isCostCeilingHalt(loopResult('loop-cap-exhausted')), false);
  assert.equal(isCostCeilingHalt(loopResult('hollow-no-work')), false);
});

test('isCostCeilingHalt: false for a null result (a crashed/never-ran WI)', () => {
  assert.equal(isCostCeilingHalt(null), false);
});
