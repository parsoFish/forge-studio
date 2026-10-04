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
 *    actually active AND `forge serve` is running.
 */
import type { ArchitectSessionSummary, ServeStatus } from './bridge-client';
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
    case 'critiquing':
    case 'revising':
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
    case 'critiquing': return 'The architect is checking the plan for gaps…';
    case 'revising': return 'The architect is revising the plan…';
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

/**
 * The PLAN artifact for an architect session. With no `mode` the artifact page
 * arms the gate from the session's LIVE phase (`resolveArtifactMode`), which is
 * what a link rendered from one poll's phase must ask for — freezing the mode
 * into the href let a link rendered a poll early open read-only after the
 * session armed (`forge-8vfn.6.11.48`). An explicit mode is for a link whose
 * intent is fixed: the gate's own "decide" link, or a deliberate read-only view.
 */
export function architectPlanArtifactHref(sessionId: string, mode?: 'gate' | 'view'): string {
  const base = `/artifact?run=${ARCHITECT_RUN_PREFIX}${encodeURIComponent(sessionId)}&type=plan`;
  return mode === undefined ? base : `${base}&mode=${mode}`;
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
 *  `initiativeId` — a neighbour's run is never cross-attributed.
 *
 *  W8-B3 (sessions-kinds-08) — `knownFlowIds` is the LIVE flows roster, and
 *  `monitorHref` is now derived against it instead of being minted from the
 *  run's `flowId` unconditionally. 22 of 63 runs carry the `"unknown"`
 *  sentinel the runs payload uses for pre-S8 manifests, so on 8 of 12
 *  committed architect sessions the biggest, greenest control on the panel
 *  ("Watch it build →") navigated to `/flows/unknown` — a retired-flow
 *  not-found page. A sentinel check would have closed that ONE id; deriving
 *  against the roster closes the whole class, because a run naming any
 *  since-deleted flow is exactly as dead an address, and it needs no mirror
 *  of the sentinel literal on this side of the wire. The run's OWN page stays
 *  linked either way — `/flows/<id>/run/<initiative>` resolves without a flow
 *  definition (that route derives from the runs list, W7-FIX-A3), which is
 *  precisely why only the monitor link was broken.
 *
 *  An UNRESOLVED roster (`undefined` — the flows list has not loaded, or its
 *  read failed) yields `monitorHref: null` rather than an optimistic link:
 *  the caller renders one fewer link for a moment, instead of a dead end. */
export function deriveInitiativeLinkage(initiativeIds: string[], runs: Run[], knownFlowIds?: readonly string[]): InitiativeLinkage[] {
  return initiativeIds.map((initiativeId) => {
    const run = runs.find((r) => r.initiativeId === initiativeId) ?? null;
    if (!run) {
      return { initiativeId, runId: null, flowId: null, runStatus: null, queueState: 'unknown', runHref: null, monitorHref: null };
    }
    const flow = encodeURIComponent(run.flowId);
    const flowIsReal = knownFlowIds !== undefined && knownFlowIds.includes(run.flowId);
    return {
      initiativeId,
      runId: run.id,
      flowId: run.flowId,
      runStatus: run.status,
      queueState: QUEUE_STATE_FOR_RUN[run.status] ?? 'unknown',
      // The INITIATIVE id is the stable run handle (the bridge's findRun
      // matches it in every queue state); a run's own `id` flips from the
      // initiative id to the cycle id the moment forge serve claims it.
      runHref: `/flows/${flow}/run/${encodeURIComponent(initiativeId)}`,
      monitorHref: flowIsReal ? `/flows/${flow}` : null,
    };
  });
}

export type PostCommitTone =
  | 'building'
  | 'claimed-not-running'
  | 'claimed-unknown'
  | 'queued-running'
  | 'queued-not-running'
  | 'queued-unknown'
  | 'gated'
  | 'done'
  | 'failed'
  | 'unknown';

/** `serveNotReady` — true whenever the headline cannot promise progress (serve
 *  unconfirmed, or confirmed but not currently running) and the caller should
 *  mount the shared `<ServeStatusNotice>` for the precise detail. */
export type PostCommitView = { tone: PostCommitTone; headline: string; serveNotReady: boolean };

function idsIn(linkage: InitiativeLinkage[], state: InitiativeQueueState): string {
  return linkage.filter((l) => l.queueState === state).map((l) => l.initiativeId).join(', ');
}

/** The honest post-approve headline. Precedence: gated > building > queued >
 *  failed > done > unknown; whether `forge serve` is actually running decides
 *  whether "queued" / "claimed" can progress. There is no pause/stop state an
 *  operator can put serve into any more (M7-E row 205) — only confirmed-running
 *  vs confirmed-not-running (restarting/draining/down, detailed by the shared
 *  notice) vs unconfirmed (the read failed, or no supervisor exists at all). */
export function describePostCommit(linkage: InitiativeLinkage[], serve: ServeStatus | null): PostCommitView {
  // `null` or `unsupervised` = never promise progress we cannot confirm.
  const unknown = serve === null || serve.state === 'unsupervised';
  const running = serve?.state === 'running';
  const has = (s: InitiativeQueueState) => linkage.some((l) => l.queueState === s);
  const unconfirmed = 'could not confirm forge serve is running.';

  if (has('gated')) return { tone: 'gated', headline: `${idsIn(linkage, 'gated')} is waiting on your verdict.`, serveNotReady: false };
  if (has('building')) {
    const ids = idsIn(linkage, 'building');
    if (unknown) return { tone: 'claimed-unknown', headline: `${ids} is claimed — ${unconfirmed}`, serveNotReady: true };
    return running
      ? { tone: 'building', headline: `The autonomous loop is building ${ids} now.`, serveNotReady: false }
      : { tone: 'claimed-not-running', headline: `${ids} is claimed but forge serve is not currently running — it will resume once Studio brings it back.`, serveNotReady: true };
  }
  if (has('queued')) {
    const ids = idsIn(linkage, 'queued');
    if (unknown) return { tone: 'queued-unknown', headline: `${ids} is queued — ${unconfirmed}`, serveNotReady: true };
    if (running) return { tone: 'queued-running', headline: `${ids} is queued — forge serve will pick it up.`, serveNotReady: false };
    return { tone: 'queued-not-running', headline: `${ids} is queued — forge serve is not currently running; it will resume once Studio brings it back.`, serveNotReady: true };
  }
  if (has('failed')) return { tone: 'failed', headline: `${idsIn(linkage, 'failed')} failed — see the run for the failure note.`, serveNotReady: false };
  if (linkage.length > 0 && linkage.every((l) => l.queueState === 'complete')) {
    return { tone: 'done', headline: `${idsIn(linkage, 'complete')} finished.`, serveNotReady: false };
  }
  return { tone: 'unknown', headline: 'Approved — no queue entry found for this session yet.', serveNotReady: false };
}
