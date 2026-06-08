/**
 * In-UI architect runner (ADR 020).
 *
 * The architect used to be an interactive Claude-Code skill the operator ran in
 * their own terminal session (`/forge-architect`), driving `AskUserQuestion`.
 * ADR 020 moves it into the forge UI as a server-side, operator-driven,
 * file-checkpointed runner. This module is that runner's brain: a bounded,
 * Ralph-style **turn** that reads the session-dir state, advances ONE step via a
 * `status.json` cursor, and exits. Operator think-time happens *between* turns
 * (the bridge re-spawns a turn on each operator action), so there is no
 * long-lived blocked session and the flow is crash-resumable (ADR 012).
 *
 * Interactivity is **file-based handoff** — the same pattern the reflector uses
 * (`questions.json` ↔ `answers.json`), NOT SDK `canUseTool` interception (which
 * is an allow/deny permission gate and cannot return the operator's answer as a
 * tool result). See ADR 020 for the full rationale.
 *
 * The LLM call sits behind an injectable `queryFn` seam (the `runCouncil`
 * pattern) so every turn is unit-testable without a live LLM. The prompt is
 * composed from `skills/architect/SKILL.md` (not re-baked in TS) so prompt
 * changes stay content changes — ADR 003 is preserved.
 *
 * State machine (`status.json.phase`):
 *
 *   interviewing ──(needs input)──▶ awaiting-answers ──(bridge: answer)──▶ interviewing
 *        │ (ready to draft)
 *        ▼
 *     drafting ──▶ awaiting-verdict ──(bridge: approve)──▶ finalizing ──▶ committed
 *                        │ (bridge: revise) ──▶ interviewing
 *                        └ (bridge: reject)  ──▶ rejected
 *
 * `awaiting-answers` / `awaiting-verdict` are bridge-owned waiting states — the
 * runner is only spawned in an *actionable* phase. The bridge transitions out of
 * the waiting states when the operator acts, then re-spawns a turn.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const HEARTBEAT_THROTTLE_MS = 2000;

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

export type QueryFn = (params: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<unknown>;

import {
  writePlanDoc,
  archiveSessionDir,
  sessionPaths,
  type ArchitectSession,
  type ProposedInitiative,
  type CouncilTranscript,
  type InterviewRound,
} from '../cli/architect-plan.ts';
import { loadBrainIndex } from '../cli/brain-index.ts';
import {
  serializeManifest,
  parseManifest,
  type InitiativeManifest,
} from './manifest.ts';
import { promoteManifests } from './promote-manifests.ts';
import { withIdleDeadline } from './stream-deadline.ts';
import { createLogger, type EventLogger } from './logging.ts';
import { makeToolEventSink, extractLiveToolDetails } from './tool-event-emit.ts';
import type { ToolUseLiveDetail } from '../loops/ralph/claude-agent.ts';

// ---------------------------------------------------------------------------
// Session-dir state contract
// ---------------------------------------------------------------------------

export type ArchitectPhase =
  | 'interviewing'
  | 'awaiting-answers'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export type ArchitectStatus = {
  session_id: string;
  project: string;
  project_repo_path: string;
  phase: ArchitectPhase;
  /** 1-based interview round counter. */
  round: number;
  /** The operator's raw idea (also persisted to `idea.md`). */
  idea: string;
  updated_at: string;
};

/** One operator-facing question — the reflector's `StructuredQuestion` shape so
 *  the UI form renderer is shared. */
export type ArchitectQuestion = {
  question: string;
  /** ≤12 chars chip label (AskUserQuestion constraint). */
  header: string;
  options: { label: string; description: string }[];
};

/** One round of answers POSTed by the operator (written by the bridge). */
export type AnswerRound = {
  round: number;
  answers: { question: string; answer: string }[];
};

// ---------------------------------------------------------------------------
// Runner I/O
// ---------------------------------------------------------------------------

export type RunArchitectTurnInput = {
  sessionId: string;
  projectRoot: string;
  /** Inject a fake `query` for tests. Defaults to the SDK. */
  queryFn?: QueryFn;
  /** `_logs/` root; defaults to `<cwd>/_logs`. */
  logsRoot?: string;
  /** `_queue/` root; defaults to `<cwd>/_queue`. */
  queueRoot?: string;
  /** Logger override (tests). */
  logger?: EventLogger;
  /** Path to the architect skill (prompt source — ADR 003). */
  skillPromptPath?: string;
  /** Safety cap on interview rounds before forcing a draft. Default 4. */
  maxInterviewRounds?: number;
  /**
   * Forge root for brain-index loading (ARCH-1). Defaults to `process.cwd()`.
   * Override in tests / bench so the brain index loads from the correct root.
   */
  brainCwd?: string;
};

