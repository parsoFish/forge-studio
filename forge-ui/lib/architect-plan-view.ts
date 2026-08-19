/**
 * architect-plan-view — pure derivations behind the architect PLAN surface on
 * /artifact (`?run=_architect-<sid>&type=plan`) and the architect session
 * page's committed banner (W7-A3: artifact-plan-03/04/10/21/27/28/33,
 * sessions-kinds-08/12, artifact-plan-22/23).
 *
 * Principles:
 *  - the gate is armed by the SESSION PHASE, never by the URL;
 *  - session → initiative → run linkage is DERIVED from what the bridge already
 *    serves (`initiativeIds` off the session's manifests dir + the runs list),
 *    never stored;
 *  - "the autonomous loop is building it now" is only ever said when a run is
 *    actually active AND the scheduler is running.
 */
import type { ArchitectSessionSummary, SchedulerStatus } from './bridge-client';
import type { Run } from './studio-client';

export const ARCHITECT_RUN_PREFIX = '_architect-';

export type ArchitectPlanPhaseKind =
  | 'not-found'
  | 'awaiting-answers'
  | 'working'
  | 'awaiting-verdict'
  | 'finalizing'
  | 'committed'
  | 'rejected';

export function isArchitectRunId(runId: string): boolean {
  return runId.startsWith(ARCHITECT_RUN_PREFIX);
}

export function architectSessionIdFromRunId(runId: string): string {
  return isArchitectRunId(runId) ? runId.slice(ARCHITECT_RUN_PREFIX.length) : '';
}

export function deriveArchitectPlanPhase(session: ArchitectSessionSummary | null): ArchitectPlanPhaseKind {
  if (!session) return 'not-found';
  switch (session.phase) {
    case 'interviewing':
    case 'exploring':
    case 'drafting':
      return 'working';
    case 'awaiting-answers':
    case 'awaiting-verdict':
    case 'finalizing':
    case 'committed':
    case 'rejected':
      return session.phase;
    default:
      return 'working';
  }
}

/** The plan gate is live ONLY while the architect awaits a verdict. */
export function architectGateArmed(session: ArchitectSessionSummary | null): boolean {
  return session?.phase === 'awaiting-verdict';
}

export function architectPlanStatusCopy(session: ArchitectSessionSummary): string {
  switch (session.phase) {
    case 'awaiting-answers': return 'The architect is waiting for your answers.';
    case 'interviewing': return `The architect is thinking… (round ${session.round})`;
    case 'exploring': return 'The architect is exploring edge cases…';
    case 'drafting': return 'The architect is drafting the plan…';
    case 'awaiting-verdict': return 'Plan ready — review & approve.';
    case 'finalizing': return 'Approved — the architect is finalizing and queueing the manifests…';
    case 'committed': return 'Approved — manifests promoted to the queue.';
    case 'rejected': return 'This plan was rejected — it stays readable below.';
    default: return `Architect session phase: ${String(session.phase)}`;
  }
}

export function architectSessionHref(session: Pick<ArchitectSessionSummary, 'sessionId' | 'project'>): string {
  return `/sessions/architect/${encodeURIComponent(session.sessionId)}?project=${encodeURIComponent(session.project)}`;
}

export function architectPlanArtifactHref(sessionId: string, mode: 'gate' | 'view'): string {
  return `/artifact?run=${ARCHITECT_RUN_PREFIX}${encodeURIComponent(sessionId)}&type=plan&mode=${mode}`;
}

// ---- session → initiative → run linkage ------------------------------------

export type InitiativeQueueState = 'queued' | 'building' | 'gated' | 'complete' | 'failed' | 'unknown';

export type InitiativeLinkage = {
  initiativeId: string;
  runId: string | null;
  flowId: string | null;
  runStatus: Run['status'] | null;
  queueState: InitiativeQueueState;
  runHref: string | null;
  monitorHref: string | null;
};

const QUEUE_STATE_FOR_RUN: Record<Run['status'], InitiativeQueueState> = {
  planned: 'queued',
  active: 'building',
  gated: 'gated',
  complete: 'complete',
  failed: 'failed',
};

/** One row per initiative id (input order), matched on the run's OWN
 *  `initiativeId` — a neighbour's run is never cross-attributed. */
