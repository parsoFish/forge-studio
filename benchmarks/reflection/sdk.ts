/**
 * SDK invocation helper for the reflection-phase benchmark.
 *
 * One call ≈ one reflector-skill run against one fixture. Sets up an isolated
 * tempdir mirroring the live forge layout, drops the fixture's data into the
 * right paths, pre-populates `user-feedback.md` via the simulator, then
 * invokes the agent via the Claude Agent SDK with the contract from
 * `orchestrator/reflector-invocation.ts`.
 *
 * Why isolated tempdirs: each fixture's reflector writes theme files into
 * `brain/projects/<project>/themes/` and an archive into
 * `brain/_raw/cycles/<cycle-id>.md`. Running against the live brain would
 * pollute it. Symlinks (read-through) make brain/, skills/, docs/,
 * orchestrator/, loops/ available without copying.
 *
 * Brain seeding: the bench symlinks the `brain/` tree from FORGE_ROOT into the
 * tempdir. New theme files written under `<tempdir>/brain/projects/<n>/themes/`
 * land inside the symlinked directory — which means they would touch the live
 * brain. To avoid this we mask the project's theme directory with a real
 * (writable) per-tempdir override BEFORE the agent runs: walk the symlinked
 * brain, identify the target project's `themes/` directory, replace it with a
 * fresh empty directory in the tempdir, and (importantly) recreate the
 * upstream symlinks (INDEX.md, _raw/, etc.) so the agent still sees a coherent
 * brain. The cycle-archive directory `brain/_raw/cycles/` gets the same
 * treatment so the reflector's archive write doesn't pollute the live brain.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import {
  REFLECTOR_ALLOWED_TOOLS,
  REFLECTOR_DISALLOWED_TOOLS,
  REFLECTOR_MODEL,
  buildReflectorSystemPrompt,
  renderReflectorUserPrompt,
  tallyToolUse,
  type ReflectorToolUseSummary,
} from '../../orchestrator/reflector-invocation.ts';
import { layerBrain } from '../_lib/brain-mask.ts';
import { prepareUserFeedback } from './simulator.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

export type ReflectorQueryFn = (input: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunReflectorInput = {
  fixtureId: string;
  initiativeId: string;
  cycleId: string;
  /** Project name. Used to resolve brain/projects/<project>/themes/. */
  projectName: string;
  /** Absolute path to the fixture's closed manifest file. */
  manifestPath: string;
  /** Absolute path to the fixture's events.jsonl. */
  eventLogPath: string;
  /** Absolute path to brain-gaps.jsonl. May not exist; the reflector tolerates that. */
  brainGapsPath: string;
  /** Absolute path to the merged-tree snapshot the reflector inspects. */
  mergedTreePath: string;
  /** Canned user-feedback content the simulator pre-writes. */
  userFeedbackContent: string;
  /** Max session turns before the SDK aborts. Default 40. */
  maxTurns?: number;
  /** Cost budget in USD. Default 0.6. */
  maxBudgetUsd?: number;
  /** Inject a fake `query` for testing. */
  queryFn?: ReflectorQueryFn;
};

export type ReflectorRunnerErrorKind =
  | 'manifest_missing'
  | 'event_log_missing'
  | 'merged_tree_missing'
  | 'agent_threw'
  | 'unknown_error';

export type RunReflectorResult = {
  tempdir: string;
  /** Path inside the tempdir where the reflector reads brain from. */
  brainRoot: string;
  /** Path inside the tempdir where the reflector reads/writes its cycle log dir. */
  cycleLogDir: string;
  /** Path inside the tempdir where new theme files land. */
  themesDir: string;
  /** Path inside the tempdir where the cycle archive lands. */
  cycleArchivePath: string;
  /** Path the simulator wrote (for diagnostic logging). */
  userFeedbackPath: string;
  durationMs: number;
  costUsd: number;
  toolUseSummary: ReflectorToolUseSummary;
  /** SDK message subtype on the result event ('success' | 'error_max_turns' | …). */
  resultSubtype?: string;
  runnerError?: { kind: ReflectorRunnerErrorKind; message: string };
};

/**
 * Set up an isolated tempdir for one bench run.
 *
 * Layout (matches the live forge root the agent expects to navigate):
 *   <tempdir>/
 *     brain/                 → masked: layered to allow writes into project themes dir + _raw/cycles/
 *     skills/                → symlink into FORGE_ROOT/skills
 *     docs/                  → symlink
 *     orchestrator/          → symlink
 *     loops/                 → symlink
 *     projects/<name>/       → recursive copy of mergedTreePath (read-only inspection)
 *     _queue/done/<id>.md    → copy of manifestPath
 *     _logs/<cycle-id>/
 *       events.jsonl         → copy of eventLogPath
 *       brain-gaps.jsonl     → copy of brainGapsPath (if it exists)
 *       user-feedback.md     → written by simulator (canned)
 */
