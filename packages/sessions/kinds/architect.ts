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
 *        │ (ready)
 *        ▼
 *     exploring ──(R4-04-F4: edge cases + brain constraints, fail-open)──▶ drafting
 *                                                                             │
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
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';


import { runStructuredTurn, type QueryFn } from '../interactive-session.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';
export type { QueryFn };

import {
  writePlanDoc,
  archiveSessionDir,
  sessionPaths,
  type ArchitectSession,
  type ProposedInitiative,
  type CouncilTranscript,
  type InterviewRound,
} from './architect-plan.ts';
import { loadBrainIndex } from '@forge/knowledge/brain-index.ts';
import { resolveGuardedPath, guardedFile, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import {
  serializeManifest,
  parseManifest,
  mintAndPersistManifestCycleId,
  type InitiativeManifest,
} from '@forge/flows/manifest.ts';
import { promoteManifests } from '@forge/flows/promote-manifests.ts';
import type { EventLogger } from '@forge/kernel';
import type { ToolUseLiveDetail } from '@forge/agents/ralph/claude-agent.ts';
import { modelForSpec, resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import {
  runCompletenessCritic,
  truncateWithMarker,
  CRITIC_MAX_MANIFEST_BODY_CHARS,
  type CompletenessCriticFinding,
} from './architect-critic.ts';
import { skillPath, skillPathRelative, loadSkillTurnPrompt, splitSkillTurnSections } from '@forge/agents/skill-path.ts';
import {
  runKindTurn,
  type KindTurnPlumbing,
  type SessionKindVariant,
} from './kind-turn.ts';

// ---------------------------------------------------------------------------
// ADR-024 / M2-4: spec derived from skills/architect/SKILL.md (single source)
// ---------------------------------------------------------------------------

/**
 * The architect's PhaseAgentSpec — derived from SKILL.md frontmatter so the
 * model tier and tool allow-list have one source of truth (ADR-024).
 */
export const architectAgentSpec = deriveAgentSpec(skillPathRelative('architect'));

/** Concrete model id resolved from the spec's tier. */
export const ARCHITECT_MODEL = modelForSpec(architectAgentSpec);

// ---------------------------------------------------------------------------
// Session-dir state contract
// ---------------------------------------------------------------------------

export type ArchitectPhase =
  | 'interviewing'
  | 'awaiting-answers'
  | 'exploring'
  | 'drafting'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

/**
 * Result of the architect-completeness-critic FINALIZE gate (ADR ref:
 * brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md).
 * Presence on `ArchitectStatus` means the critic has ALREADY run for this
 * session — one-shot-per-session: a subsequent finalize turn skips the critic
 * and promotes straight through. The operator's re-approve after findings IS
 * the acknowledgement; there is no separate UI action.
 */
export type CompletenessCriticStatus = {
  ranAt: string;
  findings: CompletenessCriticFinding[];
  /** True when the critic turn crashed (advisory infra; treated as zero
   *  findings — finalize still proceeds to promote). */
  crashed?: boolean;
};

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
  completenessCritic?: CompletenessCriticStatus;
  /**
   * ADR-043 §3 amendment (2026-08-15, wave-6 kickoff model-tier seam): an
   * operator-chosen model tier, validated by the bridge's `/api/architect/
   * start` route against `architectAgentSpec` (`strategy:fixed`, so the only
   * legal value is the fixed model's own tier) before it is ever persisted
   * here. Absent ⇒ unchanged default behavior (`ARCHITECT_MODEL`).
   */
  modelTier?: ModelTier;
  /**
   * W7-B6 (projects-14 / sessions-kinds-03): operator-declared cost ceiling
   * (USD) for the WHOLE session, validated by `POST /api/architect/start`
   * (finite, > 0, <= MAX_KICKOFF_COST_CEILING_USD) before it is persisted.
   * Enforced by `runArchitectTurn` at every turn start: when the session's
   * accumulated event-log cost (`readArchitectSessionStats`) has reached the
   * ceiling, the turn REFUSES to start (an `error` event + a thrown error the
   * session lifecycle surfaces) instead of silently overrunning. Absent ⇒ no
   * ceiling (unchanged default).
   */
  costCeilingUsd?: number;
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

// ADR-039: this is the architect's bespoke turn spawn — it deliberately stays
// outside flow-runner's node-executor registry (never resolveNodeKind /
// PHASE_EXECUTOR_KINDS / execAgent). The architect is intentionally
// out-of-cycle (ARCHITECTURE.md §2) — an interactive, file-checkpointed
// runner invoked directly by the Studio bridge, not a flow DAG node — so it
// is not, and should not become, an executor-enum consumer.
/**
 * ARCH-6 idempotency: a rejected session is MOVED to `_architect/_archived/`,
 * so a repeat reject turn finds no live `status.json`. That is not a refusal —
 * it is a no-op. The archived read is a SECOND request-derived path
 * construction, contained the same way the live one is (a symlinked
 * `_archived` must not disclose out-of-root content).
 */
function architectMissingStatus(input: RunArchitectTurnInput): RunArchitectTurnResult | null {
  const archived = guardedReadStatus(input.projectRoot, ['_architect', '_archived', input.sessionId]);
  return archived?.phase === 'rejected' ? { phase: 'rejected', wrote: [] } : null;
}

/**
 * Turn-boundary work that must run for EVERY phase, before the start event.
 *
 * W7-B6 (projects-14) — cost-ceiling enforcement. The operator's kickoff
 * ceiling rides in status.json; the session's spend is DERIVED from its own
 * event log (`readArchitectSessionStats`), never a stored copy. A turn that
 * would START at or past the ceiling emits an `error` event and THROWS: the
 * spawn wrapper's stderr.log and the A2 lifecycle derivation surface the
 * reason on the session page, and the operator can cancel or start a fresh
 * session with a higher ceiling.
 *
 * ARCH-1 — the `brain-query` event. The planner brain-first mandate has to be
 * traceable, so every turn records which project scope was consulted and the
 * event log can detect brain-gaps. It fires on every phase, which is why it
 * lives here rather than in a step.
 */
function architectPreamble(args: {
  input: RunArchitectTurnInput;
  status: ArchitectStatus;
  logger: EventLogger;
  logsRoot: string;
}): void {
  const { input, status, logger, logsRoot } = args;
  const initiativeId = `architect-session-${input.sessionId}`;

  if (typeof status.costCeilingUsd === 'number' && Number.isFinite(status.costCeilingUsd) && status.costCeilingUsd > 0) {
    const stats = readArchitectSessionStats(logsRoot, input.sessionId);
    if (stats !== null && stats.cost_usd >= status.costCeilingUsd) {
      const message =
        `architect session cost ceiling reached: $${stats.cost_usd.toFixed(4)} spent >= $${status.costCeilingUsd.toFixed(2)} ceiling — ` +
        `refusing to start another turn (cancel the session, or start a new one with a higher ceiling)`;
      logger.emit({
        initiative_id: initiativeId, phase: 'architect', skill: 'architect-runner',
        event_type: 'error', input_refs: [], output_refs: [], message,
        metadata: { session_id: input.sessionId, cost_usd: stats.cost_usd, cost_ceiling_usd: status.costCeilingUsd },
      });
      throw new Error(message);
    }
  }

  logger.emit({
    initiative_id: initiativeId, phase: 'architect', skill: 'architect-runner',
    event_type: 'brain-query', input_refs: [], output_refs: [],
    message: `brain-query (project=${status.project})`,
    metadata: { session_id: input.sessionId, project: status.project },
  });
}

/** ARCH-1: the brain navigation index, loaded per turn by the steps that
 *  inject it into prompts (PM/reflector pattern). Cheap — a few small markdown
 *  files — and deliberately not cached across turns, since each turn is a
 *  fresh process invocation. */
function architectBrainIndex(input: RunArchitectTurnInput, status: ArchitectStatus): ReturnType<typeof loadBrainIndex> {
  return loadBrainIndex({ cwd: input.brainCwd ?? resolve('.'), scope: status.project });
}

export const architectKind: SessionKindVariant<
  ArchitectStatus,
  RunArchitectTurnResult,
  RunArchitectTurnInput
> = {
  id: 'architect',
  kindDir: '_architect',
  label: 'architect runner',
  eventLabel: 'architect turn',
  eventPhase: 'architect',
  eventSkill: 'architect-runner',
  initiativeId: (sessionId) => `architect-session-${sessionId}`,
  onMissingStatus: architectMissingStatus,
  preamble: architectPreamble,

  steps: {
    // The interview and its two exits, then the explore -> draft chain. ADR 043
    // reserved architect as the branching-control-flow case and this is why:
    // one turn may run the interview, then exploration, then the draft, and
    // which of those happen depends on the agent's own answer plus the round
    // ceiling. No phase table expresses that.
    interviewing: withPaths(async ({ input, status, plumbing, writeStatus, paths }) => {
      const maxRounds = input.maxInterviewRounds ?? DEFAULT_MAX_INTERVIEW_ROUNDS;
      const interview = readInterview(input.projectRoot, input.sessionId);
      const decision = await runInterviewStep({ input, status, interview, plumbing, writeStatus, paths });

      if (!decision.done && status.round < maxRounds && decision.questions.length > 0) {
        const questionsPath = writeQuestions(input.projectRoot, input.sessionId, decision.questions);
        writeStatus({ ...status, phase: 'awaiting-answers' });
        plumbing.logger.emit({
          initiative_id: plumbing.initiativeId, phase: 'architect', skill: 'architect-runner',
          event_type: 'log', input_refs: [], output_refs: [questionsPath],
          message: `interview round ${status.round} — ${decision.questions.length} question(s) for the operator`,
          metadata: { session_id: input.sessionId, round: status.round },
        });
        return { phase: 'awaiting-answers', wrote: [questionsPath], questions: decision.questions };
      }

      // Ready — the explicit exploration stage runs before drafting (R4-04-F4).
      writeStatus({ ...status, phase: 'exploring' });
      return await runExploreThenDraft({ input, status, plumbing, writeStatus, paths });
    }),

    exploring: withPaths(runExploreThenDraft),

    drafting: withPaths(async (a) => await runDraftStep({ ...a, resolvedDecisions: null })),

    finalizing: withPaths(runFinalizeStep),

    rejected: async ({ input, plumbing }) => {
      // ARCH-6: the bridge sets phase=rejected before spawning this turn; the
      // session dir moves to _architect/_archived/ so it leaves
      // listArchitectSessions. Best-effort — already archived or missing is fine.
      try {
        const archivedPath = archiveSessionDir(input.projectRoot, input.sessionId);
        plumbing.logger.emit({
          initiative_id: plumbing.initiativeId, phase: 'architect', skill: 'architect-runner',
          event_type: 'log', input_refs: [], output_refs: [archivedPath],
          message: 'plan-rejected — session archived',
          metadata: { session_id: input.sessionId, action: 'plan-rejected', archived_path: archivedPath },
        });
      } catch {
        // Already archived or session dir gone — silently accept.
      }
      return { phase: 'rejected', wrote: [] };
    },
  },

  // No actionable work in a waiting/terminal phase.
  otherwise: (status) => ({ phase: status.phase, wrote: [] }),
  startMetadata: (status) => ({ round: status.round }),
};

export async function runArchitectTurn(
  input: RunArchitectTurnInput,
): Promise<RunArchitectTurnResult> {
  return await runKindTurn(architectKind, input);
}

type ArchitectStepArgs = {
  input: RunArchitectTurnInput;
  status: ArchitectStatus;
  plumbing: KindTurnPlumbing;
  writeStatus: (next: ArchitectStatus) => void;
  /** The session's derived paths — built ONCE per turn by `withPaths` below,
   *  not per step. Recomputing it in each step is harmless at runtime (one
   *  step runs per turn) but multiplies the request-derived path-construction
   *  sites `check-request-path-sinks` counts, which is surface, not cost. */
  paths: ReturnType<typeof sessionPaths>;
};

/** Adds this turn's `paths` to a step's args — the single `sessionPaths` call
 *  site for the whole kind. */
function withPaths<T>(
  step: (args: ArchitectStepArgs) => Promise<T>,
): (args: Omit<ArchitectStepArgs, 'paths'>) => Promise<T> {
  return (args) => step({ ...args, paths: sessionPaths(args.input.projectRoot, args.input.sessionId) });
}

/**
 * The exploration stage, then the draft — one turn, R4-04-F4.
 *
 * ALWAYS a fresh run: a revise round changes the inputs, and re-exploring is
 * one cheap structured turn. The previous round's findings are unlinked FIRST,
 * so a failed re-exploration can never silently feed stale edge cases into the
 * new draft — the fail-open message has to stay honest, and no findings file
 * means no explore block, ever. Fail-open covers BOTH an empty output and a
 * thrown stream/SDK error: the stage is advisory enrichment and must never
 * brick the session.
 */
async function runExploreThenDraft(args: ArchitectStepArgs): Promise<RunArchitectTurnResult> {
  const { input, status, plumbing, writeStatus, paths } = args;
  const { logger, initiativeId } = plumbing;

  // SEC-04 leaf: resolve the stale `edge-cases.json` through the guard before
  // removing it — never rm THROUGH a symlinked/escaping leaf (null ⇒ absent or
  // out-of-root, both a safe no-op).
  const staleEdge = guardedFile(input.projectRoot, ['_architect', input.sessionId, 'edge-cases.json'], 'read');
  if (staleEdge) {
    try {
      rmSync(staleEdge, { force: true });
    } catch {
      /* best-effort — a stale file that survives is overwritten on success */
    }
  }

  let findings: ExploreFindings | null = null;
  let exploreCrash: string | null = null;
  try {
    findings = await runExploreStep(args);
  } catch (err) {
    exploreCrash = err instanceof Error ? err.message : String(err);
  }
  logger.emit({
    initiative_id: initiativeId,
    phase: 'architect',
    skill: 'architect-runner',
    event_type: 'log',
    input_refs: [],
    output_refs: findings ? [edgeCasesPath(paths.sessionDir)] : [],
    message: findings
      ? `exploration stage — ${findings.edgeCases.length} edge case(s), ${findings.brainConstraints.length} brain constraint(s)`
      : exploreCrash
        ? `exploration stage crashed — proceeding to draft without an explore block (fail-open): ${exploreCrash}`
        : 'exploration stage returned nothing — proceeding to draft without an explore block (fail-open)',
    metadata: {
      session_id: input.sessionId,
      edge_cases: findings?.edgeCases.length ?? 0,
      brain_constraints: findings?.brainConstraints.length ?? 0,
      ...(exploreCrash ? { crashed: true } : {}),
    },
  });

  writeStatus({ ...status, phase: 'drafting' });
  return await runDraftStep({ ...args, resolvedDecisions: null });
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

async function runInterviewStep(
  args: ArchitectStepArgs & { interview: InterviewRound[] },
): Promise<InterviewDecision> {
  const { input, status, interview, plumbing } = args;
  const { queryFn, logger, initiativeId, onToolUse, onHeartbeat, onText, onThinking } = plumbing;
  const skillPromptPath = input.skillPromptPath;
  const brainIndex = architectBrainIndex(input, status);
  const skill = loadSkillTurnPrompt({ name: 'architect', turnId: 'interview', skillPromptPath });
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
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview so far:',
    priorQa,
  ].join('\n');

  const { output: out } = await runStructured<{ done?: boolean; questions?: ArchitectQuestion[] }>({
    logger, initiativeId,
    queryFn,
    prompt,
    schema: INTERVIEW_SCHEMA,
    modelTier: status.modelTier,
    onToolUse,
    onHeartbeat,
    onText,
    onThinking,
  });
  const questions = Array.isArray(out?.questions) ? out!.questions! : [];
  return { done: out?.done === true, questions };
}

// ---------------------------------------------------------------------------
// Exploration step (R4-04-F4 — operator-journey gap #6)
// ---------------------------------------------------------------------------

/**
 * One edge case the architect enumerated before drafting, with an explicit
 * disposition so nothing enumerated can silently vanish (the scope-ledger
 * discipline from brain theme 2026-07-01-architect-coverage-scope-fidelity).
 */
export type ExploreEdgeCase = {
  title: string;
  detail: string;
  /** covered = an initiative's ACs will own it; needs-initiative = it demands its own; deferred = explicitly out of this plan. */
  disposition: 'covered' | 'needs-initiative' | 'deferred';
};

export type ExploreFindings = {
  edgeCases: ExploreEdgeCase[];
  /** Brain-sourced constraints that must shape ACs, each citing its theme. */
  brainConstraints: { constraint: string; source: string }[];
  exploreSummary: string;
};

const EXPLORE_SCHEMA = {
  type: 'object',
  properties: {
    edgeCases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          disposition: { type: 'string', enum: ['covered', 'needs-initiative', 'deferred'] },
        },
        required: ['title', 'detail', 'disposition'],
      },
    },
    brainConstraints: {
      type: 'array',
      items: {
        type: 'object',
        properties: { constraint: { type: 'string' }, source: { type: 'string' } },
        required: ['constraint', 'source'],
      },
    },
    exploreSummary: { type: 'string' },
  },
  required: ['edgeCases', 'brainConstraints', 'exploreSummary'],
};

