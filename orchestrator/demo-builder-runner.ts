/**
 * In-UI demo-builder runner (Stage B).
 *
 * Builds a project's demo as a rich, self-contained **HTML page** (`DEMO.html`)
 * plus the in-repo machinery to reproduce it — replacing the rigid `demo.json`
 * contract with bespoke, Forge-styled HTML the agent authors per project. The
 * operator reviews the rendered page in a sandboxed iframe and gives direct
 * feedback; the agent revises until the operator locks it in for reproducibility.
 *
 * Unlike the read-only instructions-creator (where the runner writes the single
 * output file), the demo-builder agent WRITES the machinery + DEMO.html into the
 * project repo itself (write tools, cwd = the repo). The runner verifies the
 * agent produced DEMO.html, drives the feedback loop, and records the lock.
 *
 * State machine (`status.json.phase`):
 *   generating ──▶ awaiting-review ──(bridge: feedback)──▶ generating
 *                        │ (bridge: lock)
 *                        ▼
 *                     locking ──▶ locked
 *                        └ (bridge: abandon) ──▶ abandoned
 *
 * Accepted residual (same trust tier as the hardlink/TOCTOU notes in
 * `orchestrator/studio/session-transcript.ts`'s header — read that first for
 * the precedent this follows): `runLockStep`'s selected-generation restore
 * writes `DEMO.html` then the generator skill as two separate `writeFileSync`
 * calls, not one atomic transaction. A genuine fs failure between the two
 * (disk full, EMFILE, a killed process) leaves a half-restore — one file
 * holding the chosen generation's bytes, the other still holding whatever was
 * in the repo before this lock attempt. This is disclosed, not fixed: the
 * validation that gates this write (the `skillRelPath` allowlist + realpath
 * containment below) runs BEFORE either write, so the residual is strictly
 * about a mid-restore OS-level failure, never about untrusted input reaching
 * a write it shouldn't; a true atomic pair-write would need a temp-file +
 * rename on both files plus a way to make two renames commit together
 * (effectively a two-phase-commit journal) for a failure mode that is
 * self-healing regardless — the operator's next lock attempt re-runs the
 * SAME restore from the SAME immutable `generations/<n>/` snapshot and
 * overwrites whatever partial state was left, so no repeated attempt can
 * observe (or worsen) the half-restored window.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

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
import { ensureStudioBranch, commitStudioChange } from './project-repo-tx.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { loadProjectConfig } from './project-config.ts';
import { listDemoElements } from './studio/registry.ts';
import type { DemoStep, DemoElementDefinition } from './studio/types.ts';
import { skillPath, skillPathRelative, SLUG_RE } from './skill-path.ts';

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/demo-builder/SKILL.md (single source)
// ---------------------------------------------------------------------------

export const demoBuilderAgentSpec = deriveAgentSpec(skillPathRelative('demo-builder'));
export const DEMO_BUILDER_MODEL = modelForSpec(demoBuilderAgentSpec);

// ---------------------------------------------------------------------------
// Paths (project-repo-relative)
// ---------------------------------------------------------------------------

export const DEMO_REL_DIR = '.forge/demo';
/** The reusable per-initiative-change demo generator the agent authors. Same slug
 *  + path the existing demo-design machinery / preflight DEMO-SKILL clause use. */
export const DEMO_SKILL_REL_PATH = '.forge/skills/demo-design/SKILL.md';
/** The reviewable sample the generator renders from a representative real change. */
export const DEMO_HTML_REL_PATH = '.forge/demo/DEMO.html';
export const DEMO_LOCK_REL_PATH = '.forge/demo/demo.lock.json';
/** Where each locked demo is snapshotted so previous demos stay viewable. */
export const DEMO_HISTORY_REL_DIR = '.forge/demo/history';
/** Per-element rendered fragments — one `<id>.html` each, so the operator can
 *  view a single part's output independently. The composer assembles these in
 *  demoProcess order into DEMO.html. */
export const DEMO_FRAGMENTS_REL_DIR = '.forge/demo/fragments';
/** Forge-root-relative path to the base stylesheet the agent inlines. */
export const FORGE_DEMO_CSS_REL_PATH = 'studio/demo/forge-demo.css';

