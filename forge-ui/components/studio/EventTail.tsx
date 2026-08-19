'use client';

import { useEffect, useRef } from 'react';
import type { EventLogEntry } from '@/lib/bridge-client';
import type { Run } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// EventTail — live event log for the active run.
//
// The parent page feeds events (from WS subscribe filtered to the active
// run's cycleId) as props. This component renders them newest-last, auto-
// scrolls to the bottom, and caps at 100 entries.
// ---------------------------------------------------------------------------

interface EventTailProps {
  events: EventLogEntry[];
  activeRunId: string | null;
  /**
   * W7-A3 (flows-30): the selected run's status — the empty-state copy says
   * "finished"/"failed"/"queued" instead of "Waiting for events…" forever on
   * a run that ended weeks ago. Optional; absent ⇒ the pre-existing copy.
   */
  runStatus?: Run['status'] | null;
}

// W7-A3 (flows-30): the empty-state is keyed on the run's STATUS, not merely on
// whether a run is selected — a finished run is not "waiting for events".
export type TailState = 'none' | 'live' | 'finished' | 'failed' | 'queued';

export function deriveTailState(activeRunId: string | null, runStatus: Run['status'] | null | undefined): TailState {
  if (!activeRunId) return 'none';
  if (runStatus === 'complete') return 'finished';
  if (runStatus === 'failed') return 'failed';
  if (runStatus === 'planned') return 'queued';
  return 'live';
}

const EMPTY_COPY: Record<TailState, string> = {
  none: 'No active run selected.',
  live: 'Waiting for events…',
  finished: 'This run finished — open a phase hex for its logs.',
  failed: 'This run failed — open a phase hex for its logs.',
  queued: 'Queued — no events until the scheduler claims it.',
};

export function EventTail({ events, activeRunId, runStatus }: EventTailProps) {
  const tailState = deriveTailState(activeRunId, runStatus);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  const dotStatus: string = activeRunId
    ? events.length > 0
      ? 'active'
      : 'pending'
    : 'pending';

  return (
    <div
      data-component="event-tail"
      data-tail-state={tailState}
      style={{
        height: 160,
        flexShrink: 0,
        borderTop: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--panel)',
        borderRadius: 0,
        border: '1px solid var(--line)',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: 'none',
      }}
    >
      {/* Header */}
      <div className="panel-head">
        <span className="status-dot" data-status={dotStatus} />
        <span>Live Events</span>
        <span style={{ flex: 1 }} />
        {activeRunId && (
          <span
            data-tail-count={events.length}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--faint)',
            }}
          >
            {activeRunId} · {events.length} events
          </span>
        )}
      </div>

      {/* Log rows */}
      <div
        ref={logRef}
        data-tail-count={events.length}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 14px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--dim)',
          lineHeight: 1.7,
        }}
      >
        {events.length === 0 ? (
          <div style={{ color: 'var(--faint)', fontStyle: 'italic', fontSize: 11 }}>
            {EMPTY_COPY[tailState]}
          </div>
        ) : (
          events.slice(-100).map((evt, i) => (
            <EventRow key={`${evt.event_id}-${i}`} event={evt} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventRow — one log line
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: EventLogEntry }) {
  const ts = new Date(event.started_at).toTimeString().slice(0, 8);
  const msg = event.message ?? event.event_type;

  let cls = '';
  if (event.event_type === 'end' || event.message?.includes('complete')) cls = 'ok';
  else if (event.event_type === 'error' || event.message?.includes('fail')) cls = 'warn';
  else if (event.event_type === 'phase_transition') cls = 'highlight';

  const colorMap: Record<string, string> = {
    ok:        'var(--green)',
    warn:      'var(--amber)',
    highlight: 'var(--text)',
    '':        'var(--dim)',
  };

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: 'var(--faint)', flexShrink: 0 }}>{ts}</span>
      <span style={{ color: colorMap[cls] ?? 'var(--dim)' }}>
        {event.phase && `[${event.phase}] `}{msg}
      </span>
    </div>
  );
}