/** Pure path builder — the ONLY remaining use is the non-fs event-log
 *  `output_refs` string (no bytes flow through it). Every ACTUAL read/write/rm
 *  of `edge-cases.json` routes the leaf through `guardedFile` instead. */
export function edgeCasesPath(sessionDir: string): string {
  return join(sessionDir, 'edge-cases.json');
}

/** SEC-04: the `edge-cases.json` leaf rides through the guard (read mode); a
 *  symlinked leaf collapses to `null`, indistinguishable from absent. */
export function readExploreFindings(projectsRoot: string, sessionId: string): ExploreFindings | null {
  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'edge-cases.json']);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ExploreFindings;
  } catch {
    return null;
  }
}

/**
 * The explicit "exploring / edge cases" stage between the interview and the
 * draft (R4-04-F4). One structured turn prompting enumeration: edge cases
 * with dispositions, plus brain-sourced constraints to propagate into ACs.
 * FAIL-OPEN: this stage enriches the draft — an empty/failed exploration is
 * recorded honestly and the session proceeds (never bricks on an advisory
 * enrichment step); the draft prompt then simply carries no explore block.
 */
async function runExploreStep(args: ArchitectStepArgs): Promise<ExploreFindings | null> {
  const { input, status, plumbing } = args;
  const { queryFn, logger, initiativeId, onToolUse, onHeartbeat, onText, onThinking } = plumbing;
  const projectRoot = input.projectRoot;
  const sessionId = input.sessionId;
  const skillPromptPath = input.skillPromptPath;
  const brainIndex = architectBrainIndex(input, status);
  const skill = loadSkillTurnPrompt({ name: 'architect', turnId: 'explore', skillPromptPath });
  const interview = readInterview(projectRoot, sessionId);
  const priorQa = interview.length
    ? interview.map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`).join('\n')
    : '_(operator drafted directly)_';
  const prompt = [
    ...(brainIndex
      ? [
          '# Brain navigation index',
          '',
          'Read the relevant brain theme files below FIRST — a brain-sourced constraint you surface here must cite its theme path as `source`.',
          '',
          brainIndex,
          '',
          '---',
          '',
        ]
      : []),
    skill,
    '',
    `Project: ${status.project}`,
    '',
    'Operator idea / brief:',
    status.idea,
    '',
    'Interview answers:',
    priorQa,
  ].join('\n');

  const { output } = await runStructured<ExploreFindings>({
    logger, initiativeId,
    queryFn,
    prompt,
    schema: EXPLORE_SCHEMA,
    modelTier: status.modelTier,
    onToolUse,
    onHeartbeat,
    onText,
    onThinking,
  });
  if (!output || !Array.isArray(output.edgeCases) || !Array.isArray(output.brainConstraints)) {
    return null;
  }
  // Item-shape validation (review finding): the downstream renderers consume
  // these fields verbatim after the EXPENSIVE draft call — drop malformed
  // items here rather than TypeError-ing the whole turn later.
  const DISPOSITIONS = new Set(['covered', 'needs-initiative', 'deferred']);
  const edgeCases = output.edgeCases.filter(
    (ec): ec is ExploreEdgeCase =>
      ec !== null &&
      typeof ec === 'object' &&
      typeof ec.title === 'string' &&
      typeof ec.detail === 'string' &&
      typeof ec.disposition === 'string' &&
      DISPOSITIONS.has(ec.disposition),
  );
  const brainConstraints = output.brainConstraints.filter(
    (bc): bc is { constraint: string; source: string } =>
      bc !== null && typeof bc === 'object' && typeof bc.constraint === 'string' && typeof bc.source === 'string',
  );
  if (edgeCases.length === 0 && brainConstraints.length === 0) return null;
  const findings: ExploreFindings = {
    edgeCases,
    brainConstraints,
    exploreSummary: typeof output.exploreSummary === 'string' ? output.exploreSummary : '',
  };
  // SEC-04 leaf: persist through the guard (write mode). A symlinked/escaping
  // `edge-cases.json` leaf is refused (null) — this stage is advisory
  // enrichment, so a refused write is fail-open (findings still returned for
  // THIS turn; the draft step simply finds no persisted explore block).
  guardedWriteFile(projectRoot, ['_architect', sessionId, 'edge-cases.json'], JSON.stringify(findings, null, 2));
  return findings;
}

// ---------------------------------------------------------------------------
// Draft step (+ council + PLAN)
// ---------------------------------------------------------------------------

export type DraftInitiative = {
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

/**
 * Render the explore stage's findings into the draft prompt (R4-04-F4).
 * Empty array when no findings exist (fail-open exploration) — the draft
 * prompt is then byte-identical to the pre-explore shape.
 */
function renderExploreBlock(findings: ExploreFindings | null): string[] {
  if (!findings || (findings.edgeCases.length === 0 && findings.brainConstraints.length === 0)) {
    return [];
  }
  const lines: string[] = ['', '### Edge cases + brain constraints (exploration stage)', ''];
  if (findings.edgeCases.length > 0) {
    lines.push(
      'Edge cases you enumerated — every one MUST land per its disposition: ' +
        '`covered` cases appear in a matching initiative\'s ACs; `needs-initiative` ' +
        'cases get their own initiative; `deferred` cases are named in the ' +
        'initiative body\'s out-of-scope note (nothing enumerated may silently vanish):',
    );
    for (const ec of findings.edgeCases) {
      lines.push(`- [${ec.disposition}] **${ec.title}** — ${ec.detail}`);
    }
  }
  if (findings.brainConstraints.length > 0) {
    lines.push(
      '',
      'Brain-sourced constraints — shape the matching acceptance criteria and ' +
        'cite the source theme in the AC line where applicable:',
    );
    for (const bc of findings.brainConstraints) {
      lines.push(`- ${bc.constraint} _(source: ${bc.source})_`);
    }
  }
  return lines;
}

async function runDraftStep(
  args: ArchitectStepArgs & { resolvedDecisions: string | null },
): Promise<RunArchitectTurnResult> {
  const { input, status, plumbing, writeStatus, resolvedDecisions, paths } = args;
  const { queryFn, logger, onToolUse, onHeartbeat, onText, onThinking } = plumbing;
  const brainIndex = architectBrainIndex(input, status);
  // W8-B6 — the same initiative id every event in this session already uses.
  const initiativeId = `architect-session-${input.sessionId}`;
  const interview = readInterview(input.projectRoot, input.sessionId);
  const skill = loadSkillTurnPrompt({ name: 'architect', turnId: 'draft', skillPromptPath: input.skillPromptPath });

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
    ...renderExploreBlock(readExploreFindings(input.projectRoot, input.sessionId)),
  ].join('\n');

  let { output: draft, brainReads } = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
    logger, initiativeId,
    queryFn,
    prompt,
    schema: DRAFT_SCHEMA,
    modelTier: status.modelTier,
    onToolUse,
    onHeartbeat,
    onText,
    onThinking,
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
    const forceEmitSection = loadForceEmitTurnSection(input.skillPromptPath);
    const retry = await runStructured<{ vision?: string; initiatives?: DraftInitiative[] }>({
    logger, initiativeId,
      queryFn,
      prompt: `${prompt}\n\n${forceEmitSection}`,
      schema: DRAFT_SCHEMA,
      modelTier: status.modelTier,
      onToolUse,
      onHeartbeat,
      onText,
      onThinking,
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
  // W7-C3 deref guard: a draft row with NEITHER slug nor title (structured
  // output is LLM-produced) must not crash the whole run inside slugify's
  // .toLowerCase() — it falls to slugify's own 'initiative' fallback.
  const knownSlugs = new Set(draftInitiatives.map((d) => slugify(d.slug || d.title || '')));
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

  const exploreFindings = readExploreFindings(input.projectRoot, input.sessionId);
  const session: ArchitectSession = {
    session_id: status.session_id,
    project: status.project,
    project_repo_path: status.project_repo_path,
    vision,
    interview,
    brain_context,
    council: councilTranscript,
    ...(exploreFindings ? { explore: exploreFindings } : {}),
    initiatives: proposed,
  };

  const planPath = writePlanDoc(session, input.projectRoot);
  writeStatus({ ...status, phase: 'awaiting-verdict' });

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
// Completeness critic (FINALIZE gate)
// ---------------------------------------------------------------------------

/** Render the flattened interview Q/A into a numbered markdown block for the
 *  critic prompt. Returns a placeholder when the session had no interview. */
function renderInterviewSummary(rounds: InterviewRound[]): string {
  if (rounds.length === 0) return '(no interview — the operator drafted directly)';
  return rounds
    .map((r, i) => `${i + 1}. Q: ${r.question}\n   A: ${r.answer}`)
    .join('\n');
}

/** Render every manifest about to be promoted (id, dependencies, full body)
 *  into one block per initiative for the critic prompt. Reads fresh from disk
 *  so the critic reviews EXACTLY what `promoteManifests` is about to move. */
function buildManifestsSummary(manifestsDir: string): string {
  if (!existsSync(manifestsDir)) return '(no manifests found)';
  const files = readdirSync(manifestsDir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return '(no manifests found)';
  return files
    .map((f) => {
      const m = parseManifest(readFileSync(join(manifestsDir, f), 'utf8'));
      const deps = m.depends_on_initiatives?.length ? m.depends_on_initiatives.join(', ') : '(none)';
      // Roadmap-scale sessions promote 20+ manifests — bound each body so the
      // assembled critic prompt cannot blow the context window.
      const body = truncateWithMarker(m.body, CRITIC_MAX_MANIFEST_BODY_CHARS);
      return `### ${m.initiative_id}\ndepends_on: ${deps}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Run the completeness critic once and fold the result onto the session
 * status. Never throws — a crash is advisory infra (treated as zero findings,
 * loudly logged) so `runFinalizeStep` always proceeds to promotion in that
 * case. Returns `blockPromotion: true` only when the critic surfaced at least
 * one finding on a session that had not yet run it.
 */
async function runFinalizeCompletenessCritic(args: {
  input: RunArchitectTurnInput;
  paths: ReturnType<typeof sessionPaths>;
  status: ArchitectStatus;
  logger: EventLogger;
  queryFn: QueryFn;
}): Promise<{ status: ArchitectStatus; blockPromotion: boolean }> {
  const { input, paths, status, logger, queryFn } = args;
  const initiativeId = `architect-session-${input.sessionId}`;

  const critStart = logger.emit({
    initiative_id: initiativeId,
    phase: 'architect',
    skill: 'architect-completeness-critic',
    event_type: 'start',
    input_refs: [paths.planPath],
    output_refs: [],
    message: 'architect.completeness-critic.start',
    metadata: { session_id: input.sessionId },
  });

  const interviewSummary = renderInterviewSummary(readInterview(input.projectRoot, input.sessionId));
  const planMarkdown = existsSync(paths.planPath) ? readFileSync(paths.planPath, 'utf8') : null;
  const manifestsSummary = buildManifestsSummary(paths.manifestsDir);

  const critic = await runCompletenessCritic({
    idea: status.idea,
    interviewSummary,
    planMarkdown,
    manifestsSummary,
    queryFn,
    logger,
    initiativeId,
  });

  if (critic.crashed) {
    // Advisory infra — never brick finalize, but log loudly.
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: critStart.event_id,
      phase: 'architect',
      skill: 'architect-completeness-critic',
      event_type: 'error',
      input_refs: [paths.planPath],
      output_refs: [],
      message: 'architect.completeness-critic.crashed — proceeding to promote (advisory infra, zero findings)',
      metadata: { session_id: input.sessionId, error: critic.error ?? null },
    });
  } else {
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: critStart.event_id,
      phase: 'architect',
      skill: 'architect-completeness-critic',
      event_type: 'end',
      input_refs: [paths.planPath],
      output_refs: [],
      message: `architect.completeness-critic.end (findings=${critic.findings.length})`,
      metadata: { session_id: input.sessionId, findings_count: critic.findings.length },
    });
    for (const f of critic.findings) {
      logger.emit({
        initiative_id: f.initiativeId ?? initiativeId,
        parent_event_id: critStart.event_id,
        phase: 'architect',
        skill: 'architect-completeness-critic',
        event_type: 'log',
        input_refs: [paths.planPath],
        output_refs: [],
        message: `architect.completeness-critic.finding (${f.severity}): ${f.gap}`,
        metadata: {
          session_id: input.sessionId,
          severity: f.severity,
          initiativeId: f.initiativeId,
          gap: f.gap,
        },
      });
    }
  }

  const nextStatus: ArchitectStatus = {
    ...status,
    completenessCritic: {
      ranAt: new Date().toISOString(),
      findings: critic.findings,
      ...(critic.crashed ? { crashed: true } : {}),
    },
  };

  if (critic.findings.length > 0) {
    return { status: { ...nextStatus, phase: 'awaiting-verdict' }, blockPromotion: true };
  }
  return { status: nextStatus, blockPromotion: false };
}

