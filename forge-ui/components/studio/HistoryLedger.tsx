'use client';

/**
 * HistoryLedger — the SHARED, purely presentational run-history ledger
 * (R6-05 Task 4). Renders whatever `LedgerRow[]` it is given
 * (`../../lib/history-ledger.ts` / `../../lib/flow-ledger.ts`'s
 * `deriveFlowLedgerRows` is the FIRST caller, from the flow monitor's own
 * `app/flows/[id]/page.tsx`) — it derives NOTHING itself.
 *
 * SURFACE-AGNOSTIC ON PURPOSE (D2, the R6-06 reuse seam): this component
 * contains NOTHING flow-specific — no flow ids, no route construction. A
 * row's `href` arrives already-built on the row and is rendered verbatim.
 *
 * DOM-as-metrics contract:
 *   <section data-section="history-ledger" data-ledger-count={n}>
 *     (n===0) -> <div data-component="history-ledger-empty">           honest-empty (never a fabricated row)
 *     (n>0)   -> one <a data-ledger-row="true" data-run-id data-run-status
 *                    data-run-when data-ledger-cost-usd href={row.href}>
 *                  per row, in the ARRAY ORDER GIVEN (sorting is the
 *                  caller's job, `sortLedgerRowsNewestFirst`)
 *                [data-ledger-narrative]   ONLY when row.narrative !== null
 *                [data-narrative-kinds]    ONLY when row.narrativeKinds is
 *                                           non-empty — join(',') verbatim
 *                [data-ledger-link-kind]   ONLY when row.linkKind !== undefined
 *                [data-trigger-*]          ONLY when row.trigger !== undefined
 *                [data-ledger-agent]       ONLY when row.agent !== undefined
 *                                           (W7-B5 agents-04 — the chip is
 *                                           also visible text)
 *
 * `data-ledger-cost-usd` is bare `.toFixed(2)` (no `$`). `row.costUsd:
 * null` omits BOTH the attribute and the display text — never a fabricated
 * `"0.00"` standing in for an absent fact.
 *
 * The row is a REAL `<a href>` via `next/link` (amendment 29 / W6-IA-6).
 *
 * `data-run-when` carries the raw ISO `row.when` verbatim (D7); the
 * human-readable relative text renders via `formatWhen(row.when, nowMs)`
 * from the REQUIRED `nowMs` prop — never `Date.now()` inside.
 *
 * W7-B5 (agents-32 / agents-04) — THREE new OPTIONAL props, each following
 * the established byte-identical-when-absent discipline (`showKindChip`,
 * R6-06 D8):
 *   - `pageSize`   — renders only the first N rows plus a
 *                    `[data-action="ledger-show-more"]` control; the section
 *                    gains `data-ledger-shown`. Replaces the old
 *                    fixed-220px-scroller answer to a 77-row history: when
 *                    set, the scroller is dropped (paging bounds the DOM
 *                    instead). Absent → the legacy maxHeight scroller,
 *                    byte-identical.
 *   - `filterable` — renders a `[data-ledger-filter]` status `<select>`
 *                    whose options are the DISTINCT statuses actually
 *                    present in `rows` (each vocabulary shown verbatim —
 *                    D12: never mapped onto an invented shared vocabulary).
 *   - (row-level)  — `row.agent` renders a leading agent chip.
 */

import { useState } from 'react';
import Link from 'next/link';
import { formatWhen, ledgerRowKind, sessionPhaseRunStatus } from '@/lib/history-ledger';
import type { LedgerRow } from '@/lib/history-ledger';

export type HistoryLedgerProps = {
  rows: LedgerRow[];
  /** Explicit "now", threaded through to `formatWhen` (D7) — never read via
   *  `Date.now()` inside this component. */
  nowMs: number;
  /**
   * W6-IA-4 — OPTIONAL, default false/omitted: renders a `data-ledger-kind`
   * attribute + a small visible "flow"/"agent" badge per row, derived via
   * `ledgerRowKind(row)`. Only Home's merged everything-ledger opts in.
   */
  showKindChip?: boolean;
  /** W7-B5 (agents-32): page the rows instead of cramming them into the
   *  legacy 220px scroller. Absent → byte-identical legacy rendering. */
  pageSize?: number;
  /** W7-B5 (agents-32): render the status filter row. Absent → no filter
   *  UI, byte-identical legacy rendering. */
  filterable?: boolean;
};

