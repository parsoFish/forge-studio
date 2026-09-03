/**
 * The `demo` session kind — a registered step-handler variant (ADR 043 as
 * amended 2026-09-03, M4 ruling 60).
 *
 * Builds a project's demo: an agent authors demo machinery and DEMO.html into
 * the project repo, the operator reviews it, and an approved generation is
 * locked with a snapshot.
 *
 * THE NAME TRAP, which is real and load-bearing (`AgentRunnerEntry.kindDir`'s
 * own doc calls it out): the operator types the agent-id `demo-builder`, but
 * the SESSION KIND is `demo` and its on-disk dir is `_demo`. So the registry
 * KEY is `demo-builder` while `demoKind.id` is `demo` — which is what drives
 * the `_demo-<sid>` event-log directory every consumer already derives
 * independently. Naming the variant `demo-builder` would write events into
 * `_demo-builder-<sid>`, a directory nothing reads.
 *
 * This file holds ONLY the kind's identity — its phases, its agent spec, the
 * generate/lock steps, the generation snapshots, and the studio-branch bracket
 * around the steps that write into the project repo. Every piece of turn
 * plumbing it used to carry now lives once in `kind-turn.ts`.
 *
 * Ported from `packages/sessions/demo-builder-runner.ts`. Byte-identical spawn
 * behaviour is pinned by `interactive-runners-golden.test.ts` against
 * `orchestrator/test-fixtures/spawn-capture/interactive-demo-builder.json`.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';


import { runAgentTurn } from '../interactive-session.ts';
import {
  runKindTurn,
  type KindTurnInput,
  type KindTurnPlumbing,
  type SessionKindVariant,
} from './kind-turn.ts';
import { guardedFile, guardedReadFile, guardedReadDir } from '@forge/kernel';
import { ensureStudioBranch, commitStudioChange } from '@forge/projects/project-repo-tx.ts';
import { modelForSpec, resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';
import { listDemoElements } from '@forge/library/studio/artifact-registry.ts';
import type { DemoStep, DemoElementDefinition } from '@forge/contracts/studio/types.ts';
import { skillPathRelative, loadSkillTurnPrompt, SLUG_RE } from '@forge/agents/skill-path.ts';

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
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's `/api/demo-builder/
   * start` route against `demoBuilderAgentSpec` (now `strategy:range` — see
   * the SKILL.md runtime block) before it is ever persisted here. Absent ⇒
   * unchanged default behavior (`DEMO_BUILDER_MODEL`).
   */
  modelTier?: ModelTier;
  /**
   * W7-C2 (sessions-kinds-36) — the permanent pointer at what this session
   * produced, written once at lock success and read back by the
   * session-shell route on every GET (`finalized` on the wire). `demo` names
   * the project whose `.forge/demo/demo.lock.json` was written. Absent until
   * the session locks.
   */
  finalized?: { kind: string; id: string };
};

export type RunDemoBuilderTurnInput = KindTurnInput;

export type RunDemoBuilderTurnResult = {
  phase: DemoBuilderPhase;
  wrote: string[];
  /** Present after a generate turn — absolute path to the produced DEMO.html. */
  demoPath?: string;
  /** Present after lock — absolute path to demo.lock.json. */
  lockPath?: string;
};

/** The kind-dir under a project root that holds demo-builder sessions. */
const DEMO_KIND_DIR = '_demo';

export function demoSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, DEMO_KIND_DIR, sessionId);
}

// ---------------------------------------------------------------------------
// The variant
// ---------------------------------------------------------------------------

/**
 * The studio-branch bracket around the steps that WRITE INTO THE PROJECT REPO.
 * Kind composition, not plumbing: only this kind's agent authors machinery into
 * someone else's repo, so only this kind brackets its steps that way.
 *
 * R4-23 WI-2 round-2 fix (AT-10): the commit runs in a `finally`, so a step
 * that throws AFTER the agent has already written partial machinery still gets
 * committed rather than leaving the project repo checked out on `forge-studio`
 * with uncommitted writes. No `catch` — only `finally` — so the error still
 * propagates unchanged.
 */
async function withStudioRepo<T>(
  status: DemoBuilderStatus,
  run: () => Promise<T> | T,
): Promise<T> {
  try { ensureStudioBranch(status.project_repo_path); } catch { /* non-git project */ }
  try {
    return await run();
  } finally {
    try {
      commitStudioChange(status.project_repo_path, `forge-studio: demo machinery (${status.phase})`);
    } catch { /* best-effort */ }
  }
}

