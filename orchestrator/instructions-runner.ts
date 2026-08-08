/**
 * In-UI instructions-creator runner (Stage A).
 *
 * Authors a managed project's **AGENTS.md** the way `claude init` does: an
 * operator-driven, file-checkpointed interview that explores the real repo,
 * asks the operator what only they can answer, drafts, and writes only after the
 * operator approves. AGENTS.md is the single source of agent instructions (the
 * Studio `instructions` field binds to it) — so this never auto-authors without
 * an explicit operator confirm-gate.
 *
 * Mirrors architect-runner.ts (ADR 020): a bounded **turn** reads the session
 * dir, advances ONE step via the `status.json` cursor, and exits. Operator
 * think-time happens between turns; the bridge re-spawns on each action. The LLM
 * sits behind the shared `runStructuredTurn` seam (interactive-session.ts) so
 * every turn is unit-testable without a live LLM.
 *
 * State machine (`status.json.phase`):
 *   interviewing ──(needs input)──▶ awaiting-answers ──(bridge: answer)──▶ interviewing
 *        │ (ready to draft)
 *        ▼
 *     drafting ──▶ awaiting-verdict ──(bridge: approve)──▶ finalizing ──▶ committed
 *                        │ (bridge: revise) ──▶ drafting
 *                        └ (bridge: reject)  ──▶ rejected
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runStructuredTurn,
  readSessionStatus,
  writeSessionStatus,
  writeQuestions,
  readAnswerRounds,
  makeHeartbeatWriter,
  type QueryFn,
  type InterviewQuestion,
  type InterviewAnswer,
} from './interactive-session.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { resolveGuardedPath } from '../cli/studio-path-guard.ts';
import { withStudioWrite } from './project-repo-tx.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { readAgentInstructionsFile } from './project-config.ts';
import { skillPath, skillPathRelative } from './skill-path.ts';
import { listInstructionSeeds } from './studio/registry.ts';
import type { InstructionSeed } from './studio/types.ts';
import {
  detectProjectTags,
  matchInstructionSeeds,
  renderSeedPromptSection,
  composedSeedsFooter,
  stripComposedSeedsFooter,
} from './instruction-seed-match.ts';

export { type InterviewQuestion } from './interactive-session.ts';

// ---------------------------------------------------------------------------
// ADR-024: spec derived from skills/instructions-creator/SKILL.md (single source)
// ---------------------------------------------------------------------------

export const instructionsAgentSpec = deriveAgentSpec(skillPathRelative('instructions-creator'));
export const INSTRUCTIONS_MODEL = modelForSpec(instructionsAgentSpec);

// ---------------------------------------------------------------------------
// Session-dir state contract
// ---------------------------------------------------------------------------

export type InstructionsPhase =
  | 'briefing'
  | 'interviewing'
  | 'awaiting-answers'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export type InstructionsStatus = {
  session_id: string;
  project: string;
  /** Absolute path to the project's git repo (where AGENTS.md is written). */
  project_repo_path: string;
  phase: InstructionsPhase;
  /**
   * `init` — no AGENTS.md yet, author one from scratch. `edit` — an AGENTS.md
   * exists; the operator's brief is a set of change-notes and the agent revises
   * the existing file rather than starting over. Absent ⇒ `init`.
   */
  mode?: 'init' | 'edit';
  /** 1-based interview round counter. */
  round: number;
  /** The operator's raw brief / change-notes (also persisted to `prompt.md`). */
  prompt: string;
  updated_at: string;
};

/** The draft AGENTS.md the runner writes between turns, pending operator verdict. */
export const DRAFT_FILENAME = 'AGENTS.draft.md';

// ---------------------------------------------------------------------------
// Runner I/O
// ---------------------------------------------------------------------------