/** R4-16 — session-dir-relative home for per-generation snapshots
 *  (`<sessionDir>/generations/<n>/`), NEVER the project repo (D4: the
 *  derivation may not read outside sessionDir, and project-repo history would
 *  commit intermediate generations onto the project's forge-studio branch). */
export const GENERATIONS_DIRNAME = 'generations';
/** The two files a generation snapshots — exactly the pair `runGenerateStep`
 *  already verifies (D5) — plus the metadata file recording how to restore
 *  them. */
export const GENERATION_DEMO_FILENAME = 'DEMO.html';
export const GENERATION_SKILL_FILENAME = 'SKILL.md';
export const GENERATION_META_FILENAME = 'meta.json';

// ---------------------------------------------------------------------------
// Session-dir state contract
// ---------------------------------------------------------------------------

export type DemoBuilderPhase =
  | 'briefing'
  | 'generating'
  | 'awaiting-review'
  | 'locking'
  | 'locked'
  | 'abandoned';

export type DemoBuilderStatus = {
  session_id: string;
  project: string;
  /** Absolute path to the project's git repo (where .forge/demo/ is written). */
  project_repo_path: string;
  phase: DemoBuilderPhase;
  /**
   * `create` — no locked demo yet, build one. `update` — a demo skill/sample
   * already exists; the operator's brief is change-notes and the agent revises
   * the existing skill + sample rather than rebuilding. Absent ⇒ `create`.
   */
  mode?: 'create' | 'update';
  /**
   * When set, the agent iterates ONLY this demo-element kind (a "smaller chunk"):
   * it authors/refines `.forge/skills/demo/<targetElement>/` and renders just that
   * element's fragment as the sample, so the operator can perfect one element
   * before composing the whole demo. Absent ⇒ compose the full demo.
   */
  targetElement?: string;
  /** 1-based generate-turn counter. */
  iteration: number;
  /** The operator's look-and-feel guidance / change-notes (persisted to `prompt.md`). */
  prompt: string;
  updated_at: string;
  /**
   * R4-16 — the generation number the operator chose to lock, DECLARED here
   * and ENFORCED by `runLockStep` (D6): naming a generation with no
   * readable/parsable snapshot fails the lock loudly (declared-data-fails-open
   * is the antipattern this guards against — it must never silently lock the
   * latest). Absent ⇒ lock whatever is currently in the repo (today's
   * behaviour, unchanged) and `demo.lock.json.generation` records `null`.
   */
  selectedGeneration?: number;
};

export type RunDemoBuilderTurnInput = {
  sessionId: string;
  /** Managed-project dir under forge `projects/` (holds the session dir). */
  projectRoot: string;
  /** Forge root for reading the base CSS + skill. Defaults to `process.cwd()`. */
  forgeRoot?: string;
  queryFn?: QueryFn;
  logsRoot?: string;
  logger?: EventLogger;
  skillPromptPath?: string;
};

export type RunDemoBuilderTurnResult = {
  phase: DemoBuilderPhase;
  wrote: string[];
  /** Present after a generate turn — absolute path to the produced DEMO.html. */
  demoPath?: string;
  /** Present after lock — absolute path to demo.lock.json. */
  lockPath?: string;
};

export function demoSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '_demo', sessionId);
}

// ---------------------------------------------------------------------------
// Turn entry point
// ---------------------------------------------------------------------------

