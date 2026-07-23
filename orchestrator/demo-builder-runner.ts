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
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { ensureStudioBranch, commitStudioChange } from './project-repo-tx.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { loadProjectConfig } from './project-config.ts';
import { listDemoElements } from './studio/registry.ts';
import type { DemoStep, DemoElementDefinition } from './studio/types.ts';
import { skillPath, skillPathRelative } from './skill-path.ts';

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
  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  if (!existsSync(demoPath)) {
    throw new Error(
      `demo-builder runner: cannot lock — no ${DEMO_HTML_REL_PATH} in the repo. Generate a demo before locking.`,
    );
  }
  const skillPath = join(status.project_repo_path, DEMO_SKILL_REL_PATH);
  const lockPath = join(status.project_repo_path, DEMO_LOCK_REL_PATH);
  const lock = {
    session_id: status.session_id,
    project: status.project,
    prompt: status.prompt,
    iterations: status.iteration,
    // The locked, reproducible generator — future cycles run it per completed
    // initiative to render a before/after demo of that initiative's changes.
    demo_skill: existsSync(skillPath) ? DEMO_SKILL_REL_PATH : null,
    demo_html: DEMO_HTML_REL_PATH,
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

/** The generator bodies for a set of elements (the skill-creating-skill prompts). */
function elementGeneratorLines(els: DemoElementDefinition[]): string[] {
  const out: string[] = ['', '### Element generators — author each project-side element-skill per these'];
  for (const e of els) {
    out.push('', `#### ${e.id} (${e.name}, phase: ${e.phase})`, e.body);
  }
  return out;
}

/** The task-specific instruction block: per-element iteration, composed, or legacy. */
function demoTaskLines(args: {
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