export type RunInstructionsTurnInput = {
  sessionId: string;
  /** The managed-project dir under forge `projects/` (holds the session dir). */
  projectRoot: string;
  /** Inject a fake `query` for tests. Defaults to the SDK. */
  queryFn?: QueryFn;
  /** `_logs/` root; defaults to `<cwd>/_logs`. */
  logsRoot?: string;
  /** Logger override (tests). */
  logger?: EventLogger;
  /** Path to the skill prompt (ADR 003). Defaults to the repo skill. */
  skillPromptPath?: string;
  /** Safety cap on interview rounds before forcing a draft. Default 4. */
  maxInterviewRounds?: number;
  /**
   * R3-05-F3 — forge root holding the `studio/instruction-seeds/` library
   * (threaded by `cmdAgentRun` via `needsForgeRoot`, mirroring demo-builder).
   * Defaults to `cwd` (the forge process root); tests inject a fixture root.
   */
  forgeRoot?: string;
};

export type RunInstructionsTurnResult = {
  phase: InstructionsPhase;
  wrote: string[];
  questions?: InterviewQuestion[];
  /** Present after a draft turn — the path to the pending AGENTS.draft.md. */
  draftPath?: string;
  /** Present after finalize — the path AGENTS.md was written to. */
  agentsPath?: string;
};

const DEFAULT_MAX_INTERVIEW_ROUNDS = 4;

/** The kind-dir under a project root that holds instructions sessions. */
const INSTRUCTIONS_KIND_DIR = '_instructions';

export function instructionsSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, INSTRUCTIONS_KIND_DIR, sessionId);
}

// ---------------------------------------------------------------------------
// Turn entry point
// ---------------------------------------------------------------------------

export async function runInstructionsTurn(
  input: RunInstructionsTurnInput,
): Promise<RunInstructionsTurnResult> {
  // SEC-04 runner leg: the session dir must be CONTAINED before the first read.
  // `sessionId` (and the kind-dir) each arrive as their own guarded path segment
  // against the projectRoot base — never folded into a bare `join` that
  // `readSessionStatus` would then follow out of the project subtree. A traversal
  // sessionId or a symlinked `_instructions` resolves to a containment reject,
  // and the runner REFUSES rather than disclose out-of-root content.
  const guarded = resolveGuardedPath(input.projectRoot, [INSTRUCTIONS_KIND_DIR, input.sessionId]);
  if (!guarded.ok) {
    throw new Error(
      `instructions runner: no status.json — session dir failed containment (${guarded.reason}). Has the session been started?`,
    );
  }
  const sessionDir = guarded.realPath;
  const status = readSessionStatus<InstructionsStatus>(sessionDir);
  if (!status) {
    throw new Error(
      `instructions runner: no status.json at ${sessionDir}. Has the session been started?`,
    );
  }

  const logsRoot = input.logsRoot ?? resolve('_logs');
  const cycleId = `_instructions-${input.sessionId}`;
  const initiativeId = `instructions-${input.sessionId}`;
  const logger = input.logger ?? createLogger(cycleId, logsRoot);
  const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);
  const maxRounds = input.maxInterviewRounds ?? DEFAULT_MAX_INTERVIEW_ROUNDS;

  // R3-05-F3: match the library's instruction seeds to this project's detected
  // shape/language (empty ⇒ from-scratch fallback). Best-effort — a broken/absent
  // library must never block authoring AGENTS.md. Only computed for the phases
  // that consume it (interview + draft); terminal/waiting turns skip the fs reads.
  let matchedSeeds: InstructionSeed[] = [];
  if (status.phase === 'interviewing' || status.phase === 'drafting') {
    try {
      const seedsRoot = input.forgeRoot ?? resolve('.');
      matchedSeeds = matchInstructionSeeds(
        listInstructionSeeds(seedsRoot),
        detectProjectTags(status.project_repo_path),
      );
    } catch {
      matchedSeeds = [];
    }
  }

  const startEv = logger.emit({
    initiative_id: initiativeId,
    phase: 'architect',
    skill: 'instructions-runner',
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `instructions turn (phase=${status.phase}, round=${status.round})`,
    metadata: { session_id: input.sessionId, phase: status.phase, round: status.round },
  });

  const sink = makeToolEventSink(logger, {
    initiativeId,
    parentEventId: startEv.event_id,
    phase: 'architect',
    skill: 'instructions-runner',
  });
  const onToolUse = sink.onToolUse;
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const onText = makeReasoningSink(logger, initiativeId, input.sessionId);

  let result: RunInstructionsTurnResult;
  let phase = status.phase;

  if (phase === 'interviewing') {
    const interview = readAnswerRounds(sessionDir);
    const decision = await runInterviewStep({ status, interview, queryFn, skillPromptPath: input.skillPromptPath, matchedSeeds, onToolUse, onHeartbeat, onText });
    if (!decision.done && status.round < maxRounds && decision.questions.length > 0) {
      const questionsPath = writeQuestions(sessionDir, decision.questions);
      writeSessionStatus(sessionDir, { ...status, phase: 'awaiting-answers' });
      logger.emit({
        initiative_id: initiativeId, phase: 'architect', skill: 'instructions-runner',
        event_type: 'log', input_refs: [], output_refs: [questionsPath],
        message: `interview round ${status.round} — ${decision.questions.length} question(s) for the operator`,
        metadata: { session_id: input.sessionId, round: status.round },
      });
      sink.flushIteration(1);
      return { phase: 'awaiting-answers', wrote: [questionsPath], questions: decision.questions };
    }
    phase = 'drafting';
    writeSessionStatus(sessionDir, { ...status, phase: 'drafting' });
  }

  if (phase === 'drafting') {
    result = await runDraftStep({ input, sessionDir, status, queryFn, logger, initiativeId, matchedSeeds, onToolUse, onHeartbeat, onText });
  } else if (phase === 'finalizing') {
    result = runFinalizeStep({ input, sessionDir, status, logger, initiativeId });
  } else if (phase === 'rejected') {
    writeSessionStatus(sessionDir, { ...status, phase: 'rejected' });
    result = { phase: 'rejected', wrote: [] };
  } else {
    // Waiting/terminal phase — no actionable work this turn.
    result = { phase, wrote: [] };
  }

  sink.flushIteration(1);
  return result;
}

