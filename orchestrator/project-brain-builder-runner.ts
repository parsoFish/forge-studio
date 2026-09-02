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
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';

import {
  runAgentTurn,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  statusWriteRefusalReason,
  makeHeartbeatWriter,
  makeThinkingSink,
  type QueryFn,
} from '@forge/sessions/interactive-session.ts';
import { createLogger, type EventLogger } from '@forge/kernel';
import { resolveGuardedPath } from '@forge/kernel';
import { makeToolEventSink } from '@forge/agents/tool-event-emit.ts';
import { modelForSpec, resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPathRelative, loadSkillTurnPrompt } from '@forge/agents/skill-path.ts';
import {
  PROJECT_BRAIN_KIND_DIR,
  buildAnalyzePlan,
  commitProjectBrain,
  listStagedThemes,
} from '@forge/knowledge/project-brain-build.ts';
import type { KbBinding } from '@forge/contracts/studio/types.ts';

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
  /**
   * R1-06 WI-2 (F2 hand-off, T1 ruling Q4 option (a)): when this session was
   * started as the POST /api/studio/kbs create hand-off, these two fields
   * carry the target KB's OWN id + binding (which may differ from `project`
   * — an arbitrary directory the session dir merely nests under). Absent
   * (the ordinary, non-KB-scoped project-brain flow), the commit step falls
   * back to the historical default: `{ kind: 'project', ref: project }`.
   */
  kb_id?: string;
  kb_binding?: KbBinding;
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's
   * `/api/project-brain/start` route against `projectBrainAgentSpec`
   * (`strategy:fixed`, so the only legal value is the fixed model's own
   * tier) before it is ever persisted here. Absent ⇒ unchanged default
   * behavior (`PROJECT_BRAIN_MODEL`).
   */
  modelTier?: ModelTier;
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

export function projectBrainSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PROJECT_BRAIN_KIND_DIR, sessionId);
}

function stagingThemesDir(sessionDir: string): string {
  return join(sessionDir, 'themes');
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
    phase: 'project-brain',
    skill: 'project-brain-builder',
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `project-brain turn (phase=${status.phase})`,
    metadata: { session_id: input.sessionId, phase: status.phase, project: status.project },
  });

  // W6-B1: interactive sessions are operator-attended, low-volume turns —
  // pass the same {readOnlySampleRate:1, cap:200} "unsampled" opts as every
  // other interactive runner (the unattended dev-loop/PM/reflector phases
  // are unchanged and keep the sampler's defaults).
  const sink = makeToolEventSink(
    logger,
    {
      initiativeId,
      parentEventId: startEv.event_id,
      phase: 'project-brain',
      skill: 'project-brain-builder',
    },
    { readOnlySampleRate: 1, cap: 200 },
  );
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const onThinking = makeThinkingSink(logger, {
    initiativeId, phase: 'project-brain', skill: 'project-brain-builder', idMeta: { session_id: input.sessionId },
  });

  let result: RunProjectBrainTurnResult;

  if (status.phase === 'analyzing') {
    result = await runAnalyzeStep({ input, sessionDir, status, forgeRoot, queryFn, logger, initiativeId, onToolUse: sink.onToolUse, onHeartbeat, onThinking });
  } else if (status.phase === 'committing') {
    // The brain half is `@forge/knowledge`'s; the phase transition is this
    // runner's, because it is the half that may touch `@forge/sessions`.
    const committed = commitProjectBrain({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      forgeRoot,
      status,
    });
    writeProjectBrainStatus(input.projectRoot, input.sessionId, { ...status, phase: 'committed' });
    result = { phase: 'committed', wrote: committed.wrote, themes: committed.themes };
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
    phase: 'project-brain',
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
  /** W8-B6 — required, so this step cannot spawn hook-blind. */
  logger: EventLogger;
  initiativeId: string;
  onToolUse: (d: Parameters<NonNullable<Parameters<typeof runAgentTurn>[0]['onToolUse']>>[0]) => void;
  onHeartbeat: () => void;
  /** Forward extended-thinking blocks to the event log (W6-B1). */
  onThinking?: (text: string) => void;
}): Promise<RunProjectBrainTurnResult> {
  const { input, sessionDir, status, forgeRoot, queryFn, onToolUse, onHeartbeat, onThinking } = args;
  const staging = stagingThemesDir(sessionDir);
  mkdirSync(staging, { recursive: true });

  const skillFor = (turnId: string) =>
    loadSkillTurnPrompt({ name: 'project-brain-builder', turnId, skillPromptPath: input.skillPromptPath });
  const { cwd, prompt } = buildAnalyzePlan(status, forgeRoot, staging, skillFor);

  await runAgentTurn({
    queryFn,
    prompt,
    cwd,
    model: resolveSessionModel(projectBrainAgentSpec, status.modelTier),
    allowedTools: projectBrainAgentSpec.allowedTools,
    disallowedTools: projectBrainAgentSpec.disallowedTools,
    ...(() => {
      const hooks = sdkHooksForAgent({ skill: projectBrainAgentSpec.skill, logger: args.logger, initiativeId: args.initiativeId });
      return hooks !== undefined ? { hooks } : {};
    })(),
    maxTurns: 30,
    onToolUse,
    onHeartbeat,
    onThinking,
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

// W6-B1 review round 2: the local makeThinkingSink duplicate was removed —
// this file now consumes the ONE shared sink exported from
// interactive-session.ts (imported above). This runner still has no
// reasoning sink (it never had one before W6-B1; unchanged scope).

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
    // W7-FIX-A2 (W7A2-01): the seam ALSO refuses a write that would move an
    // on-disk `cancelled` phase — a turn that finished after the operator
    // cancelled. Name that honestly (the advance is discarded by design;
    // lifecycle reads terminal, never crashed) instead of "containment".
    if (statusWriteRefusalReason(projectRoot, [PROJECT_BRAIN_KIND_DIR, sessionId], status.phase) === 'cancelled') {
      throw new Error(
        `project-brain runner: the session was cancelled while this turn ran — the turn's advance to "${status.phase}" is discarded and status.json stays cancelled (the terminal cancelled phase is sticky).`,
      );
    }
    throw new Error(
      'project-brain runner: status.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
}
