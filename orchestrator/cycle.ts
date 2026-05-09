/**
 * Run one initiative end-to-end:
 *   PM → developer-loop (per work item) → review-prep
 *
 * The orchestrator's only job is to thread phase outputs into the next phase's
 * inputs. Each phase is invoked by calling its skill via the Claude Agent SDK
 * (or, for the developer loop, via loops/ralph/runner.ts).
 *
 * STATUS: skeleton. Each phase invocation is a no-op stub that emits start/end
 * events to the log so the wiring is provable. Implementation lands per
 * docs/phases/<phase>.md.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { EventLogger } from './logging.ts';
import { createLogger } from './logging.ts';
import { parseManifest } from './manifest.ts';
import {
  PM_ALLOWED_TOOLS,
  PM_DISALLOWED_TOOLS,
  PM_MODEL,
  buildPmSystemPrompt,
  renderPmUserPrompt,
  tallyToolUse,
  type PmToolUseSummary,
} from './pm-invocation.ts';
import {
  DEV_ALLOWED_TOOLS,
  DEV_DISALLOWED_TOOLS,
  DEV_MODEL,
  buildDevSystemPrompt,
  prepareDevWorkspace,
  tallyToolUse as tallyDevToolUse,
  type DevToolUseSummary,
} from './dev-invocation.ts';
import {
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItemStatus,
  type WorkItem,
} from './work-item.ts';
import { createClaudeAgent, type QueryFn } from '../loops/ralph/claude-agent.ts';
import { run as runRalph, type LoopResult } from '../loops/ralph/runner.ts';

export type CycleInput = {
  initiativeId: string;
  manifestPath: string;
  projectRepoPath: string;
  worktreePath: string;
  cycleId?: string;
  dryRun?: boolean;
};

export type CycleResult = {
  cycle_id: string;
  initiative_id: string;
  status: 'ready-for-review' | 'failed';
  duration_ms: number;
  log_path: string;
};

export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const started = Date.now();
  const cycleId = input.cycleId ?? newCycleId(input.initiativeId);
  const logger = createLogger(cycleId);

  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
    message: input.dryRun ? 'cycle.start (dry run)' : 'cycle.start',
  });

  try {
    if (!input.dryRun) {
      await runProjectManager(input, logger);
      await runDeveloperLoop(input, logger);
      await runReviewPrep(input, logger);
    }

    const result: CycleResult = {
      cycle_id: cycleId,
      initiative_id: input.initiativeId,
      status: 'ready-for-review',
      duration_ms: Date.now() - started,
      log_path: logger.logFilePath,
    };

    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'end',
      input_refs: [input.manifestPath],
      output_refs: [logger.logFilePath],
      duration_ms: result.duration_ms,
      message: 'cycle.end',
      metadata: { status: result.status },
    });

    return result;
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      cycle_id: cycleId,
      initiative_id: input.initiativeId,
      status: 'failed',
      duration_ms: Date.now() - started,
      log_path: logger.logFilePath,
    };
  }
}

/**
 * Defaults for the live PM invocation. Higher budget + turn cap than the bench
 * (real worktrees are richer than fixtures); the bench enforces 0.5 USD / 30
 * turns to keep iteration cheap.
 */
const PM_LIVE_MAX_TURNS = 50;
const PM_LIVE_MAX_BUDGET_USD = 1.0;

