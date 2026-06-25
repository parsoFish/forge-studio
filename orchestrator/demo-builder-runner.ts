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

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

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
import { loadProjectConfig } from './project-config.ts';

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/demo-builder/SKILL.md (single source)
// ---------------------------------------------------------------------------

export const demoBuilderAgentSpec = deriveAgentSpec('skills/demo-builder/SKILL.md');
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
  const demoProcess = describeDemoProcess(status.project_repo_path);
  const feedback = readFeedback(sessionDir);

  const prompt = [
    skill,
    '',
    '## Your task this turn: build the demo skill + render a sample',
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory): ${status.project_repo_path}`,
    ...(status.mode === 'update'
      ? ['',
         `UPDATE MODE: a locked demo already exists — ${DEMO_SKILL_REL_PATH} (the generator) and ` +
         `${DEMO_HTML_REL_PATH} (the sample). READ both and REVISE them per the operator's change-notes ` +
         'below; do NOT rebuild from scratch.']
      : []),
    '',
    status.mode === 'update' ? 'Operator change-notes:' : 'Operator look-and-feel guidance:',
    status.prompt || '_(none — choose a clean, faithful before/after treatment)_',
    '',
    'Configured demo process (capture / verify / present steps to bake into the skill):',
    demoProcess,
    ...(feedback ? ['', 'Operator feedback on the previous sample (apply it):', feedback] : []),
    '',
    '## Forge demo base stylesheet — the demo skill must inline this verbatim into the HTML it generates',
    '```css',
    baseCss,
    '```',
    '',
    'Deliver BOTH:',
    `1. ${DEMO_SKILL_REL_PATH} — the reusable generator that renders a before/after HTML demo of an INITIATIVE'S CHANGES.`,
    `2. ${DEMO_HTML_REL_PATH} — a real sample produced by running that generator against a representative recent change ` +
      '(use `git log`/`git diff` to pick one; render a genuine before/after with REAL output on both sides — never fabricate).',
    '',
    `Scope the demo to what a change introduced, not the whole project. Stop when both ${DEMO_SKILL_REL_PATH} and ${DEMO_HTML_REL_PATH} exist.`,
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

  const demoPath = join(status.project_repo_path, DEMO_HTML_REL_PATH);
  const skillPath = join(status.project_repo_path, DEMO_SKILL_REL_PATH);
  const missing = [
    !existsSync(skillPath) ? DEMO_SKILL_REL_PATH : null,
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
    event_type: 'log', input_refs: [], output_refs: [skillPath, demoPath], cost_usd: costUsd,
    message: `demo-generated (iteration ${status.iteration}, awaiting operator review)`,
    metadata: { session_id: input.sessionId, iteration: status.iteration },
  });

  return { phase: 'awaiting-review', wrote: [skillPath, demoPath], demoPath };
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
  writeSessionStatus(sessionDir, { ...status, phase: 'locked' });

  logger.emit({
    initiative_id: initiativeId, phase: 'unifier', skill: 'demo-builder-runner',
    event_type: 'log', input_refs: [demoPath], output_refs: [lockPath],
    message: 'demo-locked (machinery committed-ready in the repo for reproduction)',
    metadata: { session_id: input.sessionId, lock_path: lockPath },
  });

  return { phase: 'locked', wrote: [lockPath], lockPath };
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
  const def = join(forgeRoot, 'skills/demo-builder/SKILL.md');
  cachedSkill = existsSync(def) ? readFileSync(def, 'utf8') : 'You are the forge demo-builder agent.';
  return cachedSkill;
}
