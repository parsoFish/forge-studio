/**
 * AgentsIndexView — pure, props-driven view for the `/agents` index route
 * (T2 lane W6-IA-3). Mirrors the `RunView` precedent
 * (`components/studio/agent-builder/RunView.tsx`): the actual
 * `app/agents/page.tsx` is a thin client shell that fetches the agent
 * roster (`fetchStudioAgents` — the SAME fetch `/library` already makes)
 * and this section's "recent agent runs" ledger (`lib/agents-index.ts`'s
 * `fetchRecentAgentRuns`) and renders `<AgentsIndexView .../>` with the
 * resolved data. `StudioNav` stays OUT of this component (it lives in the
 * page shell) so this component stays renderable via `renderToStaticMarkup`
 * in tests — see `../../lib/agents-index-render.test.ts`'s header for the
 * full rationale (the same one `run-view-render.test.ts` documents for its
 * own sibling split).
 *
 * Two sections:
 *   - `agent-roster` — the full agent roster as `AgentCard`s, reused
 *     UNCHANGED from `LibraryCard.tsx` (D2 — the SAME card `/library`
 *     already renders for its own agents pillar), plus a "+ New agent" CTA
 *     to `/agents/new`.
 *   - `recent-agent-runs` — the shared `RecentRuns` widget
 *     (`components/RecentRuns.tsx`, W7-B2's extraction of this very
 *     section; the KB health tab renders the same one), over the
 *     newest-first, bounded ledger `lib/agents-index.ts` reads in ONE call
 *     to `GET /api/agents/runs/recent`. W7-B5 (agents-03/04/39) landed that
 *     aggregate route: the per-agent fan-out this header used to describe
 *     is gone, along with the arbitrary-node attribution that published one
 *     node's $0.00 as a failed run's cost.
 *
 * `ready` / `recentRunsReady` are two INDEPENDENT facts, not one shared
 * "loading" flag — the roster and the runs ledger are two different
 * fetches with different latencies, and collapsing them would either show a stale
 * "loading" runs ledger after the roster is already interactive, or gate
 * the whole page behind the slower of the two for no reason. Each section
 * renders its own honest loading / empty state independently — never a
 * fabricated claim about data that has not resolved yet (the same
 * declared-data-fails-open discipline `HistoryLedger`'s own three-state
 * fetch-outcome convention already establishes on `/agents/[id]`).
 */

import Link from 'next/link';
import { AgentCard } from '@/components/studio/LibraryCard';
import { RecentRuns } from '@/components/RecentRuns';
import { FetchErrorState } from '@/components/FetchErrorState';
import type { Agent } from '@/lib/studio-client';
import type { LedgerRow } from '@/lib/history-ledger';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';

export type AgentsIndexViewProps = {
  /** Whether the agent-roster fetch has resolved. */
  ready: boolean;
  agents: Agent[];
  /** Whether the merged "recent agent runs" fetch has resolved. */
  recentRunsReady: boolean;
  recentRuns: LedgerRow[];
  /** Threaded through to `HistoryLedger`'s own required `nowMs` prop (D7)
   *  — never `Date.now()` read inside this component. */
  nowMs: number;
  /** W7-A1 (crosscut-01): the roster fetch's failure — renders the shared
   *  failure state INSTEAD of "No agents yet — create your first one." */
  error?: { message: string; status?: number } | null;
  onRetry?: () => void;
  /** W7-FIX-A1 (A1-09): how many per-agent history reads came back
   *  `'unresolved'` (of `recentRunsTotal` fanned out) — rendered as an honest
   *  notice ABOVE the rows that WERE read; 0/omitted = every read settled. */
  recentRunsUnresolved?: number;
  recentRunsTotal?: number;
  onRetryRecentRuns?: () => void;
  /** W7-B5 (agents-40): the bound the current rows were fetched under —
   *  published as `data-limit` so a truncated list is never silent. */
  recentRunsLimit?: number;
  /** W7-B5 (agents-40): "view all" — refetch under the expanded bound.
   *  Omitted (or already expanded) renders no affordance. */
  onShowAllRecentRuns?: (() => void) | null;
};