export function setupTempdir(input: RunReflectorInput): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bench-reflect-'));

  // Read-only forge-tree symlinks the agent navigates.
  for (const sub of ['skills', 'docs', 'orchestrator', 'loops']) {
    symlinkSync(resolve(FORGE_ROOT, sub), resolve(dir, sub));
  }

  // Mask the brain so writes land in the tempdir, not the live brain.
  layerBrain(dir, input.projectName);

  // Project tree (post-merge snapshot) — recursive copy.
  if (!existsSync(input.mergedTreePath)) {
    throw new Error(`merged tree path does not exist: ${input.mergedTreePath}`);
  }
  const projDir = resolve(dir, 'projects', input.projectName);
  mkdirSync(projDir, { recursive: true });
  cpSync(input.mergedTreePath, projDir, { recursive: true });

  // Closed manifest in `_queue/done/`.
  if (!existsSync(input.manifestPath)) {
    throw new Error(`manifest path does not exist: ${input.manifestPath}`);
  }
  const queueDir = resolve(dir, '_queue', 'done');
  mkdirSync(queueDir, { recursive: true });
  cpSync(input.manifestPath, resolve(queueDir, `${input.initiativeId}.md`));

  // Cycle log dir, with the fixture's events.jsonl + (optional) brain-gaps.jsonl.
  const cycleLogDir = resolve(dir, '_logs', input.cycleId);
  mkdirSync(cycleLogDir, { recursive: true });
  if (!existsSync(input.eventLogPath)) {
    throw new Error(`event log path does not exist: ${input.eventLogPath}`);
  }
  cpSync(input.eventLogPath, resolve(cycleLogDir, 'events.jsonl'));
  if (existsSync(input.brainGapsPath)) {
    cpSync(input.brainGapsPath, resolve(cycleLogDir, 'brain-gaps.jsonl'));
  }

  // Pre-write user-feedback.md via the simulator.
  prepareUserFeedback({
    cycleLogDir,
    cannedFeedback: input.userFeedbackContent,
  });

  return dir;
}

export function cleanupTempdir(tempdir: string): void {
  try {
    rmSync(tempdir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export async function runReflector(input: RunReflectorInput): Promise<RunReflectorResult> {
  const tempdir = setupTempdir(input);
  const brainRoot = resolve(tempdir, 'brain');
  const cycleLogDir = resolve(tempdir, '_logs', input.cycleId);
  const themesDir = resolve(brainRoot, 'projects', input.projectName, 'themes');
  const cycleArchivePath = resolve(brainRoot, '_raw', 'cycles', `${input.cycleId}.md`);
  const userFeedbackPath = resolve(cycleLogDir, 'user-feedback.md');

  const toolUseSummary: ReflectorToolUseSummary = {
    brainReads: 0,
    themeWrites: 0,
    retroWrites: 0,
    bashCalls: 0,
  };

  const queryFn: ReflectorQueryFn = input.queryFn ?? (sdkQuery as unknown as ReflectorQueryFn);

  // Build the prompt.
  const manifestRel = `_queue/done/${input.initiativeId}.md`;
  const eventLogRel = `_logs/${input.cycleId}/events.jsonl`;
  const brainGapsRel = `_logs/${input.cycleId}/brain-gaps.jsonl`;
  const mergedTreeRel = `projects/${input.projectName}`;
  const userQuestionsRel = `_logs/${input.cycleId}/user-questions.md`;
  const userFeedbackRel = `_logs/${input.cycleId}/user-feedback.md`;
  const retroRel = `_logs/${input.cycleId}/retro.md`;
  const cycleArchiveRel = `brain/_raw/cycles/${input.cycleId}.md`;
  const themesDirRel = `brain/projects/${input.projectName}/themes`;

  const systemPrompt = buildReflectorSystemPrompt(tempdir);
  const prompt = renderReflectorUserPrompt({
    initiativeId: input.initiativeId,
    cycleId: input.cycleId,
    manifestRelPath: manifestRel,
    eventLogRelPath: eventLogRel,
    brainGapsRelPath: brainGapsRel,
    mergedTreeRelPath: mergedTreeRel,
    projectName: input.projectName,
    userQuestionsRelPath: userQuestionsRel,
    userFeedbackRelPath: userFeedbackRel,
    retroRelPath: retroRel,
    cycleArchiveRelPath: cycleArchiveRel,
    themesDirRelPath: themesDirRel,
  });

  const options: Record<string, unknown> = {
    cwd: tempdir,
    systemPrompt,
    model: REFLECTOR_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: [...REFLECTOR_ALLOWED_TOOLS],
    disallowedTools: [...REFLECTOR_DISALLOWED_TOOLS],
    maxTurns: input.maxTurns ?? 40,
    maxBudgetUsd: input.maxBudgetUsd ?? 0.6,
  };

  const startedAt = Date.now();
  let durationMs = 0;
  let costUsd = 0;
  let resultSubtype: string | undefined;
  let runnerError: RunReflectorResult['runnerError'];

  try {
    for await (const msg of queryFn({ prompt, options })) {
      if (typeof msg !== 'object' || msg === null) continue;
      const m = msg as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
        subtype?: string;
        duration_ms?: number;
        total_cost_usd?: number;
      };
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
  } catch (err) {
    runnerError = {
      kind: 'agent_threw',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (durationMs === 0) durationMs = Date.now() - startedAt;

  return {
    tempdir,
    brainRoot,
    cycleLogDir,
    themesDir,
    cycleArchivePath,
    userFeedbackPath,
    durationMs,
    costUsd,
    toolUseSummary,
    resultSubtype,
    runnerError,
  };
}

// Re-export readFileSync for tests that need to inspect emitted artifacts.
export { readFileSync };
