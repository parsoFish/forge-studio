'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { EventLogEntry } from '@/lib/bridge-client';
import { STATUS_COLOR } from '@/lib/status-colors';
import {
  toActivityRows,
  deriveLastActivityLine,
  formatActivityCostTicker,
  type ActivityRow,
} from '@/lib/activity-log-view';

// ---------------------------------------------------------------------------
// ActivityLog — the shared live thinking/working feed (W6-B7), generalized
// off `ArchitectActivityLog.tsx` (deleted once every consumer below adopted
// this) into the operator-locked shape from the round-3 session-surface
// decision: a FULL-WIDTH COLLAPSIBLE BOTTOM DRAWER, not the mock's
// (`mockups/session-surface-v1/session-live.html`) bottom-left inline panel
// — the mock's row *content* design (thinking italic+clamp, tool rows full,
// redacted literal, phase chip + cost ticker) is carried over verbatim; only
// the placement changed.
//
// Row derivation is entirely in `lib/activity-log-view.ts` (pure, unit
// tested) — this component only renders `ActivityRow[]` and owns the two
// pieces of UI-only state a pure function can't: which drawer/rows are
// expanded.
// ---------------------------------------------------------------------------

export type ActivityLogProps = {
  /** Header label — replaces the old hardcoded 'architect activity' text so
   *  every kind (architect / instructions / demo / a standalone agent run)
   *  can name itself. */
  label: string;
  /** Full event list from `useCycleEvents` for this activity's cycle id
   *  (same seam every consumer already used for `ArchitectActivityLog`). */
  events: EventLogEntry[];
  /** Optional phase chip text (e.g. 'interviewing', 'drafting', 'running') —
   *  omitted renders no chip. */
  phaseLabel?: string;
  /** Pulses the phase chip's glow — true while the phase is a working state,
   *  false for a terminal/needs-you state. Ignored when `phaseLabel` is
   *  absent. */
  phaseActive?: boolean;
  /** Cost/token/wall-time ticker inputs — each optional and rendered only
   *  when the caller has a REAL wired value (see
   *  `formatActivityCostTicker`'s doc comment); never fabricated. */
  costUsd?: number;
  tokensTotal?: number;
  elapsedMs?: number;
  /** Initial drawer state. Defaults to open — every current call site only
   *  mounts this component during an actively-working phase, so starting
   *  open matches "the operator just asked for this and wants to watch it
   *  work." Uncontrolled thereafter (the operator's own toggle owns it) —
   *  no consumer today needs to force it open/closed from outside. */
  defaultOpen?: boolean;
};