// ---------------------------------------------------------------------------
// Interview step
// ---------------------------------------------------------------------------

type InterviewDecision = { done: boolean; questions: InterviewQuestion[] };

const INTERVIEW_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          header: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, description: { type: 'string' } },
              required: ['label', 'description'],
            },
          },
        },
        required: ['question', 'header'],
      },
    },
  },
  required: ['done'],
};

async function runInterviewStep(args: {
  status: InstructionsStatus;
  interview: InterviewAnswer[];
  queryFn: QueryFn;
  skillPromptPath?: string;
  matchedSeeds?: readonly InstructionSeed[];
  onToolUse?: Parameters<typeof runStructuredTurn>[0]['onToolUse'];
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
}): Promise<InterviewDecision> {
  const { status, interview, queryFn, skillPromptPath, matchedSeeds, onToolUse, onHeartbeat, onText } = args;
  const skill = loadSkillPrompt(skillPromptPath);
  const priorQa = interview.length
    ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
    : '_(no answers yet — this is the first round)_';
  const editContext = editContextLines(status);
  const seedSection = renderSeedPromptSection(matchedSeeds ?? []);
  const prompt = [
    skill,
    '',
    '## Your task this turn: the interview step',
    '',
    `Project: ${status.project}`,
    `Project repo path: ${status.project_repo_path}`,
    ...editContext,
    ...(seedSection ? [seedSection] : []),
    '',
    status.mode === 'edit' ? 'Operator change-notes:' : 'Operator brief:',
    status.prompt || '_(no brief — author AGENTS.md from the repo as you find it)_',
    '',
    'Interview so far:',
    priorQa,
    '',
    status.mode === 'edit'
      ? 'You are UPDATING the existing AGENTS.md above per the change-notes. You can usually ' +
        'proceed without questions — return `{ "done": true }`. Only return ' +
        '`{ "done": false, "questions": [...] }` (1-4 AskUserQuestion-shaped) if a note is genuinely ambiguous.'
      : 'Inspect the repo with your read tools, then decide whether you can write an ' +
        'accurate AGENTS.md without unresolved ambiguity. If yes, return ' +
        '`{ "done": true }`. Otherwise return `{ "done": false, "questions": [...] }` ' +
        'with 1-4 high-leverage questions in the AskUserQuestion shape.',
  ].join('\n');

  const { output } = await runStructuredTurn<{ done?: boolean; questions?: InterviewQuestion[] }>({
    queryFn, prompt, schema: INTERVIEW_SCHEMA,
    model: INSTRUCTIONS_MODEL, allowedTools: instructionsAgentSpec.allowedTools,
    onToolUse, onHeartbeat, onText, label: 'instructions-structured',
  });
  const questions = Array.isArray(output?.questions) ? output!.questions! : [];
  return { done: output?.done === true, questions };
}