export type RunArchitectTurnResult = {
  /** Phase the session is in AFTER this turn. */
  phase: ArchitectPhase;
  /** Files written this turn. */
  wrote: string[];
  /** Present when the turn ended needing operator answers. */
  questions?: ArchitectQuestion[];
  /** Present when the turn produced a plan. */
  planPath?: string;
  /** Present when the turn finalized (manifests promoted to the queue). */
  promotedManifestPaths?: string[];
};

const DEFAULT_MAX_INTERVIEW_ROUNDS = 4;

// ---------------------------------------------------------------------------
// Turn entry point
// ---------------------------------------------------------------------------

export async function runArchitectTurn(
  input: RunArchitectTurnInput,
): Promise<RunArchitectTurnResult> {
  const paths = sessionPaths(input.projectRoot, input.sessionId);
  const status = readStatus(paths.sessionDir);
  if (!status) {
    // ARCH-6 idempotency: a rejected session is moved to _architect/_archived/.
    // A repeat reject turn then finds no live status.json — if the archived copy
    // was a rejected session, treat the turn as a no-op rather than throwing.
    const archived = readStatus(
      resolve(input.projectRoot, '_architect', '_archived', input.sessionId),
    );
    if (archived?.phase === 'rejected') {
      return { phase: 'rejected', wrote: [] };
    }
    throw new Error(
      `architect runner: no status.json at ${paths.sessionDir}. Has the session been started?`,
    );
  }

  const logger =
    input.logger ??
    createLogger(`_architect-${input.sessionId}`, input.logsRoot ?? resolve('_logs'));
  const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);
  const maxRounds = input.maxInterviewRounds ?? DEFAULT_MAX_INTERVIEW_ROUNDS;

  // ARCH-1: load brain navigation index at turn start and inject into prompts.
  // Mirrors the PM/reflector pattern (pm-invocation.ts, reflector-invocation.ts).
  // The index is cheap to read (a few small markdown files); we don't cache it
  // across turns because each turn is a fresh process invocation.
  const brainCwd = input.brainCwd ?? resolve('.');
  const brainIndex = loadBrainIndex({ cwd: brainCwd, scope: status.project });

  const startEv = logger.emit({
    initiative_id: `architect-session-${input.sessionId}`,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'start',
    input_refs: [join(paths.sessionDir, 'status.json')],
    output_refs: [],
    message: `architect turn (phase=${status.phase}, round=${status.round})`,
    metadata: { session_id: input.sessionId, phase: status.phase, round: status.round },
  });

  // ARCH-1: emit brain-query event so the planner brain-first mandate is
  // traceable. The brain index is loaded above; the event records which
  // project scope was consulted so the event log can detect brain-gaps.
  logger.emit({
    initiative_id: `architect-session-${input.sessionId}`,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'brain-query',
    input_refs: [],
    output_refs: [],
    message: `brain-query (project=${status.project})`,
    metadata: { session_id: input.sessionId, project: status.project },
  });

  // Per-tool telemetry so the architect hex streams live bursts (ADR 020). The
  // runner drives its own SDK stream (`runStructured`), so it feeds the sink
  // the same way the PM does — `extractLiveToolDetails` → `sink.onToolUse`.
  const sink = makeToolEventSink(logger, {
    initiativeId: `architect-session-${input.sessionId}`,
    parentEventId: startEv.event_id,
    phase: 'architect',
    skill: 'architect-runner',
  });
  const onToolUse = sink.onToolUse;

  // Heartbeat: write an ISO timestamp to <logsRoot>/_architect-<sid>/.heartbeat
  // on each SDK stream message (throttled). The bridge reads this file's mtime
  // to compute staleMs for the stuck-warning in the UI.
  const heartbeatDir = join(input.logsRoot ?? resolve('_logs'), `_architect-${input.sessionId}`);
  mkdirSync(heartbeatDir, { recursive: true });
  const heartbeatPath = join(heartbeatDir, '.heartbeat');
  const onHeartbeat = (): void => {
    try { writeFileSync(heartbeatPath, new Date().toISOString()); } catch { /* best-effort */ }
  };

  // P3: Emit each non-empty reasoning text block from the agent stream as a log
  // event so the operator's activity panel can show live architect reasoning.
  // Cap at 400 chars to keep the event log readable; skip pure-whitespace blocks.
  const MAX_REASONING_TEXT = 400;
  const initiativeIdForLog = `architect-session-${input.sessionId}`;
  const onText = (text: string): void => {
    const capped = text.length > MAX_REASONING_TEXT
      ? `${text.slice(0, MAX_REASONING_TEXT)}…`
      : text;
    logger.emit({
      initiative_id: initiativeIdForLog,
      phase: 'architect',
      skill: 'architect-runner',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: capped,
      metadata: { session_id: input.sessionId, kind: 'reasoning' },
    });
  };

  let result: RunArchitectTurnResult;

  // Interview phase — may flow straight through to drafting when ready.
  let phase = status.phase;
  if (phase === 'interviewing') {
    const interview = readInterview(paths.sessionDir);
    const decision = await runInterviewStep({
      status,
      interview,
      queryFn,
      skillPromptPath: input.skillPromptPath,
      brainIndex,
      onToolUse,
      onHeartbeat,
      onText,
    });
    if (!decision.done && status.round < maxRounds && decision.questions.length > 0) {
      const questionsPath = writeQuestions(paths.sessionDir, decision.questions);
      writeStatus(paths.sessionDir, { ...status, phase: 'awaiting-answers' });
      logger.emit({
        initiative_id: `architect-session-${input.sessionId}`,
        phase: 'architect',
        skill: 'architect-runner',
        event_type: 'log',
        input_refs: [],
        output_refs: [questionsPath],
        message: `interview round ${status.round} — ${decision.questions.length} question(s) for the operator`,
        metadata: { session_id: input.sessionId, round: status.round },
      });
      result = { phase: 'awaiting-answers', wrote: [questionsPath], questions: decision.questions };
      sink.flushIteration(1);
      return result;
    }
    // Ready to draft (operator answered enough, or the round cap forced it).
    phase = 'drafting';
    writeStatus(paths.sessionDir, { ...status, phase: 'drafting' });
  }

  if (phase === 'drafting') {
    result = await runDraftStep({
      input,
      paths,
      status,
      queryFn,
      logger,
      resolvedDecisions: null,
      brainIndex,
      onToolUse,
      onHeartbeat,
      onText,
    });
  } else if (phase === 'finalizing') {
    result = await runFinalizeStep({ input, paths, status, queryFn, logger, brainIndex, onToolUse, onHeartbeat, onText });
  } else if (phase === 'rejected') {
    // ARCH-6: wire archiveSessionDir into the reject path. The bridge sets
    // phase=rejected before spawning this turn; we move the session dir to
    // _architect/_archived/ so it no longer appears in listArchitectSessions.
    // Best-effort — if the dir is already archived or missing, just return.
    try {
      const archivedPath = archiveSessionDir(input.projectRoot, input.sessionId);
      logger.emit({
        initiative_id: `architect-session-${input.sessionId}`,
        phase: 'architect',
        skill: 'architect-runner',
        event_type: 'log',
        input_refs: [],
        output_refs: [archivedPath],
        message: 'plan-rejected — session archived',
        metadata: { session_id: input.sessionId, action: 'plan-rejected', archived_path: archivedPath },
      });
    } catch {
      // Already archived or session dir gone — silently accept.
    }
    result = { phase: 'rejected', wrote: [] };
  } else {
    // No actionable work in a waiting/terminal phase — return the phase unchanged.
    result = { phase, wrote: [] };
  }

  sink.flushIteration(1);
  return result;
}

