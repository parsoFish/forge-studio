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

import { readResolvedDecisions, writeQuestions } from './architect-session.ts';
import { runDraftStep, runExploreThenDraft, runInterviewStep, withPaths } from './architect-steps.ts';
import type { ArchitectStepArgs } from './architect-steps.ts';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { QueryFn } from '../interactive-session.ts';
import { archiveSessionDir, sessionPaths } from './architect-plan.ts';
import type { InterviewRound } from './architect-plan.ts';
import type { EventLogger } from '@forge/kernel';
import { requirePorts } from './architect-ports.ts';
import type { ArchitectManifestPorts } from './architect-ports.ts';
import { runCompletenessCritic, truncateWithMarker, CRITIC_MAX_MANIFEST_BODY_CHARS } from './architect-critic.ts';
import { runKindTurn } from './kind-turn.ts';
import type { SessionKindVariant } from './kind-turn.ts';
import { guardedReadStatus, readArchitectSessionStats, readInterview } from './architect-session.ts';
import type { ArchitectStatus, RunArchitectTurnInput, RunArchitectTurnResult } from './architect-session.ts';

// ---- The kind's public door -----------------------------------------------
// `kinds/architect.ts` is the module every consumer outside this directory
// imports; the three-way split (M4 exit row 5, ruling 96) moved most of these
// declarations into its leaves but must not move the door with them. Fifteen
// names are imported from here across the repo — re-exported, never re-declared,
// so there is exactly one definition of each and this list cannot silently
// diverge from it. `readStatus` and `writeStatus` are DECLARED here rather
// than re-exported — see the note above them (ruling 114).
export { ARCHITECT_MODEL, architectAgentSpec, guardedReadStatus, guardedWriteStatus, listArchitectSessions, readArchitectSessionStats } from './architect-session.ts';
export type { ArchitectQuestion, ArchitectStatus, DraftInitiative } from './architect-session.ts';
export { buildManifest } from './architect-manifest.ts';

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
export type { QueryFn };


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
function buildManifestsSummary(manifestsDir: string, parseManifest: ArchitectManifestPorts['parseManifest']): string {
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
  const manifestsSummary = buildManifestsSummary(paths.manifestsDir, requirePorts(input).parseManifest);

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
  // Refuses here, before any work, if the ports were never injected.
  const ports = requirePorts(input);
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
      const m = ports.parseManifest(readFileSync(p, 'utf8'));
      if (m.body.includes('## Resolved design decisions')) continue;
      const body = `${m.body}\n\n## Resolved design decisions (operator)\n\n${resolved}\n`;
      writeFileSync(p, ports.serializeManifest({ ...m, body }));
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
      const m = ports.parseManifest(readFileSync(p, 'utf8'));
      writeFileSync(p, ports.serializeManifest({
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

  const { writtenManifestPaths, writtenInitiativeIds } = ports.promoteManifests(paths.manifestsDir, {
    queueRoot,
  });

  // DEC-2 (S6): thread the initiativeId+cycleId lineage at finalize time so that
  // when the Develop flow later claims this manifest it reuses the SAME
  // `_logs/<cycleId>` dir instead of minting a sibling. One cycleId ⇒ one event
  // log ⇒ cost/roadmap/metrics roll up as one unit. Idempotent + best-effort.
  for (let i = 0; i < writtenManifestPaths.length; i++) {
    const initId = writtenInitiativeIds[i];
    if (initId) ports.mintAndPersistManifestCycleId(writtenManifestPaths[i], initId);
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