export async function runDemoBuilderTurn(
  input: RunDemoBuilderTurnInput,
): Promise<RunDemoBuilderTurnResult> {
  const sessionDir = demoSessionDir(input.projectRoot, input.sessionId);
  const status = readSessionStatus<DemoBuilderStatus>(sessionDir);
  if (!status) {
    throw new Error(
      `demo-builder runner: no status.json at ${sessionDir}. Has the session been started?`,
    );
  }

  const forgeRoot = input.forgeRoot ?? resolve('.');
  const logsRoot = input.logsRoot ?? resolve('_logs');
  const cycleId = `_demo-${input.sessionId}`;
  const initiativeId = `demo-${input.sessionId}`;
  const logger = input.logger ?? createLogger(cycleId, logsRoot);
  const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);

  const startEv = logger.emit({
    initiative_id: initiativeId,
    phase: 'unifier',
    skill: 'demo-builder-runner',
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `demo-builder turn (phase=${status.phase}, iteration=${status.iteration})`,
    metadata: { session_id: input.sessionId, phase: status.phase, iteration: status.iteration },
  });

  const sink = makeToolEventSink(logger, {
    initiativeId,
    parentEventId: startEv.event_id,
    phase: 'unifier',
    skill: 'demo-builder-runner',
  });
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const onText = makeReasoningSink(logger, initiativeId, input.sessionId);

  let result: RunDemoBuilderTurnResult;

  // The agent writes demo machinery (.forge/demo/, .forge/skills/demo-design/)
  // into the project repo — land it on the project's forge-studio branch.
  const writesProjectRepo = status.phase === 'generating' || status.phase === 'locking';
  if (writesProjectRepo) {
    try { ensureStudioBranch(status.project_repo_path); } catch { /* non-git project */ }
  }

  if (status.phase === 'generating') {
    result = await runGenerateStep({ input, sessionDir, status, forgeRoot, queryFn, logger, initiativeId, onToolUse: sink.onToolUse, onHeartbeat, onText });
  } else if (status.phase === 'locking') {
    result = runLockStep({ input, sessionDir, status, logger, initiativeId });
  } else if (status.phase === 'abandoned') {
    writeSessionStatus(sessionDir, { ...status, phase: 'abandoned' });
    result = { phase: 'abandoned', wrote: [] };
  } else {
    // awaiting-review / locked — no actionable work this turn.
    result = { phase: status.phase, wrote: [] };
  }

  if (writesProjectRepo) {
    try { commitStudioChange(status.project_repo_path, `forge-studio: demo machinery (${status.phase})`); } catch { /* best-effort */ }
  }

  sink.flushIteration(1);
  return result;
}

// ---------------------------------------------------------------------------
// Generate step — the agent writes machinery + DEMO.html into the project repo
// ---------------------------------------------------------------------------

