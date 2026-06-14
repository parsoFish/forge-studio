'use client';

import { useEffect, useMemo, useRef } from 'react';

import type { EventLogEntry } from '@/lib/bridge-client';

// ---- public surface ---------------------------------------------------------

export type ArchitectActivityLogProps = {
  /**
   * Full event list from `useCycleEvents` for the architect session's cycle id.
   * The component filters to tool_use and kind:'reasoning' log events.
   */
  events: EventLogEntry[];
};

// ---- constants --------------------------------------------------------------

/** Maximum entries rendered (newest-last). */
const MAX_ENTRIES = 40;

// ---- helpers ----------------------------------------------------------------

/** Trim a tool input object down to a short readable summary string. */
function summariseInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  // Prefer the most informative single field.
  for (const key of ['pattern', 'file_path', 'glob', 'command', 'path', 'query']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) {
      const trimmed = v.trim();
      return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    }
  }
  // Fallback: JSON of first value.
  const first = Object.values(obj)[0];
  if (first !== undefined) {
    const s = JSON.stringify(first);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }
  return '';
}

/** One display row derived from an EventLogEntry. */
type ActivityRow = {
  key: string;
  kind: 'tool' | 'reasoning';
  label: string;
  detail: string;
};

function toRows(events: EventLogEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const ev of events) {
    if (ev.event_type === 'tool_use') {
      const tool = (ev.metadata?.tool as string | undefined) ?? ev.skill ?? '?';
      const inputSummary = summariseInput(ev.metadata?.input);
      rows.push({
        key: ev.event_id,
        kind: 'tool',
        label: tool,
        detail: inputSummary,
      });
    } else if (ev.event_type === 'log' && ev.metadata?.kind === 'reasoning') {
      rows.push({
        key: ev.event_id,
        kind: 'reasoning',
        label: 'reasoning',
        detail: ev.message ?? '',
      });
    }
  }
  // Newest-last: already chronological from useCycleEvents (append-only).
  // Cap to last MAX_ENTRIES.
  return rows.length > MAX_ENTRIES ? rows.slice(rows.length - MAX_ENTRIES) : rows;
}

// ---- component --------------------------------------------------------------

/**
 * P3 live activity panel for the architect session page. Renders a compact
 * auto-scrolling list of tool_use calls + agent reasoning text blocks streamed
 * from the session's event log. Mounted during working phases
 * (interviewing | drafting | finalizing).
 */
export function ArchitectActivityLog({ events }: ArchitectActivityLogProps): JSX.Element {
  const rows = useMemo(() => toRows(events), [events]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new rows arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows.length]);

  return (
    <div
      data-section="architect-activity"
      data-activity-count={rows.length}
      style={{
        border: '1px solid #30363d',
        borderRadius: 10,
        background: '#0d1117',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #21262d',
          fontSize: 11,
          color: '#6e7681',
          fontFamily: 'ui-monospace, Menlo, monospace',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        architect activity
      </div>
      <div
        style={{
          maxHeight: 280,
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: '10px 14px', fontSize: 12, color: '#6e7681' }}>
            Waiting for activity…
          </div>
        ) : (
          rows.map((row) => (
            <ActivityRow key={row.key} row={row} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ActivityRow({ row }: { row: ActivityRow }): JSX.Element {
  const isReasoning = row.kind === 'reasoning';
  return (
    <div
      data-activity-kind={row.kind}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '4px 14px',
        fontSize: 12,
        lineHeight: '1.5',
        borderLeft: isReasoning ? '2px solid #388bfd44' : '2px solid transparent',
      }}
    >
      {/* Kind chip */}
      <span
        style={{
          flex: '0 0 auto',
          fontSize: 10,
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: isReasoning ? '#388bfd' : '#3fb950',
          background: isReasoning ? '#0d1f4a' : '#071e0f',
          border: `1px solid ${isReasoning ? '#388bfd44' : '#3fb95044'}`,
          borderRadius: 4,
          padding: '1px 5px',
          minWidth: 56,
          textAlign: 'center',
        }}
      >
        {isReasoning ? 'reason' : row.label}
      </span>
      {/* Detail text */}
      <span
        style={{
          flex: 1,
          color: isReasoning ? '#8b949e' : '#e6edf3',
          fontFamily: isReasoning ? 'inherit' : 'ui-monospace, Menlo, monospace',
          fontSize: isReasoning ? 12 : 11,
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap',
        }}
      >
        {row.detail}
      </span>
    </div>
  );
}
