import type { CSSProperties } from 'react';
import { describeBridgeError } from '@/lib/bridge-result';

/**
 * FetchErrorState — the ONE shared "this read failed" state (W7-A1:
 * crosscut-01/-09/-12, home-sessions-29/-30, projects-03, library-13).
 *
 * Every pillar page / panel that used to render its EMPTY state when a bridge
 * read failed renders this instead. It frames the two failure classes
 * differently and never conflates them:
 *   - `status` present  → the bridge ANSWERED and refused/errored: the copy
 *     says so and carries the bridge's own text verbatim (a 409 "migrate: …"
 *     is the operator's fix instruction; a 400 "invalid hook id" is not an
 *     outage). Never "could not reach the bridge" here (library-13).
 *   - `status` absent   → the bridge was never reached (transport failure).
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md, "Shared — fetch-error"):
 *   `[data-component="fetch-error"][data-fetch-status="error"]
 *    [data-fetch-reachable="true"|"false"][data-fetch-http-status=<n>]`
 *   + `[data-action="retry-fetch"]` when `onRetry` is supplied.
 * `role="alert"` so a11y tooling + the walkthrough crawl both see it.
 */

export type FetchErrorProps = {
  /** What was being read — "sessions", "the project roster", "contract stages". */
  what: string;
  /** Message text, verbatim (from `describeBridgeError(err).message`). */
  error: string;
  /** HTTP status iff the bridge answered. */
  status?: number;
  onRetry?: () => void;
  /** Inline one-liner (inside a panel) instead of the boxed page section. */
  compact?: boolean;
};

/** Build the `error`/`status` props from any caught error. */
export function fetchErrorPropsFrom(err: unknown): { error: string; status?: number } {
  const d = describeBridgeError(err);
  return d.status !== undefined ? { error: d.message, status: d.status } : { error: d.message };
}

const BOX_STYLE: CSSProperties = {
  color: '#f87171',
  fontSize: 13,
  lineHeight: 1.5,
  padding: '14px 16px',
  border: '1px solid rgba(248,113,113,.35)',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'rgba(248,113,113,.06)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const COMPACT_STYLE: CSSProperties = {
  color: '#f87171',
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: '6px 0',
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

export function FetchErrorState({ what, error, status, onRetry, compact }: FetchErrorProps) {
  const reachable = status !== undefined;
  return (
    <div
      role="alert"
      data-component="fetch-error"
      data-fetch-status="error"
      data-fetch-reachable={reachable ? 'true' : 'false'}
      {...(reachable ? { 'data-fetch-http-status': String(status) } : {})}
      style={compact ? COMPACT_STYLE : BOX_STYLE}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>
        {reachable
          ? <>The forge bridge refused to read {what} (HTTP {status}): <span data-fetch-error-text style={{ fontFamily: 'var(--font-mono, ui-monospace)' }}>{error}</span></>
          : <>Could not reach the forge bridge — {what} unavailable (<span data-fetch-error-text style={{ fontFamily: 'var(--font-mono, ui-monospace)' }}>{error}</span>). This is NOT an empty result; it will refill when the bridge is back.</>}
      </span>
      {onRetry ? (
        <button type="button" data-action="retry-fetch" onClick={onRetry} style={RETRY_STYLE}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
