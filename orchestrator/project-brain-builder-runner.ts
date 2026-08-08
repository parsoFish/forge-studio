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
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runAgentTurn,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  makeHeartbeatWriter,
  type QueryFn,
} from './interactive-session.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile, guardedReadDir } from '../cli/studio-path-guard.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { loadKbDescriptor, serializeKbDescriptor } from './studio/registry.ts';
import { regenerateBrainIndex } from '../cli/brain-index.ts';
import { skillPath, skillPathRelative } from './skill-path.ts';

export const projectBrainAgentSpec = deriveAgentSpec(skillPathRelative('project-brain-builder'));
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

/** The kind-dir under a project root that holds project-brain sessions. */
const PROJECT_BRAIN_KIND_DIR = '_project-brain';

export function projectBrainSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PROJECT_BRAIN_KIND_DIR, sessionId);
}

function stagingThemesDir(sessionDir: string): string {
  return join(sessionDir, 'themes');
}

function loadSkillPrompt(skillPromptPath: string | undefined, forgeRoot: string): string {
  const path = skillPromptPath ?? skillPath('project-brain-builder', forgeRoot);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return 'You are the forge project-brain builder.';
  }
}

export async function runProjectBrainTurn(
  input: RunProjectBrainTurnInput,
): Promise<RunProjectBrainTurnResult> {
  // SEC-04 runner leg: contain the session dir before the first read — `sessionId`
  // and the kind-dir arrive as their own guarded segments against the projectRoot
  // base, so a traversal sessionId or a symlinked `_project-brain` resolves to a
  // reject and the runner REFUSES rather than read out-of-root content.
  const dirSegments = [PROJECT_BRAIN_KIND_DIR, input.sessionId];
  const guarded = resolveGuardedPath(input.projectRoot, dirSegments);
  if (!guarded.ok) {
    throw new Error(
      `project-brain runner: no status.json — session dir failed containment (${guarded.reason}). Has the session been started?`,
    );
  }
  const sessionDir = guarded.realPath;
  // SEC-04 leaf: route the status.json READ through the guarded sibling (leaf
  // included) so a symlinked status.json inside the real, contained session dir
  // is refused too. projectRoot is trusted; kind-dir + sessionId ride as guarded
  // segments. A rejected leaf collapses to null → the runner refuses.
  const status = guardedReadSessionStatus<ProjectBrainStatus>(input.projectRoot, dirSegments);
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
    result = runCommitStep({ input, sessionDir, status, forgeRoot, logger, initiativeId });
  } else if (status.phase === 'abandoned') {
    writeProjectBrainStatus(input.projectRoot, input.sessionId, { ...status, phase: 'abandoned' });
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

  const themes = listStagedThemes(input.projectRoot, input.sessionId);
  if (themes.length === 0) {
    throw new Error(
      'project-brain runner: the agent turn produced no theme files — re-run to retry, or refine the guidance.',
    );
  }
  writeProjectBrainStatus(input.projectRoot, input.sessionId, { ...status, phase: 'awaiting-review' });
  return { phase: 'awaiting-review', wrote: themes.map((t) => join(staging, t)), themes };
}

// --- commit step: copy staged themes into the central project brain -----------

function runCommitStep(args: {
  input: RunProjectBrainTurnInput;
  sessionDir: string;
  status: ProjectBrainStatus;
  forgeRoot: string;
  logger: EventLogger;
  initiativeId: string;
}): RunProjectBrainTurnResult {
  const { input, status, forgeRoot } = args;
  const staged = listStagedThemes(input.projectRoot, input.sessionId);

  // SEC-04: `status.project` is request-derived — contain it (and every leaf)
  // as its OWN segment against the TRUSTED forgeRoot, NEVER folded into a
  // projectThemesDir/projectBrainDir root (that would be the root-folding
  // bypass the guard cannot self-detect). Central brain layout (ADR 035):
  // brain/projects/<project>/{themes/<file>,profile.md,kb.yaml}.
  const brainSegs = ['brain', 'projects', status.project];

  const wrote: string[] = [];
  for (const file of staged) {
    // Source: a staged theme leaf the agent authored under the session dir.
    // Route the READ through the guard (a symlinked staged file → null → skip),
    // and route the central-brain WRITE through the guard too (project +
    // filename as guarded segments). `file` is a readdir entry name, so it is a
    // single safe path component by construction.
    const contents = guardedReadFile(input.projectRoot, [PROJECT_BRAIN_KIND_DIR, input.sessionId, 'themes', file]);
    if (contents === null) continue; // unreadable / escaping staged leaf — skip
    const destSegs = file === 'profile.md' ? [...brainSegs, 'profile.md'] : [...brainSegs, 'themes', file];
    const dest = guardedWriteFile(forgeRoot, destSegs, contents);
    if (dest === null) {
      throw new Error(
        `project-brain runner: refusing to commit — destination for "${file}" failed containment (project="${status.project}").`,
      );
    }
    wrote.push(dest);
  }

  // Ensure a kb.yaml descriptor exists so the brain is discoverable. R1-01:
  // binding.kind=project ref=<project> — the owning-project identity,
  // replacing the old loose `scope: project` enum. Existence + write both
  // routed through the guard (project folded as a segment, not the root).
  const existingKb = guardedReadFile(forgeRoot, [...brainSegs, 'kb.yaml']);
  if (existingKb === null) {
    const kbDest = guardedWriteFile(
      forgeRoot,
      [...brainSegs, 'kb.yaml'],
      serializeKbDescriptor({
        id: status.project,
        name: `${status.project} Brain`,
        binding: { kind: 'project', ref: status.project },
        desc: `Per-project brain for ${status.project}.`,
        path: '',
      }),
    );
    if (kbDest === null) {
      throw new Error(
        `project-brain runner: refusing to commit — kb.yaml for project "${status.project}" failed containment.`,
      );
    }
    // Loud self-check (parity with project-brain-seed): a malformed kb.yaml
    // fails the commit rather than shipping an undiscoverable brain.
    loadKbDescriptor(kbDest);
    wrote.push(kbDest);
  }

  try { regenerateBrainIndex({ cwd: forgeRoot }); } catch { /* index regen best-effort */ }

  writeProjectBrainStatus(input.projectRoot, input.sessionId, { ...status, phase: 'committed' });
  return { phase: 'committed', wrote, themes: staged };
}

/** SEC-04 leaf: the staged-themes readdir routed through the guard (leaf dir
 *  included) — a symlinked `themes/` collapses to null → []. */
function listStagedThemes(projectRoot: string, sessionId: string): string[] {
  const entries = guardedReadDir(projectRoot, [PROJECT_BRAIN_KIND_DIR, sessionId, 'themes']);
  if (entries === null) return [];
  return entries.filter((f) => f.endsWith('.md')).sort();
}

/**
 * SEC-04 leaf: guarded status.json write. Routes the WHOLE
 * `<projectRoot>/<kind>/<sid>/status.json` path (leaf included) through the
 * containment guard and THROWS (fail closed — the runner contract) if the leaf
 * escapes.
 */
function writeProjectBrainStatus(
  projectRoot: string,
  sessionId: string,
  status: ProjectBrainStatus,
): void {
  const p = guardedWriteSessionStatus(projectRoot, [PROJECT_BRAIN_KIND_DIR, sessionId], status);
  if (p === null) {
    throw new Error(
      'project-brain runner: status.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
}