// ---------------------------------------------------------------------------
// Interview step
// ---------------------------------------------------------------------------

type InterviewDecision = { done: boolean; questions: ArchitectQuestion[] };

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
  status: ArchitectStatus;
  interview: InterviewRound[];
  queryFn: QueryFn;
  skillPromptPath?: string;
  /** Brain navigation index (ARCH-1). Injected into the system prompt prefix. */
  brainIndex?: string;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  /** Forward reasoning text blocks to the event log (P3 live activity panel). */
  onText?: (text: string) => void;
}): Promise<InterviewDecision> {
  const { status, interview, queryFn, skillPromptPath, brainIndex, onToolUse, onHeartbeat, onText } = args;
  const skill = loadSkillPrompt(skillPromptPath);
  const priorQa = interview.length
    ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
    : '_(no answers yet — this is the first round)_';
  const prompt = [
    ...(brainIndex
      ? [
          '# Brain navigation index',
          '',
          'Read relevant brain theme files listed below before answering. Your first tool calls must be Read against brain/ paths.',
          '',
          brainIndex,
          '',
          '---',
          '',
        ]
      : []),
    skill,
    '',
    '## Your task this turn: the interview step',
    '',
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview so far:',
    priorQa,
    '',
    'Decide whether you have enough to draft a coherent, releasable initiative ' +
      'WITHOUT unresolved scope / success-signal / constraint ambiguity. ' +
      'If you do, return `{ "done": true }`. Otherwise return `{ "done": false, ' +
      '"questions": [...] }` with 1-4 high-leverage questions in the ' +
      'AskUserQuestion shape (question, header ≤12 chars, 2-4 options each with ' +
      'label + description). Ask only what unblocks drafting; stop as soon as ' +
      'further questions would merely refine.',
  ].join('\n');

  const { output: out } = await runStructured<{ done?: boolean; questions?: ArchitectQuestion[] }>({
    queryFn,
    prompt,
    schema: INTERVIEW_SCHEMA,
    onToolUse,
    onHeartbeat,
    onText,
  });
  const questions = Array.isArray(out?.questions) ? out!.questions! : [];
  return { done: out?.done === true, questions };
}