export function deriveInitiativeLinkage(initiativeIds: string[], runs: Run[]): InitiativeLinkage[] {
  return initiativeIds.map((initiativeId) => {
    const run = runs.find((r) => r.initiativeId === initiativeId) ?? null;
    if (!run) {
      return { initiativeId, runId: null, flowId: null, runStatus: null, queueState: 'unknown', runHref: null, monitorHref: null };
    }
    const flow = encodeURIComponent(run.flowId);
    return {
      initiativeId,
      runId: run.id,
      flowId: run.flowId,
      runStatus: run.status,
      queueState: QUEUE_STATE_FOR_RUN[run.status] ?? 'unknown',
      // The INITIATIVE id is the stable run handle (the bridge's findRun
      // matches it in every queue state); a run's own `id` flips from the
      // initiative id to the cycle id the moment the scheduler claims it.
      runHref: `/flows/${flow}/run/${encodeURIComponent(initiativeId)}`,
      monitorHref: `/flows/${flow}`,
    };
  });
}

export type PostCommitTone =
  | 'building'
  | 'claimed-stopped'
  | 'claimed-unknown'
  | 'queued-running'
  | 'queued-stopped'
  | 'queued-unknown'
  | 'gated'
  | 'done'
  | 'failed'
  | 'unknown';

export type PostCommitView = { tone: PostCommitTone; headline: string; needsSchedulerStart: boolean };

function idsIn(linkage: InitiativeLinkage[], state: InitiativeQueueState): string {
  return linkage.filter((l) => l.queueState === state).map((l) => l.initiativeId).join(', ');
}

/** The honest post-approve headline. Precedence: gated > building > queued >
 *  failed > done > unknown; the scheduler state decides whether "queued" /
 *  "claimed" can progress. */
export function describePostCommit(linkage: InitiativeLinkage[], scheduler: SchedulerStatus | null): PostCommitView {
  // W7-FIX-A3 (A3-04): `null` = the status could not be READ — a third state,
  // never collapsed into "stopped" (the strip beneath renders "unknown" with
  // no Start button, so a "start it" headline would contradict its controls).
  const unknown = scheduler === null;
  const running = !!scheduler?.running;
  const paused = running && !!scheduler?.paused;
  const has = (s: InitiativeQueueState) => linkage.some((l) => l.queueState === s);
  const unconfirmed = 'could not confirm the scheduler is running; check its status below.';

  if (has('gated')) return { tone: 'gated', headline: `${idsIn(linkage, 'gated')} is waiting on your verdict.`, needsSchedulerStart: false };
  if (has('building')) {
    const ids = idsIn(linkage, 'building');
    if (unknown) return { tone: 'claimed-unknown', headline: `${ids} is claimed — ${unconfirmed}`, needsSchedulerStart: true };
    return running
      ? { tone: 'building', headline: `The autonomous loop is building ${ids} now.`, needsSchedulerStart: false }
      : { tone: 'claimed-stopped', headline: `${ids} is claimed but the scheduler is stopped — it will not progress until you start it.`, needsSchedulerStart: true };
  }
  if (has('queued')) {
    const ids = idsIn(linkage, 'queued');
    if (unknown) return { tone: 'queued-unknown', headline: `${ids} is queued — ${unconfirmed}`, needsSchedulerStart: true };
    if (running && !paused) return { tone: 'queued-running', headline: `${ids} is queued — the scheduler will pick it up.`, needsSchedulerStart: false };
    if (paused) return { tone: 'queued-running', headline: `${ids} is queued — the scheduler is paused; resume it to start.`, needsSchedulerStart: false };
    return { tone: 'queued-stopped', headline: `${ids} is queued — the scheduler is stopped. Start it to build.`, needsSchedulerStart: true };
  }
  if (has('failed')) return { tone: 'failed', headline: `${idsIn(linkage, 'failed')} failed — see the run for the failure note.`, needsSchedulerStart: false };
  if (linkage.length > 0 && linkage.every((l) => l.queueState === 'complete')) {
    return { tone: 'done', headline: `${idsIn(linkage, 'complete')} finished.`, needsSchedulerStart: false };
  }
  return { tone: 'unknown', headline: 'Approved — no queue entry found for this session yet.', needsSchedulerStart: false };
}
