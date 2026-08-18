'use client';

/**
 * EnqueueOutcomeLine — the honest "enqueued — now what?" line after a Plan /
 * Start development / Start Run click (W7-A3: projects-16/17/32, flows-02/23).
 *
 * Every one of those buttons is a QUEUE WRITE; the scheduler daemon does the
 * running. The old success copy said "started" (and still named the retired
 * unifier) with a hardcoded flow-index link. This line derives its claim from
 * the real scheduler status (`describeEnqueueOutcome`), links the run the
 * enqueue just returned (`/flows/<flowId>/run/<cycleId>`), and — when the
 * daemon is stopped — puts the Start control right here.
 *
 * `EnqueueOutcomeLineView` is the pure half (render-pinned);
 * `EnqueueOutcomeLine` wires it to `useSchedulerStatus()` — the fetch only
 * happens once an enqueue actually succeeded and the line mounts.
 *
 * DOM contract:
 *   [data-component="enqueue-outcome"][data-enqueue-kind][data-needs-scheduler-start]
 *     a[data-action=<runAction>]  (when a run href is known)
 *     [data-component="scheduler-card"][data-scheduler-variant="strip"] (when a start is needed)
 */

import Link from 'next/link';

import { SchedulerCardView } from '@/components/SchedulerCard';
import { describeEnqueueOutcome, type SchedulerAction } from '@/lib/scheduler-view';
import { useSchedulerStatus } from '@/lib/use-scheduler-status';
import type { SchedulerStatus } from '@/lib/bridge-client';

export type EnqueueOutcomeLineViewProps = {
  kind: 'plan' | 'develop' | 'flow';
  cycleId?: string;
  flowId?: string;
  /** The `data-action` name on the run link (kept per surface for the journeys). */
  runAction: string;
  scheduler: SchedulerStatus | null;
  schedulerReady: boolean;
  busy?: boolean;
  error?: string | null;
  onSchedulerAction?: (action: SchedulerAction) => void;
};

export function EnqueueOutcomeLineView({
  kind,
  cycleId,
  flowId,
  runAction,
  scheduler,
  schedulerReady,
  busy = false,
  error = null,
  onSchedulerAction,
}: EnqueueOutcomeLineViewProps): JSX.Element {
  const outcome = schedulerReady
    ? describeEnqueueOutcome(kind, scheduler, { cycleId, flowId })
    : { claim: 'Enqueued — reading the scheduler…', needsSchedulerStart: false, runHref: describeEnqueueOutcome(kind, { running: true }, { cycleId, flowId }).runHref };
  return (
    <div
      data-component="enqueue-outcome"
      data-enqueue-kind={kind}
      data-needs-scheduler-start={outcome.needsSchedulerStart ? 'true' : 'false'}
      style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: outcome.needsSchedulerStart ? 'var(--ember)' : 'var(--green, #3fb950)', fontWeight: 600 }}>
          {outcome.claim}
        </span>
        {outcome.runHref && (
          <Link
            data-action={runAction}
            href={outcome.runHref}
            style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}
          >
            view run →
          </Link>
        )}
      </div>
      {outcome.needsSchedulerStart && (
        <SchedulerCardView
          status={scheduler}
          ready={schedulerReady}
          queuedCount={1}
          busy={busy}
          error={error}
          variant="strip"
          onAction={onSchedulerAction}
        />
      )}
    </div>
  );
}

export function EnqueueOutcomeLine(props: Omit<EnqueueOutcomeLineViewProps, 'scheduler' | 'schedulerReady' | 'busy' | 'error' | 'onSchedulerAction'>): JSX.Element {
  const { status, ready, busy, error, act } = useSchedulerStatus();
  return (
    <EnqueueOutcomeLineView
      {...props}
      scheduler={status}
      schedulerReady={ready}
      busy={busy}
      error={error}
      onSchedulerAction={(a) => void act(a)}
    />
  );
}
