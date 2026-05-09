/**
 * Pure scoring functions for the developer-loop benchmark. Kept separate from
 * score.ts (the runner) so they are trivially unit-testable without mocking
 * the SDK or shelling out to test runners.
 *
 * Mirrors benchmarks/project-manager/scoring.ts shape:
 *   - one `terminated_cleanly` gate (run() returned without throwing).
 *   - five weighted criteria summed to 1.0.
 *   - PASS_THRESHOLD = 0.7 (matches brain + architect + PM benches).
 *
 * Why these dimensions and weights:
 *
 *   gate: terminated_cleanly
 *       If run() threw, no quality dimension matters — the loop crashed.
 *       Mirrors PM's `work_items_present` gate.
 *
 *   loop_completed (0.35)
 *       result.status === 'complete'. The loop's whole purpose is to drive a
 *       work item green. Anything else is efficiency around that — hence the
 *       heaviest weight.
 *
 *   iteration_budget_respected (0.20)
 *       result.iterations <= expected.max_iterations. Phase-doc target is
 *       median ≤ 3 iterations; the bench enforces that per fixture.
 *
 *   cost_budget_respected (0.15)
 *       result.cost_usd <= expected.max_cost_usd. Token-burn discipline.
 *
 *   files_in_scope_respected (0.20)
 *       Every modified path ∈ workItem.files_in_scope ∪ expected.files_in_scope_extra.
 *       Catches scope creep — the load-bearing PM-handoff invariant. If the
 *       loop ignores scope, the PM's `no_hidden_coupling` work was wasted.
 *
 *   no_regression (0.10)
 *       Pre-existing tests still pass at the end (provided by the bench
 *       harness as a separate command). Defends against the wedge-detector
 *       escape valve where the agent makes random changes that pass the new
 *       test but break others.
 *
 * Atomic-commits-per-AC discipline is intentionally NOT scored in v1: it's
 * hard to verify reliably across language fixtures (each language tooling
 * differs), and the existing weight set already discriminates good vs bad
 * loop behaviour. Promote when the rubric plateaus and we need finer
 * resolution.
 */

import type { LoopResult } from '../../loops/ralph/runner.ts';
import type { WorkItem } from '../../orchestrator/work-item.ts';

export type DevExpected = {
  max_iterations: number;
  max_cost_usd: number;
  must_complete: boolean;
  /** Argv-style command run by the bench to verify acceptance criteria. */
  quality_gate_cmd: string[];
  /** Optional argv-style command for the regression check. If undefined, regression criterion = 1. */
  pre_existing_tests_cmd?: string[];
  /** Test files that are allowed beyond `WorkItem.files_in_scope`. */
  files_in_scope_extra?: string[];
};

export type DevCriteria = {
  terminated_cleanly: 0 | 1;
  loop_completed: 0 | 1;
  iteration_budget_respected: 0 | 1;
  cost_budget_respected: 0 | 1;
  files_in_scope_respected: 0 | 1;
  no_regression: 0 | 1;
};

export type DevScore = {
  score: number;
  passed: boolean;
  criteria: DevCriteria;
  iterations: number;
  cost_usd: number;
  files_changed: string[];
  out_of_scope_files: string[];
  status: LoopResult['status'] | 'crashed';
  stop_reason: LoopResult['stop_reason'] | 'crashed';
};

export const PASS_THRESHOLD = 0.7;

// Weights — must sum to 1.
export const WEIGHT_COMPLETED = 0.35;
export const WEIGHT_ITERATIONS = 0.20;
export const WEIGHT_FILES_IN_SCOPE = 0.20;
export const WEIGHT_COST = 0.15;
export const WEIGHT_NO_REGRESSION = 0.10;

export function loopCompleted(result: LoopResult | null): number {
  return result !== null && result.status === 'complete' ? 1 : 0;
}

export function iterationBudgetRespected(result: LoopResult | null, expected: DevExpected): number {
  if (result === null) return 0;
  return result.iterations <= expected.max_iterations ? 1 : 0;
}

export function costBudgetRespected(result: LoopResult | null, expected: DevExpected): number {
  if (result === null) return 0;
  return result.cost_usd <= expected.max_cost_usd ? 1 : 0;
}

