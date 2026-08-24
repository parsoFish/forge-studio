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
import { sdkHooksForAgent } from './studio/hook-dispatch.ts';

import { REDACTED_THINKING_MARKER, makeReasoningSink, makeThinkingSink } from './interactive-session.ts';
import { createLogger } from './logging.ts';
import { makeToolEventSink, extractLiveToolDetails } from './tool-event-emit.ts';
import { withIdleDeadline } from './stream-deadline.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { modelForSpec } from './phase-agent.ts';
import { runBrainLint, lintThemeFiles, classify } from '../cli/brain-lint.ts';
import { snapshotKbFiles } from '../cli/kb-drain-structural.ts';
import { guardAgentKbEdits, type KbEditGateResult } from '../cli/kb-drain-edit-soundness.ts';
import { resolveKbBrainDir } from './brain-paths.ts';
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
  /** W8-B2 — what the edit-soundness gate did to this turn's writes. Absent
   *  only when the KB id resolves to no brain dir (nothing to guard). */
  editAudit?: KbEditGateResult;
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

  // W6-B1: brain-fix is an operator/reflector-triggered, low-volume, single
  // fix turn — pass the same {readOnlySampleRate:1, cap:200} "unsampled"
  // opts as every interactive runner (the unattended dev-loop/PM/reflector
  // phases are unchanged and keep the sampler's defaults).
  const sink = makeToolEventSink(
    logger,
    {
      initiativeId: cycleId,
      parentEventId: startEv.event_id,
      phase: 'reflection',
      skill: 'brain-fix',
    },
    { readOnlySampleRate: 1, cap: 200 },
  );

  // W6-B1: brain-fix drives its own raw SDK stream loop (not
  // runStructuredTurn/runAgentTurn), so it had NO text/thinking sink at all
  // before this change — wired inline below onto the ONE shared sink pair
  // (interactive-session.ts), keyed by runId (this file's own id convention).
  const sinkCtx = { initiativeId: cycleId, phase: 'reflection' as const, skill: 'brain-fix', idMeta: { runId: input.runId } };
  const onText = makeReasoningSink(logger, sinkCtx);
  const onThinking = makeThinkingSink(logger, sinkCtx);

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
    ...(() => {
      const hooks = sdkHooksForAgent({ skill: brainFixAgentSpec.skill, logger, initiativeId: cycleId });
      return hooks !== undefined ? { hooks } : {};
    })(),
  };

  const abortController = new AbortController();
  options.abortController = abortController;

  const queryImpl: QueryFn =
    input.queryFn ?? (sdkQuery as unknown as QueryFn);

  // W8-B2 — the edit-soundness gate runs HERE, around the turn itself, not at
  // a call site. `runBrainFixTurn` has three production callers: the drain's
  // round loop, `runBrainConsolidateNow` (the Consolidate button, and
  // approveKbCleanup's non-draft arm), and `forge brain fix` (which the
  // per-finding `op=fix-agent` route the needs-you walkthrough dispatches
  // spawns as a subprocess). The first cut guarded the drain alone, so the two
  // paths an operator clicks by HAND could still land the exact 2026-08-22
  // edits. Guarding a call site closes a door; guarding the turn closes the
  // class — no caller, present or future, can invoke this ungated.
  const guardedBrainDir = resolveKbBrainDir(input.forgeRoot, input.kbId);
  const preTurnSnapshot = guardedBrainDir ? snapshotKbFiles(guardedBrainDir) : null;

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
      phase: 'reflection',
      skill: 'brain-fix',
      event_type: 'error',
      input_refs: [input.file],
      output_refs: [],
      message: 'brain-fix.crashed',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    sink.flushIteration(1);
    return { runId: input.runId, cleared: false, ...(applyEditGate() ?? {}) };
  }

  sink.flushIteration(1);
  // BEFORE the verification lint, deliberately: a refused edit is reverted, so
  // the finding is back on disk and the re-lint must see that rather than the
  // agent's rejected version.
  const editAudit = applyEditGate();

  // ---------------------------------------------------------------------------
  // Verification gate: re-lint the file and check if the same kind cleared.
  // ---------------------------------------------------------------------------
  const relFile = relative(input.forgeRoot, input.file);
  let cleared = false;
  try {
    // W8-B2 — the verification lens must cover the file it is verifying.
    //
    // `runBrainLint`'s `checkSourceLinks` and `checkDanglingEdges` are both
    // CHECK_SCOPE 'forge-themes': they iterate `readThemeFiles`, which walks
    // ONLY brain/cycles/themes and brain/forge-dev/themes (its own comment
    // still says project themes live in separate repos — ADR 035 centralised
    // them into brain/projects/<name>/themes/ in 2026-06). So for a project
    // theme those two checks produced NO finding at all, cleared or not, and
    // `cleared` came back unconditionally TRUE for exactly the two check kinds
    // both 2026-08-22 drain defects involved. That is how a link repointed at
    // a second dead path got reported cleared.
    //
    // `lintThemeFiles` is the project-aware lens the KB drain already surfaces
    // findings through (via `collectKbFindings`). Unioning it in means the
    // thing that raises a finding and the thing that verifies its fix agree
    // about which files exist — two derivations disagreeing is the exact shape
    // of forge-d8l.
    const scoped = runBrainLint({ cwd: input.forgeRoot, scope: 'single-file', file: relFile }).findings;
    const perFile = lintThemeFiles(input.forgeRoot, [input.file]).map((f) => (f.resolution ? f : classify(f)));
    cleared = ![...scoped, ...perFile].some(
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

  return { runId: input.runId, cleared, ...(editAudit ?? {}) };

  function applyEditGate(): { editAudit: KbEditGateResult } | undefined {
    if (!guardedBrainDir || preTurnSnapshot === null) return undefined;
    try {
      return { editAudit: guardAgentKbEdits(input.forgeRoot, guardedBrainDir, preTurnSnapshot) };
    } catch {
      // A gate that throws must not take the turn down with it — but it must
      // also not report a clean audit it never performed.
      return undefined;
    }
  }
}