// ---------------------------------------------------------------------------
// Draft step (+ council + PLAN)
// ---------------------------------------------------------------------------

type DraftInitiative = {
  slug: string;
  title: string;
  iteration_budget: number;
  cost_budget_usd: number;
  /**
   * Slugs of OTHER initiatives in this same draft that must merge before this
   * one is claimed (build order). Maps to the manifest's
   * `depends_on_initiatives` (F-25 scheduler gate). Empty = runs in parallel.
   */
  depends_on?: string[];
  body: string;
};

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    vision: { type: 'string' },
    initiatives: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          iteration_budget: { type: 'number' },
          cost_budget_usd: { type: 'number' },
          depends_on: { type: 'array', items: { type: 'string' } },
          body: { type: 'string' },
        },
        required: ['slug', 'title', 'iteration_budget', 'cost_budget_usd', 'body'],
      },
    },
  },
  required: ['vision', 'initiatives'],
};

async function runDraftStep(args: {
  input: RunArchitectTurnInput;
  paths: ReturnType<typeof sessionPaths>;
  status: ArchitectStatus;
  queryFn: QueryFn;
  logger: EventLogger;
  resolvedDecisions: string | null;
  /** Brain navigation index (ARCH-1). Injected into the system prompt prefix. */
  brainIndex?: string;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  /** Forward reasoning text blocks to the event log (P3 live activity panel). */
  onText?: (text: string) => void;
}): Promise<RunArchitectTurnResult> {
  const { input, paths, status, queryFn, logger, resolvedDecisions, brainIndex, onToolUse, onHeartbeat, onText } = args;
  const interview = readInterview(paths.sessionDir);
  const skill = loadSkillPrompt(input.skillPromptPath);

  const prompt = [
    ...(brainIndex
      ? [
          '# Brain navigation index',
          '',
          'Read relevant Brain 2 (brain/cycles/) and Brain 3 (projects/<project>/brain/) theme files listed below as your FIRST action. Record the paths you consulted — they surface in the PLAN\'s Brain context section.',
          '',
          brainIndex,
          '',
          '---',
          '',
        ]
      : []),
    skill,
    '',
    '## Your task this turn: draft the initiative(s)',
    '',
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview answers:',
    interview.length
      ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
      : '_(operator drafted directly)_',
    ...(resolvedDecisions
      ? ['', 'Resolved design decisions (bake these into the manifests):', resolvedDecisions]
      : []),
    '',
    'Produce one or more coherent, releasable initiatives. For each: a kebab ' +
      '`slug`, a `title`, an `iteration_budget` (>0) and `cost_budget_usd` (>0), ' +
      'and a markdown `body` spec with concrete, Given-When-Then acceptance criteria ' +
      '(one GWT block per independently-deliverable outcome). The PM decomposes ' +
      'those ACs directly into work items — there is no intermediate feature layer.',
    '',
    '### Build order (cross-initiative dependencies)',
    "If a later initiative would fail without an earlier one merged first — a " +
      'green-CI gate before feature work, a base resource before the data source ' +
      'that reads it — set that initiative\'s `depends_on` to the earlier ' +
      'initiative slug(s). Leave it empty for initiatives that can run in ' +
      'parallel. The scheduler runs independent initiatives concurrently and ' +
      'holds dependents until their prerequisites merge, so under-declaring ' +
      'order causes parallel failures and over-declaring serialises needlessly.',
    '',
    '### Size — what an initiative / work item IS',
    '- **Initiative**: one coherent, releasable capability you could describe in ' +
      'a sentence and review as a single PR-worthy outcome (functionality + its ' +
      'tests + its docs). It is the unit of build order above. A roadmap is many ' +
      'initiatives.',
    '- **Work item** (the PM derives these from your body ACs): the atomic ' +
      'verifiable change — the smallest diff that lands as one mergeable ' +
      'commit-set and is proven by one sharp test/gate, roughly a focused ' +
      'half-day. Write ACs at THIS grain when an initiative is small; the ' +
      'PM enriches them rather than re-decomposing.',
    '- **Each GWT block in the body = one independently-deliverable outcome.** ' +
      'Split into multiple GWT blocks only when two parts change genuinely ' +
      'independent files/surfaces — never to reach a count.',
  ].join('\n');

  let { output: draft, brainReads } = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
    queryFn,
    prompt,
    schema: DRAFT_SCHEMA,
    onToolUse,
    onHeartbeat,
    onText,
  });
  let draftInitiatives = Array.isArray(draft?.initiatives) ? draft!.initiatives! : [];
  // Convergence backstop: if the model still returns zero initiatives (e.g. it did not
  // honour the schema's minItems), re-issue ONE focused, research-light turn that forbids
  // further tools and demands ≥1 initiative, so the agent synthesizes what it already
  // gathered rather than failing the whole session. (The turn cap that originally caused
  // empty drafts on the release-CRUD idea, 2026-06-08, has been removed — the architect
  // is operator-driven, so it now runs uncapped.)
  if (draftInitiatives.length === 0) {
    logger.emit({
      initiative_id: `architect-session-${input.sessionId}`,
      phase: 'architect',
      skill: 'architect-runner',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'draft returned no initiatives — retrying with a forced-emit turn (no further research)',
      metadata: { session_id: input.sessionId },
    });
    const retry = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
      queryFn,
      prompt: `${prompt}\n\n## EMIT NOW — do not research further\nYou have already done enough research (this turn and the interview rounds). Do NOT call any more tools. Synthesize what you already know and return the structured draft immediately, with AT LEAST ONE initiative.`,
      schema: DRAFT_SCHEMA,
      onToolUse,
      onHeartbeat,
      onText,
    });
    if (Array.isArray(retry.output?.initiatives) && retry.output!.initiatives!.length > 0) {
      draft = retry.output;
      brainReads.push(...retry.brainReads);
      draftInitiatives = retry.output!.initiatives!;
    }
  }
  const vision = (draft?.vision ?? status.idea).trim();
  if (draftInitiatives.length === 0) {
    throw new Error(
      'architect runner: draft step returned no initiatives after a forced-emit retry — the idea may be ' +
      'too broad to plan in one pass. Re-run to retry, or split/refine the idea or interview answers.',
    );
  }

  const created_at = new Date().toISOString();
  const datePart = created_at.slice(0, 10);
  // Slug set lets buildManifest resolve `depends_on` refs to sibling initiatives
  // (and drop refs to slugs not in this draft, which would block forever).
  const knownSlugs = new Set(draftInitiatives.map((d) => slugify(d.slug || d.title)));
  const manifests = draftInitiatives.map((d) =>
    buildManifest(d, status, datePart, created_at, knownSlugs),
  );

  const councilTranscript: CouncilTranscript = { flags: [], escalations: [], perCritic: [], totalCostUsd: 0 };

  // Write draft manifests (promoted to the queue only on finalize/approve).
  if (!existsSync(paths.manifestsDir)) mkdirSync(paths.manifestsDir, { recursive: true });
  for (const m of manifests) {
    writeFileSync(join(paths.manifestsDir, `${m.initiative_id}.md`), serializeManifest(m));
  }

  const proposed: ProposedInitiative[] = manifests.map((m, idx) => ({
    initiative_id: m.initiative_id,
    project: m.project,
    project_repo_path: m.project_repo_path,
    title: draftInitiatives[idx]?.title ?? m.initiative_id,
    iteration_budget: m.iteration_budget,
    cost_budget_usd: m.cost_budget_usd,
    // Carry cross-initiative build order through to the PLAN render. The
    // renderer's "Depends on" column reads this; without it the plan showed
    // every initiative as "—" even when the manifests DID carry deps
    // (operator catch, 2026-06-01).
    depends_on_initiatives: m.depends_on_initiatives,
    body: m.body,
  }));

  // ARCH-1: build brain_context from the brain/ paths the agent actually Read
  // during the draft turn. Deduplicate paths; use a generic summary since the
  // agent's Read content is not parsed here.
  const seenPaths = new Set<string>();
  const brain_context = brainReads
    .filter((p) => {
      if (seenPaths.has(p)) return false;
      seenPaths.add(p);
      return true;
    })
    .map((p) => ({ path: p, summary: 'consulted during architect draft' }));

  const session: ArchitectSession = {
    session_id: status.session_id,
    project: status.project,
    project_repo_path: status.project_repo_path,
    vision,
    interview,
    brain_context,
    council: councilTranscript,
    initiatives: proposed,
  };

  const planPath = writePlanDoc(session, input.projectRoot);
  writeStatus(paths.sessionDir, { ...status, phase: 'awaiting-verdict' });

  logger.emit({
    initiative_id: `architect-session-${input.sessionId}`,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'log',
    input_refs: [],
    output_refs: [planPath],
    message: `plan-emitted (${manifests.length} initiative(s), 0 escalation(s))`,
    metadata: {
      session_id: input.sessionId,
      initiative_ids: manifests.map((m) => m.initiative_id),
      escalation_count: 0,
    },
  });

  return { phase: 'awaiting-verdict', wrote: [planPath], planPath };
}

