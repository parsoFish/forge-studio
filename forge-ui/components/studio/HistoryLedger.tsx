/**
 * HistoryLedger — the SHARED, purely presentational run-history ledger
 * (R6-05 Task 4). Renders whatever `LedgerRow[]` it is given
 * (`../../lib/history-ledger.ts` / `../../lib/flow-ledger.ts`'s
 * `deriveFlowLedgerRows` is the FIRST caller, from the flow monitor's own
 * `app/flows/[id]/page.tsx`) — it derives NOTHING itself.
 *
 * SURFACE-AGNOSTIC ON PURPOSE (D2, the R6-06 reuse seam): this component
 * contains NOTHING flow-specific — no flow ids, no route construction. A
 * row's `href` arrives already-built on the row and is rendered verbatim,
 * exactly like `FlowRunDetail.tsx`'s own established "renders whatever it
 * is given" discipline for props it does not own the derivation of. R6-06
 * (agent monitor) reuses this component unchanged with a different `href`
 * shape (`/agents/...` rather than `/flows/.../run/...`).
 *
 * Embedded as a page-level SECTION (not a route), matching the existing
 * `<section data-section="run-timeline">` / `<section
 * data-section="run-trigger">` convention already shipped in
 * `FlowRunDetail.tsx` — see `../../lib/history-ledger-render.test.ts` for
 * the full pinned DOM contract this component satisfies.
 *
 * DOM-as-metrics contract:
 *   <section data-section="history-ledger" data-ledger-count={n}>
 *     (n===0) -> <div data-component="history-ledger-empty">           honest-empty (never a fabricated row)
 *     (n>0)   -> one <a data-ledger-row="true" data-run-id data-run-status
 *                    data-run-when data-ledger-cost-usd href={row.href}>
 *                  per row, in the ARRAY ORDER GIVEN (sorting is the
 *                  caller's job, `sortLedgerRowsNewestFirst` — this
 *                  component trusts its input order)
 *                [data-ledger-narrative]   ONLY when row.narrative !== null
 *                [data-narrative-kinds]    ONLY when row.narrativeKinds is
 *                                           non-empty — `row.narrativeKinds.
 *                                           join(',')` verbatim, in array
 *                                           order, NEVER re-derived by
 *                                           parsing `row.narrative`'s human
 *                                           string (D11 — the two surfaces
 *                                           agree only because both come
 *                                           from the same row).
 *
 * `data-ledger-cost-usd` is bare `.toFixed(2)` (no `$`) — deliberately NOT
 * `data-run-cost-usd`, which `MonitorSummary.tsx:107` already emits at
 * `.toFixed(4)` precision on the page-level summary strip; reusing that
 * name here would make one attribute mean two different precisions across
 * two different elements. The `$`-prefixed form is display text only.
 * R6-06: `row.costUsd` can be `null` (a cost that genuinely does not exist
 * yet — e.g. a session with no log dir) — BOTH the attribute and the
 * display text are then omitted entirely, never a fabricated `"0.00"`/
 * `"$0.00"` standing in for an absent fact.
 *
 * The row is a REAL `<a href>` (amendment 29) — not a `<div>` with an
 * `onClick` bolted on, which is invisible to keyboard nav, screen readers,
 * and cmd-click/open-in-new-tab, and which the render tests below
 * explicitly assert the tag name to catch (attribute-only assertions
 * cannot distinguish `<a>` from `<div>`). (W6-IA-6: rendered via `next/link`'s
 * `Link` for same-tab client-side routing instead of a full page reload —
 * `Link` still renders a real `<a>`, so amendment 29's tag-name contract is
 * unchanged.)
 *
 * `data-run-when` carries the raw ISO `row.when` verbatim (D7); the
 * human-readable relative text is rendered separately via
 * `formatWhen(row.when, nowMs)` from the REQUIRED `nowMs` prop — never
 * `Date.now()` read inside this component.
 *
 * R6-06 D8 — TWO new CONDITIONAL attributes, mirroring `data-ledger-narrative`/
 * `data-narrative-kinds`'s own "only when present" discipline exactly, so
 * every EXISTING (pre-R6-06) flow-ledger row renders BYTE-IDENTICALLY:
 *   [data-ledger-link-kind]                 ONLY when row.linkKind !== undefined
 *   [data-trigger-kind/source/scope]        ONLY when row.trigger !== undefined
 *                                             (all three together — an
 *                                             unscoped trigger still renders
 *                                             `data-trigger-scope=""`, never
 *                                             omitted, never "null")
 * The trigger attribute NAMES mirror `FlowRunDetail.tsx`'s already-shipped
 * `data-trigger-kind`/`data-trigger-source`/`data-trigger-scope` vocabulary
 * verbatim — reused here on the ROW element instead of a page-level section.
 */

import Link from 'next/link';
import { formatWhen, ledgerRowKind } from '@/lib/history-ledger';
import type { LedgerRow } from '@/lib/history-ledger';

export type HistoryLedgerProps = {
  rows: LedgerRow[];
  /** Explicit "now", threaded through to `formatWhen` (D7) — never read via
   *  `Date.now()` inside this component. */
  nowMs: number;
  /**
   * W6-IA-4 — OPTIONAL, default false/omitted: renders a `data-ledger-kind`
   * attribute + a small visible "flow"/"agent" badge per row, derived via
   * `ledgerRowKind(row)`. Only Home's merged everything-ledger opts in
   * (`showKindChip`) — every OTHER existing caller (the flow monitor's own
   * ledger, the agents index's recent-runs section, an agent's own ledger)
   * renders BYTE-IDENTICALLY to before this prop existed, matching this
   * component's own established byte-identical-when-absent discipline
   * (R6-06 D8's `linkKind`/`trigger` attributes, same file).
   */
  showKindChip?: boolean;
};

export function HistoryLedger({ rows, nowMs, showKindChip }: HistoryLedgerProps) {
  return (
    <section
      data-section="history-ledger"
      data-ledger-count={rows.length}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 20px',
        flexShrink: 0,
        maxHeight: 220,
        overflowY: 'auto',
        borderTop: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <h3 style={{ margin: '0 0 4px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--faint)' }}>
        History
      </h3>
      {rows.length === 0 ? (
        <div data-component="history-ledger-empty" className="muted" style={{ fontStyle: 'italic', fontSize: 12 }}>
          No runs yet.
        </div>
      ) : (
        rows.map((row) => (
          <Link
            key={row.id}
            data-ledger-row="true"
            data-run-id={row.id}
            data-run-status={row.status}
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
    </section>
  );
}