async function runProjectManager(input: CycleInput, logger: EventLogger): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
  });

  const manifest = parseManifest(readFileSync(input.manifestPath, 'utf8'));
  const featureCountByFeatureId = new Map<string, number>();
  for (const f of manifest.features) featureCountByFeatureId.set(f.feature_id, 0);

  const forgeRoot = resolve(import.meta.dirname, '..');
  const systemPrompt = buildPmSystemPrompt(forgeRoot);
  const prompt = renderPmUserPrompt({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    worktreeRelPath: input.worktreePath,
    projectName: manifest.project,
    minWorkItems: Math.max(manifest.features.length, 2),
    maxWorkItems: Math.max(manifest.features.length * 4, 6),
    parallelFractionAtLeast: 0.3,
  });

  const options: Record<string, unknown> = {
    cwd: forgeRoot,
    systemPrompt,
    model: PM_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: PM_ALLOWED_TOOLS,
    disallowedTools: PM_DISALLOWED_TOOLS,
    maxTurns: PM_LIVE_MAX_TURNS,
    maxBudgetUsd: PM_LIVE_MAX_BUDGET_USD,
  };

  const toolUseSummary: PmToolUseSummary = { brainReads: 0, writes: 0, bashCalls: 0 };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;

  for await (const msg of sdkQuery({ prompt, options }) as AsyncIterable<unknown>) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> }; subtype?: string; total_cost_usd?: number; duration_ms?: number };
    if (m.type === 'assistant') {
      tallyToolUse(m.message, toolUseSummary);
      continue;
    }
    if (m.type !== 'result') continue;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    resultSubtype = m.subtype ?? 'success';
    break;
  }

  for (let i = 0; i < toolUseSummary.brainReads; i++) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'tool_use',
      input_refs: ['brain/'],
      output_refs: [],
      message: 'pm.brain-query',
    });
  }

  const workItemsDir = resolve(input.worktreePath, '.forge', 'work-items');
  const { items, parseErrors } = readWorkItemsFromDir(workItemsDir);

  for (const item of items) {
    const prev = featureCountByFeatureId.get(item.feature_id) ?? 0;
    featureCountByFeatureId.set(item.feature_id, prev + 1);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [resolve(workItemsDir, `${item.work_item_id}.md`)],
      message: 'pm.work-item-emitted',
      metadata: { work_item_id: item.work_item_id, feature_id: item.feature_id },
    });
  }

  for (const [featureId, count] of featureCountByFeatureId.entries()) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: 'pm.feature-decomposed',
      metadata: { feature_id: featureId, work_item_count: count },
    });
  }

  const knownFeatureIds = new Set(manifest.features.map((f) => f.feature_id));
  const { perItem, setErrors } = validateWorkItemSet(items, {
    expectedInitiativeId: manifest.initiative_id,
    knownFeatureIds,
  });
  const itemErrorCount = Object.values(perItem).reduce((acc, errs) => acc + errs.length, 0);
  const failed =
    items.length === 0 ||
    Object.keys(parseErrors).length > 0 ||
    setErrors.length > 0 ||
    itemErrorCount > 0;

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [input.manifestPath],
    output_refs: [resolve(workItemsDir, '_graph.md')],
    message: 'pm.graph-emitted',
  });

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: failed ? 'error' : 'end',
    input_refs: [input.manifestPath],
    output_refs: [workItemsDir],
    duration_ms: durationMs,
    cost_usd: costUsd,
    metadata: {
      work_item_count: items.length,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
      parse_errors: parseErrors,
      set_errors: setErrors,
      per_item_error_count: itemErrorCount,
    },
  });

  if (failed) {
    const summary = [
      items.length === 0 ? 'no work items emitted' : null,
      Object.keys(parseErrors).length > 0 ? `parse errors: ${Object.keys(parseErrors).join(', ')}` : null,
      setErrors.length > 0 ? `set errors: ${setErrors.join('; ')}` : null,
      itemErrorCount > 0 ? `${itemErrorCount} per-item validation errors` : null,
    ]
      .filter((s): s is string => s !== null)
      .join('; ');
    throw new Error(`project-manager phase failed: ${summary}`);
  }
}

/**
 * Defaults for the live Ralph loop. Higher per-iteration USD cap than the bench
 * (live worktrees are richer); the bench tightens to 0.30 USD / 3 iterations
 * per fixture to surface efficiency regressions quickly.
 */
const DEV_LIVE_DEFAULT_ITERATIONS_PER_WI = 5;
const DEV_LIVE_DEFAULT_USD_PER_WI = 1.0;
const DEV_LIVE_MAX_TURNS_PER_ITERATION = 25;
const DEV_LIVE_MAX_BUDGET_USD_PER_ITERATION = 0.50;

