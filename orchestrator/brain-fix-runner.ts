/**
 * Brain-fix runner — applies a single agent-driven repair to a brain theme file
 * to clear one 'agent'-tier finding from `forge brain lint`.
 *
 * Pattern mirrors architect-runner.ts: injectable queryFn seam, idle-deadline,
 * tool-event-sink, and createLogger — so the fix turn streams hex bursts and a
 * heartbeat file under _logs/_brainfix-<runId>/, enabling the UI tail.
 *
 * After the agent turn, runBrainLint re-checks the file to confirm the finding
 * cleared. The verification result (cleared: boolean) is returned and emitted
 * on the 'end' event so callers can surface per-finding outcomes.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import { createLogger } from './logging.ts';
import { makeToolEventSink, extractLiveToolDetails } from './tool-event-emit.ts';
import { withIdleDeadline } from './stream-deadline.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { modelForSpec } from './phase-agent.ts';
import { runBrainLint } from '../cli/brain-lint.ts';
import { skillPath, skillPathRelative } from './skill-path.ts';

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/brain-fix/SKILL.md
// ---------------------------------------------------------------------------

export const brainFixAgentSpec = deriveAgentSpec(skillPathRelative('brain-fix'));
export const BRAIN_FIX_MODEL = modelForSpec(brainFixAgentSpec);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The same query shape architect-runner and reflector use — a loose async
 * iterable so test stubs don't need to implement the full SDK type.
 */
export type QueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunBrainFixInput = {
  /** Unique id for this fix run (used as the log-dir suffix). */
  runId: string;
  /** The KB id of the brain this file belongs to (for context). */
  kbId: string;
  /** Absolute path to the file to fix. */
  file: string;
  /** The check slug from the finding (e.g. 'frontmatter.missing-field'). */
  check: string;
  /** The kind slug from the finding (same as check in practice). */
  kind: string;
  /** Optional concrete repair hint from classifyFinding. */
  fixHint?: string;
  /** The finding's human-readable message. */
  message: string;
  /** Absolute path to the forge root. */
  forgeRoot: string;
  /** Root directory for event logs; defaults to <forgeRoot>/_logs. */
  logsRoot?: string;
  /** Injectable query function for tests; defaults to the real SDK. */
  queryFn?: QueryFn;
};

export type RunBrainFixResult = {
  runId: string;
  /** True when the re-lint after the agent turn found no same-kind finding. */
  cleared: boolean;
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const HEARTBEAT_THROTTLE_MS = 2000;

export async function runBrainFixTurn(
  input: RunBrainFixInput,
): Promise<RunBrainFixResult> {
  const logsRoot = input.logsRoot ?? resolve(input.forgeRoot, '_logs');
  const cycleId = `_brainfix-${input.runId}`;
  const logger = createLogger(cycleId, logsRoot);

  // Ensure heartbeat directory exists.
  const heartbeatDir = join(logsRoot, cycleId);
  mkdirSync(heartbeatDir, { recursive: true });
  const heartbeatPath = join(heartbeatDir, '.heartbeat');

  const startEv = logger.emit({
    initiative_id: cycleId,
    phase: 'reflection',
    skill: 'brain-fix',
    event_type: 'start',
    input_refs: [input.file],
    output_refs: [],
    message: `brain-fix.start (kind=${input.kind}, file=${input.file})`,
    metadata: { runId: input.runId, kbId: input.kbId, kind: input.kind, check: input.check },
  });

  const sink = makeToolEventSink(logger, {
    initiativeId: cycleId,
    parentEventId: startEv.event_id,
    phase: 'reflection',
    skill: 'brain-fix',
  });

  // Load skill prompt (ADR 003 — prompt is skill content, not re-baked TS).
  const skillFile = skillPath('brain-fix', input.forgeRoot);
  let skillPrompt = 'You are the forge brain-fix agent.';
  try {
    skillPrompt = readFileSync(skillFile, 'utf8');
  } catch {
    /* fall through to default */
  }

  const userPayload = [
    '## Fix task',
    '',
    `**File (absolute path):** ${input.file}`,
    `**Finding kind:** ${input.kind}`,
    `**Finding message:** ${input.message}`,
    ...(input.fixHint ? [`**Fix hint:** ${input.fixHint}`] : []),
    '',
    'Open the file, apply ONLY the single targeted fix that clears this finding, do not touch any other files, then stop.',
  ].join('\n');

  const prompt = [skillPrompt, '', userPayload].join('\n');

  const options: Record<string, unknown> = {
    cwd: input.forgeRoot,
    model: BRAIN_FIX_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: [...brainFixAgentSpec.allowedTools],
    disallowedTools: [...brainFixAgentSpec.disallowedTools],
    maxTurns: 8,
  };

  const abortController = new AbortController();
  options.abortController = abortController;

  const queryImpl: QueryFn =
    input.queryFn ?? (sdkQuery as unknown as QueryFn);

  let costUsd = 0;
  let toolSeq = 0;
  let lastHeartbeatMs = 0;

  try {
    for await (const msg of withIdleDeadline(
      queryImpl({ prompt, options }),
      { label: `brain-fix-${input.runId}`, abortController },
    )) {
      // Throttled heartbeat.
      const now = Date.now();
      if (now - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
        try { writeFileSync(heartbeatPath, new Date().toISOString()); } catch { /* best-effort */ }
        lastHeartbeatMs = now;
      }

      if (typeof msg !== 'object' || msg === null) continue;
      const m = msg as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
        total_cost_usd?: number;
      };

      if (m.type === 'assistant') {
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const d of details) sink.onToolUse(d);
        toolSeq += details.length;
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
      phase: 'reflection',
      skill: 'brain-fix',
      event_type: 'error',
      input_refs: [input.file],
      output_refs: [],
      message: 'brain-fix.crashed',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    sink.flushIteration(1);
    return { runId: input.runId, cleared: false };
  }

  sink.flushIteration(1);

  // ---------------------------------------------------------------------------
  // Verification gate: re-lint the file and check if the same kind cleared.
  // ---------------------------------------------------------------------------
  const relFile = relative(input.forgeRoot, input.file);
  let cleared = false;
  try {
    const lintResult = runBrainLint({
      cwd: input.forgeRoot,
      scope: 'single-file',
      file: relFile,
    });
    cleared = !lintResult.findings.some(
      (f) => f.kind === input.kind && (f.file === input.file || f.file === relFile),
    );
  } catch {
    cleared = false;
  }

  logger.emit({
    initiative_id: cycleId,
    parent_event_id: startEv.event_id,
    phase: 'reflection',
    skill: 'brain-fix',
    event_type: 'end',
    input_refs: [input.file],
    output_refs: [],
    cost_usd: costUsd,
    message: `brain-fix.end (cleared=${cleared})`,
    metadata: { runId: input.runId, kind: input.kind, file: input.file, cleared },
  });

  return { runId: input.runId, cleared };
}