export const demoKind: SessionKindVariant<DemoBuilderStatus, RunDemoBuilderTurnResult> = {
  // `demo`, NOT `demo-builder` — see this file's header. The id drives the
  // `_demo-<sid>` event-log directory every consumer derives independently.
  id: 'demo',
  kindDir: DEMO_KIND_DIR,
  label: 'demo-builder runner',
  eventLabel: 'demo-builder turn',
  eventPhase: 'demo',
  eventSkill: 'demo-builder-runner',
  initiativeId: (sessionId) => `demo-${sessionId}`,

  steps: {
    generating: async ({ input, status, plumbing, writeStatus }) =>
      await withStudioRepo(status, () => runGenerateStep({ input, status, plumbing, writeStatus })),

    locking: async ({ input, status, plumbing, writeStatus }) =>
      await withStudioRepo(status, () => runLockStep({ input, status, plumbing, writeStatus })),

    abandoned: async ({ status, writeStatus }) => {
      writeStatus({ ...status, phase: 'abandoned' });
      return { phase: 'abandoned', wrote: [] };
    },
  },

  // awaiting-review / locked — no actionable work this turn.
  otherwise: (status) => ({ phase: status.phase, wrote: [] }),
  startMetadata: (status) => ({ iteration: status.iteration }),
};

export async function runDemoBuilderTurn(
  input: RunDemoBuilderTurnInput,
): Promise<RunDemoBuilderTurnResult> {
  return await runKindTurn(demoKind, input);
}

// ---------------------------------------------------------------------------
// Generate step — the agent writes machinery + DEMO.html into the project repo
// ---------------------------------------------------------------------------

async function runGenerateStep(args: {
  input: RunDemoBuilderTurnInput;
  status: DemoBuilderStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: DemoBuilderStatus) => void;
}): Promise<RunDemoBuilderTurnResult> {
  const { input, status, plumbing, writeStatus } = args;
  const { forgeRoot, logger, initiativeId } = plumbing;
  const baseCss = readBaseCss(forgeRoot);
  // CONSUME-ONCE: the driver reads feedback.md, runs this step, and deletes the
  // note only once the step RESOLVES. Before the port this runner read it and
  // never cleared it, so one revise kept steering every later generation.
  return await plumbing.withOperatorFeedback(async (feedback) => {

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

  // ADR-024 (R4-23): the turn id selects the SAME branch this runner has always
  // taken — `target` ⇒ per-element, `composed` ⇒ multi-element, else the legacy
  // monolithic generator — but the task instructions for that branch now live in
  // skills/demo-builder/SKILL.md as a `<!-- turn: ... -->` section rather than
  // being hand-composed here; this function keeps only the branch selection + data.
  const turnId = target ? 'generate-element' : composed ? 'generate-composed' : 'generate-legacy';
  const skill = loadSkillTurnPrompt({ name: 'demo-builder', turnId, skillPromptPath: input.skillPromptPath, root: forgeRoot });

  const taskLines = demoTaskLines({ status, target, composed, elementSteps, byId });

  const prompt = [
    skill,
    '',
    `Mode: ${status.mode ?? 'create'}`,
    `Project: ${status.project}`,
    `Project repo (your working directory): ${status.project_repo_path}`,
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
    queryFn: plumbing.queryFn,
    prompt,
    cwd: status.project_repo_path,
    model: resolveSessionModel(demoBuilderAgentSpec, status.modelTier),
    allowedTools: demoBuilderAgentSpec.allowedTools,
    disallowedTools: demoBuilderAgentSpec.disallowedTools,
    // W8-B6 — hook dispatch comes from the driver already bound to this turn's
    // logger and initiative id, so no kind can spawn hook-blind.
    ...plumbing.hooksForSkill(demoBuilderAgentSpec.skill),
    maxTurns: 24,
    onToolUse: plumbing.onToolUse,
    onHeartbeat: plumbing.onHeartbeat,
    onText: plumbing.onText,
    onThinking: plumbing.onThinking,
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
  // SEC-04 leaf: each snapshot leaf under <sessionDir>/generations/<n>/ is
  // written through the guard (leaf included) so a symlinked snapshot slot
  // cannot escape; the demoPath/skillPath READS are repo-side (project-repo
  // root) byte copies (Buffer) preserved for byte-identical lock-time restore.
  const genSegs = [DEMO_KIND_DIR, input.sessionId, GENERATIONS_DIRNAME, String(status.iteration)];
  const demoSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_DEMO_FILENAME], 'generation DEMO.html snapshot');
  writeFileSync(demoSnapPath, readFileSync(demoPath));
  const skillSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_SKILL_FILENAME], 'generation SKILL.md snapshot');
  writeFileSync(skillSnapPath, readFileSync(requiredSkillPath));
  // feedback.md at TURN END (D8) — records what THIS generation consumed.
  // Before the M4 ruling-60 port this re-read the file, on the premise that
  // "the runner never clears it"; the port falsifies that premise (the driver
  // consumes the note once, after this step resolves), so the value the step
  // was GIVEN is now both the correct record and the only one that stays true
  // for the whole turn.
  const generationMeta = {
    iteration: status.iteration,
    createdAt: new Date().toISOString(),
    feedback,
    targetElement: target ?? null,
    composed,
    skillRelPath: requiredSkillRel,
  };
  const metaSnapPath = guardedGenerationWritePath(input.projectRoot, [...genSegs, GENERATION_META_FILENAME], 'generation meta.json');
  writeFileSync(metaSnapPath, `${JSON.stringify(generationMeta, null, 2)}\n`);

  writeStatus({ ...status, phase: 'awaiting-review' });
  logger.emit({
    initiative_id: initiativeId, phase: 'demo', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [], output_refs: [requiredSkillPath, demoPath], cost_usd: costUsd,
    message: `demo-generated (iteration ${status.iteration}${target ? `, element=${target}` : composed ? ', composed' : ''}, awaiting review)`,
    metadata: { session_id: input.sessionId, iteration: status.iteration, target_element: target ?? null, composed },
  });

  return { phase: 'awaiting-review', wrote: [requiredSkillPath, demoPath], demoPath };
  });
}

