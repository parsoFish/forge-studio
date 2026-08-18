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

export type SchedulerViewState = 'running' | 'paused' | 'stopped' | 'unknown';
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
  if (!scheduler || !scheduler.running) {
    return {
      claim: 'Enqueued — the scheduler is stopped, so nothing will run until you start it.',
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
