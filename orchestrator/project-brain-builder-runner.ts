/**
 * Project-brain builder runner (operator feedback R1-3b, 2026-06-27).
 *
 * Replaces the index-only "build project brain" stub with a real agentic
 * evaluation: an agent reads the managed project from scratch and authors a draft
 * set of theme pages into a session staging dir; the operator reviews them; on
 * approval the runner commits them into the project's central brain
 * (brain/projects/<name>/, ADR-035) and regenerates the index.
 *
 * Mirrors the demo-builder runner (runAgentTurn + a review gate). Injectable
 * queryFn for tests.
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runAgentTurn,
  readSessionStatus,
  writeSessionStatus,
  makeHeartbeatWriter,
  type QueryFn,
} from './interactive-session.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { projectBrainDir, projectThemesDir } from './brain-paths.ts';
import { regenerateBrainIndex } from '../cli/brain-index.ts';

export const projectBrainAgentSpec = deriveAgentSpec('skills/project-brain-builder/SKILL.md');
export const PROJECT_BRAIN_MODEL = modelForSpec(projectBrainAgentSpec);

export type ProjectBrainPhase =
  | 'briefing'
  | 'analyzing'
  | 'awaiting-review'
  | 'committing'
  | 'committed'
  | 'abandoned';

export type ProjectBrainStatus = {
  session_id: string;
  /** The project id / name — the central-brain key (brain/projects/<project>/). */
  project: string;
  /** Absolute path to the project repo the agent reads. */
  project_repo_path: string;
  phase: ProjectBrainPhase;
  /** The operator's focus/guidance for the brain (persisted to prompt.md). */
  prompt: string;
  updated_at: string;
};

export type RunProjectBrainTurnInput = {
  sessionId: string;
  /** Managed-project dir under forge `projects/` (holds the session dir). */
  projectRoot: string;
  /** Forge root (central brain). Defaults to cwd. */
  forgeRoot?: string;
  queryFn?: QueryFn;
  logsRoot?: string;
  logger?: EventLogger;
  skillPromptPath?: string;
};

export type RunProjectBrainTurnResult = {
  phase: ProjectBrainPhase;
  wrote: string[];
  /** The staged (or committed) theme file names. */
  themes?: string[];
};

export function projectBrainSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '_project-brain', sessionId);
}

function stagingThemesDir(sessionDir: string): string {
  return join(sessionDir, 'themes');
}

function loadSkillPrompt(skillPromptPath: string | undefined, forgeRoot: string): string {
  const path = skillPromptPath ?? resolve(forgeRoot, 'skills/project-brain-builder/SKILL.md');
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return 'You are the forge project-brain builder.';
  }
}

export async function runProjectBrainTurn(
  input: RunProjectBrainTurnInput,
): Promise<RunProjectBrainTurnResult> {
  const sessionDir = projectBrainSessionDir(input.projectRoot, input.sessionId);
  const status = readSessionStatus<ProjectBrainStatus>(sessionDir);
  if (!status) {
    throw new Error(`project-brain runner: no status.json at ${sessionDir}. Has the session been started?`);
  }

  const forgeRoot = input.forgeRoot ?? resolve('.');
  const logsRoot = input.logsRoot ?? resolve(forgeRoot, '_logs');
  const cycleId = `_project-brain-${input.sessionId}`;
  const initiativeId = `project-brain-${input.sessionId}`;
  const logger = input.logger ?? createLogger(cycleId, logsRoot);
  const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);

  const startEv = logger.emit({
    initiative_id: initiativeId,
    phase: 'reflection',
    skill: 'project-brain-builder',
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `project-brain turn (phase=${status.phase})`,
    metadata: { session_id: input.sessionId, phase: status.phase, project: status.project },
  });

  const sink = makeToolEventSink(logger, {
    initiativeId,
    parentEventId: startEv.event_id,
    phase: 'reflection',
    skill: 'project-brain-builder',
  });
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));

  let result: RunProjectBrainTurnResult;

  if (status.phase === 'analyzing') {
    result = await runAnalyzeStep({ input, sessionDir, status, forgeRoot, queryFn, onToolUse: sink.onToolUse, onHeartbeat });
  } else if (status.phase === 'committing') {
    result = runCommitStep({ sessionDir, status, forgeRoot, logger, initiativeId });
  } else if (status.phase === 'abandoned') {
    writeSessionStatus(sessionDir, { ...status, phase: 'abandoned' });
    result = { phase: 'abandoned', wrote: [] };
  } else {
    result = { phase: status.phase, wrote: [] };
  }

  sink.flushIteration(1);
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: startEv.event_id,
    phase: 'reflection',
    skill: 'project-brain-builder',
    event_type: 'end',
    input_refs: [],
    output_refs: result.wrote,
    message: `project-brain turn end (phase=${result.phase})`,
    metadata: { session_id: input.sessionId, phase: result.phase, theme_count: result.themes?.length ?? 0 },
  });
  return result;
}