export function ActivityLog({
  label,
  events,
  phaseLabel,
  phaseActive,
  costUsd,
  tokensTotal,
  elapsedMs,
  defaultOpen = true,
}: ActivityLogProps): JSX.Element {
  const rows = useMemo(() => toActivityRows(events), [events]);
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const clampableKeys = useMemo(() => rows.filter((r) => r.clamp !== null).map((r) => r.key), [rows]);
  const anyCollapsed = clampableKeys.some((k) => !expanded[k]);

  // Auto-scroll to the newest row while the drawer is open.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows.length, open]);

  function toggleRow(key: string): void {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAll(): void {
    const next = anyCollapsed; // any row still collapsed → expand every clampable row; else collapse all
    setExpanded(Object.fromEntries(clampableKeys.map((k) => [k, next])));
  }

  const ticker = formatActivityCostTicker({ costUsd, tokensTotal, elapsedMs });

  // The drawer is position:fixed at the page bottom. Without reserving space
  // it OVERLAYS whatever sits at the bottom of the page — the wave-6 final
  // journey gate found the agent builder's Save button unclickable ("Waiting
  // for activity…" intercepted pointer events, agents.mjs:848). Reserve its
  // rendered height on document.body while mounted (and re-measure on open /
  // row-count change) so page content scrolls above it, never under it.
  const drawerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = drawerRef.current;
    if (!el || typeof document === 'undefined') return;
    const prev = document.body.style.paddingBottom;
    const apply = () => { document.body.style.paddingBottom = `${el.getBoundingClientRect().height}px`; };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); document.body.style.paddingBottom = prev; };
  }, [open, rows.length]);

  return (
    <div
      ref={drawerRef}
      data-component="activity-drawer"
      data-drawer-open={open ? 'true' : 'false'}
      data-activity-count={rows.length}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        borderTop: '1px solid var(--line, #28324a)',
        background: '#0d1117',
        boxShadow: '0 -8px 24px rgba(0,0,0,.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 16px',
          borderBottom: open ? '1px solid #21262d' : 'none',
          background: 'var(--panel, #141a26)',
        }}
      >
        {phaseLabel && <PhaseChip label={phaseLabel} active={!!phaseActive} />}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--faint, #5b6779)',
            fontFamily: 'ui-monospace, Menlo, monospace',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>

        {!open && (
          <span
            data-component="activity-last-line"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              color: 'var(--dim, #93a0b4)',
            }}
          >
            {deriveLastActivityLine(rows)}
          </span>
        )}

        <span style={{ flex: open ? 1 : 0 }} />

        {ticker && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: 'var(--faint, #5b6779)',
              whiteSpace: 'nowrap',
            }}
          >
            {ticker}
          </span>
        )}

        {open && clampableKeys.length > 0 && (
          <button
            type="button"
            data-action="expand-all-thinking"
            onClick={toggleAll}
            style={{
              background: 'none',
              border: 0,
              color: 'var(--steel, #5cc8ff)',
              fontSize: 10.5,
              fontFamily: 'ui-monospace, Menlo, monospace',
              cursor: 'pointer',
              padding: '2px 4px',
              whiteSpace: 'nowrap',
            }}
          >
            {anyCollapsed ? 'expand all' : 'collapse all'}
          </button>
        )}

        <button
          type="button"
          data-action="toggle-activity-drawer"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: 'none',
            border: '1px solid var(--line-2, #39455f)',
            borderRadius: 4,
            color: 'var(--dim, #93a0b4)',
            fontSize: 10.5,
            fontFamily: 'ui-monospace, Menlo, monospace',
            cursor: 'pointer',
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {open ? 'collapse' : 'expand'}
        </button>
      </div>

      {open && (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '6px 0' }}>
          {rows.length === 0 ? (
            <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--faint, #5b6779)' }}>
              Waiting for activity…
            </div>
          ) : (
            rows.map((row) => (
              <ActivityRowView key={row.key} row={row} expanded={!!expanded[row.key]} onToggle={() => toggleRow(row.key)} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function PhaseChip({ label, active }: { label: string; active: boolean }): JSX.Element {
  return (
    <span
      data-component="activity-phase-chip"
      data-phase-active={active ? 'true' : 'false'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--panel-3, #202a3c)',
        border: `1px solid ${active ? STATUS_COLOR.active : 'var(--line-2, #39455f)'}`,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'ui-monospace, Menlo, monospace',
        color: active ? STATUS_COLOR.active : 'var(--dim, #93a0b4)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? STATUS_COLOR.active : 'var(--faint, #5b6779)',
        }}
      />
      {label}
    </span>
  );
}

const TAG_COLOR: Record<ActivityRow['kind'], string> = {
  tool: STATUS_COLOR.complete,
  'tool-coalesced': STATUS_COLOR.attention,
  thinking: STATUS_COLOR.active,
  'thinking-redacted': 'var(--faint, #5b6779)',
  reasoning: STATUS_COLOR.active,
  capped: 'var(--faint, #5b6779)',
  // W7-B2 (knowledge-01): a job's own per-transition progress line.
  progress: STATUS_COLOR.active,
};

/** thinking / reasoning / redacted / capped rows all read as the agent's own
 *  narration rather than a mechanical tool call, so they share the italic
 *  treatment — including the redacted marker (the mock's own
 *  `.frow.redact .d` is italic too; "literal" describes the TEXT — rendered
 *  verbatim, never summarised — not the styling). */
const ITALIC_KINDS = new Set<ActivityRow['kind']>(['thinking', 'thinking-redacted', 'reasoning', 'capped']);

function ActivityRowView({
  row,
  expanded,
  onToggle,
}: {
  row: ActivityRow;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const isTool = row.kind === 'tool' || row.kind === 'tool-coalesced';
  return (
    <div
      data-activity-kind={row.kind}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 9,
        padding: '4px 16px',
        fontSize: 12,
        lineHeight: 1.55,
        borderLeft: ITALIC_KINDS.has(row.kind) ? '2px solid #388bfd44' : '2px solid transparent',
      }}
    >
      <span
        style={{
          flex: '0 0 auto',
          fontSize: 10,
          fontWeight: 600,
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: TAG_COLOR[row.kind],
          border: `1px solid ${TAG_COLOR[row.kind]}44`,
          borderRadius: 4,
          padding: '0 6px',
          minWidth: 58,
          textAlign: 'center',
        }}
      >
        {row.tag}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          fontStyle: ITALIC_KINDS.has(row.kind) ? 'italic' : 'normal',
          fontFamily: isTool ? 'ui-monospace, Menlo, monospace' : 'inherit',
          color: row.kind === 'thinking-redacted' || row.kind === 'capped' ? 'var(--faint, #5b6779)' : 'var(--text, #e6edf3)',
        }}
      >
        {row.clamp ? (expanded ? row.text : row.clamp.shown) : row.text}
        {row.clamp && (
          <button
            type="button"
            data-action="expand-activity-row"
            data-activity-expanded={expanded ? 'true' : 'false'}
            onClick={onToggle}
            style={{
              background: 'none',
              border: 0,
              color: 'var(--steel, #5cc8ff)',
              fontSize: 10.5,
              fontStyle: 'normal',
              fontFamily: 'ui-monospace, Menlo, monospace',
              cursor: 'pointer',
              padding: '0 0 0 4px',
            }}
          >
            {expanded ? 'collapse' : `+${row.clamp.restChars} chars`}
          </button>
        )}
      </span>
    </div>
  );
}
