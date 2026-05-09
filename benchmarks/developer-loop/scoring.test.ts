/**
 * Unit tests for benchmarks/developer-loop/scoring.ts. Pure functions only —
 * no SDK, no shells, no tempdirs. Mirrors benchmarks/project-manager/scoring.test.ts
 * shape: assemble a synthetic LoopResult + WorkItem + DevExpected, call
 * caseScore, assert the criteria booleans and score arithmetic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  caseScore,
  costBudgetRespected,
  filesInScopeRespected,
  iterationBudgetRespected,
  loopCompleted,
  PASS_THRESHOLD,
  WEIGHT_COMPLETED,
  WEIGHT_COST,
  WEIGHT_FILES_IN_SCOPE,
  WEIGHT_ITERATIONS,
  WEIGHT_NO_REGRESSION,
  type DevExpected,
} from './scoring.ts';
import type { LoopResult } from '../../loops/ralph/runner.ts';
import type { WorkItem } from '../../orchestrator/work-item.ts';

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: 'WI-1',
    feature_id: 'FEAT-1',
    initiative_id: 'INIT-2026-05-09-test',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['src/foo.ts'],
    estimated_iterations: 2,
    body: '',
    ...overrides,
  };
}

function loopResult(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    status: 'complete',
    iterations: 2,
    cost_usd: 0.15,
    duration_ms: 1000,
    artifacts: { agentMdPath: '/tmp/a', fixPlanPath: '/tmp/p' },
    filesChanged: ['src/foo.ts'],
    stop_reason: 'quality-gates-pass',
    ...overrides,
  };
}

function expected(overrides: Partial<DevExpected> = {}): DevExpected {
  return {
    max_iterations: 3,
    max_cost_usd: 0.30,
    must_complete: true,
    quality_gate_cmd: ['npm', 'test'],
    files_in_scope_extra: ['tests/foo.test.ts'],
    ...overrides,
  };
}

test('caseScore: ideal run scores 1.0 and passes', () => {
  const score = caseScore({
    result: loopResult(),
    workItem: workItem(),
    expected: expected(),
    regressionPassed: true,
  });
  assert.equal(score.score, 1);
  assert.ok(score.passed);
  assert.deepEqual(score.criteria, {
    terminated_cleanly: 1,
    loop_completed: 1,
    iteration_budget_respected: 1,
    cost_budget_respected: 1,
    files_in_scope_respected: 1,
    no_regression: 1,
  });
  assert.equal(score.status, 'complete');
  assert.equal(score.stop_reason, 'quality-gates-pass');
  assert.deepEqual(score.out_of_scope_files, []);
});

test('caseScore: crashed run scores 0 and fails the gate', () => {
  const score = caseScore({
    result: null,
    errorMessage: 'spawn ENOENT',
    workItem: workItem(),
    expected: expected(),
    regressionPassed: true,
  });
  assert.equal(score.score, 0);
  assert.ok(!score.passed);
  assert.equal(score.criteria.terminated_cleanly, 0);
  assert.equal(score.status, 'crashed');
  assert.equal(score.stop_reason, 'crashed');
});

test('caseScore: failed run (over iteration budget) loses iteration weight only', () => {
  const score = caseScore({
    result: loopResult({ status: 'failed', iterations: 5, stop_reason: 'iteration-budget' }),
    workItem: workItem(),
    expected: expected({ max_iterations: 3 }),
    regressionPassed: true,
  });
  // loses loop_completed (0.35) AND iteration_budget_respected (0.20)
  const want = WEIGHT_FILES_IN_SCOPE + WEIGHT_COST + WEIGHT_NO_REGRESSION;
  assert.equal(round3(score.score), round3(want));
  assert.equal(score.criteria.loop_completed, 0);
  assert.equal(score.criteria.iteration_budget_respected, 0);
  assert.ok(!score.passed);
});

test('caseScore: completed but cost-overrun keeps loop_completed and loses cost', () => {
  const score = caseScore({
    result: loopResult({ cost_usd: 0.50 }),
    workItem: workItem(),
    expected: expected({ max_cost_usd: 0.30 }),
    regressionPassed: true,
  });
  const want = 1 - WEIGHT_COST;
  assert.equal(round3(score.score), round3(want));
  assert.equal(score.criteria.cost_budget_respected, 0);
  assert.equal(score.criteria.loop_completed, 1);
});

test('caseScore: out-of-scope file modification loses scope weight', () => {
  const score = caseScore({
    result: loopResult({ filesChanged: ['src/foo.ts', 'src/secret-config.ts'] }),
    workItem: workItem({ files_in_scope: ['src/foo.ts'] }),
    expected: expected({ files_in_scope_extra: [] }),
    regressionPassed: true,
  });
  const want = 1 - WEIGHT_FILES_IN_SCOPE;
  assert.equal(round3(score.score), round3(want));
  assert.equal(score.criteria.files_in_scope_respected, 0);
  assert.deepEqual(score.out_of_scope_files, ['src/secret-config.ts']);
});

test('caseScore: regression failure loses no_regression weight only', () => {
  const score = caseScore({
    result: loopResult(),
    workItem: workItem(),
    expected: expected(),
    regressionPassed: false,
  });
  const want = 1 - WEIGHT_NO_REGRESSION;
  assert.equal(round3(score.score), round3(want));
  assert.equal(score.criteria.no_regression, 0);
});

test('caseScore: completed at exactly iteration budget passes the iteration criterion', () => {
  // boundary: max_iterations is inclusive
  const score = caseScore({
    result: loopResult({ iterations: 3 }),
    workItem: workItem(),
    expected: expected({ max_iterations: 3 }),
    regressionPassed: true,
  });
  assert.equal(score.criteria.iteration_budget_respected, 1);
});

test('caseScore: pass threshold of 0.7 is the gate', () => {
  // With weights 0.35/0.20/0.20/0.15/0.10, dropping the two lightest (cost +
  // no_regression) gives 0.75 — still passes. Dropping a heavier one fails.
  const dropCostAndRegression = caseScore({
    result: loopResult({ cost_usd: 1 }),
    workItem: workItem(),
    expected: expected({ max_cost_usd: 0.3 }),
    regressionPassed: false,
  });
  assert.ok(dropCostAndRegression.score >= PASS_THRESHOLD, `${dropCostAndRegression.score} >= ${PASS_THRESHOLD}`);

  const dropCompleted = caseScore({
    result: loopResult({ status: 'failed', stop_reason: 'iteration-budget' }),
    workItem: workItem(),
    expected: expected(),
    regressionPassed: true,
  });
  assert.ok(dropCompleted.score < PASS_THRESHOLD, `${dropCompleted.score} < ${PASS_THRESHOLD}`);
});

test('filesInScopeRespected: Ralph workspace artifacts are not counted as out-of-scope', () => {
  const r = filesInScopeRespected(
    loopResult({
      filesChanged: [
        'src/foo.ts',
        'AGENT.md',
        'fix_plan.md',
        'PROMPT.md',
        '.forge/work-items/WI-1.md',
      ],
    }),
    workItem({ files_in_scope: ['src/foo.ts'] }),
    expected({ files_in_scope_extra: [] }),
  );
  assert.equal(r.value, 1);
  assert.deepEqual(r.outOfScope, []);
});

test('filesInScopeRespected: source files outside scope are still flagged even with Ralph artifacts present', () => {
  const r = filesInScopeRespected(
    loopResult({
      filesChanged: ['src/foo.ts', 'src/secret.ts', 'AGENT.md'],
    }),
    workItem({ files_in_scope: ['src/foo.ts'] }),
    expected({ files_in_scope_extra: [] }),
  );
  assert.equal(r.value, 0);
  assert.deepEqual(r.outOfScope, ['src/secret.ts']);
});

test('filesInScopeRespected: leading ./ is stripped before comparison', () => {
  const r = filesInScopeRespected(
    loopResult({ filesChanged: ['./src/foo.ts'] }),
    workItem({ files_in_scope: ['src/foo.ts'] }),
    expected(),
  );
  assert.equal(r.value, 1);
  assert.deepEqual(r.outOfScope, []);
});

test('individual criterion helpers handle null result', () => {
  assert.equal(loopCompleted(null), 0);
  assert.equal(iterationBudgetRespected(null, expected()), 0);
  assert.equal(costBudgetRespected(null, expected()), 0);
  const r = filesInScopeRespected(null, workItem(), expected());
  assert.equal(r.value, 0);
  assert.deepEqual(r.outOfScope, []);
});

test('weights sum to 1', () => {
  const sum =
    WEIGHT_COMPLETED + WEIGHT_ITERATIONS + WEIGHT_FILES_IN_SCOPE + WEIGHT_COST + WEIGHT_NO_REGRESSION;
  assert.equal(round3(sum), 1);
});

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
