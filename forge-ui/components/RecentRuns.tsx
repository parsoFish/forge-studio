/**
 * RecentRuns — the SHARED, agent-agnostic "recent runs" section (W7-B2,
 * knowledge-20), extracted from `AgentsIndexView.tsx`'s recent-agent-runs
 * section so the KB health tab (and B5's agent surfaces) render the SAME
 * widget over any `LedgerRow[]` source instead of each page hand-rolling the
 * loading / honest-empty / unresolved-notice / ledger stack.
 *
 * Purely presentational: rows arrive already derived and sorted (the
 * caller's job — `lib/agents-index.ts` for agents, `lib/kb-runs.ts` for a
 * KB); `nowMs` is threaded to `HistoryLedger` (D7 — never `Date.now()` read
 * here). The `section` prop preserves each surface's established
 * `data-section` contract (`recent-agent-runs` on /agents;
 * `kb-recent-runs` on /knowledge) rather than forcing one shared token and
 * silently breaking the agents journey.
 *
 * W7-B5 (agents-40) folded its own additions INTO this shared component
 * rather than forking it back apart: the section publishes `data-count` and,
 * when the caller fetched a bounded window, `data-limit` + an optional
 * `[data-action="recent-runs-show-all"]` control. A capped list that says
 * neither how many rows it holds nor what bound produced them is a lie of
 * omission on any surface, so both consumers get the honesty.
 */

import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { UnresolvedHistoriesNotice } from '@/components/studio/UnresolvedHistoriesNotice';
import { FetchErrorState } from '@/components/FetchErrorState';
import type { LedgerRow } from '@/lib/history-ledger';

export type RecentRunsProps = {
  /** The section's own `data-section` token (per-surface DOM contract). */
  section: string;
  title: string;
  /** Whether the rows fetch has RESOLVED (success or failure). */
  ready: boolean;
  rows: LedgerRow[];
  nowMs: number;
  /** W7-A1 discipline: a failed rows read renders the shared failure state,
   *  never an honest-looking empty ledger. */
  error?: { message: string; status?: number } | null;
  onRetry?: () => void;
  /** Fan-out sources only (agents index): how many per-source reads came
   *  back unresolved, of how many. */
  unresolved?: number;
  total?: number;
  onRetryUnresolved?: () => void;
  /** W7-B5 (agents-40): the bound the current rows were fetched under —
   *  published as `data-limit` alongside `data-count` so a truncated list is
   *  never silent. Omitted = the caller fetched no bounded window. */
  limit?: number;
  /** W7-B5 (agents-40): "view all" — refetch under an expanded bound. Null or
   *  omitted (already expanded, or nothing more to show) renders no control,
   *  so the affordance never promises rows that do not exist. */
  onShowAll?: (() => void) | null;
};

export function RecentRuns({
  section, title, ready, rows, nowMs, error = null, onRetry,
  unresolved = 0, total = 0, onRetryUnresolved,
  limit, onShowAll = null,
}: RecentRunsProps) {
  return (
    <section
      className="lib-section"
      data-section={section}
      data-recent-runs-unresolved={ready ? unresolved : 0}
      data-count={ready ? rows.length : 0}
      {...(limit !== undefined ? { 'data-limit': limit } : {})}
      style={{ marginBottom: 40 }}
    >
      <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {ready && onShowAll && (
          <button
            type="button"
            className="btn btn-sm"
            data-action="recent-runs-show-all"
            onClick={onShowAll}
          >
            View all runs
          </button>
        )}
      </div>

      {!ready ? (
        <div
          data-component="recent-runs-loading"
          className="muted"
          style={{ fontStyle: 'italic', fontSize: 13, padding: '10px 0' }}
        >
          Loading recent runs…
        </div>
      ) : error ? (
        <FetchErrorState what={title.toLowerCase()} error={error.message} status={error.status} onRetry={onRetry} />
      ) : (
        <>
          <UnresolvedHistoriesNotice unresolved={unresolved} total={total} onRetry={onRetryUnresolved} />
          <HistoryLedger rows={rows} nowMs={nowMs} />
        </>
      )}
    </section>
  );
}
