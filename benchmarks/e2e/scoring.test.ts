/**
 * Unit tests for benchmarks/e2e/scoring.ts. Pure-function tests — assemble
 * synthetic inputs, call caseScore, assert criteria booleans + score arithmetic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  caseScore,
  PASS_THRESHOLD,
  WEIGHT_CONVERGED,
  WEIGHT_COST,
  WEIGHT_MERGED,
  WEIGHT_NO_REGRESSION,
  WEIGHT_SPEC_SATISFIED,
  type CaseScoreInput,
  type E2eExpected,
} from './scoring.ts';
import type { CycleResult } from '../../orchestrator/cycle.ts';
import type { PreComputedSpecResults } from './simulator.ts';

function expected(o: Partial<E2eExpected> = {}): E2eExpected {
  return { max_rounds: 2, max_cost_usd: 10, ...o };
}

function specGreen(): PreComputedSpecResults {
  return {
    manifest_acs_pass: true,
    non_functional_results: [
      { description: 'edge case empty', passed: true },
      { description: 'consecutive separators', passed: true },
    ],
    pr_signals_present: { 'edge case': true, Why: true },
  };
}

function cycleResult(o: Partial<CycleResult> = {}): CycleResult {
  return {
    cycle_id: 'cy-1',
    initiative_id: 'INIT-test',
    status: 'merged',
    duration_ms: 1000,
    log_path: '/tmp/log',
    ...o,
  };
}

function input(o: Partial<CaseScoreInput> = {}): CaseScoreInput {
  return {
    cycleResult: cycleResult(),
    cycleThrew: false,
    rounds: 1,
    costUsd: 5,
    merged: true,
    postMergeSpecResults: specGreen(),
    expected: expected(),
    regressionPassed: true,
    ...o,
  };
}

test('caseScore: ideal happy path scores 1.0 and passes', () => {
  const s = caseScore(input());
  assert.equal(s.score, 1);
  assert.ok(s.passed);
  assert.deepEqual(s.criteria, {
    cycle_completed: 1,
    merged: 1,
    converged_within_budget: 1,
    spec_satisfied: 1,
    cost_within_budget: 1,
    no_regression: 1,
  });
});

test('caseScore: cycle threw → score 0 with crashed outcome', () => {
  const s = caseScore(input({ cycleThrew: true, cycleResult: null }));
  assert.equal(s.score, 0);
  assert.ok(!s.passed);
  assert.equal(s.outcome, 'crashed');
});

test('caseScore: not merged → loses merged weight, may still pass on partials', () => {
  const s = caseScore(input({ merged: false }));
  assert.equal(s.criteria.merged, 0);
  assert.ok(Math.abs(s.score - (1 - WEIGHT_MERGED)) < 1e-9);
});

test('caseScore: rounds beyond cap → loses converged weight', () => {
  const s = caseScore(input({ rounds: 3 }));
  assert.equal(s.criteria.converged_within_budget, 0);
  assert.ok(Math.abs(s.score - (1 - WEIGHT_CONVERGED)) < 1e-9);
});

test('caseScore: rounds at cap is OK', () => {
  const s = caseScore(input({ rounds: 2 }));
  assert.equal(s.criteria.converged_within_budget, 1);
});

test('caseScore: spec failure → loses spec weight + records failures', () => {
  const failingSpec: PreComputedSpecResults = {
    manifest_acs_pass: true,
    non_functional_results: [{ description: 'edge case empty', passed: false }],
    pr_signals_present: { Why: true },
  };
  const s = caseScore(input({ postMergeSpecResults: failingSpec }));
  assert.equal(s.criteria.spec_satisfied, 0);
  assert.ok(s.spec_failures.length > 0);
  assert.match(s.spec_failures.join(' '), /edge case empty/);
});

test('caseScore: missing pr signal flagged in spec_failures', () => {
  const s = caseScore(
    input({
      postMergeSpecResults: {
        manifest_acs_pass: true,
        non_functional_results: [],
        pr_signals_present: { 'edge case': false, Why: true },
      },
    }),
  );
  assert.match(s.spec_failures.join(' '), /pr_signal_missing.*edge case/);
});

test('caseScore: cost over budget → loses cost weight', () => {
  const s = caseScore(input({ costUsd: 15 }));
  assert.equal(s.criteria.cost_within_budget, 0);
  assert.ok(Math.abs(s.score - (1 - WEIGHT_COST)) < 1e-9);
});

test('caseScore: regression failure → loses no_regression weight', () => {
  const s = caseScore(input({ regressionPassed: false }));
  assert.equal(s.criteria.no_regression, 0);
  assert.ok(Math.abs(s.score - (1 - WEIGHT_NO_REGRESSION)) < 1e-9);
});

test('caseScore: weights sum to 1.0', () => {
  const sum =
    WEIGHT_MERGED + WEIGHT_CONVERGED + WEIGHT_SPEC_SATISFIED + WEIGHT_COST + WEIGHT_NO_REGRESSION;
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
});

test('caseScore: pass threshold matches phase convention', () => {
  assert.equal(PASS_THRESHOLD, 0.7);
});

test('caseScore: only merged + converged is below threshold (0.65)', () => {
  // merged + converged only = 0.40 + 0.25 = 0.65, below 0.7
  const s = caseScore(
    input({
      postMergeSpecResults: {
        manifest_acs_pass: false,
        non_functional_results: [],
        pr_signals_present: {},
      },
      costUsd: 100,
      regressionPassed: false,
    }),
  );
  assert.ok(Math.abs(s.score - (WEIGHT_MERGED + WEIGHT_CONVERGED)) < 1e-9);
  assert.ok(!s.passed, 'merged+converged alone should not pass');
});
