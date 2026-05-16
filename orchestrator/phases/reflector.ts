/**
 * Reflection phase runner. Extracted from cycle.ts (Phase 3.4c step 2).
 *
 * Runs after a successful merge to extract patterns from the cycle's event
 * log + merged tree into brain themes. Behaviour is identical to the prior
 * in-cycle implementation — this module only relocates the code so the
 * orchestration spine stays thin.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { EventLogger } from '../logging.ts';
import { parseManifest } from '../manifest.ts';
import {
  REFLECTOR_ALLOWED_TOOLS,
  REFLECTOR_DISALLOWED_TOOLS,
  REFLECTOR_MODEL,
  buildReflectorSystemPrompt,
  renderReflectorUserPrompt,
  tallyToolUse as tallyReflectorToolUse,
  type ReflectorToolUseSummary,
} from '../reflector-invocation.ts';
import {
  recordBrainGateResult,
  type CycleInput,
  type ReflectionStatus,
} from '../cycle-context.ts';

/**
 * Defaults for the live reflector invocation. The reflector is a one-shot SDK
 * call (not a Ralph loop) that consumes the cycle's event log + manifest +
 * merged tree and emits brain theme writes. The bench's 5-fixture median is
 * ~$0.74/run; the live cap gives 2x headroom for richer real cycles.
 */
const REFLECTOR_LIVE_MAX_TURNS = 60;
const REFLECTOR_LIVE_MAX_BUDGET_USD = 1.5;

/**
 * Reflection phase. Runs after a successful merge to extract patterns from the
 * cycle's event log + merged tree into brain themes. Closes the learning loop.
 *
 * Failure mode: log-and-continue. A thrown reflector returns `'failed'`
 * but does not propagate — the merge already happened in `runReviewer`,
 * and reflection cannot un-merge.
 *
 * Live invocation contract is shared with the bench via
 * orchestrator/reflector-invocation.ts (single source of truth).
 */
