/**
 * The `instructions` session kind — a registered step-handler variant
 * (ADR 043 as amended 2026-09-03, M4 ruling 60).
 *
 * Authors a project's AGENTS.md: an optional operator brief, then a bounded
 * interview, then a structured draft the operator approves, then a
 * deterministic commit of that draft to the project repo's root.
 *
 * This file holds ONLY that identity — the phase set, the two structured
 * schemas, seed matching with its provenance footer, the mode-conditional
 * turn-id, the interview CEILING and the interview -> draft SAME-TURN
 * fall-through. Those last four are precisely the behaviours ADR 043's own
 * 2026-09-03 amendment records as having NO phase-table form, which is why
 * this kind is a variant rather than data. Every piece of turn plumbing it
 * used to carry (containment, status read/write, logger, tool-event sink,
 * heartbeat, thinking and reasoning sinks, hook wiring, start/end events,
 * feedback consumption) now lives once in `kind-turn.ts`.
 *
 * Ported from `packages/sessions/instructions-runner.ts`. Byte-identical spawn
 * behaviour is pinned by `interactive-runners-golden.test.ts` against
 * `orchestrator/test-fixtures/spawn-capture/interactive-instructions.json`.
 */

import type { ServerResponse } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';


import { runStructuredTurn } from '../interactive-session.ts';
import { writeQuestions, readAnswerRounds, type InterviewQuestion, type InterviewAnswer } from '../session-status-io.ts';
import { guardedWriteSessionStatus } from '../session-status-io.ts';
import { parsePendingQuestions } from '../bridge-studio-sessions.ts';
import {
  affordanceDryBridgeMarker,
  answersCapReason,
  safeParseJson,
  MAX_ANSWER_FIELD_BYTES,
  type AffordanceRouteContext,
} from '../bridge-studio-sessions-affordance-shell.ts';
import {
  runKindTurn,
  type KindTurnInput,
  type KindTurnPlumbing,
  type SessionKindVariant,
} from './kind-turn.ts';
import { guardedReadFile, guardedWriteFile, sendJson } from '@forge/kernel';
import { withStudioWrite } from '@forge/projects/project-repo-tx.ts';
import { modelForSpec, resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { readAgentInstructionsFile } from '@forge/projects/project-config.ts';
import { skillPathRelative, loadSkillTurnPrompt } from '@forge/agents/skill-path.ts';
import { listInstructionSeeds } from '@forge/library/studio/artifact-registry.ts';
import type { InstructionSeed } from '@forge/contracts/studio/types.ts';
import {
  detectProjectTags,
  matchInstructionSeeds,
  renderSeedPromptSection,
  composedSeedsFooter,
  stripComposedSeedsFooter,
} from '@forge/library/instruction-seed-match.ts';

export { type InterviewQuestion } from '../session-status-io.ts';

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

export type RunInstructionsTurnInput = KindTurnInput & {
  /** Safety cap on interview rounds before forcing a draft. Default 4. */
  maxInterviewRounds?: number;
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
// The variant
// ---------------------------------------------------------------------------

/**
 * R3-05-F3: match the library's instruction seeds to this project's detected
 * shape/language (empty ⇒ from-scratch fallback). Best-effort — a broken or
 * absent library must never block authoring AGENTS.md. Computed ONCE per turn
 * even when the interview falls through to the draft in the same turn, so the
 * fall-through costs no second scan of the seed library.
 */
function matchSeedsFor(status: InstructionsStatus, forgeRoot: string): InstructionSeed[] {
  try {
    return matchInstructionSeeds(listInstructionSeeds(forgeRoot), detectProjectTags(status.project_repo_path));
  } catch {
    return [];
  }
}

export const instructionsKind: SessionKindVariant<
  InstructionsStatus,
  RunInstructionsTurnResult,
  RunInstructionsTurnInput
> = {
  id: 'instructions',
  kindDir: INSTRUCTIONS_KIND_DIR,
  label: 'instructions runner',
  eventLabel: 'instructions turn',
  eventPhase: 'instructions',
  eventSkill: 'instructions-runner',
  initiativeId: (sessionId) => `instructions-${sessionId}`,

  steps: {
    // The interview, and its two exits. This is the fall-through ADR 043's
    // amendment names as having no phase-table form: one turn either asks
    // another round of questions OR runs the draft step itself, and which it
    // does depends on the agent's own answer plus the round ceiling. A phase
    // table can express "interviewing -> drafting"; it cannot express "…in the
    // same turn, when the agent says it has enough".
    interviewing: async ({ input, status, plumbing, writeStatus }) => {
      const maxRounds = input.maxInterviewRounds ?? DEFAULT_MAX_INTERVIEW_ROUNDS;
      const seeds = matchSeedsFor(status, plumbing.forgeRoot);
      // SEC-04 leaf: answers.json READ routed through the guard (leaf included) — a
      // symlinked answers.json inside the real, contained session dir collapses to
      // [] rather than leaking out-of-root content into the interview prompt.
      const interview = readAnswerRounds(input.projectRoot, plumbing.dirSegments);
      const decision = await runInterviewStep({ input, status, interview, plumbing, seeds });

      if (!decision.done && status.round < maxRounds && decision.questions.length > 0) {
        // SEC-04 leaf: questions.json WRITE routed through the guard (leaf
        // included); a symlinked/escaping leaf ⇒ null ⇒ the runner refuses.
        const questionsPath = writeQuestions(input.projectRoot, plumbing.dirSegments, decision.questions);
        if (questionsPath === null) {
          throw new Error(
            'instructions runner: questions.json write failed containment (symlinked/escaping leaf) — refusing to write.',
          );
        }
        writeStatus({ ...status, phase: 'awaiting-answers' });
        plumbing.logger.emit({
          initiative_id: plumbing.initiativeId, phase: 'instructions', skill: 'instructions-runner',
          event_type: 'log', input_refs: [], output_refs: [questionsPath],
          message: `interview round ${status.round} — ${decision.questions.length} question(s) for the operator`,
          metadata: { session_id: input.sessionId, round: status.round },
        });
        return { phase: 'awaiting-answers', wrote: [questionsPath], questions: decision.questions };
      }

      writeStatus({ ...status, phase: 'drafting' });
      return await runDraftStep({ input, status, plumbing, writeStatus, seeds });
    },

    drafting: async ({ input, status, plumbing, writeStatus }) =>
      await runDraftStep({ input, status, plumbing, writeStatus, seeds: matchSeedsFor(status, plumbing.forgeRoot) }),

    finalizing: async ({ input, status, plumbing, writeStatus }) =>
      runFinalizeStep({ input, status, plumbing, writeStatus }),

    rejected: async ({ status, writeStatus }) => {
      writeStatus({ ...status, phase: 'rejected' });
      return { phase: 'rejected', wrote: [] };
    },
  },

  // Waiting/terminal phases — no actionable work this turn.
  otherwise: (status) => ({ phase: status.phase, wrote: [] }),
  startMetadata: (status) => ({ round: status.round }),
};

export async function runInstructionsTurn(
  input: RunInstructionsTurnInput,
): Promise<RunInstructionsTurnResult> {
  return await runKindTurn(instructionsKind, input);
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
  input: RunInstructionsTurnInput;
  status: InstructionsStatus;
  interview: InterviewAnswer[];
  plumbing: KindTurnPlumbing;
  seeds: readonly InstructionSeed[];
}): Promise<InterviewDecision> {
  const { input, status, interview, plumbing, seeds } = args;
  const skillPromptPath = input.skillPromptPath;
  const matchedSeeds = seeds;
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
    queryFn: plumbing.queryFn, prompt, schema: INTERVIEW_SCHEMA,
    model: resolveSessionModel(instructionsAgentSpec, status.modelTier), allowedTools: instructionsAgentSpec.allowedTools,
    disallowedTools: instructionsAgentSpec.disallowedTools,
    // W8-B6 — hook dispatch comes from the driver already bound to this turn's
    // logger and initiative id, so no kind can spawn hook-blind.
    ...plumbing.hooksForSkill(instructionsAgentSpec.skill),
    onToolUse: plumbing.onToolUse, onHeartbeat: plumbing.onHeartbeat,
    onText: plumbing.onText, onThinking: plumbing.onThinking, label: 'instructions-structured',
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
  plumbing: KindTurnPlumbing;
  writeStatus: (next: InstructionsStatus) => void;
  seeds: readonly InstructionSeed[];
}): Promise<RunInstructionsTurnResult> {
  const { input, status, plumbing, writeStatus, seeds: matchedSeeds } = args;
  const { logger, initiativeId } = plumbing;
  // SEC-04 leaf: answers.json READ routed through the guard (leaf included).
  const interview = readAnswerRounds(input.projectRoot, plumbing.dirSegments);
  // CONSUME-ONCE: the driver reads feedback.md, runs this step, and deletes the
  // note only once the step RESOLVES. Before the port this runner read it and
  // never cleared it, so one revise kept steering every later turn.
  return await plumbing.withOperatorFeedback(async (feedback) => {
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
    queryFn: plumbing.queryFn, prompt, schema: DRAFT_SCHEMA,
    model: resolveSessionModel(instructionsAgentSpec, status.modelTier), allowedTools: instructionsAgentSpec.allowedTools,
    disallowedTools: instructionsAgentSpec.disallowedTools,
    ...plumbing.hooksForSkill(instructionsAgentSpec.skill),
    onToolUse: plumbing.onToolUse, onHeartbeat: plumbing.onHeartbeat,
    onText: plumbing.onText, onThinking: plumbing.onThinking, label: 'instructions-structured',
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
  writeStatus({ ...status, phase: 'awaiting-verdict' });

  logger.emit({
    initiative_id: initiativeId, phase: 'instructions', skill: 'instructions-runner',
    event_type: 'log', input_refs: [], output_refs: [draftPath],
    message: 'instructions-drafted (AGENTS.md awaiting operator verdict)',
    metadata: { session_id: input.sessionId, bytes: agentsMd.length, composed_seed_ids: composedIds },
  });

  return { phase: 'awaiting-verdict', wrote: [draftPath], draftPath };
  });
}