// ---------------------------------------------------------------------------
// Finalize step (approve → bake resolved decisions → promote to queue)
// ---------------------------------------------------------------------------

async function runFinalizeStep(args: {
  input: RunArchitectTurnInput;
  paths: ReturnType<typeof sessionPaths>;
  status: ArchitectStatus;
  queryFn: QueryFn;
  logger: EventLogger;
  /** Brain navigation index; passed through to fallback draft step (ARCH-1). */
  brainIndex?: string;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  /** Forward reasoning text blocks to the event log (P3 live activity panel). */
  onText?: (text: string) => void;
}): Promise<RunArchitectTurnResult> {
  const { input, paths, status, logger } = args;
  const resolved = readResolvedDecisions(paths.sessionDir);

  // DETERMINISTIC FINALIZE (#3, 2026-06-01). "Approve" must promote EXACTLY the
  // plan the operator saw. Previously this ran a SECOND LLM draft with the
  // resolved decisions in the prompt — which silently drifted the betterado plan
  // from 5 initiatives to 4 and let a council "delete this initiative" verdict
  // leak into the queue. Instead: read the already-approved draft manifests,
  // mechanically append the resolved decisions to each body, and promote those
  // unchanged. No second non-deterministic draft on the hot path.
  const queueRoot = input.queueRoot ?? resolve('_queue');
  const manifestFiles = existsSync(paths.manifestsDir)
    ? readdirSync(paths.manifestsDir).filter((f) => f.endsWith('.md'))
    : [];
  if (manifestFiles.length === 0) {
    // No draft on disk (e.g. an operator who drafted directly with no prior
    // awaiting-verdict turn). Fall back to one draft pass so finalize still
    // produces manifests — the deterministic branch above is the common path.
    await runDraftStep({ ...args, resolvedDecisions: resolved });
  } else if (resolved) {
    for (const f of manifestFiles) {
      const p = join(paths.manifestsDir, f);
      const m = parseManifest(readFileSync(p, 'utf8'));
      if (m.body.includes('## Resolved design decisions')) continue;
      const body = `${m.body}\n\n## Resolved design decisions (operator)\n\n${resolved}\n`;
      writeFileSync(p, serializeManifest({ ...m, body }));
    }
  }
  // P4: compute architect cost + duration from the session's own event log and
  // stamp them onto every promoted manifest so `runCycle` can emit real (not
  // synthetic/hardcoded) architect start/end events into the cycle log.
  const archStats = readArchitectSessionStats(
    input.logsRoot ?? resolve('_logs'),
    input.sessionId,
  );
  if (archStats !== null) {
    const reReadFiles = existsSync(paths.manifestsDir)
      ? readdirSync(paths.manifestsDir).filter((f) => f.endsWith('.md'))
      : [];
    for (const f of reReadFiles) {
      const p = join(paths.manifestsDir, f);
      const m = parseManifest(readFileSync(p, 'utf8'));
      writeFileSync(p, serializeManifest({
        ...m,
        architect_session_id: input.sessionId,
        architect_cost_usd: archStats.cost_usd,
        architect_duration_ms: archStats.duration_ms,
      }));
    }
  }

  const { writtenManifestPaths, writtenInitiativeIds } = promoteManifests(paths.manifestsDir, {
    queueRoot,
  });
  writeStatus(paths.sessionDir, { ...status, phase: 'committed' });

  logger.emit({
    initiative_id: writtenInitiativeIds[0] ?? `architect-session-${input.sessionId}`,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'log',
    input_refs: [paths.planPath],
    output_refs: writtenManifestPaths,
    message: 'plan-approved',
    metadata: {
      session_id: input.sessionId,
      action: 'plan-approved',
      initiative_ids: writtenInitiativeIds,
    },
  });

  return {
    phase: 'committed',
    wrote: writtenManifestPaths,
    planPath: paths.planPath,
    promotedManifestPaths: writtenManifestPaths,
  };
}

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

