'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useStudioHomeData } from '@/lib/use-studio-home-data';
import { useEverythingLedger } from '@/lib/use-everything-ledger';
import { useNowTicker } from '@/lib/use-now-ticker';
import { StudioPage } from '@/components/StudioPage';
import { FetchErrorState } from '@/components/FetchErrorState';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { UnresolvedHistoriesNotice } from '@/components/studio/UnresolvedHistoriesNotice';
import { HomeSessionsStrip } from '@/components/studio/HomeSessionsStrip';
import { MonitorSummaryStrip } from '@/components/studio/MonitorSummaryStrip';
import { RunRail } from '@/components/studio/RunRail';
import { ServeStatusNotice } from '@/components/studio/ServeStatusNotice';
import { useServeStatus } from '@/lib/use-serve-status';
import {
  buildHomeSessionsStrip,
  gateAttentionStatusDot,
} from '@/lib/home-view';
import { buildMonitorSummary, deriveSummaryReady } from '@/lib/monitor-view';
import { buildWaitingOnYou } from '@/lib/reflection-attention';
import type { SessionIndexRow } from '@/lib/studio-client';
import type { CancelOutcome } from '@/lib/session-lifecycle-client';

// ---------------------------------------------------------------------------
// Monitor — the seventh pillar (W8-B1, operator note 8).
//
// The one place that answers "what is running, and what is stuck": flow runs,
// standalone agent runs, interactive sessions, the queue/scheduler daemon,
// and everything waiting on the operator. Before this, an operator chasing a
// run had to visit Home for the ledger, a flow page for the run rail,
// /sessions for the sessions, and a project page for its gates — and Home's
// own headline count disagreed with the ledger printed directly beneath it.
//
// LIFT, DO NOT FORK — the load-bearing rule for this page. Every part of it
// is an existing piece:
//   - the seven cross-object reads: `useStudioHomeData` (shared with Home)
//   - the merged flow+agent ledger: `useEverythingLedger` (LIFTED out of
//     app/page.tsx by this lane so Home and Monitor read ONE list)
//   - the counts: `buildMonitorSummary` over the SAME rows rendered below
//   - the run rail with its real `failed` group: `RunRail`
//   - sessions: `HomeSessionsStrip` (+ `buildHomeSessionsStrip`)
//   - serve status: `ServeStatusNotice` (M7-E row 205 — read-only; there is
//     no operator control over `forge serve` any more)
//   - attention: `buildWaitingOnYou` (lib/reflection-attention.ts) — the
//     builders Home renders plus pending reflections (forge-nk1y.3, read from
//     `GET /api/reflections/pending`)
// No new bridge route, and no route added anywhere: this page's own endpoint
// (`GET /api/agents/runs/recent`) already existed, reached through its
// existing typed wrapper; serve status rides the existing `GET /api/health`.
// Structurally enforced by `scripts/home-no-new-polling.test.ts`, which this
// lane extended to cover this page, the lifted hook and the pure derivation.
//
// Home keeps the SUMMARY (a four-tile strip, same component, same value);
// Monitor owns the DEPTH. Two ledgers that drift is the same fail-open shape
// as a field nothing enforces — so there is only one.
// ---------------------------------------------------------------------------

/** How many session cards Monitor shows before linking out — Home shows 4. */
const MONITOR_SESSION_CARDS = 12;

/** How many ledger rows a page of Monitor's activity list holds. */
const MONITOR_LEDGER_PAGE = 25;

/** Flow runs are already grouped by status inside the rail; bound its height
 *  so the rail scrolls internally instead of pushing the ledger off-screen. */
const RUN_RAIL_HEIGHT = 420;

