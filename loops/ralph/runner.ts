/**
 * Ralph loop driver.
 *
 * Implements the LoopInput / LoopResult interface declared in loops/README.md.
 * One run = one work item driven to a stop condition.
 *
 * STATUS: skeleton. Wires the shape end-to-end with a stub agent call so the
 * scaffold compiles and the smoke tests pass. Replacing the stub with a real
 * Claude Agent SDK query() call lands in a subsequent session per the
 * developer-loop phase doc.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkStopConditions,
  countOpenFixPlanItems,
  defaultQualityGates,
  type StopCondition,
  type LoopState,
} from './stop-conditions.ts';

export type LoopInput = {
  workItemSpecPath: string;
  worktreePath: string;
  initiativeBudget: { iterations: number; usd: number };
  brainQueryResults: string;
  cycleId: string;
  initiativeId: string;
};

export type LoopResult = {
  status: 'complete' | 'failed' | 'wedged';
  iterations: number;
  cost_usd: number;
  duration_ms: number;
  artifacts: { agentMdPath: string; fixPlanPath: string };
};

export type AgentInvocation = (params: {
  promptPath: string;
  agentMdPath: string;
  fixPlanPath: string;
  worktreePath: string;
  iteration: number;
}) => Promise<{ filesChanged: string[]; costUsd: number }>;

/** Stub agent invocation — replace with @anthropic-ai/claude-agent-sdk query() call. */
const stubAgent: AgentInvocation = async () => {
  return { filesChanged: [], costUsd: 0 };
};

export async function run(input: LoopInput, agent: AgentInvocation = stubAgent): Promise<LoopResult> {
  const startedAt = Date.now();
  const agentMdPath = join(input.worktreePath, 'AGENT.md');
  const fixPlanPath = join(input.worktreePath, 'fix_plan.md');
  const promptPath = join(input.worktreePath, 'PROMPT.md');

  // Stamp PROMPT.md and AGENT.md from templates if they don't exist yet.
  ensureScaffolded(input, promptPath, agentMdPath, fixPlanPath);

  const conditions: StopCondition[] = [
    { kind: 'quality-gates-pass' },
    { kind: 'iteration-budget', max: input.initiativeBudget.iterations },
    { kind: 'cost-budget', maxUsd: input.initiativeBudget.usd },
    { kind: 'wedged', noProgressIterations: 3 },
  ];

  const state: LoopState = {
    worktreePath: input.worktreePath,
    iteration: 0,
    costUsdSoFar: 0,
    fixPlanItemsHistory: [countOpenFixPlanItems(input.worktreePath)],
    filesChangedHistory: [],
  };

  for (;;) {
    const stop = checkStopConditions(state, conditions, () => defaultQualityGates(input.worktreePath));
    if (stop.stop) {
      return finalize(state, startedAt, stop.condition, agentMdPath, fixPlanPath);
    }

    state.iteration += 1;
    const result = await agent({
      promptPath,
      agentMdPath,
      fixPlanPath,
      worktreePath: input.worktreePath,
      iteration: state.iteration,
    });
    state.costUsdSoFar += result.costUsd;
    state.filesChangedHistory.push(result.filesChanged);
    state.fixPlanItemsHistory.push(countOpenFixPlanItems(input.worktreePath));
  }
}

function ensureScaffolded(
  input: LoopInput,
  promptPath: string,
  agentMdPath: string,
  fixPlanPath: string,
): void {
  if (!existsSync(promptPath)) {
    const tmpl = readFileSync(join(import.meta.dirname, 'PROMPT.md.tmpl'), 'utf8');
    writeFileSync(
      promptPath,
      tmpl
        .replace(/{{WORK_ITEM_ID}}/g, basename(input.workItemSpecPath, '.md'))
        .replace(/{{INITIATIVE_ID}}/g, input.initiativeId)
        .replace(/{{ITERATION}}/g, '0')
        .replace(/{{ITERATION_BUDGET}}/g, String(input.initiativeBudget.iterations))
        .replace(/{{WORK_ITEM_SPEC_BODY}}/g, readFileSync(input.workItemSpecPath, 'utf8')),
    );
  }
  if (!existsSync(agentMdPath)) {
    const tmpl = readFileSync(join(import.meta.dirname, 'AGENT.md.tmpl'), 'utf8');
    writeFileSync(
      agentMdPath,
      tmpl
        .replace(/{{WORK_ITEM_ID}}/g, basename(input.workItemSpecPath, '.md'))
        .replace(/{{BRAIN_QUERY_RESULTS}}/g, input.brainQueryResults),
    );
  }
  if (!existsSync(fixPlanPath)) {
    writeFileSync(fixPlanPath, '# Fix Plan\n\n_(populate from acceptance criteria)_\n');
  }
}

function finalize(
  state: LoopState,
  startedAt: number,
  stopReason: string,
  agentMdPath: string,
  fixPlanPath: string,
): LoopResult {
  const status: LoopResult['status'] =
    stopReason === 'quality-gates-pass'
      ? 'complete'
      : stopReason === 'wedged'
        ? 'wedged'
        : 'failed';
  return {
    status,
    iterations: state.iteration,
    cost_usd: state.costUsdSoFar,
    duration_ms: Date.now() - startedAt,
    artifacts: { agentMdPath, fixPlanPath },
  };
}

function basename(p: string, ext: string): string {
  const last = p.split('/').pop() ?? p;
  return last.endsWith(ext) ? last.slice(0, -ext.length) : last;
}
