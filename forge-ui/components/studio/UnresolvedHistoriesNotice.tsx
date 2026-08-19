import type { CSSProperties } from 'react';

/**
 * UnresolvedHistoriesNotice — W7-FIX-A1 (A1-09).
 *
 * The recent-agent-runs ledger (`/agents` + Home "Recent activity") fans
 * `GET /api/agents/:slug/history` out across the roster; each read resolves
 * `found` / `not-found` / `unresolved` (`lib/agent-ledger.ts`). Before this,
 * the `unresolved` count was parsed and DISCARDED — a total outage rendered
 * the SAME empty ledger as a fleet that has never run. This renders the count
 * ABOVE whatever rows WERE read (never replacing them, never fabricating a
 * row): "N of M agent histories could not be read".
 *
 * Deliberately NOT `FetchErrorState`: the roster read itself succeeded (the
 * page's `data-fetch-status` stays honest to that), an unresolved history
 * carries no reachability/status fact (`lib/agent-ledger.ts` collapses
 * transport + non-404 + malformed to one `'unresolved'`), and the journeys'
 * healthy-bridge check counts `[data-component="fetch-error"]` nodes.
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md → `/agents` recent-agent-runs):
 *   `[role="status"][data-component="recent-agent-runs-unresolved"]
 *    [data-unresolved-count=<n>][data-unresolved-total=<m>]`
 *   + `[data-action="retry-recent-runs"]` when `onRetry` is supplied.
 *   Renders NOTHING when `unresolved === 0`.
 */
export type UnresolvedHistoriesNoticeProps = {
  /** Per-agent history reads that resolved `'unresolved'`. */
  unresolved: number;
  /** Agents fanned out to. */
  total: number;
  onRetry?: () => void;
};

const NOTICE_STYLE: CSSProperties = {
  color: '#f59e0b',
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: '6px 0 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const RETRY_STYLE: CSSProperties = {
  fontSize: 12,
  padding: '3px 10px',
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

export function UnresolvedHistoriesNotice({ unresolved, total, onRetry }: UnresolvedHistoriesNoticeProps) {
  if (unresolved <= 0) return null;
  return (
    <div
      role="status"
      data-component="recent-agent-runs-unresolved"
      data-unresolved-count={unresolved}
      data-unresolved-total={total}
      style={NOTICE_STYLE}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>
        {unresolved} of {total} agent histories could not be read — the rows below are only what WAS read, not the full picture.
      </span>
      {onRetry ? (
        <button type="button" data-action="retry-recent-runs" onClick={onRetry} style={RETRY_STYLE}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