async function runDeveloperLoop(input: CycleInput, logger: EventLogger): Promise<void> {
  const workItemsDir = resolve(input.worktreePath, '.forge/work-items');
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'start',
    input_refs: [workItemsDir],
    output_refs: [],
  });

  const { items, parseErrors } = readWorkItemsFromDir(workItemsDir);
  if (Object.keys(parseErrors).length > 0) {
    throw new Error(
      `developer-loop: parse errors: ${Object.entries(parseErrors).map(([f, e]) => `${f}: ${e}`).join('; ')}`,
    );
  }
  if (items.length === 0) {
    throw new Error(`developer-loop: no work items found at ${workItemsDir}`);
  }
  const { setErrors } = validateWorkItemSet(items);
  if (setErrors.length > 0) {
    throw new Error(`developer-loop: invalid WI set: ${setErrors.join('; ')}`);
  }

  const ordered = topologicalOrder(items);
  const forgeRoot = resolve(import.meta.dirname, '..');
  const systemPrompt = buildDevSystemPrompt(forgeRoot);
  const sdkQueryFn = sdkQuery as unknown as QueryFn;

  const wiOutcomes: Array<{ id: string; status: WorkItem['status']; result: LoopResult | null }> = [];

  for (const wi of ordered) {
    const wiStart = logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'log',
      input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
      output_refs: [],
      message: 'ralph.start',
      metadata: { work_item_id: wi.work_item_id, feature_id: wi.feature_id },
    });

    if (prerequisiteFailed(wi, wiOutcomes)) {
      writeWorkItemStatus(resolve(workItemsDir, `${wi.work_item_id}.md`), 'failed');
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: wiStart.event_id,
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'log',
        input_refs: [resolve(workItemsDir, `${wi.work_item_id}.md`)],
        output_refs: [],
        message: 'ralph.skipped',
        metadata: { work_item_id: wi.work_item_id, reason: 'prerequisite-failed' },
      });
      wiOutcomes.push({ id: wi.work_item_id, status: 'failed', result: null });
      continue;
    }

    const specPath = resolve(workItemsDir, `${wi.work_item_id}.md`);
    const wiToolUse: DevToolUseSummary = { reads: 0, writes: 0, bashCalls: 0, testRuns: 0 };

    prepareDevWorkspace({
      initiativeId: input.initiativeId,
      workItemSpecPath: specPath,
      workItemSpecRelPath: `.forge/work-items/${wi.work_item_id}.md`,
      worktreePath: input.worktreePath,
      iterationBudget: wi.estimated_iterations > 0
        ? Math.max(wi.estimated_iterations, DEV_LIVE_DEFAULT_ITERATIONS_PER_WI)
        : DEV_LIVE_DEFAULT_ITERATIONS_PER_WI,
      costBudgetUsd: DEV_LIVE_DEFAULT_USD_PER_WI,
    });

    const tallyingQueryFn: QueryFn = ({ prompt, options }) => {
      const inner = sdkQueryFn({ prompt, options });
      return (async function* () {
        for await (const msg of inner) {
          const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } };
          if (m.type === 'assistant') tallyDevToolUse(m.message, wiToolUse);
          yield msg;
        }
      })();
    };

    const agent = createClaudeAgent({
      model: DEV_MODEL,
      allowedTools: [...DEV_ALLOWED_TOOLS],
      disallowedTools: [...DEV_DISALLOWED_TOOLS],
      permissionMode: 'acceptEdits',
      systemPrompt,
      maxTurnsPerIteration: DEV_LIVE_MAX_TURNS_PER_ITERATION,
      maxBudgetUsdPerIteration: DEV_LIVE_MAX_BUDGET_USD_PER_ITERATION,
      queryFn: tallyingQueryFn,
    });

    let result: LoopResult | null = null;
    let runnerError: { kind: string; message: string } | undefined;
    try {
      result = await runRalph(
        {
          workItemSpecPath: specPath,
          worktreePath: input.worktreePath,
          initiativeBudget: {
            iterations: Math.max(wi.estimated_iterations, DEV_LIVE_DEFAULT_ITERATIONS_PER_WI),
            usd: DEV_LIVE_DEFAULT_USD_PER_WI,
          },
          brainQueryResults: '',
          cycleId: logger.cycleId,
          initiativeId: input.initiativeId,
        },
        agent,
      );
    } catch (err) {
      runnerError = {
        kind: 'agent_threw',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const finalStatus: WorkItem['status'] = result?.status === 'complete'
      ? 'complete'
      : 'failed';
    writeWorkItemStatus(specPath, finalStatus);

    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: wiStart.event_id,
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'end',
      input_refs: [specPath],
      output_refs: result ? result.filesChanged : [],
      cost_usd: result?.cost_usd ?? 0,
      duration_ms: result?.duration_ms ?? 0,
      message: 'ralph.end',
      metadata: {
        work_item_id: wi.work_item_id,
        status: finalStatus,
        iterations: result?.iterations ?? 0,
        stop_reason: result?.stop_reason ?? 'crashed',
        tool_use: wiToolUse,
        runner_error: runnerError,
      },
    });

    wiOutcomes.push({ id: wi.work_item_id, status: finalStatus, result });
  }

  const completeCount = wiOutcomes.filter((o) => o.status === 'complete').length;
  const totalCost = wiOutcomes.reduce((acc, o) => acc + (o.result?.cost_usd ?? 0), 0);

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'end',
    input_refs: [workItemsDir],
    output_refs: [input.worktreePath],
    cost_usd: totalCost,
    metadata: {
      work_item_count: items.length,
      complete: completeCount,
      failed: items.length - completeCount,
    },
  });

  if (completeCount < items.length) {
    throw new Error(
      `developer-loop: ${items.length - completeCount}/${items.length} work items did not complete`,
    );
  }
}

function prerequisiteFailed(
  wi: WorkItem,
  outcomes: Array<{ id: string; status: WorkItem['status'] }>,
): boolean {
  if (wi.depends_on.length === 0) return false;
  const byId = new Map(outcomes.map((o) => [o.id, o.status] as const));
  for (const dep of wi.depends_on) {
    const status = byId.get(dep);
    if (status === 'failed') return true;
  }
  return false;
}

async function runReviewPrep(input: CycleInput, logger: EventLogger): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'review-loop',
    skill: 'reviewer',
    event_type: 'start',
    input_refs: [input.worktreePath],
    output_refs: [],
  });
  // TODO: invoke skills/reviewer review-prep stage.
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'reviewer',
    event_type: 'end',
    input_refs: [input.worktreePath],
    output_refs: [],
  });
}

function newCycleId(initiativeId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${ts}_${initiativeId}`;
}
