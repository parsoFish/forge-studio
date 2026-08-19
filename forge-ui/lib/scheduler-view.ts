/**
 * scheduler-view — pure derivations behind the SchedulerCard (W7-A3,
 * flows-01 / flows-23 / projects-16) and every "enqueued — now what?" success
 * line (projects-17 / projects-32).
 *
 * The daemon (`forge serve`) is the only thing that executes queued work; every
 * Studio "start" control is a QUEUE WRITE. These helpers turn the bridge's
 * `GET /api/scheduler/status` into (a) an honest label/hint/action set — actions
 * are DERIVED from running/paused, never a fixed button row, and an unknown
 * status offers none — and (b) enqueue copy that says "nothing will run" when
 * the daemon is stopped instead of "started".
 */
import type { SchedulerStatus } from './bridge-client';

export type SchedulerViewState = 'running' | 'paused' | 'stopping' | 'stopped' | 'unknown';
export type SchedulerAction = 'start' | 'pause' | 'resume' | 'stop';

export type SchedulerView = {
  state: SchedulerViewState;
  label: string;
  hint: string;
  actions: SchedulerAction[];
};

function runs(n: number): string {
  return `${n} queued run${n === 1 ? '' : 's'}`;
}

export function deriveSchedulerView(status: SchedulerStatus | null, opts: { queuedCount?: number } = {}): SchedulerView {
  const queued = opts.queuedCount ?? 0;
  if (!status) {
    return {
      state: 'unknown',
      label: 'Scheduler status unknown',
      hint: 'Could not read the scheduler from the bridge.',
      actions: [],
    };
  }
  if (!status.running) {
    return {
      state: 'stopped',
      label: 'Scheduler stopped',
      hint: queued > 0 ? `${runs(queued)} will not start until the scheduler runs.` : 'Queued work will not run until you start it.',
      actions: ['start'],
    };
  }
  // W7-FIX-A3 (A3-07): the drain window after Stop — SIGTERM sent, pid still
  // alive while in-flight cycles settle. The bridge marks the pid it
  // signalled (`daemonState.stopping`); nothing new is claimed and no action
  // is honest until the poll reports running:false.
  if (status.stopping) {
    return {
      state: 'stopping',
      label: 'Scheduler stopping',
      hint: 'Draining in-flight runs, then exiting — nothing new is claimed.',
      actions: [],
    };
  }
  if (status.paused) {
    return {
      state: 'paused',
      label: 'Scheduler paused',
      hint: 'In-flight runs keep going; nothing new is claimed.',
      actions: ['resume', 'stop'],
    };
  }
  return {
    state: 'running',
    label: 'Scheduler running',
    hint: queued > 0 ? `Claiming queued work — ${runs(queued)}.` : 'Claiming queued work as it arrives.',
    actions: ['pause', 'stop'],
  };
}

export type EnqueueOutcome = {
  claim: string;
  needsSchedulerStart: boolean;
  runHref: string | null;
};

const KIND_CLAIM: Record<'plan' | 'develop' | 'flow', string> = {
  plan: 'Planning enqueued — the scheduler will decompose it into work items.',
  develop: 'Development enqueued — the develop flow will open a PR for review.',
  flow: 'Run enqueued — the scheduler will pick it up.',
};

/** Href for the run an enqueue just returned — flow + run handle when both are
 *  known, the flow monitor when only the flow is, else null (never fabricated).
 *  `runId` is the STABLE handle: the initiative id (the bridge's findRun matches
 *  it in every queue state — a planned run's own id IS the initiative id, and a
 *  claimed run is found by its initiativeId), never the cycle id, which only
 *  resolves once the scheduler has claimed the manifest. */
export function enqueuedRunHref(enqueued: { runId?: string; flowId?: string }): string | null {
  if (enqueued.flowId && enqueued.runId) {
    return `/flows/${encodeURIComponent(enqueued.flowId)}/run/${encodeURIComponent(enqueued.runId)}`;
  }
  if (enqueued.flowId) return `/flows/${encodeURIComponent(enqueued.flowId)}`;
  return null;
}

export function describeEnqueueOutcome(
  kind: 'plan' | 'develop' | 'flow',
  scheduler: SchedulerStatus | null,
  enqueued: { runId?: string; flowId?: string },
): EnqueueOutcome {
  const runHref = enqueuedRunHref(enqueued);
  // W7-FIX-A3 (A3-04): an UNREADABLE status (null — the bridge read failed)
  // is not "stopped". The strip mounted beneath (needsSchedulerStart) renders
  // its own honest "unknown" with no controls; the claim must not assert a
  // state that was never read.
  if (!scheduler) {
    return {
      claim: 'Enqueued — could not confirm the scheduler is running; check its status below.',
      needsSchedulerStart: true,
      runHref,
    };
  }
  if (!scheduler.running) {
    return {
      claim: 'Enqueued — the scheduler is stopped, so nothing will run until you start it.',
      needsSchedulerStart: true,
      runHref,
    };
  }
  // W7-FIX-A3 (round-2 finding 3): the DRAIN window. `stopping` rides on
  // `running: true` (the signalled pid stays alive while in-flight cycles
  // settle), so without this branch a draining daemon claimed "the scheduler
  // will pick it up" for a run it will never claim — it exits at the end of
  // the drain. Checked BEFORE `paused`: Resume is not even offered while
  // stopping (deriveSchedulerView gives that state no actions).
  if (scheduler.stopping) {
    return {
      claim: 'Enqueued — the scheduler is stopping, so nothing will be claimed until you start it again.',
      needsSchedulerStart: true,
      runHref,
    };
  }
  if (scheduler.paused) {
    return {
      claim: `${KIND_CLAIM[kind]} The scheduler is paused — resume it to let this run start.`,
      needsSchedulerStart: false,
      runHref,
    };
  }
  return { claim: KIND_CLAIM[kind], needsSchedulerStart: false, runHref };
}