// ---------------------------------------------------------------------------
// Finalize step — deterministic: write the approved draft to the repo root
// ---------------------------------------------------------------------------

function runFinalizeStep(args: {
  input: RunInstructionsTurnInput;
  status: InstructionsStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: InstructionsStatus) => void;
}): RunInstructionsTurnResult {
  const { status, plumbing, writeStatus, input } = args;
  const { logger, initiativeId, sessionDir } = plumbing;
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
  // still there — `finalizedObjectExists`, packages/sessions/bridge-studio-sessions.ts —
  // rather than trusting the pointer's mere presence).
  writeStatus({ ...status, phase: 'committed', finalized: { kind: 'agents-md', id: status.project } });

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

// W6-B1 review round 2 removed this file's local makeReasoningSink/
// makeThinkingSink duplicates in favour of the shared pair. The M4 ruling-60
// port took the next step: the sinks are BUILT by kind-turn.ts and arrive on
// `plumbing`, so this file neither declares nor constructs them.

// ---------------------------------------------------------------------------
// The generic session-affordance WRITE arms for this kind (M4 row 37 carve).
// Per-kind logic lives with its kind; the dispatch
// (`bridge-studio-sessions-affordances.ts`) routes to these by
// `affordance.kind` + `affordance.phase` and records the verdict afterwards.
// ---------------------------------------------------------------------------

export async function handleInstructionsAnswer(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const answersRaw = body.answers;
  if (
    !Array.isArray(answersRaw) ||
    !answersRaw.every((a) => a !== null && typeof a === 'object' && typeof (a as Record<string, unknown>).question === 'string' && typeof (a as Record<string, unknown>).answer === 'string')
  ) {
    sendJson(res, 400, { error: 'body.answers must be an array of {question: string, answer: string}' }, origin);
    return;
  }
  const answers = answersRaw as { questionId?: unknown; question: string; answer: string }[];
  const capReason = answersCapReason(answers);
  if (capReason !== null) {
    sendJson(res, 400, { error: capReason }, origin);
    return;
  }

  // W7-C2 T1 review (A3, finding sessions-kinds-19) — CORRELATE BY ID, not
  // by text. The panel renders one control per pending question and posts
  // each answer back with the `questionId` the shell route derived
  // (`pendingQuestionId`, cli/bridge-studio-sessions.ts); this re-derives the
  // SAME ids from the SAME on-disk questions.json and refuses an answer that
  // names an unknown id, or whose text does not match the question that id
  // actually asks. Answers correlated by text alone mis-bind the moment a
  // round repeats or rewords a question, and the durable answers.json is the
  // permanent record of that mis-binding.
  //
  // The requirement is DERIVED from live state, not a flag: it applies
  // exactly when there IS a pending questions.json to correlate against. The
  // free-text single-box submission (a round whose questions never reached
  // the wire) has nothing to correlate and carries no id — and cannot,
  // because there is no question list to name.
  const pendingRaw = guardedReadFile(projectsRoot, [...dirSegs, 'questions.json']);
  const pending = pendingRaw !== null ? parsePendingQuestions(pendingRaw) : null;
  if (pending !== null && pending.length > 0) {
    for (const [i, a] of answers.entries()) {
      const id = a.questionId;
      if (typeof id !== 'string' || id.length === 0) {
        sendJson(res, 400, { error: `body.answers[${i}].questionId is required (one of: ${pending.map((q) => q.id).join(', ')}) — answers are correlated by id, never by question text` }, origin);
        return;
      }
      const match = pending.find((q) => q.id === id);
      if (match === undefined) {
        sendJson(res, 400, { error: `body.answers[${i}].questionId ${JSON.stringify(id)} names no pending question — expected one of: ${pending.map((q) => q.id).join(', ')}` }, origin);
        return;
      }
      if (match.question !== a.question) {
        sendJson(res, 400, { error: `body.answers[${i}].question does not match the text of pending question ${JSON.stringify(id)} — refusing to record a mis-bound answer` }, origin);
        return;
      }
    }
  }
  const recordedAnswers = answers.map((a) => ({
    ...(typeof a.questionId === 'string' && a.questionId.length > 0 ? { questionId: a.questionId } : {}),
    question: a.question,
    answer: a.answer,
  }));

  const priorRaw = guardedReadFile(projectsRoot, [...dirSegs, 'answers.json']);
  const prior = (priorRaw !== null ? safeParseJson<{ round: number; answers: unknown[] }[]>(priorRaw) : null) ?? [];
  const round = prior.length + 1;

  // SYNC INVARIANT: no await between this function's writes and the caller's
  // own status read above — an await here reopens the double-spawn race; see
  // kb-cleanup's now-fixed `approveKbCleanup` (cli/bridge-studio-kbs.ts) for
  // the shape a genuinely-awaited claim needs.
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'answers.json'], JSON.stringify([...prior, { round, answers: recordedAnswers }], null, 2)) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: round + 1 }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }

  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastKindChanged('instructions');
  sendJson(res, 200, { ok: true, round, ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}

// ---------------------------------------------------------------------------
// question-form — instructions' PRE-interview briefing checkpoint
// (`briefing-question-form`, the phase `POST /api/instructions/start` lands
// EVERY new session in — cli/ui-bridge.ts:3193-3197 — without spawning the
// agent). Mirrors `POST /api/instructions/brief` (cli/ui-bridge.ts:3275):
// writes `prompt.md` (NOT `answers.json` — a different on-disk target from
// `handleInstructionsAnswer` above) and sets `status.prompt`/`round: 1`/
// `phase: 'interviewing'`, then spawns the same turn.
// ---------------------------------------------------------------------------

export async function handleInstructionsBrief(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const answersRaw = body.answers;
  if (!Array.isArray(answersRaw) || !answersRaw.every((a) => a !== null && typeof a === 'object' && typeof (a as Record<string, unknown>).answer === 'string')) {
    sendJson(res, 400, { error: 'body.answers must be an array of {question: string, answer: string}' }, origin);
    return;
  }
  // W6-B9 — the generic single-box question-form UI submits at most one
  // entry (SessionInteractivePanel's hardcoded `[{question:'Operator
  // response', answer: answerText}]`); only the free text itself is the
  // brief — this phase is not a real interview round, so there is no
  // question to echo back. An empty submission (no entries, or a lone
  // empty-string answer) is a legal "no notes" brief — mirrors the bespoke
  // route's own `body.brief ?? ''` default, and is WHY the generic panel's
  // Send button no longer requires non-empty text (see that file's own note).
  const brief = (answersRaw[0] as { answer?: string } | undefined)?.answer ?? '';
  const briefBytes = Buffer.byteLength(brief, 'utf8');
  if (briefBytes > MAX_ANSWER_FIELD_BYTES) {
    sendJson(res, 400, { error: `body.answers[0].answer is ${briefBytes} bytes — exceeds the ${MAX_ANSWER_FIELD_BYTES}-byte limit` }, origin);
    return;
  }

  // SYNC INVARIANT: no await between this function's writes and the
  // caller's own status read above — see this file's header note.
  if (
    guardedWriteFile(projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
    guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'interviewing', round: 1, prompt: brief }) === null
  ) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }

  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastKindChanged('instructions');
  sendJson(res, 200, { ok: true, phase: 'interviewing', ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}

// ---------------------------------------------------------------------------
// verdict — instructions (approve|reject; "revise" is the ONE generic
// `handleGenericRevise` arm since W7-C2 — the bespoke
// `/api/instructions/verdict` route keeps its own revise arm as the
// independently-tested bespoke surface, and C2-REV-4 pins the two reaching
// the identical phase + feedback.md).
// ---------------------------------------------------------------------------

export async function handleInstructionsVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  verdict: 'approve' | 'reject',
): Promise<void> {
  const nextPhase = verdict === 'approve' ? 'finalizing' : 'rejected';
  // SYNC INVARIANT: no await between the caller's status read and this
  // write — see this file's header note.
  if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: nextPhase }) === null) {
    sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
    return;
  }
  ctx.spawnAgentTurn(ctx.forgeRoot, 'instructions', project, sessionId);
  ctx.broadcastKindChanged('instructions');
  sendJson(res, 200, { ok: true, phase: nextPhase, ...affordanceDryBridgeMarker(ctx, sessionId) }, origin);
}
