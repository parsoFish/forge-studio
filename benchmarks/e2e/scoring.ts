/**
 * Pure scoring functions for the end-to-end benchmark. Same shape as the
 * per-phase benches: gate criterion + weighted criteria summing to 1.0,
 * pass threshold 0.7.
 *
 * Why these dimensions and weights:
 *
 *   gate: cycle_completed
 *       runCycle returned without throwing. If it threw, no quality
 *       dimension matters — the cycle crashed.
 *
 *   merged (0.40)
 *       The cycle ended with an approved + merged PR (gh shim recorded
 *       merged=true). The whole point of the integration loop is to drive
 *       the initiative to merged-on-main; this is the heaviest weight.
 *
 *   converged_within_budget (0.25)
 *       Review-Ralph rounds <= 2 (i.e., approved on iteration 1 or
 *       iteration 2 with one send-back). Round count > 2 means the loop
 *       hit the cap; treat as inefficient.
 *
 *   spec_satisfied (0.20)
 *       Orchestrator re-runs every target-spec check post-merge against
 *       the merged worktree. All must exit 0. Independent of the
 *       simulator's verdict — catches the case where the simulator
 *       approved but the actual code doesn't satisfy the spec.
 *
 *   cost_within_budget (0.10)
 *       Total cycle cost (PM + dev-loop + review-Ralph + simulator)
 *       <= budget cap. Discipline against runaway cost.
 *
 *   no_regression (0.05)
 *       Pre-existing tests on main still pass after merge. Trivially
 *       true on first cycle when main starts effectively empty;
 *       load-bearing for future fixtures with prior commits.
 */

import type { CycleResult } from '../../orchestrator/cycle.ts';
import type { PreComputedSpecResults } from './simulator.ts';

export type E2eExpected = {
  /** Max review-Ralph rounds tolerated (>= this -> converged criterion fails). */
  max_rounds: number;
  /** Total cycle cost cap in USD. */
  max_cost_usd: number;
  /** Argv-style command to verify pre-existing tests still pass. Optional. */
  pre_existing_tests_cmd?: string[];
};

export type E2eCriteria = {
  cycle_completed: 0 | 1;
  merged: 0 | 1;
  converged_within_budget: 0 | 1;
  spec_satisfied: 0 | 1;
  cost_within_budget: 0 | 1;
  no_regression: 0 | 1;
};

export type E2eScore = {
  score: number;
  passed: boolean;
  criteria: E2eCriteria;
  rounds: number;
  cost_usd: number;
  outcome: CycleResult['status'] | 'crashed';
  spec_failures: string[];
};

export const PASS_THRESHOLD = 0.7;

// Weights — must sum to 1.
export const WEIGHT_MERGED = 0.40;
export const WEIGHT_CONVERGED = 0.25;
export const WEIGHT_SPEC_SATISFIED = 0.20;
export const WEIGHT_COST = 0.10;
export const WEIGHT_NO_REGRESSION = 0.05;

export type CaseScoreInput = {
  cycleResult: CycleResult | null;
  cycleThrew: boolean;
  rounds: number;
  costUsd: number;
  merged: boolean;
  postMergeSpecResults: PreComputedSpecResults | null;
  expected: E2eExpected;
  /** Did the regression command pass post-merge? Defaults to true if no command. */
  regressionPassed: boolean;
};

export function caseScore(input: CaseScoreInput): E2eScore {
  const { cycleResult, cycleThrew, rounds, costUsd, merged, postMergeSpecResults, expected, regressionPassed } = input;

  if (cycleThrew || cycleResult === null) {
    return {
      score: 0,
      passed: false,
      criteria: emptyCriteria(),
      rounds,
      cost_usd: costUsd,
      outcome: 'crashed',
      spec_failures: ['cycle threw before completing'],
    };
  }

  const mergedC = merged ? 1 : 0;
  const convergedC = rounds > 0 && rounds <= expected.max_rounds ? 1 : 0;
  const specResult = scoreSpecSatisfied(postMergeSpecResults);
  const costC = costUsd <= expected.max_cost_usd ? 1 : 0;
  const noRegressionC = regressionPassed ? 1 : 0;

  const criteria: E2eCriteria = {
    cycle_completed: 1,
    merged: mergedC as 0 | 1,
    converged_within_budget: convergedC as 0 | 1,
    spec_satisfied: specResult.value,
    cost_within_budget: costC as 0 | 1,
    no_regression: noRegressionC as 0 | 1,
  };

  const score =
    WEIGHT_MERGED * criteria.merged +
    WEIGHT_CONVERGED * criteria.converged_within_budget +
    WEIGHT_SPEC_SATISFIED * criteria.spec_satisfied +
    WEIGHT_COST * criteria.cost_within_budget +
    WEIGHT_NO_REGRESSION * criteria.no_regression;

  return {
    score,
    passed: score >= PASS_THRESHOLD,
    criteria,
    rounds,
    cost_usd: costUsd,
    outcome: cycleResult.status,
    spec_failures: specResult.failures,
  };
}

function scoreSpecSatisfied(
  results: PreComputedSpecResults | null,
): { value: 0 | 1; failures: string[] } {
  if (!results) return { value: 0, failures: ['no spec results recorded'] };
  const failures: string[] = [];
  if (!results.manifest_acs_pass) failures.push('manifest_ac_command exited non-zero');
  for (const r of results.non_functional_results) {
    if (!r.passed) failures.push(`non_functional: ${r.description}`);
  }
  for (const [sig, present] of Object.entries(results.pr_signals_present)) {
    if (!present) failures.push(`pr_signal_missing: "${sig}"`);
  }
  return { value: failures.length === 0 ? 1 : 0, failures };
}

function emptyCriteria(): E2eCriteria {
  return {
    cycle_completed: 0,
    merged: 0,
    converged_within_budget: 0,
    spec_satisfied: 0,
    cost_within_budget: 0,
    no_regression: 0,
  };
}