// ---------------------------------------------------------------------------
// Draft step
// ---------------------------------------------------------------------------

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    agents_md: { type: 'string' },
    // R3-05-F3 — the ids of the library seeds the draft actually composed from
    // (traceability for later seed improvements). Optional; [] when authored
    // from scratch with no matching seeds.
    composed_seed_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['agents_md'],
};

async function runDraftStep(args: {
  input: RunInstructionsTurnInput;
  sessionDir: string;
  status: InstructionsStatus;
  queryFn: QueryFn;
  logger: EventLogger;
  initiativeId: string;
  matchedSeeds?: readonly InstructionSeed[];
  onToolUse?: Parameters<typeof runStructuredTurn>[0]['onToolUse'];
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
}): Promise<RunInstructionsTurnResult> {
  const { input, sessionDir, status, queryFn, logger, initiativeId, matchedSeeds, onToolUse, onHeartbeat, onText } = args;
  const interview = readAnswerRounds(sessionDir);
  const feedback = readFeedback(sessionDir);
  const skill = loadSkillPrompt(input.skillPromptPath);

  const editContext = editContextLines(status);
  const seedSection = renderSeedPromptSection(matchedSeeds ?? []);
  const prompt = [
    skill,
    '',
    '## Your task this turn: draft AGENTS.md',
    '',
    `Project: ${status.project}`,
    `Project repo path: ${status.project_repo_path}`,
    ...editContext,
    ...(seedSection ? [seedSection] : []),
    '',
    status.mode === 'edit' ? 'Operator change-notes:' : 'Operator brief:',
    status.prompt || '_(none)_',
    '',
    'Interview answers:',
    interview.length
      ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
      : '_(operator drafted directly)_',
    ...(feedback ? ['', 'Revision feedback from the operator (apply it):', feedback] : []),
    '',
    status.mode === 'edit'
      ? 'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the existing AGENTS.md above, REVISED to ' +
        'incorporate the operator\'s change-notes. Preserve everything they did not ask to change; ' +
        'keep commands copy-accurate; keep it tight. List any seed ids you composed from in composed_seed_ids.'
      : 'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the complete AGENTS.md content, ' +
        'ready to write verbatim to the repo root. Keep commands copy-accurate; keep it tight. ' +
        'List any seed ids you composed from in composed_seed_ids ([] if none applied).',
  ].join('\n');

  const { output } = await runStructuredTurn<{ agents_md?: string; composed_seed_ids?: string[] }>({
    queryFn, prompt, schema: DRAFT_SCHEMA,
    model: INSTRUCTIONS_MODEL, allowedTools: instructionsAgentSpec.allowedTools,
    onToolUse, onHeartbeat, onText, label: 'instructions-structured',
  });

  // Strip any prior composed-seeds footer the LLM echoed back (edit-mode
  // revisions include the existing file verbatim) so re-appending is idempotent.
  const agentsMd = stripComposedSeedsFooter((output?.agents_md ?? '').trim()).trim();
  if (!agentsMd) {
    throw new Error(
      'instructions runner: draft step returned empty AGENTS.md content — re-run to retry, or refine the brief / interview answers.',
    );
  }

  // R3-05-F3: record which library seeds the draft composed from — restricted to
  // ids that were ACTUALLY matched for this project (a hallucinated id the LLM
  // returns is dropped), machine-greppable footer for later seed improvements.
  const matchedIds = new Set((matchedSeeds ?? []).map((s) => s.id));
  const composedIds = (output?.composed_seed_ids ?? []).filter((id) => matchedIds.has(id));
  const footer = composedSeedsFooter(composedIds);

  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const draftPath = join(sessionDir, DRAFT_FILENAME);
  writeFileSync(draftPath, `${agentsMd}\n${footer}`);
  writeSessionStatus(sessionDir, { ...status, phase: 'awaiting-verdict' });

  logger.emit({
    initiative_id: initiativeId, phase: 'architect', skill: 'instructions-runner',
    event_type: 'log', input_refs: [], output_refs: [draftPath],
    message: 'instructions-drafted (AGENTS.md awaiting operator verdict)',
    metadata: { session_id: input.sessionId, bytes: agentsMd.length, composed_seed_ids: composedIds },
  });

  return { phase: 'awaiting-verdict', wrote: [draftPath], draftPath };
}

