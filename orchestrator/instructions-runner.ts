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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runStructuredTurn,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  statusWriteRefusalReason,
  writeQuestions,
  readAnswerRounds,
  makeHeartbeatWriter,
  makeReasoningSink,
  makeThinkingSink,
  type QueryFn,
  type InterviewQuestion,
  type InterviewAnswer,
} from './interactive-session.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { resolveGuardedPath, guardedReadFile, guardedWriteFile } from '../cli/studio-path-guard.ts';
import { withStudioWrite } from './project-repo-tx.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { modelForSpec, resolveSessionModel, type ModelTier } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { readAgentInstructionsFile } from './project-config.ts';
import { skillPathRelative, loadSkillTurnPrompt } from './skill-path.ts';
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
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's `/api/instructions/
   * start` route against `instructionsAgentSpec` (now `strategy:range` —
   * see the SKILL.md runtime block) before it is ever persisted here. Absent
   * ⇒ unchanged default behavior (`INSTRUCTIONS_MODEL`).
   */
  modelTier?: ModelTier;
  /**
   * W7-C2 (sessions-kinds-36) — the permanent pointer at what this session
   * produced, written once at finalize success and read back by the
   * session-shell route on every GET (`finalized` on the wire). `agents-md`
   * names the project whose AGENTS.md was committed. Absent until the
   * session commits.
   */
  finalized?: { kind: string; id: string };
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
  const dirSegments = [INSTRUCTIONS_KIND_DIR, input.sessionId];
  const guarded = resolveGuardedPath(input.projectRoot, dirSegments);
  if (!guarded.ok) {
    throw new Error(
      `instructions runner: no status.json — session dir failed containment (${guarded.reason}). Has the session been started?`,
    );
  }
  const sessionDir = guarded.realPath;
  // SEC-04 leaf: route the status.json READ through the guarded sibling so a
  // symlinked/hardlinked status.json leaf inside the (real, contained) session
  // dir is refused too — not just a symlinked/traversing dir. `projectRoot` is
  // the trusted root; the kind-dir + `sessionId` ride as their own guarded
  // segments (see the guard's root-trust contract). A rejected leaf collapses
  // to null and the runner refuses rather than read/act on out-of-root content.
  const status = guardedReadSessionStatus<InstructionsStatus>(input.projectRoot, dirSegments);
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
    phase: 'instructions',
    skill: 'instructions-runner',
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `instructions turn (phase=${status.phase}, round=${status.round})`,
    metadata: { session_id: input.sessionId, phase: status.phase, round: status.round },
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
      phase: 'instructions',
      skill: 'instructions-runner',
    },
    { readOnlySampleRate: 1, cap: 200 },
  );
  const onToolUse = sink.onToolUse;
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const sinkCtx = { initiativeId, phase: 'instructions' as const, skill: 'instructions-runner', idMeta: { session_id: input.sessionId } };
  const onText = makeReasoningSink(logger, sinkCtx);
  const onThinking = makeThinkingSink(logger, sinkCtx);

  let result: RunInstructionsTurnResult;
  let phase = status.phase;

  if (phase === 'interviewing') {
    // SEC-04 leaf: answers.json READ routed through the guard (leaf included) — a
    // symlinked answers.json inside the real, contained session dir collapses to
    // [] rather than leaking out-of-root content into the interview prompt.
    const interview = readAnswerRounds(input.projectRoot, dirSegments);
    const decision = await runInterviewStep({ status, interview, queryFn, skillPromptPath: input.skillPromptPath, matchedSeeds, onToolUse, onHeartbeat, onText, onThinking });
    if (!decision.done && status.round < maxRounds && decision.questions.length > 0) {
      // SEC-04 leaf: questions.json WRITE routed through the guard (leaf
      // included); a symlinked/escaping leaf ⇒ null ⇒ the runner refuses.
      const questionsPath = writeQuestions(input.projectRoot, dirSegments, decision.questions);
      if (questionsPath === null) {
        throw new Error(
          'instructions runner: questions.json write failed containment (symlinked/escaping leaf) — refusing to write.',
        );
      }
      writeInstructionsStatus(input.projectRoot, input.sessionId, { ...status, phase: 'awaiting-answers' });
      logger.emit({
        initiative_id: initiativeId, phase: 'instructions', skill: 'instructions-runner',
        event_type: 'log', input_refs: [], output_refs: [questionsPath],
        message: `interview round ${status.round} — ${decision.questions.length} question(s) for the operator`,
        metadata: { session_id: input.sessionId, round: status.round },
      });
      sink.flushIteration(1);
      return { phase: 'awaiting-answers', wrote: [questionsPath], questions: decision.questions };
    }
    phase = 'drafting';
    writeInstructionsStatus(input.projectRoot, input.sessionId, { ...status, phase: 'drafting' });
  }

  if (phase === 'drafting') {
    result = await runDraftStep({ input, status, queryFn, logger, initiativeId, matchedSeeds, onToolUse, onHeartbeat, onText, onThinking });
  } else if (phase === 'finalizing') {
    result = runFinalizeStep({ input, sessionDir, status, logger, initiativeId });
  } else if (phase === 'rejected') {
    writeInstructionsStatus(input.projectRoot, input.sessionId, { ...status, phase: 'rejected' });
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
  onThinking?: (text: string) => void;
}): Promise<InterviewDecision> {
  const { status, interview, queryFn, skillPromptPath, matchedSeeds, onToolUse, onHeartbeat, onText, onThinking } = args;
  // R4-23 round 2 (R2-AT-3): the mode branches are two SEPARATE, self-contained
  // turn sections — the runner selects exactly one, mirroring the pre-refactor
  // TypeScript ternary this replaces, instead of showing the agent both
  // branches' instructions in a single concatenated section.
  const turnId = status.mode === 'edit' ? 'interview-edit' : 'interview';
  const skill = loadSkillTurnPrompt({ name: 'instructions-creator', turnId, skillPromptPath });
  const priorQa = interview.length
    ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
    : '_(no answers yet — this is the first round)_';
  const editContext = editContextLines(status);
  const seedSection = renderSeedPromptSection(matchedSeeds ?? []);
  const prompt = [
    skill,
    '',
    `Mode: ${status.mode ?? 'init'}`,
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
  ].join('\n');

  const { output } = await runStructuredTurn<{ done?: boolean; questions?: InterviewQuestion[] }>({
    queryFn, prompt, schema: INTERVIEW_SCHEMA,
    model: resolveSessionModel(instructionsAgentSpec, status.modelTier), allowedTools: instructionsAgentSpec.allowedTools,
    disallowedTools: instructionsAgentSpec.disallowedTools,
    onToolUse, onHeartbeat, onText, onThinking, label: 'instructions-structured',
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
  status: InstructionsStatus;
  queryFn: QueryFn;
  logger: EventLogger;
  initiativeId: string;
  matchedSeeds?: readonly InstructionSeed[];
  onToolUse?: Parameters<typeof runStructuredTurn>[0]['onToolUse'];
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
}): Promise<RunInstructionsTurnResult> {
  const { input, status, queryFn, logger, initiativeId, matchedSeeds, onToolUse, onHeartbeat, onText, onThinking } = args;
  // SEC-04 leaf: answers.json READ routed through the guard (leaf included).
  const interview = readAnswerRounds(input.projectRoot, [INSTRUCTIONS_KIND_DIR, input.sessionId]);
  const feedback = readFeedback(input.projectRoot, input.sessionId);
  // R4-23 round 2 (R2-AT-3): same mode-branch selection as the interview step.
  const turnId = status.mode === 'edit' ? 'draft-edit' : 'draft';
  const skill = loadSkillTurnPrompt({ name: 'instructions-creator', turnId, skillPromptPath: input.skillPromptPath });

  const editContext = editContextLines(status);
  const seedSection = renderSeedPromptSection(matchedSeeds ?? []);
  const prompt = [
    skill,
    '',
    `Mode: ${status.mode ?? 'init'}`,
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
  ].join('\n');

  const { output } = await runStructuredTurn<{ agents_md?: string; composed_seed_ids?: string[] }>({
    queryFn, prompt, schema: DRAFT_SCHEMA,
    model: resolveSessionModel(instructionsAgentSpec, status.modelTier), allowedTools: instructionsAgentSpec.allowedTools,
    disallowedTools: instructionsAgentSpec.disallowedTools,
    onToolUse, onHeartbeat, onText, onThinking, label: 'instructions-structured',
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

  // SEC-04 leaf: route the AGENTS.draft.md write through the guard (leaf
  // included) so a symlinked/hardlinked draft leaf cannot escape the session
  // dir. guardedWriteFile mkdirs the parent, so the manual mkdir is gone.
  const draftPath = guardedWriteFile(
    input.projectRoot,
    [INSTRUCTIONS_KIND_DIR, input.sessionId, DRAFT_FILENAME],
    `${agentsMd}\n${footer}`,
  );
  if (draftPath === null) {
    throw new Error(
      'instructions runner: AGENTS.draft.md write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
  writeInstructionsStatus(input.projectRoot, input.sessionId, { ...status, phase: 'awaiting-verdict' });

  logger.emit({
    initiative_id: initiativeId, phase: 'instructions', skill: 'instructions-runner',
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
  // SEC-04 leaf: route the draft READ through the guard (leaf included) — a
  // symlinked AGENTS.draft.md pointing out of root collapses to null (no
  // oracle: absent and rejected are indistinguishable) and finalize refuses.
  const content = guardedReadFile(
    input.projectRoot,
    [INSTRUCTIONS_KIND_DIR, input.sessionId, DRAFT_FILENAME],
  );
  if (content === null) {
    throw new Error(
      `instructions runner: cannot finalize — no readable draft at ${draftPath}. Draft before approving.`,
    );
  }
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
  // W7-C2 T1 review (P0-4, sessions-kinds-36) — the permanent "what this
  // session produced" pointer. It was declared REQUIRED on the session-shell
  // payload and rendered by `FinalizedLink` (forge-ui), but only 2 of the 5
  // finalizing kinds ever WROTE it — a field surfaced everywhere and
  // produced by 40% of its producers is declared-data-fails-open. What an
  // instructions session produces is the project's own AGENTS.md, so the
  // pointer names the PROJECT (the shell route derives whether the file is
  // still there — `finalizedObjectExists`, cli/bridge-studio-sessions.ts —
  // rather than trusting the pointer's mere presence).
  writeInstructionsStatus(input.projectRoot, input.sessionId, {
    ...status,
    phase: 'committed',
    finalized: { kind: 'agents-md', id: status.project },
  });

  logger.emit({
    initiative_id: initiativeId, phase: 'instructions', skill: 'instructions-runner',
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

/**
 * SEC-04 leaf: guarded status.json write. Routes the WHOLE
 * `<projectRoot>/<kind>/<sid>/status.json` path (leaf included) through the
 * containment guard and THROWS (fail closed — the runner contract, never a
 * silent skip) if the leaf escapes.
 */
function writeInstructionsStatus(
  projectRoot: string,
  sessionId: string,
  status: InstructionsStatus,
): void {
  const p = guardedWriteSessionStatus(projectRoot, [INSTRUCTIONS_KIND_DIR, sessionId], status);
  if (p === null) {
    // W7-FIX-A2 (W7A2-01): the seam ALSO refuses a write that would move an
    // on-disk `cancelled` phase — a turn that finished after the operator
    // cancelled. Name that honestly (the advance is discarded by design;
    // lifecycle reads terminal, never crashed) instead of "containment".
    if (statusWriteRefusalReason(projectRoot, [INSTRUCTIONS_KIND_DIR, sessionId], status.phase) === 'cancelled') {
      throw new Error(
        `instructions runner: the session was cancelled while this turn ran — the turn's advance to "${status.phase}" is discarded and status.json stays cancelled (the terminal cancelled phase is sticky).`,
      );
    }
    throw new Error(
      'instructions runner: status.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
}

/** Read `feedback.md` (operator revision notes) — trimmed content or null.
 *  SEC-04 leaf: routed through the guard (leaf included), so a symlinked
 *  feedback.md pointing out of root collapses to null. */
function readFeedback(projectRoot: string, sessionId: string): string | null {
  const fb = guardedReadFile(projectRoot, [INSTRUCTIONS_KIND_DIR, sessionId, 'feedback.md']);
  if (fb === null) return null;
  const trimmed = fb.trim();
  return trimmed || null;
}

// W6-B1 review round 2: the local makeReasoningSink/makeThinkingSink duplicates
// were removed — this file now consumes the ONE shared pair exported from
// interactive-session.ts (imported above).
