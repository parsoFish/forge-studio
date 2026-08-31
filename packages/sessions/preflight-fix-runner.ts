/**
 * Preflight-fix runner — applies one agent-driven, operator-approved fix to a
 * managed project to clear a single USER-tier `forge preflight` clause.
 *
 * Mirrors brain-fix-runner.ts: injectable queryFn seam, idle-deadline,
 * tool-event sink, createLogger — so the fix turn streams hex bursts + a
 * heartbeat under `_logs/_preflight-fix-<runId>/`, enabling the UI tail.
 *
 * After the agent turn, runPreflight re-checks the project and the clause's
 * `pass` flag is the verification gate. AGENT-tier clauses (C8/DEMO/BRAIN) do
 * NOT come here — the bridge routes those to the instructions / demo-builder /
 * brain-fix runners. This runner is the generic "operator decided, agent
 * applies the decision" path for USER-tier clauses.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';

import { REDACTED_THINKING_MARKER, makeReasoningSink, makeThinkingSink } from './interactive-session.ts';
import { createLogger } from '@forge/kernel';
import { makeToolEventSink, extractLiveToolDetails } from '@forge/agents/tool-event-emit.ts';
import { withIdleDeadline } from '@forge/agents/stream-deadline.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { runPreflight, type ClauseId } from '@forge/projects/preflight.ts';
import { ensureStudioBranch, commitStudioChange } from '@forge/projects/project-repo-tx.ts';
import { skillPath, skillPathRelative } from '@forge/agents/skill-path.ts';

export const preflightFixAgentSpec = deriveAgentSpec(skillPathRelative('preflight-fix'));
export const PREFLIGHT_FIX_MODEL = modelForSpec(preflightFixAgentSpec);

/** Loose async iterable — same shape brain-fix / architect runners use. */
export type QueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunPreflightFixInput = {
  /** Unique id for this fix run (used as the log-dir suffix). */
  runId: string;
  /** Absolute path to the managed project being fixed. */
  projectDir: string;
  /** The preflight clause to clear. */
  clause: ClauseId;
  /** The operator's decision / fix instruction (USER-tier note). */
  instruction: string;
  /** The clause's current failure detail (context for the agent). */
  detail?: string;
  /** Absolute path to the forge root. */
  forgeRoot: string;
  /** Root directory for event logs; defaults to <forgeRoot>/_logs. */
  logsRoot?: string;
  /** Injectable query function for tests; defaults to the real SDK. */
  queryFn?: QueryFn;
};

export type RunPreflightFixResult = {
  runId: string;
  /** True when the post-turn re-run found the clause now passing. */
  cleared: boolean;
};

const HEARTBEAT_THROTTLE_MS = 2000;