export function HistoryLedger({ rows, nowMs, showKindChip, pageSize, filterable }: HistoryLedgerProps) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [shownPages, setShownPages] = useState(1);

  const filtered = filterable && statusFilter !== ''
    ? rows.filter((r) => String(r.status) === statusFilter)
    : rows;
  const paged = pageSize !== undefined ? filtered.slice(0, pageSize * shownPages) : filtered;
  const hasMore = pageSize !== undefined && paged.length < filtered.length;
  const distinctStatuses = filterable ? [...new Set(rows.map((r) => String(r.status)))] : [];

  return (
    <section
      data-section="history-ledger"
      data-ledger-count={filtered.length}
      {...(pageSize !== undefined ? { 'data-ledger-shown': paged.length } : {})}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 20px',
        flexShrink: 0,
        // W7-B5 (agents-32): paging bounds the DOM; the legacy fixed-height
        // scroller only applies when no pageSize is given.
        ...(pageSize === undefined ? { maxHeight: 220, overflowY: 'auto' as const } : {}),
        borderTop: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <h3 style={{ margin: '0 0 4px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--faint)' }}>
        History
      </h3>
      {filterable && rows.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>
          Status
          <select
            className="input"
            data-ledger-filter
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setShownPages(1); }}
            style={{ fontSize: 11, padding: '2px 6px', width: 'auto' }}
          >
            <option value="">all ({rows.length})</option>
            {distinctStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {filtered.length === 0 ? (
        <div data-component="history-ledger-empty" className="muted" style={{ fontStyle: 'italic', fontSize: 12 }}>
          {rows.length === 0 ? 'No runs yet.' : 'No runs match this filter.'}
        </div>
      ) : (
        paged.map((row) => (
          <Link
            key={row.id}
            data-ledger-row="true"
            data-run-id={row.id}
            // W7-B1 (home-sessions-33): a SESSION row's `status` is its own
            // raw status.json phase (an open per-runner vocabulary, D12) —
            // that raw phase now rides its own data-session-phase, and the
            // CLOSED data-run-status contract carries the mapped run-vocab
            // value (`sessionPhaseRunStatus`). Every other row kind renders
            // its status verbatim, byte-identical to before.
            data-run-status={row.linkKind === 'session' ? sessionPhaseRunStatus(row.status) : row.status}
            {...(row.linkKind === 'session' ? { 'data-session-phase': row.status } : {})}
            data-run-when={row.when}
            {...(row.costUsd !== null ? { 'data-ledger-cost-usd': row.costUsd.toFixed(2) } : {})}
            {...(row.narrative !== null ? { 'data-ledger-narrative': row.narrative } : {})}
            {...(row.narrativeKinds.length > 0 ? { 'data-narrative-kinds': row.narrativeKinds.join(',') } : {})}
            {...(row.linkKind !== undefined ? { 'data-ledger-link-kind': row.linkKind } : {})}
            {...(row.trigger !== undefined ? {
              'data-trigger-kind': row.trigger.kind,
              'data-trigger-source': row.trigger.source,
              'data-trigger-scope': row.trigger.scope ?? '',
            } : {})}
            {...(showKindChip ? { 'data-ledger-kind': ledgerRowKind(row) } : {})}
            {...(row.agent !== undefined ? { 'data-ledger-agent': row.agent } : {})}
            href={row.href}
            title={`${row.what} — ${formatWhen(row.when, nowMs)}`}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              color: 'inherit',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--faint)', flexShrink: 0, width: 64 }}>{formatWhen(row.when, nowMs)}</span>
            {showKindChip && (
              <span
                data-ledger-kind-badge
                style={{
                  flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 9.5, textTransform: 'uppercase',
                  letterSpacing: '0.04em', color: 'var(--faint)', border: '1px solid var(--line-2)',
                  borderRadius: 999, padding: '1px 6px',
                }}
              >
                {ledgerRowKind(row)}
              </span>
            )}
            {row.agent !== undefined && (
              <span
                data-ledger-agent-badge
                style={{
                  flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 9.5,
                  color: 'var(--dim)', border: '1px solid var(--line-2)',
                  borderRadius: 999, padding: '1px 6px', maxWidth: 220,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {row.agent}
              </span>
            )}
            <span style={{ flexShrink: 0, fontWeight: 600 }}>{row.what}</span>
            <span data-run-status-badge style={{ color: 'var(--dim)', flexShrink: 0, textTransform: 'uppercase', fontSize: 10 }}>
              {row.status}
            </span>
            {row.narrative !== null && (
              <span style={{ color: 'var(--dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.narrative}
              </span>
            )}
            {row.costUsd !== null && (
              <span style={{ color: 'var(--ember)', flexShrink: 0, marginLeft: 'auto' }}>${row.costUsd.toFixed(2)}</span>
            )}
          </Link>
        ))
      )}
      {hasMore && (
        <button
          type="button"
          className="btn btn-sm"
          data-action="ledger-show-more"
          onClick={() => setShownPages((n) => n + 1)}
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
        >
          Show more ({filtered.length - paged.length} more)
        </button>
      )}
    </section>
  );
}