function buildManifest(
  d: DraftInitiative,
  status: ArchitectStatus,
  datePart: string,
  created_at: string,
  knownSlugs?: Set<string>,
): InitiativeManifest {
  const slug = slugify(d.slug || d.title);
  // Resolve cross-initiative `depends_on` slug refs → full initiative_ids.
  // Drop self-refs and refs to slugs not in this draft (would block forever).
  const dependsOnInitiatives = Array.from(
    new Set(
      (d.depends_on ?? [])
        .map((s) => slugify(s))
        .filter((dep) => dep && dep !== slug && (knownSlugs ? knownSlugs.has(dep) : true))
        .map((dep) => `INIT-${datePart}-${dep}`),
    ),
  );
  return {
    initiative_id: `INIT-${datePart}-${slug}`,
    project: status.project,
    project_repo_path: status.project_repo_path,
    created_at,
    iteration_budget: d.iteration_budget > 0 ? Math.round(d.iteration_budget) : 5,
    cost_budget_usd: d.cost_budget_usd > 0 ? d.cost_budget_usd : 5,
    phase: 'pending',
    origin: 'architect',
    body: d.body,
    ...(dependsOnInitiatives.length > 0 ? { depends_on_initiatives: dependsOnInitiatives } : {}),
  };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'initiative'
  );
}