export async function runPreflightFixTurn(
  input: RunPreflightFixInput,
): Promise<RunPreflightFixResult> {
  const logsRoot = input.logsRoot ?? resolve(input.forgeRoot, '_logs');
  const cycleId = `_preflight-fix-${input.runId}`;
  const logger = createLogger(cycleId, logsRoot);

  const heartbeatDir = join(logsRoot, cycleId);
  mkdirSync(heartbeatDir, { recursive: true });
  const heartbeatPath = join(heartbeatDir, '.heartbeat');

  const startEv = logger.emit({
    initiative_id: cycleId,
    phase: 'orchestrator',
    skill: 'preflight-fix',
    event_type: 'start',
    input_refs: [input.projectDir],
    output_refs: [],
    message: `preflight-fix.start (clause=${input.clause}, project=${input.projectDir})`,
    metadata: { runId: input.runId, clause: input.clause },
  });

  // W6-B1: preflight-fix mirrors brain-fix — an operator-triggered, low-volume,
  // single fix turn — pass the same {readOnlySampleRate:1, cap:200}
  // "unsampled" opts as every interactive runner (the unattended
  // dev-loop/PM/reflector phases are unchanged and keep the sampler's
  // defaults).
  const sink = makeToolEventSink(
    logger,
    {
      initiativeId: cycleId,
      parentEventId: startEv.event_id,
      phase: 'orchestrator',
      skill: 'preflight-fix',
    },
    { readOnlySampleRate: 1, cap: 200 },
  );

  // W6-B1: preflight-fix drives its own raw SDK stream loop (not
  // runStructuredTurn/runAgentTurn), so it had NO text/thinking sink at all
  // before this change — wired inline below onto the ONE shared sink pair
  // (interactive-session.ts), keyed by runId (this file's own id convention).
  const sinkCtx = { initiativeId: cycleId, phase: 'orchestrator' as const, skill: 'preflight-fix', idMeta: { runId: input.runId } };
  const onText = makeReasoningSink(logger, sinkCtx);
  const onThinking = makeThinkingSink(logger, sinkCtx);

  const skillFile = skillPath('preflight-fix', input.forgeRoot);
  let skillPrompt = 'You are the forge preflight-fix agent.';
  try {
    skillPrompt = readFileSync(skillFile, 'utf8');
  } catch {
    /* fall through to default */
  }

  // Land the agent's edits on the project's forge-studio branch so they persist
  // (the working tree the verify re-run reads is this branch).
  try { ensureStudioBranch(input.projectDir); } catch { /* non-git project — edits stay in the tree */ }

  const userPayload = [
    '## Fix task',
    '',
    `**Project (cwd):** ${input.projectDir}`,
    `**Preflight clause:** ${input.clause}`,
    ...(input.detail ? [`**Current failure:** ${input.detail}`] : []),
    `**Operator decision:** ${input.instruction || '(none provided)'}`,
    '',
    'Apply ONLY the minimal edit that clears this clause, per the operator decision. Touch nothing else, then stop.',
  ].join('\n');

  const prompt = [skillPrompt, '', userPayload].join('\n');

  const options: Record<string, unknown> = {
    cwd: input.projectDir,
    model: PREFLIGHT_FIX_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: [...preflightFixAgentSpec.allowedTools],
    disallowedTools: [...preflightFixAgentSpec.disallowedTools],
    maxTurns: 8,
    ...(() => {
      const hooks = sdkHooksForAgent({ skill: preflightFixAgentSpec.skill, logger, initiativeId: cycleId });
      return hooks !== undefined ? { hooks } : {};
    })(),
  };

  const abortController = new AbortController();
  options.abortController = abortController;

  const queryImpl: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);

  let costUsd = 0;
  let toolSeq = 0;
  let lastHeartbeatMs = 0;

  try {
    for await (const msg of withIdleDeadline(
      queryImpl({ prompt, options }),
      { label: `preflight-fix-${input.runId}`, abortController },
    )) {
      const now = Date.now();
      if (now - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
        try { writeFileSync(heartbeatPath, new Date().toISOString()); } catch { /* best-effort */ }
        lastHeartbeatMs = now;
      }

      if (typeof msg !== 'object' || msg === null) continue;
      const m = msg as {
        type?: string;
        message?: {
          content?: Array<{ type?: string; name?: string; input?: unknown; text?: string; thinking?: string }>;
        };
        total_cost_usd?: number;
      };

      if (m.type === 'assistant') {
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const d of details) sink.onToolUse(d);
        toolSeq += details.length;
        for (const block of m.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            const trimmed = block.text.trim();
            if (trimmed) onText(trimmed);
          }
          if (block?.type === 'thinking' && typeof block.thinking === 'string') {
            const trimmed = block.thinking.trim();
            if (trimmed) onThinking(trimmed);
          }
          if (block?.type === 'redacted_thinking') {
            onThinking(REDACTED_THINKING_MARKER);
          }
        }
        continue;
      }
      if (m.type !== 'result') continue;
      if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
      break;
    }
  } catch (err) {
    logger.emit({
      initiative_id: cycleId,
      parent_event_id: startEv.event_id,
      phase: 'orchestrator',
      skill: 'preflight-fix',
      event_type: 'error',
      input_refs: [input.projectDir],
      output_refs: [],
      message: 'preflight-fix.crashed',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    sink.flushIteration(1);
    return { runId: input.runId, cleared: false };
  }

  sink.flushIteration(1);

  // Persist the agent's edits onto forge-studio (durable; survives a later tree
  // reset) before the verification re-run reads the working tree.
  try { commitStudioChange(input.projectDir, `forge-studio: preflight-fix ${input.clause}`); } catch { /* best-effort */ }

  // Verification gate: re-run preflight and read the clause's pass flag.
  let cleared = false;
  try {
    const report = runPreflight(input.projectDir, { forgeRoot: input.forgeRoot });
    cleared = report.clauses.some((c) => c.clause === input.clause && c.pass);
  } catch {
    cleared = false;
  }

  logger.emit({
    initiative_id: cycleId,
    parent_event_id: startEv.event_id,
    phase: 'orchestrator',
    skill: 'preflight-fix',
    event_type: 'end',
    input_refs: [input.projectDir],
    output_refs: [],
    cost_usd: costUsd,
    message: `preflight-fix.end (cleared=${cleared})`,
    metadata: { runId: input.runId, clause: input.clause, cleared },
  });

  return { runId: input.runId, cleared };
}