async function runGenerateStep(args: {
  input: RunDemoBuilderTurnInput;
  sessionDir: string;
  status: DemoBuilderStatus;
  forgeRoot: string;
  queryFn: QueryFn;
  logger: EventLogger;
  initiativeId: string;
  onToolUse: (d: Parameters<NonNullable<Parameters<typeof runAgentTurn>[0]['onToolUse']>>[0]) => void;
  onHeartbeat: () => void;
  onText: (text: string) => void;
}): Promise<RunDemoBuilderTurnResult> {
  const { input, sessionDir, status, forgeRoot, queryFn, logger, initiativeId, onToolUse, onHeartbeat, onText } = args;
  const skill = loadSkillPrompt(input.skillPromptPath, forgeRoot);
  const baseCss = readBaseCss(forgeRoot);
  const feedback = readFeedback(sessionDir);

  // Composition: the demoProcess may reference demo-element kinds from the forge
  // library. When it does, the demo is COMPOSED of project-side element-skills the
  // agent authors (per the library's skill-creating-skill generators) + a composer
  // that runs them in order. `targetElement` narrows the turn to ONE element.
  const steps = loadDemoSteps(status.project_repo_path);
  const byId = new Map(listDemoElements(forgeRoot).map((e) => [e.id, e]));
  const elementSteps = steps.filter(
    (s): s is DemoStep & { element: string } => typeof s.element === 'string' && byId.has(s.element),
  );
  const target = status.targetElement && byId.has(status.targetElement) ? status.targetElement : undefined;
  const composed = elementSteps.length > 0;

  const taskLines = demoTaskLines({ status, target, composed, elementSteps, byId });

  const prompt = [
    skill,
    '',
    `## Your task this turn: ${target ? `refine the '${target}' demo element` : 'build the demo + render a sample'}`,
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory): ${status.project_repo_path}`,
    ...(status.mode === 'update' && !target
      ? ['',
         `UPDATE MODE: a locked demo already exists — ${DEMO_SKILL_REL_PATH} (the composer) and ` +
         `${DEMO_HTML_REL_PATH} (the sample). READ them and REVISE per the operator's change-notes below; ` +
         'do NOT rebuild from scratch.']
      : []),
    '',
    status.mode === 'update' ? 'Operator change-notes:' : 'Operator look-and-feel guidance:',
    status.prompt || '_(none — choose a clean, faithful before/after treatment)_',
    ...(feedback ? ['', 'Operator feedback on the previous sample (apply it):', feedback] : []),
    '',
    ...taskLines,
    '',
    '## Forge demo base stylesheet — the demo skill(s) must inline this verbatim into the HTML they emit',
    '```css',
    baseCss,
    '```',
  ].join('\n');

  const { costUsd } = await runAgentTurn({
    queryFn,
    prompt,
    cwd: status.project_repo_path,
    model: DEMO_BUILDER_MODEL,
    allowedTools: demoBuilderAgentSpec.allowedTools,
    disallowedTools: demoBuilderAgentSpec.disallowedTools,
    maxTurns: 24,
    onToolUse,
    onHeartbeat,
    onText,
    label: `demo-builder-${input.sessionId}`,
  });

  // The required generator skill is the per-element skill when iterating one
  // element, else the composer/demo-design skill; the sample DEMO.html is always
  // the reviewable artifact.
  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  const requiredSkillRel = target ? elementSkillRelPath(target) : DEMO_SKILL_REL_PATH;
  const requiredSkillPath = join(status.project_repo_path, requiredSkillRel);
  const missing = [
    !existsSync(requiredSkillPath) ? requiredSkillRel : null,
    !existsSync(demoPath) ? DEMO_HTML_REL_PATH : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `demo-builder runner: the agent turn ended without producing ${missing.join(' + ')} — re-run to retry, or refine the guidance / feedback.`,
    );
  }

  // R4-16: snapshot this turn's verified DEMO.html + generator skill into
  // <sessionDir>/generations/<iteration>/ (D4/D5) — byte copies (Buffer, not
  // utf8 decode/re-encode) so a later lock-time restore is byte-identical.
  // Snapshots ACCUMULATE: this never touches an earlier generation's dir.
  const genDir = join(sessionDir, GENERATIONS_DIRNAME, String(status.iteration));
  mkdirSync(genDir, { recursive: true });
  writeFileSync(join(genDir, GENERATION_DEMO_FILENAME), readFileSync(demoPath));
  writeFileSync(join(genDir, GENERATION_SKILL_FILENAME), readFileSync(requiredSkillPath));
  // feedback.md at TURN END (D8) — the runner never clears it, so this is
  // read fresh rather than reusing the pre-turn `feedback` value, matching
  // the literal "at turn end" contract even though the two are identical
  // under today's code (no in-turn feedback.md mutation exists).
  const generationMeta = {
    iteration: status.iteration,
    createdAt: new Date().toISOString(),
    feedback: readFeedback(sessionDir),
    targetElement: target ?? null,
    composed,
    skillRelPath: requiredSkillRel,
  };
  writeFileSync(join(genDir, GENERATION_META_FILENAME), `${JSON.stringify(generationMeta, null, 2)}\n`);

  writeSessionStatus(sessionDir, { ...status, phase: 'awaiting-review' });
  logger.emit({
    initiative_id: initiativeId, phase: 'unifier', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [], output_refs: [requiredSkillPath, demoPath], cost_usd: costUsd,
    message: `demo-generated (iteration ${status.iteration}${target ? `, element=${target}` : composed ? ', composed' : ''}, awaiting review)`,
    metadata: { session_id: input.sessionId, iteration: status.iteration, target_element: target ?? null, composed },
  });

  return { phase: 'awaiting-review', wrote: [requiredSkillPath, demoPath], demoPath };
}

// ---------------------------------------------------------------------------
// Lock step — deterministic: record the locked demo for reproducibility
// ---------------------------------------------------------------------------