// ---------------------------------------------------------------------------
// Lock step — deterministic: record the locked demo for reproducibility
// ---------------------------------------------------------------------------

function runLockStep(args: {
  input: RunDemoBuilderTurnInput;
  status: DemoBuilderStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: DemoBuilderStatus) => void;
}): RunDemoBuilderTurnResult {
  const { input, status, plumbing, writeStatus } = args;
  const { logger, initiativeId, sessionDir } = plumbing;

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
    const genSegs = [DEMO_KIND_DIR, input.sessionId, GENERATIONS_DIRNAME, String(status.selectedGeneration)];
    const meta = readGenerationSnapshotMeta(input.projectRoot, input.sessionId, status.selectedGeneration);
    const genDir = join(sessionDir, GENERATIONS_DIRNAME, String(status.selectedGeneration));
    // SEC-04 leaf: resolve the snapshot leaves under the session dir through the
    // guard (leaf included) — a symlinked snapshot slot collapses to null, the
    // same no-oracle answer as absent.
    const snapshotDemoPath = guardedFile(input.projectRoot, [...genSegs, GENERATION_DEMO_FILENAME], 'read');
    const snapshotSkillPath = guardedFile(input.projectRoot, [...genSegs, GENERATION_SKILL_FILENAME], 'read');
    if (meta === null || snapshotDemoPath === null || snapshotSkillPath === null) {
      const existing = listExistingGenerationNumbers(input.projectRoot, input.sessionId);
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

  // W7-C2 T1 review (P0-4, sessions-kinds-36) — the permanent "what this
  // session produced" pointer (see instructions-runner's own note for why
  // all five finalizing kinds now write one). A locked demo IS the project's
  // .forge/demo/demo.lock.json, so the pointer names the PROJECT; the shell
  // route derives whether that lock is still on disk.
  writeStatus({
    ...status,
    phase: 'locked',
    finalized: { kind: 'demo', id: status.project },
  });

  logger.emit({
    initiative_id: initiativeId, phase: 'demo', skill: 'demo-builder-runner',
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

function readGenerationSnapshotMeta(projectRoot: string, sessionId: string, n: number): GenerationSnapshotMeta | null {
  // SEC-04 leaf: route the meta.json read through the guard (leaf included) so a
  // symlinked meta.json under generations/<n>/ collapses to null.
  const raw = guardedReadFile(projectRoot, [DEMO_KIND_DIR, sessionId, GENERATIONS_DIRNAME, String(n), GENERATION_META_FILENAME]);
  if (raw === null) return null;
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
function listExistingGenerationNumbers(projectRoot: string, sessionId: string): number[] {
  // SEC-04 leaf: the generations/ dir readdir routed through the guard.
  const names = guardedReadDir(projectRoot, [DEMO_KIND_DIR, sessionId, GENERATIONS_DIRNAME]);
  if (names === null) return [];
  return names
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/**
 * SEC-04 leaf: resolve a guarded WRITE path for a session-dir leaf (leaf
 * included), mkdir its parent, and return it — throwing (fail closed, the
 * runner contract) if the leaf escapes. Returns the path (not the write) so the
 * caller keeps its Buffer/string write for byte-identical snapshots.
 */
function guardedGenerationWritePath(projectRoot: string, segs: readonly string[], what: string): string {
  const p = guardedFile(projectRoot, segs, 'write');
  if (p === null) {
    throw new Error(`demo-builder runner: ${what} write failed containment (symlinked/escaping leaf) — refusing to write.`);
  }
  mkdirSync(dirname(p), { recursive: true });
  return p;
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
 *  documented in `packages/sessions/studio/session-transcript.ts`'s header — read
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
      `Target element skill path: ${elementSkillRelPath(target)}`,
      `Target element fragment path: ${DEMO_FRAGMENTS_REL_DIR}/${target}.html`,
      ...elementGeneratorLines([el]),
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
      ...elementGeneratorLines(usedEls),
    ];
  }
  // Legacy / no elements configured — the single monolithic generator.
  return [
    'Configured demo process (capture / verify / present steps to bake into the skill):',
    describeDemoProcess(status.project_repo_path),
  ];
}

function readBaseCss(forgeRoot: string): string {
  try {
    return readFileSync(join(forgeRoot, FORGE_DEMO_CSS_REL_PATH), 'utf8');
  } catch {
    return '/* forge demo base stylesheet unavailable — use the dark forge palette: bg #0a0e14, fg #e6edf3 */';
  }
}

// W6-B1 review round 2 removed this file's local makeReasoningSink/
// makeThinkingSink duplicates in favour of the shared pair. The M4 ruling-60
// port took the next step: the sinks are BUILT by kind-turn.ts and arrive on
// `plumbing`, so this file neither declares nor constructs them.
