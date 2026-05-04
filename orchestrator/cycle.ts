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

import { resolve } from 'node:path';
import type { EventLogger } from './logging.ts';
import { createLogger } from './logging.ts';

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

async function runProjectManager(input: CycleInput, logger: EventLogger): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
  });
  // TODO: invoke skills/project-manager via Claude Agent SDK.
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'end',
    input_refs: [input.manifestPath],
    output_refs: [resolve(input.worktreePath, '.forge/work-items/')],
  });
}

async function runDeveloperLoop(input: CycleInput, logger: EventLogger): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'start',
    input_refs: [resolve(input.worktreePath, '.forge/work-items/')],
    output_refs: [],
  });
  // TODO: for each work item, invoke skills/developer-ralph which calls loops/ralph/runner.ts.
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'end',
    input_refs: [resolve(input.worktreePath, '.forge/work-items/')],
    output_refs: [input.worktreePath],
  });
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