export async function runReflector(
  input: CycleInput,
  logger: EventLogger,
): Promise<ReflectionStatus> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'start',
    input_refs: [input.manifestPath, logger.logFilePath],
    output_refs: [],
    message: 'reflector.start',
  });

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const cycleId = logger.cycleId;
  const cycleLogDir = resolve(forgeRoot, '_logs', cycleId);

  // Reflection runs after the reviewer merged the initiative, which moves the
  // manifest from `_queue/in-flight/` to `_queue/done/`. The cycle was kicked
  // off with the in-flight path, so we look up the current location before
  // reading. Fall back to the original path so this stays compatible with
  // bench harnesses that point directly at a stable manifest.
  const manifestPath = resolveCurrentManifestPath(input.manifestPath, forgeRoot);

  let projectName: string;
  let origin: 'architect' | 'human-directed' = 'architect';
  try {
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    projectName = manifest.project;
    // G6: carry the cohort tag onto reflector.end so a reflection-cohort
    // reader (autonomous vs hand-directed) can split retros the same way
    // `forge metrics` splits cycles.
    origin = manifest.origin;
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'error',
      input_refs: [manifestPath],
      output_refs: [],
      message: 'reflector.manifest-unreadable',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return 'failed';
  }

  const systemPrompt = buildReflectorSystemPrompt(forgeRoot);
  const cycleArchivePath = resolve(forgeRoot, 'brain', '_raw', 'cycles', `${cycleId}.md`);
  const themesDir = resolve(forgeRoot, 'brain', 'projects', projectName, 'themes');
  // F-07: ensure brain destination dirs exist before invoking the SDK; the
  // reflector writes here directly. A first-time project (no themes/ yet) or
  // a fresh forge install (no brain/_raw/cycles/) would otherwise see ENOENT
  // inside the agent and silently log-and-continue-fail.
  mkdirSync(resolve(forgeRoot, 'brain', '_raw', 'cycles'), { recursive: true });
  mkdirSync(themesDir, { recursive: true });
  // F-12: touch brain-gaps.jsonl if absent. The reflector's user prompt
  // points it at this file; the bench fixtures pre-populate it. In live
  // cycles, gaps are agent-driven (brain-query SKILL writes to it). For the
  // production path, an empty file is a valid signal of "no gaps recorded
  // this cycle" — better than ENOENT bouncing the agent's Read attempt.
  // A real orchestrator-side gap producer is deferred to pass-3 (would
  // require post-cycle event-log scanning).
  const brainGapsPath = resolve(cycleLogDir, 'brain-gaps.jsonl');
  if (!existsSync(brainGapsPath)) {
    mkdirSync(cycleLogDir, { recursive: true });
    writeFileSync(brainGapsPath, '');
  }
  const prompt = renderReflectorUserPrompt({
    initiativeId: input.initiativeId,
    cycleId,
    manifestRelPath: manifestPath,
    eventLogRelPath: logger.logFilePath,
    brainGapsRelPath: resolve(cycleLogDir, 'brain-gaps.jsonl'),
    mergedTreeRelPath: input.projectRepoPath,
    projectName,
    userQuestionsRelPath: resolve(cycleLogDir, 'user-questions.md'),
    userFeedbackRelPath: resolve(cycleLogDir, 'user-feedback.md'),
    retroRelPath: resolve(cycleLogDir, 'retro.md'),
    cycleArchiveRelPath: cycleArchivePath,
    themesDirRelPath: themesDir,
  });

  const options: Record<string, unknown> = {
    cwd: forgeRoot,
    systemPrompt,
    model: REFLECTOR_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: [...REFLECTOR_ALLOWED_TOOLS],
    disallowedTools: [...REFLECTOR_DISALLOWED_TOOLS],
    maxTurns: REFLECTOR_LIVE_MAX_TURNS,
    maxBudgetUsd: REFLECTOR_LIVE_MAX_BUDGET_USD,
  };

  const toolUseSummary: ReflectorToolUseSummary = {
    brainReads: 0,
    themeWrites: 0,
    retroWrites: 0,
    bashCalls: 0,
  };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;

  try {
    for await (const msg of sdkQuery({ prompt, options }) as AsyncIterable<unknown>) {
      if (typeof msg !== 'object' || msg === null) continue;
      const m = msg as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
        subtype?: string;
        total_cost_usd?: number;
        duration_ms?: number;
      };
      if (m.type === 'assistant') {
        tallyReflectorToolUse(m.message, toolUseSummary);
        continue;
      }
      if (m.type !== 'result') continue;
      if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
      if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
      resultSubtype = m.subtype ?? 'success';
      break;
    }
  } catch (err) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'error',
      input_refs: [logger.logFilePath],
      output_refs: [],
      message: 'reflector.crashed',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return 'failed';
  }

  // F-13: brain-first gate for reflector. Log-and-continue style — reflector
  // failures don't propagate (the merge already happened). The
  // reflection_status field surfaces the failure to telemetry.
  if (
    !recordBrainGateResult('reflection', 'reflector', toolUseSummary.brainReads, {
      initiativeId: input.initiativeId,
      logger,
      parentEventId: start.event_id,
    })
  ) {
    return 'failed';
  }

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'end',
    input_refs: [logger.logFilePath, manifestPath],
    output_refs: [resolve(cycleLogDir, 'retro.md')],
    cost_usd: costUsd,
    duration_ms: durationMs,
    message: 'reflector.end',
    metadata: {
      status: 'closed',
      project: projectName,
      origin,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
    },
  });
  return 'closed';
}

/**
 * Resolve the current location of an initiative's manifest. The reviewer
 * moves the manifest from `_queue/in-flight/` to `_queue/done/` (or
 * `_queue/ready-for-review/`) on completion. Reflection runs *after* the
 * move, so reading the original `input.manifestPath` ENOENTs every real
 * cycle. We look at the queue's terminal states first, then fall back to
 * the original path so bench harnesses (which pass a stable, non-queue path)
 * still work.
 */
function resolveCurrentManifestPath(originalPath: string, forgeRoot: string): string {
  if (existsSync(originalPath)) return originalPath;
  const filename = basename(originalPath);
  const candidates = [
    resolve(forgeRoot, '_queue', 'done', filename),
    resolve(forgeRoot, '_queue', 'ready-for-review', filename),
    resolve(forgeRoot, '_queue', 'failed', filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return originalPath;
}