// ---------------------------------------------------------------------------
// Structured-output query (mirrors council's parse path)
// ---------------------------------------------------------------------------

type StructuredResult<T> = {
  output: T | null;
  /** Brain paths Read by the agent during this turn (for brain_context). */
  brainReads: string[];
};

async function runStructured<T>(args: {
  queryFn: QueryFn;
  prompt: string;
  schema: unknown;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  /** Called at most once per HEARTBEAT_THROTTLE_MS during the SDK stream. */
  onHeartbeat?: () => void;
  /**
   * Called for each non-empty assistant text block (reasoning). The caller
   * can forward these to the event log so the operator sees the architect's
   * reasoning stream in the activity panel.
   */
  onText?: (text: string) => void;
}): Promise<StructuredResult<T>> {
  const options: Record<string, unknown> = {
    // Read-only is enforced by the allowedTools whitelist (no Write/Edit/etc.) —
    // NOT by plan mode. F-W5-1 (2026-05-30, surfaced by the claude-harness UI
    // validation run) had TWO root causes:
    //  1. `outputFormat` was passed the BARE JSON schema. The SDK expects
    //     `{ type: 'json_schema', schema }` (entrypoints/sdk/coreTypes — OutputFormat),
    //     so the malformed value silently disabled structured output: the result
    //     never carried `structured_output`, runStructured returned null, the
    //     interview fell through with empty questions, and the draft threw
    //     "draft step returned no initiatives".
    //  2. `permissionMode: 'plan'` made the agent end the turn via `ExitPlanMode`
    //     (presenting a prose plan) instead of emitting structured output — a
    //     direct contradiction with wanting a structured result.
    // Both are fixed here: wrap the schema correctly and drop plan mode. The read
    // toolset still produces the tool_use stream the architect hex shows.
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
    outputFormat: { type: 'json_schema', schema: args.schema },
    // No maxTurns: the architect is operator-driven + interactive (unlike the
    // autonomous PM/dev/reflector phases, which cap for cost/safety). Its research +
    // draft turns run until they emit the structured output — a cap here only risks
    // ending a turn mid-research with no result. withIdleDeadline still aborts a true stall.
  };
  // Idle-deadline (#6-extend, 2026-06-01): the architect's structured interview /
  // draft SDK calls were the one stream loop not yet guarded — a usage-limit
  // stall here would hang the architect turn forever. Abort + throw on a stall.
  const abortController = new AbortController();
  options.abortController = abortController;
  let structured: T | null = null;
  let rawText = '';
  let toolSeq = 0;
  const brainReads: string[] = [];
  let lastHeartbeatMs = 0;
  for await (const msg of withIdleDeadline(args.queryFn({ prompt: args.prompt, options }), {
    label: 'architect-structured',
    abortController,
  })) {
    // Throttled heartbeat — signals liveness to the UI stale-checker.
    if (args.onHeartbeat) {
      const now = Date.now();
      if (now - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
        args.onHeartbeat();
        lastHeartbeatMs = now;
      }
    }
    const m = msg as {
      type?: string;
      structured_output?: unknown;
      message?: { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }> };
    };
    if (m.type === 'assistant') {
      // Stream tool_use blocks to the sink (drives the live architect hex).
      if (args.onToolUse) {
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const d of details) args.onToolUse(d);
        toolSeq += details.length;
      }
      for (const block of m.message?.content ?? []) {
        if (block?.type === 'tool_use' && block.name === 'Read') {
          // Collect brain/ reads for brain_context population (ARCH-1).
          const inp = block.input as { file_path?: string } | undefined;
          if (inp?.file_path && inp.file_path.includes('brain/')) {
            brainReads.push(inp.file_path);
          }
        }
        if (block?.type === 'text' && typeof block.text === 'string') {
          rawText += (rawText ? '\n' : '') + block.text;
          const trimmed = block.text.trim();
          if (trimmed && args.onText) {
            args.onText(trimmed);
          }
        }
      }
      continue;
    }
    if (m.type !== 'result') continue;
    if (m.structured_output && typeof m.structured_output === 'object') {
      structured = m.structured_output as T;
    }
    break;
  }
  const output = structured ?? parseFencedJson<T>(rawText);
  return { output, brainReads };
}