// ---------------------------------------------------------------------------
// Finalize step (approve → bake resolved decisions → promote to queue)
// ---------------------------------------------------------------------------

async function runFinalizeStep(args: ArchitectStepArgs): Promise<RunArchitectTurnResult> {
  const { input, status, plumbing, writeStatus, paths } = args;
  const { logger } = plumbing;
  const resolved = readResolvedDecisions(input.projectRoot, input.sessionId);

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

  // Completeness critic (architect-completeness-critic, ADR ref:
  // brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md).
  // One-shot-per-session: runs ONCE, right before the operator-approved
  // manifests promote. Findings send the session back to `awaiting-verdict`
  // instead of promoting; the operator's re-approve IS the acknowledgement —
  // `status.completenessCritic` being already set on the next finalize turn
  // skips the critic entirely and promotes straight through.
  let workingStatus: ArchitectStatus = status;
  if (!status.completenessCritic) {
    const criticResult = await runFinalizeCompletenessCritic({
      input,
      paths,
      status,
      logger,
      queryFn: plumbing.queryFn,
    });
    workingStatus = criticResult.status;
    // Persist the one-shot flag durably BEFORE promotion (all three outcomes:
    // findings, clean, crashed) — a crash inside promoteManifests below must
    // not re-arm the critic on the operator's retry turn.
    writeStatus(workingStatus);
    if (criticResult.blockPromotion) {
      return { phase: 'awaiting-verdict', wrote: [] };
    }
  }

  const { writtenManifestPaths, writtenInitiativeIds } = promoteManifests(paths.manifestsDir, {
    queueRoot,
  });

  // DEC-2 (S6): thread the initiativeId+cycleId lineage at finalize time so that
  // when the Develop flow later claims this manifest it reuses the SAME
  // `_logs/<cycleId>` dir instead of minting a sibling. One cycleId ⇒ one event
  // log ⇒ cost/roadmap/metrics roll up as one unit. Idempotent + best-effort.
  for (let i = 0; i < writtenManifestPaths.length; i++) {
    const initId = writtenInitiativeIds[i];
    if (initId) mintAndPersistManifestCycleId(writtenManifestPaths[i], initId);
  }

  writeStatus({ ...workingStatus, phase: 'committed' });

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

/** The seed flow an architect handoff runs under (S8/DEC-3 — architect → pm
 *  decompose). The develop build is enqueued separately onto forge-develop. */
const ARCHITECT_FLOW_ID = 'forge-architect';

export function buildManifest(
  d: DraftInitiative,
  status: ArchitectStatus,
  datePart: string,
  created_at: string,
  knownSlugs?: Set<string>,
): InitiativeManifest {
  // W7-C3 deref guard — same rationale as the knownSlugs site above.
  const slug = slugify(d.slug || d.title || '');
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
  // W7-FIX-A4 (W7A4-01): the human title the architect skill emits IS the
  // manifest's frontmatter `title:` — `initiativeTitle()` (manifest.ts) is
  // the ONE display derivation and this is its producer; without it every
  // architect-originated initiative rendered as its raw INIT id. A blank
  // draft title is absent (never `title: "  "`); the fallback chain applies.
  // `DraftInitiative` is the shape the skill is ASKED for, not one the runner
  // enforces (`runStructured` casts raw model output), so a missing/non-string
  // title degrades to the fallback chain rather than throwing out of drafting.
  const title = (typeof d.title === 'string' ? d.title : '').trim();
  return {
    initiative_id: `INIT-${datePart}-${slug}`,
    ...(title ? { title } : {}),
    project: status.project,
    project_repo_path: status.project_repo_path,
    created_at,
    iteration_budget: d.iteration_budget > 0 ? Math.round(d.iteration_budget) : 5,
    cost_budget_usd: d.cost_budget_usd > 0 ? d.cost_budget_usd : 5,
    phase: 'pending',
    origin: 'architect',
    // S8/DEC-3: route the architect's handoff to the forge-architect flow
    // (architect → pm decompose). forge-cycle was retired, so a manifest with no
    // flow_id would now throw in runCycle. After the operator approves the PLAN
    // and presses start-development, enqueue-develop-run repoints this to
    // forge-develop for the build (DEC-2 keeps the threaded cycle_id).
    flow_id: ARCHITECT_FLOW_ID,
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

/**
 * Architect-local thin wrapper over the shared `runStructuredTurn` (ADR 020 spine
 * extracted to interactive-session.ts). It binds the architect's model + tool
 * allow-list (derived from skills/architect/SKILL.md, ADR-024) and narrows the
 * generic `reads` down to the `brain/` paths the PLAN's brain-context section
 * needs (ARCH-1). Callsites keep their `{ output, brainReads }` shape.
 */
async function runStructured<T>(args: {
  queryFn: QueryFn;
  prompt: string;
  schema: unknown;
  /** W8-B6 — the run's logger + initiative id, so the architect's own bound
   *  library hooks can fire and record. Required, not optional: an optional
   *  field here would let a call site silently spawn hook-blind. */
  logger: EventLogger;
  initiativeId: string;
  /** ADR-043 §3 amendment (wave-6): the session's requested kickoff tier
   *  (`status.modelTier`), resolved against `architectAgentSpec` — absent
   *  resolves to the unchanged `ARCHITECT_MODEL` default. */
  modelTier?: ModelTier;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
}): Promise<StructuredResult<T>> {
  const { output, reads } = await runStructuredTurn<T>({
    queryFn: args.queryFn,
    prompt: args.prompt,
    schema: args.schema,
    model: resolveSessionModel(architectAgentSpec, args.modelTier),
    allowedTools: architectAgentSpec.allowedTools,
    disallowedTools: architectAgentSpec.disallowedTools,
    ...(() => {
      const hooks = sdkHooksForAgent({
        skill: architectAgentSpec.skill,
        logger: args.logger,
        initiativeId: args.initiativeId,
      });
      return hooks !== undefined ? { hooks } : {};
    })(),
    onToolUse: args.onToolUse,
    onHeartbeat: args.onHeartbeat,
    onText: args.onText,
    onThinking: args.onThinking,
    label: 'architect-structured',
  });
  return { output, brainReads: reads.filter((p) => p.includes('brain/')) };
}

// ---------------------------------------------------------------------------
// Prompt source (ADR 003 / ADR 024 — prompt is skill content, not re-baked TS)
// ---------------------------------------------------------------------------
//
// Per-turn prose now lives in `skills/architect/SKILL.md` as `<!-- turn: id -->`
// sections, loaded through the shared, fail-loud `loadSkillTurnPrompt`
// (`packages/agents/skill-path.ts`, R4-23) at each of the three call sites above
// — no runner-private fallback survives.

/**
 * The `draft-force-emit` turn section's raw text WITHOUT the shared `base`
 * preamble. The forced-emit retry APPENDS this to the already-composed draft
 * prompt rather than rebuilding it from scratch (park §2c / AT-7: the retry
 * prompt must be the first prompt with this text appended, a strict prefix
 * relationship). `loadSkillTurnPrompt` always returns `base + '\n\n' +
 * section`, which would duplicate `base` into the appended tail, so this
 * reads the same file and pulls just the one section via the shared, pure
 * `splitSkillTurnSections`. Fails loud on the same two conditions
 * `loadSkillTurnPrompt` does (unreadable file / missing turn id) — no silent
 * default here either (the declared-data-fails-open antipattern this whole
 * lane exists to close).
 */
function loadForceEmitTurnSection(skillPromptPath?: string): string {
  const resolvedPath = skillPromptPath ?? skillPath('architect');
  let text: string;
  try {
    text = readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(
      `architect runner: could not read skill "architect" (turn "draft-force-emit") at ${resolvedPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { turns } = splitSkillTurnSections(text);
  const section = turns.get('draft-force-emit');
  if (section === undefined) {
    const available = [...turns.keys()].sort().join(', ');
    throw new Error(
      `architect runner: skill "architect" (${resolvedPath}) has no turn "draft-force-emit" — available turns: ${available}.`,
    );
  }
  return section;
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

// ---------------------------------------------------------------------------
// SEC-04 — guarded leaf siblings of readStatus / writeStatus.
//
// The raw pair above raw-appends the `status.json` leaf to an already-built
// `sessionDir` (`join(sessionDir, 'status.json')`) — the "guard the dir,
// raw-append the leaf" shape SEC-04 closes. These siblings take the TRUSTED
// `projectsRoot` plus the request-derived directory segments (`project`,
// `'_architect'`, `sessionId`) as their OWN `segments[]` elements — never
// folded into the root — and route the WHOLE path, `status.json` leaf
// included, through `guardedFile`, so a symlinked/hardlinked status leaf is
// rejected. Raw pair retained; Phase-1 appliers switch the architect route
// call sites onto these. Returns `null` on a containment rejection (fail
// closed), matching `readStatus`'s existing "null when unavailable" contract.
// ---------------------------------------------------------------------------

export function guardedReadStatus(
  projectsRoot: string,
  dirSegments: readonly string[],
  leaf = 'status.json',
): ArchitectStatus | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'read');
  if (p === null) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ArchitectStatus;
  } catch {
    return null;
  }
}

export function guardedWriteStatus(
  projectsRoot: string,
  dirSegments: readonly string[],
  status: ArchitectStatus,
  leaf = 'status.json',
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'write');
  if (p === null) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
  return p;
}


// SEC-04 leaf: `questions.json`/`answers.json`/`edge-cases.json`/`feedback.md`
// each ride the WHOLE `<projectsRoot>/_architect/<sessionId>/<leaf>` path
// (leaf included) through `guardedFile` — the trusted `projectsRoot` root plus
// the request-derived `sessionId` as its OWN segment (never folded into root).
// A symlinked/hardlinked LEAF inside a genuinely real, contained session dir is
// refused: writes throw (fail closed, runner contract), reads collapse to
// empty/null (no out-of-root disclosure). Replaces the former raw
// `join(sessionDir, leaf)` helpers that guarded neither dir nor leaf.
function writeQuestions(projectsRoot: string, sessionId: string, questions: ArchitectQuestion[]): string {
  const p = guardedWriteFile(
    projectsRoot,
    ['_architect', sessionId, 'questions.json'],
    JSON.stringify(questions, null, 2),
  );
  if (p === null) {
    throw new Error(
      'architect runner: questions.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
  return p;
}

/** Read every `answers.json` round into a flat `InterviewRound[]`. The bridge
 *  appends rounds; this flattens them into the `ArchitectSession.interview`
 *  shape the renderer expects. SEC-04: the `answers.json` leaf rides through the
 *  guard (read mode) so a symlinked leaf discloses nothing — a rejected or
 *  absent file both collapse to `[]`. */
export function readInterview(projectsRoot: string, sessionId: string): InterviewRound[] {
  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'answers.json']);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as AnswerRound[] | AnswerRound;
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
function readResolvedDecisions(projectsRoot: string, sessionId: string): string | null {
  const raw = guardedReadFile(projectsRoot, ['_architect', sessionId, 'feedback.md']);
  if (raw === null) return null;
  const fb = raw.trim();
  return fb || null;
}

/** Discover every architect session under `projects/<name>/_architect/<sid>/`
 *  — used by the bridge's `GET /api/architect/sessions`. Best-effort; never
 *  throws on a malformed dir. */
export function listArchitectSessions(projectsRoot: string): ArchitectStatus[] {
  const out: ArchitectStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  for (const project of safeReaddir(projectsRoot)) {
    // SEC-04: guard the `_architect` dir as its OWN segment against the fixed
    // `projectsRoot` base — a symlinked `projects/<p>/_architect` (a plain
    // 120000 blob committable to a project repo) resolves to an identity
    // mismatch and yields NO enumeration/disclosure. This was THE reproduced
    // escape: `GET /api/architect/sessions` enumerated an out-of-root session
    // and disclosed its status.json (idea / session_id / project_repo_path).
    const archGuard = resolveGuardedPath(projectsRoot, [project, '_architect']);
    if (!archGuard.ok) continue;
    const archDir = archGuard.realPath;
    for (const sid of safeReaddir(archDir)) {
      if (sid.startsWith('_')) continue; // skip _archived/
      // Guard each session id as its own segment too — a symlinked `<sid>`
      // resolving out of root is refused, never read.
      // SEC-04 leaf: route the WHOLE `<sid>/status.json` path (leaf included)
      // through the guard — the earlier pass guarded the sid DIR but read the
      // status.json leaf raw via `readStatus(sidGuard.realPath)`, so a symlinked
      // `status.json` inside a real, contained sid dir still disclosed an
      // out-of-root file. `guardedReadStatus` refuses that leaf (null), so it is
      // never enumerated.
      const status = guardedReadStatus(projectsRoot, [project, '_architect', sid]);
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
