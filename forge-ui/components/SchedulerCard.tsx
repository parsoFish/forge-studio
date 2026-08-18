'use client';

/**
 * SchedulerCard — the scheduler daemon as a Studio object (W7-A3, flows-01 /
 * flows-23 / projects-16; ADR-031 wave-7 amendment).
 *
 * Every "start" control in Studio is a queue write; `forge serve` is the only
 * thing that executes it. Until wave 7 the daemon had no operator surface at
 * all (M7 deleted the dashboard's scheduler banner with the dashboard) — a
 * queued initiative could never be started from the UI, and every enqueue
 * success line read as "started". This card shows the daemon's real state
 * (running / paused / stopped / unknown) and offers exactly the actions that
 * state admits — derived by `lib/scheduler-view.ts`, never a fixed button row.
 *
 * `SchedulerCardView` is the pure presentational half (render-pinned by
 * lib/scheduler-card-render.test.ts); `SchedulerCard` wires it to
 * `useSchedulerStatus()`. Mounted on Home, /flows (index + monitor), and
 * inline wherever an enqueue outcome needs "start it?" (ArchitectCommittedView,
 * InitiativeDetail, the flow kickoff).
 *
 * DOM contract:
 *   [data-component="scheduler-card"][data-scheduler-status="running|paused|stopped|unknown"]
 *     [data-scheduler-variant="card|strip"][data-scheduler-ready][data-scheduler-queued]
 *     [data-scheduler-pid]  (running only)   [data-scheduler-busy="true"] (while acting)
 *   button[data-action="scheduler-start|scheduler-pause|scheduler-resume|scheduler-stop"]
 *   [data-scheduler-error]  (last action error, verbatim)
 */

import { deriveSchedulerView, type SchedulerAction } from '@/lib/scheduler-view';
import { useSchedulerStatus } from '@/lib/use-scheduler-status';
import type { SchedulerStatus } from '@/lib/bridge-client';

const ACTION_LABEL: Record<SchedulerAction, string> = {
  start: 'Start',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
};

const STATE_COLOR: Record<'running' | 'paused' | 'stopped' | 'unknown', string> = {
  running: 'var(--green)',
  paused: 'var(--amber)',
  stopped: 'var(--ember)',
  unknown: 'var(--faint)',
};

export type SchedulerCardViewProps = {
  status: SchedulerStatus | null;
  ready: boolean;
  queuedCount?: number;
  busy?: boolean;
  error?: string | null;
  variant?: 'card' | 'strip';
  title?: string;
  onAction?: (action: SchedulerAction) => void;
};

export function SchedulerCardView({
  status,
  ready,
  queuedCount = 0,
  busy = false,
  error = null,
  variant = 'card',
  title = 'Scheduler',
  onAction,
}: SchedulerCardViewProps): JSX.Element {
  const view = ready ? deriveSchedulerView(status, { queuedCount }) : null;
  const state = view?.state ?? 'unknown';
  const strip = variant === 'strip';

  return (
    <section
      data-component="scheduler-card"
      data-scheduler-status={state}
      data-scheduler-variant={variant}
      data-scheduler-ready={ready ? 'true' : 'false'}
      data-scheduler-queued={queuedCount}
      {...(state === 'running' && status?.pid ? { 'data-scheduler-pid': status.pid } : {})}
      {...(busy ? { 'data-scheduler-busy': 'true' } : {})}
      aria-label="Scheduler"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: strip ? 10 : 14,
        flexWrap: 'wrap',
        padding: strip ? '8px 12px' : '12px 16px',
        background: 'var(--panel)',
        border: `1px solid ${state === 'stopped' ? 'rgba(255,158,74,.45)' : 'var(--line)'}`,
        borderRadius: 'var(--radius)',
        fontSize: strip ? 12 : 13,
      }}
    >
      <span
        className="status-dot"
        data-status={state === 'running' ? 'active' : state === 'paused' ? 'retrying' : state === 'stopped' ? 'failed' : 'pending'}
        aria-hidden
      />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {!strip && (
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text)' }}>{title}</span>
          )}
          <span style={{ fontWeight: 600, color: STATE_COLOR[state] }}>
            {view ? view.label : 'Reading scheduler status…'}
          </span>
          {state === 'running' && status?.pid ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>pid {status.pid}</span>
          ) : null}
        </span>
        {view && <span style={{ color: 'var(--dim)', fontSize: strip ? 11.5 : 12.5 }}>{view.hint}</span>}
        {error && (
          <span data-scheduler-error style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>
        )}
      </span>
      {view && view.actions.length > 0 && (
        <span style={{ display: 'flex', gap: 6 }}>
          {view.actions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'start' || action === 'resume' ? 'btn btn-primary' : 'btn'}
              data-action={`scheduler-${action}`}
              disabled={busy}
              onClick={() => onAction?.(action)}
              style={{ fontSize: strip ? 11.5 : 12.5, padding: strip ? '3px 10px' : undefined }}
            >
              {busy ? `${ACTION_LABEL[action]}…` : ACTION_LABEL[action]}
            </button>
          ))}
        </span>
      )}
    </section>
  );
}

export function SchedulerCard({
  variant = 'card',
  queuedCount,
  title,
}: {
  variant?: 'card' | 'strip';
  queuedCount?: number;
  title?: string;
}): JSX.Element {
  const { status, ready, busy, error, act } = useSchedulerStatus();
  return (
    <SchedulerCardView
      status={status}
      ready={ready}
      busy={busy}
      error={error}
      variant={variant}
      queuedCount={queuedCount}
      title={title}
      onAction={(a) => void act(a)}
    />
  );
}
