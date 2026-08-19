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

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runAgentTurn,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  statusWriteRefusalReason,
  makeHeartbeatWriter,
  makeThinkingSink,
  type QueryFn,
} from './interactive-session.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile, guardedReadDir } from '../cli/studio-path-guard.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec, resolveSessionModel, type ModelTier } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { loadKbDescriptor, serializeKbDescriptor } from './studio/registry.ts';
import { regenerateBrainIndex } from '../cli/brain-index.ts';
import { skillPathRelative, loadSkillTurnPrompt } from './skill-path.ts';
import { cyclesRawDir } from './brain-paths.ts';
import type { KbBinding } from './studio/types.ts';

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
const PROJECT_BRAIN_KIND_DIR = '_project-brain';

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
    phase: 'reflection',
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
      phase: 'reflection',
      skill: 'project-brain-builder',
    },
    { readOnlySampleRate: 1, cap: 200 },
  );
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const onThinking = makeThinkingSink(logger, {
    initiativeId, phase: 'reflection', skill: 'project-brain-builder', idMeta: { session_id: input.sessionId },
  });

  let result: RunProjectBrainTurnResult;

  if (status.phase === 'analyzing') {
    result = await runAnalyzeStep({ input, sessionDir, status, forgeRoot, queryFn, onToolUse: sink.onToolUse, onHeartbeat, onThinking });
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

/**
 * R4-19 WI-1: pure `{cwd, prompt}` plan for the analyze-step agent turn.
 * Extracted from `runAnalyzeStep` (ADR-042 pure-function allowance) so the
 * read-source branch is directly testable without spinning up an agent turn.
 *
 * Branches on `status.kb_binding`:
 *   - a `flow` binding WITH a `band` (the create-kb-cycle case, e.g.
 *     `review-insights` bound to `{kind:'flow', ref:'forge-develop',
 *     band:'review-band'}`) has NO project repo to read — its evidence is
 *     the forge-owned cycle archives (Brain 2, `cyclesRawDir`) plus the
 *     review-band / adversarial-review findings logged inside them.
 *   - every other binding shape (`project`, `unique`, a `flow` binding
 *     WITHOUT a band, or no `kb_binding` at all — the historical default)
 *     stays on the ordinary project-repo read.
 *
 * R4-23 WI-3: the task PROSE for each branch (the `## Your task this turn:
 * …` header, the evidence-source sentence, the closing write-contract
 * instruction) now lives in `skills/project-brain-builder/SKILL.md` as the
 * `analyze-project-repo` / `analyze-cycle-archives` turn sections (ADR-024 —
 * SKILL.md is the single source of intent). This function selects the right
 * turn id per branch via `skillFor` and composes it with DATA ONLY (project
 * name, working directory, staging directory, operator guidance, and —
 * replacing the old inline `${binding.ref}` / `${binding.band}`
 * interpolation into the prose — the `Evidence flow:` / `Evidence band:`
 * data lines the SKILL.md prose now names instead of embedding).
 */
export function buildAnalyzePlan(
  status: ProjectBrainStatus,
  forgeRoot: string,
  staging: string,
  skillFor: (turnId: string) => string,
): { cwd: string; prompt: string } {
  const binding = status.kb_binding;
  if (binding?.kind === 'flow' && binding.band) {
    const cwd = cyclesRawDir(forgeRoot);
    const prompt = [
      skillFor('analyze-cycle-archives'),
      '',
      `Project: ${status.project}`,
      `Cycle archives (your working directory — READ from here): ${cwd}`,
      `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
      '',
      'Operator focus / guidance:',
      status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
      '',
      `Evidence flow: ${binding.ref}`,
      `Evidence band: ${binding.band}`,
    ].join('\n');
    return { cwd, prompt };
  }

  const cwd = status.project_repo_path;
  const prompt = [
    skillFor('analyze-project-repo'),
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory — READ from here): ${status.project_repo_path}`,
    `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
    '',
    'Operator focus / guidance:',
    status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
  ].join('\n');
  return { cwd, prompt };
}

async function runAnalyzeStep(args: {
  input: RunProjectBrainTurnInput;
  sessionDir: string;
  status: ProjectBrainStatus;
  forgeRoot: string;
  queryFn: QueryFn;
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

  // R1-06 WI-2 (T1 ruling Q4 option (a)): honor a descriptor-derived binding
  // when this session carries one (the POST /api/studio/kbs create hand-off,
  // F2) — never silently re-derive `{ kind: 'project', ref: status.project }`.
  // Absent a descriptor (the ordinary, non-KB-scoped project-brain flow), the
  // fallback IS that historical default, unchanged.
  //
  // `kb_id` present ⇔ this session is a POST /api/studio/kbs create hand-off.
  const isCreateHandoff = status.kb_id !== undefined;
  const kbId = status.kb_id ?? status.project;
  const binding: KbBinding = status.kb_binding ?? { kind: 'project', ref: status.project };

  // Brain-dir resolution MUST agree with what POST /api/studio/kbs already
  // scaffolded, or the descriptor splits in two (one empty kb.yaml at the
  // create location, one seeded kb.yaml here) and every operator-authored theme
  // is silently orphaned. Create scaffolds brain/<id> UNCONDITIONALLY for EVERY
  // binding kind (cli/bridge-studio-kbs.ts create route), so a create hand-off
  // commits into brain/<kbId> REGARDLESS of binding.kind — resolveKbBrainDir
  // (orchestrator/brain-paths.ts) resolves it there. Only the ORDINARY
  // project-brain flow (no hand-off, kbId === status.project, a real project)
  // targets the central per-project brain brain/projects/<project> (ADR 035).
  //
  // SEC-04: `kbId` is request-derived (either `status.project` or a
  // descriptor's own id) — it rides as its OWN guarded segment against the
  // TRUSTED forgeRoot below, NEVER folded into a root (the root-folding bypass
  // the guard cannot self-detect).
  const brainSegs = isCreateHandoff ? ['brain', kbId] : ['brain', 'projects', kbId];

  const wrote: string[] = [];
  for (const file of staged) {
    // Source: a staged theme leaf the agent authored under the session dir.
    // Route the READ through the guard (a symlinked staged file → null → skip),
    // and route the central-brain WRITE through the guard too (kb id +
    // filename as guarded segments). `file` is a readdir entry name, so it is a
    // single safe path component by construction.
    const contents = guardedReadFile(input.projectRoot, [PROJECT_BRAIN_KIND_DIR, input.sessionId, 'themes', file]);
    if (contents === null) continue; // unreadable / escaping staged leaf — skip
    const destSegs = file === 'profile.md' ? [...brainSegs, 'profile.md'] : [...brainSegs, 'themes', file];
    const dest = guardedWriteFile(forgeRoot, destSegs, contents);
    if (dest === null) {
      throw new Error(
        `project-brain runner: refusing to commit — destination for "${file}" failed containment (kb="${kbId}").`,
      );
    }
    wrote.push(dest);
  }

  // Ensure a kb.yaml descriptor exists so the brain is discoverable.
  // Existence + write both routed through the guard (kb id folded as a
  // segment, not the root).
  const existingKb = guardedReadFile(forgeRoot, [...brainSegs, 'kb.yaml']);
  if (existingKb === null) {
    const kbDest = guardedWriteFile(
      forgeRoot,
      [...brainSegs, 'kb.yaml'],
      serializeKbDescriptor({
        id: kbId,
        name: `${kbId} Brain`,
        binding,
        desc: binding.kind === 'project' ? `Per-project brain for ${kbId}.` : `Brain for ${kbId}.`,
        path: '',
      }),
    );
    if (kbDest === null) {
      throw new Error(
        `project-brain runner: refusing to commit — kb.yaml for "${kbId}" failed containment.`,
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

// W6-B1 review round 2: the local makeThinkingSink duplicate was removed —
// this file now consumes the ONE shared sink exported from
// interactive-session.ts (imported above). This runner still has no
// reasoning sink (it never had one before W6-B1; unchanged scope).

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