function parseFencedJson<T>(text: string): T | null {
  if (!text) return null;
  const m = /```json\s*([\s\S]*?)```/i.exec(text);
  const raw = m ? m[1] : text;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt source (ADR 003 — prompt is skill content, not re-baked TS)
// ---------------------------------------------------------------------------

let cachedSkill: string | null = null;
function loadSkillPrompt(skillPromptPath?: string): string {
  if (skillPromptPath) {
    try {
      return readFileSync(skillPromptPath, 'utf8');
    } catch {
      /* fall through to default */
    }
  }
  if (cachedSkill !== null) return cachedSkill;
  const def = resolve('skills/architect/SKILL.md');
  cachedSkill = existsSync(def) ? readFileSync(def, 'utf8') : 'You are the forge architect.';
  return cachedSkill;
}

// ---------------------------------------------------------------------------
// Session-dir file helpers
// ---------------------------------------------------------------------------

export function readStatus(sessionDir: string): ArchitectStatus | null {
  const p = join(sessionDir, 'status.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ArchitectStatus;
  } catch {
    return null;
  }
}

export function writeStatus(sessionDir: string, status: ArchitectStatus): string {
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const p = join(sessionDir, 'status.json');
  writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
  return p;
}

function writeQuestions(sessionDir: string, questions: ArchitectQuestion[]): string {
  const p = join(sessionDir, 'questions.json');
  writeFileSync(p, JSON.stringify(questions, null, 2));
  return p;
}

/** Read every `answers.json` round into a flat `InterviewRound[]`. The bridge
 *  appends rounds; this flattens them into the `ArchitectSession.interview`
 *  shape the renderer expects. */
export function readInterview(sessionDir: string): InterviewRound[] {
  const p = join(sessionDir, 'answers.json');
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as AnswerRound[] | AnswerRound;
    const rounds = Array.isArray(parsed) ? parsed : [parsed];
    const out: InterviewRound[] = [];
    for (const r of rounds) {
      for (const a of r.answers ?? []) {
        out.push({ question: a.question, answer: a.answer });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Read `feedback.md` into a markdown block the draft step bakes into the
 *  regenerated manifests. Returns the trimmed content or null if absent/empty. */
function readResolvedDecisions(sessionDir: string): string | null {
  const fbPath = join(sessionDir, 'feedback.md');
  if (!existsSync(fbPath)) return null;
  const fb = readFileSync(fbPath, 'utf8').trim();
  return fb || null;
}

/** Discover every architect session under `projects/<name>/_architect/<sid>/`
 *  — used by the bridge's `GET /api/architect/sessions`. Best-effort; never
 *  throws on a malformed dir. */
export function listArchitectSessions(projectsRoot: string): ArchitectStatus[] {
  const out: ArchitectStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  for (const project of safeReaddir(projectsRoot)) {
    const archDir = join(projectsRoot, project, '_architect');
    if (!existsSync(archDir)) continue;
    for (const sid of safeReaddir(archDir)) {
      if (sid.startsWith('_')) continue; // skip _archived/
      const status = readStatus(join(archDir, sid));
      if (status) out.push(status);
    }
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// P4: architect session stats (cost + duration from the session event log)
// ---------------------------------------------------------------------------

type ArchitectSessionStats = { cost_usd: number; duration_ms: number };

/**
 * P4: Read the architect session's own event log (`_logs/_architect-<sid>/events.jsonl`)
 * and compute:
 *   - `cost_usd`:    sum of all numeric `cost_usd` fields across events.
 *   - `duration_ms`: last `started_at` minus first `started_at`, in ms.
 *
 * Returns `null` if the log is absent, empty, or unparseable — best-effort so
 * a missing log never blocks manifest promotion.
 */
export function readArchitectSessionStats(
  logsRoot: string,
  sessionId: string,
): ArchitectSessionStats | null {
  const logPath = join(resolve(logsRoot), `_architect-${sessionId}`, 'events.jsonl');
  if (!existsSync(logPath)) return null;
  try {
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    if (lines.length === 0) return null;

    let totalCost = 0;
    let firstTs: number | null = null;
    let lastTs: number | null = null;

    for (const line of lines) {
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (typeof ev.cost_usd === 'number') totalCost += ev.cost_usd;
      if (typeof ev.started_at === 'string') {
        const t = new Date(ev.started_at).getTime();
        if (!Number.isNaN(t)) {
          if (firstTs === null || t < firstTs) firstTs = t;
          if (lastTs === null || t > lastTs) lastTs = t;
        }
      }
    }

    const duration_ms = firstTs !== null && lastTs !== null ? lastTs - firstTs : 0;
    return { cost_usd: totalCost, duration_ms };
  } catch {
    return null;
  }
}