function runLockStep(args: {
  input: RunDemoBuilderTurnInput;
  sessionDir: string;
  status: DemoBuilderStatus;
  logger: EventLogger;
  initiativeId: string;
}): RunDemoBuilderTurnResult {
  const { input, sessionDir, status, logger, initiativeId } = args;

  // R4-16 pin 2 (Finding C) — set only when THIS lock actually restored a
  // generation's snapshot; then it names the skill THAT generation recorded,
  // never the hardcoded composer path. Left null for an unselected lock
  // (behaviour unchanged — falls back to DEMO_SKILL_REL_PATH below, exactly
  // as before this fix).
  let restoredSkillRelPath: string | null = null;

  // R4-16 (D6) — a chosen generation is validated and restored BEFORE any
  // write happens. Fail closed: a selectedGeneration naming a missing or
  // unparsable snapshot throws, naming the requested number AND the
  // generations that DO exist — no lock file, no history entry, phase not
  // flipped, repo files untouched (declared-data-fails-open is exactly the
  // antipattern this guards against; it must never silently lock the latest).
  if (status.selectedGeneration !== undefined) {
    const meta = readGenerationSnapshotMeta(sessionDir, status.selectedGeneration);
    const genDir = join(sessionDir, GENERATIONS_DIRNAME, String(status.selectedGeneration));
    const snapshotDemoPath = join(genDir, GENERATION_DEMO_FILENAME);
    const snapshotSkillPath = join(genDir, GENERATION_SKILL_FILENAME);
    if (meta === null || !existsSync(snapshotDemoPath) || !existsSync(snapshotSkillPath)) {
      const existing = listExistingGenerationNumbers(sessionDir);
      throw new Error(
        `demo-builder runner: cannot lock — generation ${status.selectedGeneration} has no readable/parsable snapshot at ` +
        `${genDir}. Generations on disk: ${existing.length > 0 ? existing.join(', ') : '(none)'}.`,
      );
    }

    // R4-16 pin 2 (Finding B) — `meta.skillRelPath` is a WRITE target read
    // back off disk (a generation's own meta.json, which — per AT-43..45 — a
    // compromised agent turn or an operator-facing bug could smuggle a
    // malicious value into). An ALLOWLIST, never a ".." blocklist: a
    // blocklist would still admit an absolute-shaped path with zero ".."
    // segments (AT-44), and neither an allowlist nor a blocklist alone stops
    // a path that LEXICALLY matches the legitimate shape but resolves
    // through a symlinked directory (AT-45) — hence the realpath containment
    // check right after.
    if (!isAllowedSkillRelPath(meta.skillRelPath)) {
      throw new Error(
        `demo-builder runner: cannot lock — generation ${status.selectedGeneration}'s skillRelPath "${meta.skillRelPath}" ` +
        `is not an allowed write target (must be "${DEMO_SKILL_REL_PATH}" or match ".forge/skills/demo/<slug>/SKILL.md") — refusing to write anywhere.`,
      );
    }
    const destSkillPath = join(status.project_repo_path, meta.skillRelPath);
    let realRepoRoot: string;
    try {
      realRepoRoot = realpathSync(status.project_repo_path);
    } catch {
      throw new Error(
        `demo-builder runner: cannot lock — project repo "${status.project_repo_path}" could not be resolved to verify write containment.`,
      );
    }
    if (!closestExistingAncestorContained(dirname(destSkillPath), realRepoRoot)) {
      throw new Error(
        `demo-builder runner: cannot lock — generation ${status.selectedGeneration}'s skillRelPath "${meta.skillRelPath}" ` +
        'resolves outside the project repo (a symlinked directory along its path) — refusing to write.',
      );
    }

    mkdirSync(dirname(destSkillPath), { recursive: true });
    mkdirSync(join(status.project_repo_path, DEMO_REL_DIR), { recursive: true });
    writeFileSync(join(status.project_repo_path, DEMO_HTML_REL_PATH), readFileSync(snapshotDemoPath));
    writeFileSync(destSkillPath, readFileSync(snapshotSkillPath));
    restoredSkillRelPath = meta.skillRelPath;
  }

  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  if (!existsSync(demoPath)) {
    throw new Error(
      `demo-builder runner: cannot lock — no ${DEMO_HTML_REL_PATH} in the repo. Generate a demo before locking.`,
    );
  }
  // R4-16 pin 2 (Finding C) — the generator this lock actually restored
  // (per-element or composer), never a hardcoded composer-path check that
  // ignores which skill this generation used. `restoredSkillRelPath` is null
  // only when no generation was selected this lock (unchanged fallback).
  const demoSkillRelPathForLock = restoredSkillRelPath ?? DEMO_SKILL_REL_PATH;
  const demoSkillAbsPathForLock = join(status.project_repo_path, demoSkillRelPathForLock);
  const lockPath = join(status.project_repo_path, DEMO_LOCK_REL_PATH);
  const lock = {
    session_id: status.session_id,
    project: status.project,
    prompt: status.prompt,
    iterations: status.iteration,
    // The locked, reproducible generator — future cycles run it per completed
    // initiative to render a before/after demo of that initiative's changes.
    // null only if the generator this lock actually names genuinely is not
    // on disk (never fabricated, never a stale/unrelated generator's path).
    demo_skill: existsSync(demoSkillAbsPathForLock) ? demoSkillRelPathForLock : null,
    demo_html: DEMO_HTML_REL_PATH,
    // R4-16 (D6) — the CHOSEN generation, never attributed from
    // status.iteration (a field that happens to be a number is not the same
    // thing as "the chosen generation"). null when nothing was chosen.
    generation: status.selectedGeneration ?? null,
    locked_at: status.updated_at,
  };
  if (!existsSync(join(status.project_repo_path, DEMO_REL_DIR))) {
    mkdirSync(join(status.project_repo_path, DEMO_REL_DIR), { recursive: true });
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  // Archive this locked demo into history/<sessionId>/ so previous demos remain
  // viewable — the latest stays at .forge/demo/DEMO.html, each lock is snapshotted.
  const histDir = join(status.project_repo_path, DEMO_HISTORY_REL_DIR, status.session_id);
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, 'DEMO.html'), readFileSync(demoPath, 'utf8'));
  writeFileSync(join(histDir, 'meta.json'), `${JSON.stringify(lock, null, 2)}\n`);

  writeSessionStatus(sessionDir, { ...status, phase: 'locked' });

  logger.emit({
    initiative_id: initiativeId, phase: 'unifier', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [demoPath], output_refs: [lockPath, join(histDir, 'DEMO.html')],
    message: 'demo-locked (snapshotted to history; machinery reproducible in the repo)',
    metadata: { session_id: input.sessionId, lock_path: lockPath, history_dir: histDir },
  });

  return { phase: 'locked', wrote: [lockPath, join(histDir, 'DEMO.html')], lockPath };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** R4-16 — the subset of a generation's meta.json the lock-step restore
 *  needs. Fails CLOSED (returns null) on ANY shape violation: missing file,
 *  unreadable, not JSON, or a missing/non-string `skillRelPath` (the field
 *  the restore writes the skill back to — load-bearing). */