// --- analyze step: the agent reads the project + authors staged themes --------

async function runAnalyzeStep(args: {
  input: RunProjectBrainTurnInput;
  sessionDir: string;
  status: ProjectBrainStatus;
  forgeRoot: string;
  queryFn: QueryFn;
  onToolUse: (d: Parameters<NonNullable<Parameters<typeof runAgentTurn>[0]['onToolUse']>>[0]) => void;
  onHeartbeat: () => void;
}): Promise<RunProjectBrainTurnResult> {
  const { input, sessionDir, status, forgeRoot, queryFn, onToolUse, onHeartbeat } = args;
  const staging = stagingThemesDir(sessionDir);
  mkdirSync(staging, { recursive: true });

  const skill = loadSkillPrompt(input.skillPromptPath, forgeRoot);
  const prompt = [
    skill,
    '',
    '## Your task this turn: read the project and author its initial brain.',
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory — READ from here): ${status.project_repo_path}`,
    `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
    '',
    'Operator focus / guidance:',
    status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
    '',
    'Author 3–6 theme `.md` files plus a `profile.md` into the staging directory. Then stop.',
  ].join('\n');

  await runAgentTurn({
    queryFn,
    prompt,
    cwd: status.project_repo_path,
    model: PROJECT_BRAIN_MODEL,
    allowedTools: projectBrainAgentSpec.allowedTools,
    disallowedTools: projectBrainAgentSpec.disallowedTools,
    maxTurns: 30,
    onToolUse,
    onHeartbeat,
    label: `project-brain-${input.sessionId}`,
  });

  const themes = listStagedThemes(staging);
  if (themes.length === 0) {
    throw new Error(
      'project-brain runner: the agent turn produced no theme files — re-run to retry, or refine the guidance.',
    );
  }
  writeSessionStatus(sessionDir, { ...status, phase: 'awaiting-review' });
  return { phase: 'awaiting-review', wrote: themes.map((t) => join(staging, t)), themes };
}

// --- commit step: copy staged themes into the central project brain -----------

function runCommitStep(args: {
  sessionDir: string;
  status: ProjectBrainStatus;
  forgeRoot: string;
  logger: EventLogger;
  initiativeId: string;
}): RunProjectBrainTurnResult {
  const { sessionDir, status, forgeRoot } = args;
  const staging = stagingThemesDir(sessionDir);
  const staged = listStagedThemes(staging);

  const centralThemes = projectThemesDir(forgeRoot, status.project);
  const centralBrain = projectBrainDir(forgeRoot, status.project);
  mkdirSync(centralThemes, { recursive: true });

  const wrote: string[] = [];
  for (const file of staged) {
    if (file === 'profile.md') {
      const dest = join(centralBrain, 'profile.md');
      copyFileSync(join(staging, file), dest);
      wrote.push(dest);
    } else {
      const dest = join(centralThemes, file);
      copyFileSync(join(staging, file), dest);
      wrote.push(dest);
    }
  }

  // Ensure a kb.yaml descriptor exists so the brain is discoverable.
  const kbYaml = join(centralBrain, 'kb.yaml');
  if (!existsSync(kbYaml)) {
    writeFileSync(
      kbYaml,
      `id: ${status.project}\nname: ${status.project} Brain\nscope: project\ndesc: Per-project brain for ${status.project}.\n`,
    );
    wrote.push(kbYaml);
  }

  try { regenerateBrainIndex({ cwd: forgeRoot }); } catch { /* index regen best-effort */ }

  writeSessionStatus(sessionDir, { ...status, phase: 'committed' });
  return { phase: 'committed', wrote, themes: staged };
}

function listStagedThemes(staging: string): string[] {
  if (!existsSync(staging)) return [];
  try {
    return readdirSync(staging).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}