export default function MonitorPage() {
  const { agents, kbs, runs, attention, reflections, sessions, ready, error, reload, refreshSessions } = useStudioHomeData();
  const nowMs = useNowTicker();
  // M7-E row 205 (D-12): the read-only serve status.
  const { status: serveStatus } = useServeStatus();
  const ledger = useEverythingLedger({ agents, runs, sessions, ready });

  // The same attention builders Home renders, over the same already-fetched
  // data — Monitor lists them densely in one section rather than as named
  // strips, but never re-derives them (forge-nk1y.3 adds reflections).
  const attentionItems = buildWaitingOnYou({ attention, reflections, sessions, kbs });

  const summary = buildMonitorSummary({
    ledgerRows: ledger.rows,
    runs,
    sessions,
    attentionCount: attentionItems.length,
  });
  // forge-6gv.28: the summary strip's OWN readiness — distinct from the
  // page's `ready` (data-page-ready), which settles before the merged
  // ledger's agent half does. `summary` above is computed over `ledger.rows`,
  // which is missing that half until `ledger.agentRowsReady` — so the strip
  // must not vouch for its counts as settled until both have.
  const summaryReady = deriveSummaryReady({ homeDataReady: ready, agentRowsReady: ledger.agentRowsReady });

  const sessionsStrip = buildHomeSessionsStrip(sessions, MONITOR_SESSION_CARDS);
  const [lastCancel, setLastCancel] = useState<{ row: SessionIndexRow; outcome: CancelOutcome } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <StudioPage
      dataPage="monitor"
      ready={ready}
      data={{
        'data-monitor-live': summary.live,
        'data-monitor-needs-you': summary.needsYou,
        'data-monitor-failed': summary.failed,
        'data-attention-count': attentionItems.length,
        'data-ledger-total': ledger.rows.length,
        // loading | ok | error — an outage is an honest error state, never
        // the first-run "nothing is running" screen.
        'data-fetch-status': error ? 'error' : ready ? 'ok' : 'loading',
      }}
      eyebrow="forge studio"
      docTitle="Monitor"
      title="What is running, and what is stuck"
      lede="Flow runs, standalone agent runs, interactive sessions, the queue and everything waiting on you — one surface, one derivation."
      actions={
        <Link className="btn" href="/flows" data-action="browse-flows" style={{ textDecoration: 'none' }}>
          Browse flows
        </Link>
      }
    >
      {error ? (
        <div style={{ marginBottom: 24 }}>
          <FetchErrorState what="the fleet" error={error.message} status={error.status} onRetry={reload} />
        </div>
      ) : null}

      {/* The headline counts, derived from the rows below — never a second
          count computed from a different source. */}
      <MonitorSummaryStrip summary={summary} variant="monitor" ready={summaryReady} />

      {/* M7-E row 205: `forge serve` is what turns queued work into runs; the
          supervisor's own read-only status, surfaced only while there is
          something to report (never a card when it's simply running). */}
      {serveStatus && serveStatus.state !== 'running' && (
        <section data-section="serve-status" aria-label="forge serve status" style={{ marginBottom: 24 }}>
          <ServeStatusNotice status={serveStatus} />
        </section>
      )}

      {/* Everything waiting on a human: project gates, reflections, parked
          brain drafts and KB lint, in one dense list. Always mounted — an empty section that
          says so is information; a section that vanishes is not. */}
      <section
        data-section="monitor-attention"
        aria-label="Waiting on you"
        data-attention-count={attentionItems.length}
        style={{ marginBottom: 24 }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          Waiting on you
        </h2>
        {attentionItems.length === 0 ? (
          <p data-component="monitor-attention-empty" style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
            {ready ? 'Nothing is waiting on you right now.' : 'Reading…'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attentionItems.map((item) => (
              <Link
                key={`${item.kind}:${item.id}`}
                href={item.href}
                data-attention-item="true"
                data-attention-kind={item.kind}
                data-attention-status={item.status}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  padding: '8px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--panel)',
                  textDecoration: 'none',
                  color: 'var(--text)',
                }}
              >
                <span className="status-dot" data-status={gateAttentionStatusDot(item.status)} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.text}</span>
                <span style={{ fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{item.sub}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Interactive sessions — the same strip Home renders, given a bigger
          card budget because this is the surface that owns the depth. */}
      <HomeSessionsStrip
        strip={sessionsStrip}
        ready={ready}
        lastCancel={lastCancel}
        onCancelled={(row, outcome) => { setLastCancel({ row, outcome }); void refreshSessions(); }}
      />

      {/* Flow runs, grouped by the rail's own status vocabulary — NEEDS YOU /
          ACTIVE / FAILED / QUEUED / COMPLETE. A failed run reads as failed
          here because it is the same component, and the same
          `run.status === 'failed'` treatment, the flow page uses. */}
      <section data-section="monitor-runs" aria-label="Flow runs" data-run-count={runs.length} style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          Flow runs
        </h2>
        {runs.length === 0 ? (
          // The rail's own empty state says "No runs yet for this flow" —
          // true on a flow page, false here, so Monitor states its own case
          // rather than borrowing a sentence that would be a small lie.
          <p data-component="monitor-runs-empty" style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
            {ready ? 'No flow runs recorded yet.' : 'Reading…'}
          </p>
        ) : (
          <div style={{ display: 'flex', height: RUN_RAIL_HEIGHT, border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <RunRail runs={runs} activeRunId={selectedRunId} onSelect={setSelectedRunId} />
            <div style={{ flex: '1 1 auto', padding: 16, overflowY: 'auto' }}>
              <p style={{ fontSize: 12.5, color: 'var(--faint)', margin: 0 }}>
                {selectedRunId
                  ? 'Open the selected run from its card to see its timeline.'
                  : `${runs.length} run${runs.length === 1 ? '' : 's'} across every flow. Pick one to see where it stands, or open it from its card.`}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* The merged everything-ledger: flow runs + standalone agent runs, one
          newest-first list, paged (never silently truncated). This is the list
          the headline counts above are computed from. */}
      <section
        data-section="activity"
        aria-label="Recent activity"
        data-recent-runs-unresolved={ledger.agentRowsReady ? ledger.unresolved : 0}
        data-ledger-total={ledger.rows.length}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
          Recent activity
        </h2>
        {ledger.agentRowsReady ? (
          <UnresolvedHistoriesNotice unresolved={ledger.unresolved} total={ledger.total} onRetry={ledger.retry} />
        ) : null}
        <HistoryLedger rows={ledger.rows} nowMs={nowMs} showKindChip pageSize={MONITOR_LEDGER_PAGE} filterable />
      </section>
    </StudioPage>
  );
}