type GenerationSnapshotMeta = { readonly skillRelPath: string };

function readGenerationSnapshotMeta(sessionDir: string, n: number): GenerationSnapshotMeta | null {
  const metaPath = join(sessionDir, GENERATIONS_DIRNAME, String(n), GENERATION_META_FILENAME);
  if (!existsSync(metaPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(metaPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.skillRelPath !== 'string' || rec.skillRelPath.length === 0) return null;
  return { skillRelPath: rec.skillRelPath };
}

/** The generation numbers that DO have a `generations/<n>/` dir on disk —
 *  used only to name what's available in the R4-16 fail-closed lock error.
 *  Best-effort: a missing/unreadable `generations/` dir yields []. */
function listExistingGenerationNumbers(sessionDir: string): number[] {
  const dir = join(sessionDir, GENERATIONS_DIRNAME);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

function describeDemoProcess(projectRepoPath: string): string {
  let steps;
  try {
    steps = loadProjectConfig(projectRepoPath)?.demoProcess;
  } catch {
    steps = undefined;
  }
  if (!steps || steps.length === 0) return '_(no demo process configured — design the skill around a representative initiative\'s before/after changes; ground the sample in a real recent change)_';
  return steps.map((s, i) => `${i + 1}. [${s.kind}] ${s.text}`).join('\n');
}

function loadDemoSteps(projectRepoPath: string): DemoStep[] {
  try {
    return loadProjectConfig(projectRepoPath)?.demoProcess ?? [];
  } catch {
    return [];
  }
}

/** The project-side, concrete element-skill the generator authors for an element kind. */
function elementSkillRelPath(id: string): string {
  return `.forge/skills/demo/${id}/SKILL.md`;
}

/** R4-16 pin 2 (Finding B) — the ONLY two shapes `readGenerationSnapshotMeta`'s
 *  `skillRelPath` may ever legitimately carry, because they are the only two
 *  shapes the runner ITSELF ever writes there (see `runGenerateStep`'s
 *  `requiredSkillRel`): the fixed composer path, or a per-element path whose
 *  slug matches the SAME `SLUG_RE` forge's own demo-element library ids use
 *  (`elementSkillRelPath` above). An allowlist, not a ".." blocklist — see
 *  `isAllowedSkillRelPath`'s call site for why a blocklist is insufficient.
 *  `SLUG_RE.source` carries its OWN `^`/`$` anchors (it is normally matched
 *  standalone against a whole slug) — stripped here before splicing into a
 *  larger pattern, since an embedded mid-pattern `^`/`$` would anchor to the
 *  position 0 / end of the ENTIRE tested string, not the slug segment, and
 *  silently reject every legitimate input. */
const SLUG_SEGMENT_SOURCE = SLUG_RE.source.replace(/^\^/, '').replace(/\$$/, '');
const ELEMENT_SKILL_REL_PATH_RE = new RegExp(`^\\.forge/skills/demo/(?:${SLUG_SEGMENT_SOURCE})/SKILL\\.md$`);

function isAllowedSkillRelPath(relPath: string): boolean {
  return relPath === DEMO_SKILL_REL_PATH || ELEMENT_SKILL_REL_PATH_RE.test(relPath);
}

/** R4-16 pin 2 (Finding B) — belt-and-braces beyond the allowlist above: a
 *  `skillRelPath` can lexically match the legitimate shape and STILL resolve
 *  outside the repo if some directory along its path is a symlink to an
 *  outside location (AT-45 — the allowlist only proves the path STRING's
 *  shape, never where it resolves). Walks up from `dir` to the closest
 *  EXISTING ancestor — the allowlist already forbids ".." and absolute paths,
 *  so once that ancestor is verified contained, the remaining NEW segments
 *  are plain literal directory names, not symlinks — and verifies THAT
 *  ancestor's realpath stays inside `repoRealPath`. Fails closed (false) if
 *  no ancestor can be resolved at all.
 *
 *  Honest limit (R4-16 round 2), same trust tier as the TOCTOU residual
 *  documented in `orchestrator/studio/session-transcript.ts`'s header — read
 *  that first; this follows the same disclosure shape (mechanism, trust
 *  tier, why accepted). This check and the `mkdirSync`/`writeFileSync` calls
 *  it gates (this function's caller, above) are separate syscalls, not one
 *  atomic operation: "cannot escape" above describes the segments as they
 *  are checked, not a guarantee that holds across time. An attacker able to
 *  race a symlink into one of those NEW segments in the gap between this
 *  check returning `true` and the write actually landing defeats
 *  containment. Accepted, not fixed, on the same basis as
 *  session-transcript.ts's TOCTOU note: mounting that race requires the same
 *  local write access inside the project repo that would let an attacker
 *  write the outside content in directly, so closing it (e.g. holding an
 *  open directory file descriptor from `mkdir` instead of re-resolving paths
 *  by name) buys negligible additional protection for real implementation
 *  cost. */
function closestExistingAncestorContained(dir: string, repoRealPath: string): boolean {
  let candidate = dir;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return false;
  }
  return real === repoRealPath || real.startsWith(repoRealPath + sep);
}

/** The generator bodies for a set of elements (the skill-creating-skill prompts). */
function elementGeneratorLines(els: DemoElementDefinition[]): string[] {
  const out: string[] = ['', '### Element generators — author each project-side element-skill per these'];
  for (const e of els) {
    out.push('', `#### ${e.id} (${e.name}, phase: ${e.phase})`, e.body);
  }
  return out;
}

/** The task-specific instruction block: per-element iteration, composed, or legacy.
 * Exported (read-only) for the R4-07 descriptor-parity test — the builder and the
 * demo agent must consume the same demoProcess descriptor in the same step order. */
export function demoTaskLines(args: {
  status: DemoBuilderStatus;
  target?: string;
  composed: boolean;
  elementSteps: Array<DemoStep & { element: string }>;
  byId: Map<string, DemoElementDefinition>;
}): string[] {
  const { status, target, composed, elementSteps, byId } = args;
  if (target) {
    const el = byId.get(target)!;
    return [
      `## Iterate ONE element: '${target}' (${el.name})`,
      `Author/refine the project-side element-skill at ${elementSkillRelPath(target)} using its generator (below). Write this element's rendered HTML fragment to ${DEMO_FRAGMENTS_REL_DIR}/${target}.html (so the operator can view this part's output independently), and render ${DEMO_HTML_REL_PATH} as JUST this element's fragment (wrapped, with the base CSS) — a real before/after of a representative recent change (use git log/diff; REAL output, never fabricated) — so the operator can perfect this element before composing the whole demo. Do NOT build the other elements this turn.`,
      ...elementGeneratorLines([el]),
      '',
      `Stop when ${elementSkillRelPath(target)} and ${DEMO_HTML_REL_PATH} exist.`,
    ];
  }
  if (composed) {
    const usedEls = [...new Map(elementSteps.map((s) => [s.element, byId.get(s.element)!])).values()];
    const order = elementSteps
      .map((s, i) => `  ${i + 1}. [${s.kind}] ${s.element}${s.text ? ` — ${s.text}` : ''}`)
      .join('\n');
    return [
      '## This demo is COMPOSED of demo elements, run in this order:',
      order,
      '',
      `For each element kind above: author/refresh a project-side element-skill at .forge/skills/demo/<id>/SKILL.md using its generator (below) AND have it write its rendered HTML fragment to ${DEMO_FRAGMENTS_REL_DIR}/<id>.html (one file per element, so each part's output is viewable independently). Then author ${DEMO_SKILL_REL_PATH} — the composer that reads those fragments IN THIS ORDER and assembles them into ${DEMO_HTML_REL_PATH} (wrapped with <html>/<body> + the base CSS). Ground every fragment in a real before/after of a representative recent change (use git log/diff; REAL output, never fabricated).`,
      ...elementGeneratorLines(usedEls),
      '',
      `Scope to what a change introduced, not the whole project. Stop when ${DEMO_SKILL_REL_PATH} and ${DEMO_HTML_REL_PATH} exist.`,
    ];
  }
  // Legacy / no elements configured — the single monolithic generator.
  return [
    'Configured demo process (capture / verify / present steps to bake into the skill):',
    describeDemoProcess(status.project_repo_path),
    '',
    'Deliver BOTH:',
    `1. ${DEMO_SKILL_REL_PATH} — the reusable generator that renders a before/after HTML demo of an INITIATIVE'S CHANGES.`,
    `2. ${DEMO_HTML_REL_PATH} — a real sample produced by running that generator against a representative recent change (use git log/diff; real before/after, never fabricated).`,
    '',
    `Scope the demo to what a change introduced, not the whole project. Stop when both ${DEMO_SKILL_REL_PATH} and ${DEMO_HTML_REL_PATH} exist.`,
  ];
}

function readBaseCss(forgeRoot: string): string {
  try {
    return readFileSync(join(forgeRoot, FORGE_DEMO_CSS_REL_PATH), 'utf8');
  } catch {
    return '/* forge demo base stylesheet unavailable — use the dark forge palette: bg #0a0e14, fg #e6edf3 */';
  }
}

function readFeedback(sessionDir: string): string | null {
  const p = join(sessionDir, 'feedback.md');
  if (!existsSync(p)) return null;
  const fb = readFileSync(p, 'utf8').trim();
  return fb || null;
}

const MAX_REASONING_TEXT = 400;

function makeReasoningSink(logger: EventLogger, initiativeId: string, sessionId: string): (text: string) => void {
  return (text: string) => {
    const capped = text.length > MAX_REASONING_TEXT ? `${text.slice(0, MAX_REASONING_TEXT)}…` : text;
    logger.emit({
      initiative_id: initiativeId, phase: 'unifier', skill: 'demo-builder-runner',
      event_type: 'log', input_refs: [], output_refs: [],
      message: capped, metadata: { session_id: sessionId, kind: 'reasoning' },
    });
  };
}

let cachedSkill: string | null = null;
function loadSkillPrompt(skillPromptPath: string | undefined, forgeRoot: string): string {
  if (skillPromptPath) {
    try {
      return readFileSync(skillPromptPath, 'utf8');
    } catch {
      /* fall through */
    }
  }
  if (cachedSkill !== null) return cachedSkill;
  const def = skillPath('demo-builder', forgeRoot);
  cachedSkill = existsSync(def) ? readFileSync(def, 'utf8') : 'You are the forge demo-builder agent.';
  return cachedSkill;
}
