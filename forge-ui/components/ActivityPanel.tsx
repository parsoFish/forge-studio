'use client';

import { useMemo, useState, type CSSProperties } from 'react';

import type { EventLogEntry } from '@/lib/bridge-client';
import { eventMatchesHex, type SelectedHex } from '@/lib/hex-detail';

// ---- public surface -----------------------------------------------------

export type ActivityPanelProps = {
  events: EventLogEntry[];
  /**
   * The panel is the SCOPED activity tracker for one selected hex (rendered
   * inside the HexDetailDrawer). Events are pre-filtered to that hex via
   * `eventMatchesHex`; the chip bar is absent — scope is fixed by the clicked
   * hex, not user-driven chips.
   */
  scopeHex: SelectedHex;
};

/**
 * Scoped activity tracker rendered inside the HexDetailDrawer.
 *
 * Events are pre-filtered to the selected hex (phase / feature / WI) via
 * `eventMatchesHex`. The operator can click any row to inspect its full
 * metadata in the detail pane below.
 */
export function ActivityPanel({ events: allEvents, scopeHex }: ActivityPanelProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Only the events that belong to the selected hex.
  const events = useMemo<EventLogEntry[]>(
    () => allEvents.filter((e) => eventMatchesHex(e, scopeHex)),
    [allEvents, scopeHex],
  );

  // Newest first, cap at 100.
  const visible = useMemo<readonly EventLogEntry[]>(() => {
    const sorted = [...events].sort((a, b) => {
      // started_at is ISO; lexicographic compare is correct for ISO 8601.
      if (a.started_at === b.started_at) return 0;
      return a.started_at < b.started_at ? 1 : -1;
    });
    return sorted.slice(0, 100);
  }, [events]);

  // Collapse consecutive rows with identical (phase, event_type, message) into a
  // single row with a ×N count (operator 2026-06-02: "most messages appear to be
  // duplicated"). Sampled tool_use / repeated gate.fail lines were the worst
  // offenders. The kept representative is the newest of the run (list is desc).
  const deduped = useMemo<readonly { event: EventLogEntry; count: number }[]>(() => {
    const out: { event: EventLogEntry; count: number }[] = [];
    const key = (e: EventLogEntry): string => `${e.phase}|${e.event_type}|${e.message ?? ''}`;
    for (const e of visible) {
      const last = out[out.length - 1];
      if (last && key(last.event) === key(e)) last.count += 1;
      else out.push({ event: e, count: 1 });
    }
    return out;
  }, [visible]);

  const selectedEvent = useMemo<EventLogEntry | null>(() => {
    if (!selectedEventId) return null;
    return events.find((e) => e.event_id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  return (
    <div
      style={wrapperStyle}
      data-component="activity-panel"
      data-events-shown={visible.length}
      data-events-total={events.length}
    >
      <div style={gridStyle}>
        <div style={listStyle} data-section="events-list">
          {deduped.length === 0 ? (
            <div style={{ color: '#8b949e', fontFamily: monoStack, fontSize: 12 }} data-events-empty="true">
              (no events for this hex)
            </div>
          ) : (
            deduped.map(({ event: e, count }) => (
              <EventRow
                key={e.event_id}
                event={e}
                count={count}
                selected={e.event_id === selectedEventId}
                onClick={() => setSelectedEventId(e.event_id)}
              />
            ))
          )}
        </div>

        <div style={detailStyle} data-section="event-detail" data-detail-event-id={selectedEvent?.event_id ?? ''}>
          {selectedEvent === null ? (
            <div style={{ color: '#8b949e', fontFamily: monoStack, fontSize: 12 }}>
              (click a row to inspect)
            </div>
          ) : (
            <EventDetail event={selectedEvent} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- subcomponents ------------------------------------------------------

function EventRow({
  event,
  count,
  selected,
  onClick,
}: {
  event: EventLogEntry;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-event-id={event.event_id}
      data-event-phase={event.phase}
      data-event-type={event.event_type}
      data-event-selected={selected ? 'true' : 'false'}
      data-event-count={count}
      style={{
        ...eventRowStyle,
        background: selected ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
        borderLeftColor: selected ? '#58a6ff' : 'transparent',
      }}
    >
      <span style={{ color: '#8b949e', minWidth: 64 }}>{shortTime(event.started_at)}</span>
      <span style={{ color: phaseColor(event.phase), minWidth: 110 }}>{event.phase}</span>
      <span style={{ color: '#c9d1d9', minWidth: 90 }}>{event.event_type}</span>
      <span style={{ color: '#e6edf3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {truncate(event.message ?? '', 80)}
      </span>
      {count > 1 && <span style={countBadgeStyle}>×{count}</span>}
      <span style={{ color: '#6e7681', marginLeft: 8 }}>{'>'}</span>
    </button>
  );
}

const countBadgeStyle: CSSProperties = {
  marginLeft: 6,
  padding: '0 6px',
  borderRadius: 8,
  background: '#21262d',
  border: '1px solid #30363d',
  color: '#8b949e',
  fontSize: 10,
};

function EventDetail({ event }: { event: EventLogEntry }) {
  const wi = readWorkItemId(event);
  const parent = readStringField(event.metadata, 'parent_event_id');
  const cost = readNumberField(event.metadata, 'cost_usd');
  // Surface high-value per-iteration agent state up-front (operator
  // feedback 2026-05-24: "hard to discern from a single log"). These
  // fields are emitted by orchestrator/phases/developer-loop.ts for
  // every dev-loop iteration; the rest of metadata still renders
  // below as raw JSON for completeness.
  const bashCommands = readStringArray(event.metadata, 'bash_commands');
  const toolsUsed = readStringArray(event.metadata, 'tools_used');
  const lastText = readStringField(event.metadata, 'last_assistant_text');
  const gateStderr = readStringField(event.metadata, 'gate_stderr_tail');
  const gateStdout = readStringField(event.metadata, 'gate_stdout_tail');
  const stopReason = readStringField(event.metadata, 'stop_reason');
  const iterations = readNumberField(event.metadata, 'iterations');
  const metaJson = JSON.stringify(event.metadata ?? {}, null, 2);
  return (
    <div style={{ fontFamily: monoStack, fontSize: 12, color: '#e6edf3' }}>
      <DetailField label="event_id" value={event.event_id} />
      <DetailField label="phase" value={event.phase} accent={phaseColor(event.phase)} />
      <DetailField label="skill" value={event.skill} />
      <DetailField label="event_type" value={event.event_type} />
      <DetailField label="started_at" value={event.started_at} />
      {event.cycle_id && <DetailField label="cycle_id" value={event.cycle_id} />}
      <DetailField label="initiative_id" value={event.initiative_id} />
      {wi && <DetailField label="work_item_id" value={wi} />}
      {parent && <DetailField label="parent_event_id" value={parent} />}
      {cost !== null && <DetailField label="cost_usd" value={`$${cost.toFixed(4)}`} />}
      {iterations !== null && <DetailField label="iterations" value={String(iterations)} />}
      {stopReason && <DetailField label="stop_reason" value={stopReason} accent="#f85149" />}
      {event.message && (
        <div style={{ marginTop: 8 }}>
          <div style={detailLabelStyle}>message</div>
          <pre style={preStyle}>{event.message}</pre>
        </div>
      )}
      {toolsUsed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={detailLabelStyle}>tools used ({toolsUsed.length})</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 0' }}>
            {toolsUsed.map((t, i) => (
              <span key={i} style={toolChipStyle}>{t}</span>
            ))}
          </div>
        </div>
      )}
      {bashCommands.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={detailLabelStyle}>bash commands ({bashCommands.length})</div>
          <pre style={{ ...preStyle, maxHeight: 200 }}>
            {bashCommands.map((c, i) => `${(i + 1).toString().padStart(2, ' ')}. ${c}`).join('\n')}
          </pre>
        </div>
      )}
      {lastText && (
        <div style={{ marginTop: 8 }}>
          <div style={detailLabelStyle}>agent's last assistant text (what it thought it was doing)</div>
          <pre style={{ ...preStyle, maxHeight: 280, color: '#a5d6ff' }}>{lastText}</pre>
        </div>
      )}
      {gateStdout && (
        <div style={{ marginTop: 8 }}>
          <div style={detailLabelStyle}>gate stdout (last)</div>
          <pre style={{ ...preStyle, maxHeight: 160 }}>{gateStdout}</pre>
        </div>
      )}
      {gateStderr && (
        <div style={{ marginTop: 8 }}>
          <div style={detailLabelStyle}>gate stderr (rejection reason)</div>
          <pre style={{ ...preStyle, maxHeight: 160, color: '#ffa198' }}>{gateStderr}</pre>
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary style={{ ...detailLabelStyle, cursor: 'pointer' }}>raw metadata (click to expand)</summary>
        <pre style={preStyle}>{metaJson}</pre>
      </details>
    </div>
  );
}

const toolChipStyle: React.CSSProperties = {
  background: '#21262d',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: '2px 8px',
  fontSize: 11,
  color: '#79c0ff',
};

function DetailField({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
      <span style={{ ...detailLabelStyle, minWidth: 110 }}>{label}</span>
      <span style={{ color: accent ?? '#e6edf3', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

// ---- helpers ------------------------------------------------------------

function readWorkItemId(e: EventLogEntry): string | null {
  return readStringField(e.metadata, 'work_item_id');
}

function readStringField(
  meta: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readNumberField(
  meta: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readStringArray(
  meta: Record<string, unknown> | undefined,
  key: string,
): string[] {
  if (!meta) return [];
  const v = meta[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function shortTime(iso: string | undefined): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 19);
}

// Mirrors phaseColor in app/page.tsx — duplicated locally so the
// component is self-contained (avoids cross-importing from a page file).
function phaseColor(phase: string): string {
  const map: Record<string, string> = {
    architect: '#a371f7',
    'project-manager': '#79c0ff',
    'developer-loop': '#7ee787',
    'review-loop': '#ffa657',
    closure: '#d2a8ff',
    reflection: '#ff7b72',
    orchestrator: '#8b949e',
  };
  return map[phase] ?? '#e6edf3';
}

// ---- styles -------------------------------------------------------------

const monoStack = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const wrapperStyle: CSSProperties = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 16,
  color: '#e6edf3',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  // Fill the overlay it's mounted in so the list + detail get real estate.
  width: '100%',
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
};

// VERTICAL stack: the panel lives only in the narrow hex-detail drawer,
// where a side-by-side list|detail split left the inspection blade far
// too thin to read. List on top, inspected row's detail BELOW at full
// drawer width.
const gridStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  flex: 1,
  minHeight: 0,
};

const listStyle: CSSProperties = {
  border: '1px solid #21262d',
  borderRadius: 6,
  padding: 6,
  // Cap the list to the top ~40% so the (full-width) detail below gets room;
  // the list scrolls within its cap.
  flex: '1 1 40%',
  minHeight: 80,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  fontFamily: monoStack,
  fontSize: 11,
};

const detailStyle: CSSProperties = {
  border: '1px solid #21262d',
  borderRadius: 6,
  padding: 10,
  flex: '1 1 60%',
  minHeight: 120,
  overflowY: 'auto',
  background: '#0c1115',
};

const eventRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  border: 'none',
  borderLeft: '2px solid transparent',
  borderRadius: 3,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: monoStack,
  fontSize: 11,
  color: '#e6edf3',
  width: '100%',
};

const detailLabelStyle: CSSProperties = {
  color: '#8b949e',
  fontSize: 10,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
};

const preStyle: CSSProperties = {
  margin: '4px 0 0',
  padding: 8,
  background: '#161b22',
  border: '1px solid #21262d',
  borderRadius: 4,
  color: '#c9d1d9',
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 320,
  overflowY: 'auto',
};