// ---------------------------------------------------------------------------
// Finalize step — deterministic: write the approved draft to the repo root
// ---------------------------------------------------------------------------

function runFinalizeStep(args: {
  input: RunInstructionsTurnInput;
  sessionDir: string;
  status: InstructionsStatus;
  logger: EventLogger;
  initiativeId: string;
}): RunInstructionsTurnResult {
  const { sessionDir, status, logger, initiativeId, input } = args;
  const draftPath = join(sessionDir, DRAFT_FILENAME);
  if (!existsSync(draftPath)) {
    throw new Error(
      `instructions runner: cannot finalize — no draft at ${draftPath}. Draft before approving.`,
    );
  }
  const content = readFileSync(draftPath, 'utf8');
  const agentsPath = join(status.project_repo_path, 'AGENTS.md');
  if (!existsSync(status.project_repo_path)) {
    mkdirSync(status.project_repo_path, { recursive: true });
  }
  // Commit AGENTS.md onto the project's forge-studio branch (durable; merged to
  // main on Save). Non-git project → the write simply stays in the tree.
  withStudioWrite(
    status.project_repo_path,
    'forge-studio: author AGENTS.md',
    () => writeFileSync(agentsPath, content.endsWith('\n') ? content : `${content}\n`),
    ['AGENTS.md'],
  );
  writeSessionStatus(sessionDir, { ...status, phase: 'committed' });

  logger.emit({
    initiative_id: initiativeId, phase: 'architect', skill: 'instructions-runner',
    event_type: 'log', input_refs: [draftPath], output_refs: [agentsPath],
    message: 'instructions-committed (AGENTS.md written to the repo)',
    metadata: { session_id: input.sessionId, agents_path: agentsPath },
  });

  return { phase: 'committed', wrote: [agentsPath], agentsPath };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * For an `edit`-mode session, the current AGENTS.md content as prompt lines so the
 * agent revises the existing file rather than starting over. `[]` for `init` mode
 * or when no agent-instruction file exists yet.
 */
function editContextLines(status: InstructionsStatus): string[] {
  if (status.mode !== 'edit') return [];
  const current = readAgentInstructionsFile(status.project_repo_path);
  if (!current) return [];
  return [
    '',
    `## Existing ${current.file} (the file you are UPDATING — revise it, don't start over)`,
    '```markdown',
    current.content,
    '```',
  ];
}

/** Read `feedback.md` (operator revision notes) — trimmed content or null. */
function readFeedback(sessionDir: string): string | null {
  const p = join(sessionDir, 'feedback.md');
  if (!existsSync(p)) return null;
  const fb = readFileSync(p, 'utf8').trim();
  return fb || null;
}

const MAX_REASONING_TEXT = 400;

/** Forward each non-empty reasoning text block to the event log (live panel). */
function makeReasoningSink(
  logger: EventLogger,
  initiativeId: string,
  sessionId: string,
): (text: string) => void {
  return (text: string) => {
    const capped = text.length > MAX_REASONING_TEXT ? `${text.slice(0, MAX_REASONING_TEXT)}…` : text;
    logger.emit({
      initiative_id: initiativeId, phase: 'architect', skill: 'instructions-runner',
      event_type: 'log', input_refs: [], output_refs: [],
      message: capped, metadata: { session_id: sessionId, kind: 'reasoning' },
    });
  };
}

let cachedSkill: string | null = null;
function loadSkillPrompt(skillPromptPath?: string): string {
  if (skillPromptPath) {
    try {
      return readFileSync(skillPromptPath, 'utf8');
    } catch {
      /* fall through */
    }
  }
  if (cachedSkill !== null) return cachedSkill;
  const def = skillPath('instructions-creator');
  cachedSkill = existsSync(def) ? readFileSync(def, 'utf8') : 'You are the forge instructions-creator agent.';
  return cachedSkill;
}