export function AgentsIndexView({
  ready, agents, recentRunsReady, recentRuns, nowMs, error = null, onRetry,
  recentRunsUnresolved = 0, recentRunsTotal = 0, onRetryRecentRuns,
  recentRunsLimit, onShowAllRecentRuns = null,
}: AgentsIndexViewProps) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="agents-index"
      data-page-ready={ready ? 'true' : 'false'}
      data-agent-count={agents.length}
      data-fetch-status={error ? 'error' : ready ? 'ok' : 'loading'}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <div className="page-wrap" style={{ maxWidth: 1280, margin: '0 auto', padding: '40px 28px 64px' }}>
        {/* W7-C3 (crosscut-18/agents-35): one h1 per page — the roster's
            visible identity is the badge row, so the heading is sr-only. */}
        <h1 className="sr-only">Agents</h1>

        {/* ===== AGENT ROSTER ===== */}
        <section
          className="lib-section"
          data-section="agent-roster"
          data-count={agents.length}
          style={{ marginBottom: 40 }}
        >
          <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
            <span className="badge badge-agent">Agent</span>
            <span
              className="lib-count"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--faint)',
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '1px 7px',
              }}
            >
              {agents.length}
            </span>
            <span style={{ flex: 1 }} />
            {/* W6-B11 — Sessions is deliberately NOT its own top-level pillar
                (operator decision); this is its secondary-nav entry point
                alongside Home's active-sessions strip. `Link` (not a plain
                `<a>`), per IA-6's single-tab policy — every internal anchor
                navigates client-side, never a full-page reload. */}
            <Link
              href="/sessions"
              data-nav="sessions-secondary"
              style={{ fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)', textDecoration: 'none', marginRight: 4 }}
            >
              Sessions →
            </Link>
            {/* Review fix (same IA-6 class as the row above): was a plain
                `<a>` — converted to `Link` while in this file. */}
            <Link className="btn btn-primary" href="/agents/new" data-action="new-agent" style={{ textDecoration: 'none' }}>
              + New agent
            </Link>
          </div>

          {error ? (
            <div style={{ marginBottom: agents.length > 0 ? 14 : 0 }}>
              <FetchErrorState what="the agent roster" error={error.message} status={error.status} onRetry={onRetry} />
            </div>
          ) : null}
          {error && agents.length === 0 ? null : !ready ? (
            <div data-component="agent-roster-loading" className="muted" style={{ fontStyle: 'italic', fontSize: 13, padding: '10px 0' }}>
              Loading agents…
            </div>
          ) : agents.length === 0 ? (
            <div data-component="agent-roster-empty" className="muted" style={{ fontStyle: 'italic', fontSize: 13, padding: '10px 0' }}>
              No agents yet — create your first one.
            </div>
          ) : (
            <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
              {agents.map((a, i) => (
                <AgentCard key={a.id} agent={a} index={i} />
              ))}
            </div>
          )}
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '44px 0 40px' }} />

        {/* ===== RECENT AGENT RUNS — the shared RecentRuns widget (W7-B2
            extraction; the KB health tab consumes the same component). The
            section token stays `recent-agent-runs` (this page's established
            DOM contract). W7-B5 (agents-40) threads the fetch bound + the
            "view all" refetch through the SAME component rather than forking
            a second copy of the section — a silently-capped list is a lie of
            omission wherever it renders. ===== */}
        <RecentRuns
          section="recent-agent-runs"
          title="Recent agent runs"
          ready={recentRunsReady}
          rows={recentRuns}
          nowMs={nowMs}
          unresolved={recentRunsUnresolved}
          total={recentRunsTotal}
          onRetryUnresolved={onRetryRecentRuns}
          {...(recentRunsLimit !== undefined ? { limit: recentRunsLimit } : {})}
          onShowAll={onShowAllRecentRuns}
        />

      </div>
    </main>
  );
}