/**
 * Ralph loop bookkeeping artifacts — never count as scope creep.
 *
 * The Ralph runner stamps these into the worktree before the agent runs and
 * the agent is expected to update them across iterations. Treating their
 * modification as out-of-scope misclassifies normal loop behaviour as a
 * violation.
 *
 * - `PROMPT.md` — per-iteration brief; runner stamps once.
 * - `AGENT.md` — institutional memory; agent appends each iteration.
 * - `fix_plan.md` — checklist of acceptance criteria; agent ticks each iteration.
 * - `.forge/work-items/*.md` — WI spec; orchestrator updates frontmatter status
 *   after run() returns, but the agent may inspect it (and historically has
 *   touched it under SKILL.md step 8 wording — that step has been removed).
 */
const RALPH_WORKSPACE_ARTIFACTS: ReadonlySet<string> = new Set([
  'PROMPT.md',
  'AGENT.md',
  'fix_plan.md',
]);

function isRalphArtifact(path: string): boolean {
  if (RALPH_WORKSPACE_ARTIFACTS.has(path)) return true;
  return path.startsWith('.forge/work-items/');
}

export function filesInScopeRespected(
  result: LoopResult | null,
  workItem: WorkItem,
  expected: DevExpected,
): { value: 0 | 1; outOfScope: string[] } {
  if (result === null) return { value: 0, outOfScope: [] };
  const allowed = new Set<string>([
    ...workItem.files_in_scope,
    ...(expected.files_in_scope_extra ?? []),
  ]);
  const outOfScope = result.filesChanged
    .map(normalisePath)
    .filter((f) => !allowed.has(f) && !isRalphArtifact(f));
  return { value: outOfScope.length === 0 ? 1 : 0, outOfScope };
}

function normalisePath(p: string): string {
  // Path may come back from claude-agent.ts as absolute, relative, or a mix.
  // The work item's files_in_scope is worktree-relative. The bench harness
  // pre-normalises absolute paths via worktreeRelative(); as a defensive
  // fallback, drop any leading `./` and treat the path as-is.
  return p.replace(/^\.\//, '');
}

export type CaseScoreInput = {
  result: LoopResult | null;
  /** When result is null, the run threw. errorMessage carries the crash detail. */
  errorMessage?: string;
  workItem: WorkItem;
  expected: DevExpected;
  /** Did the regression command pass at the end of the run? Defaults to true if no command was supplied. */
  regressionPassed: boolean;
};

export function caseScore(input: CaseScoreInput): DevScore {
  const { result, workItem, expected, regressionPassed } = input;

  if (result === null) {
    return {
      score: 0,
      passed: false,
      criteria: emptyCriteria(),
      iterations: 0,
      cost_usd: 0,
      files_changed: [],
      out_of_scope_files: [],
      status: 'crashed',
      stop_reason: 'crashed',
    };
  }

  const completed = loopCompleted(result) as 0 | 1;
  const iterationsOk = iterationBudgetRespected(result, expected) as 0 | 1;
  const costOk = costBudgetRespected(result, expected) as 0 | 1;
  const scope = filesInScopeRespected(result, workItem, expected);
  const noRegression = (regressionPassed ? 1 : 0) as 0 | 1;

  const criteria: DevCriteria = {
    terminated_cleanly: 1,
    loop_completed: completed,
    iteration_budget_respected: iterationsOk,
    cost_budget_respected: costOk,
    files_in_scope_respected: scope.value,
    no_regression: noRegression,
  };

  const score =
    WEIGHT_COMPLETED * criteria.loop_completed +
    WEIGHT_ITERATIONS * criteria.iteration_budget_respected +
    WEIGHT_FILES_IN_SCOPE * criteria.files_in_scope_respected +
    WEIGHT_COST * criteria.cost_budget_respected +
    WEIGHT_NO_REGRESSION * criteria.no_regression;

  return {
    score,
    passed: score >= PASS_THRESHOLD,
    criteria,
    iterations: result.iterations,
    cost_usd: result.cost_usd,
    files_changed: result.filesChanged,
    out_of_scope_files: scope.outOfScope,
    status: result.status,
    stop_reason: result.stop_reason,
  };
}

function emptyCriteria(): DevCriteria {
  return {
    terminated_cleanly: 0,
    loop_completed: 0,
    iteration_budget_respected: 0,
    cost_budget_respected: 0,
    files_in_scope_respected: 0,
    no_regression: 0,
  };
}
