'use client';

import Link from 'next/link';
import type { MonitorSummary } from '@/lib/monitor-view';
import { buildMonitorSummaryTiles } from '@/lib/monitor-view';

// ---------------------------------------------------------------------------
// MonitorSummaryStrip — the four-tile headline over the merged
// everything-ledger (W8-B1).
//
// ONE component, TWO surfaces: Home renders it as a summary that links
// through to the depth, `/monitor` renders it as its own headline. Both are
// handed the SAME `MonitorSummary` value, derived by `buildMonitorSummary`
// from the SAME rows the ledger below renders — so the headline and the list
// cannot disagree, which is exactly the defect this lane closes (Home read
// "0 live" above ten in-flight rows because the two came from different
// derivations).
//
// Pure and props-driven: no fetch, no effect, no state. Its data-* contract
// is pinned by `lib/monitor-summary-strip-render.test.ts`.
// ---------------------------------------------------------------------------

export function MonitorSummaryStrip({
  summary,
  /** `'home'` links each tile through to `/monitor`; `'monitor'` is the
   *  destination itself, so its tiles are plain text — a self-link that
   *  reloads the page the operator is already on is a dead control. */
  variant = 'home',
  ready = true,
}: {
  summary: MonitorSummary;
  variant?: 'home' | 'monitor';
  ready?: boolean;
}) {
  const tiles = buildMonitorSummaryTiles(summary);
  const linked = variant === 'home';

  return (
    <section
      data-section="monitor-summary"
      data-monitor-variant={variant}
      aria-label="What is running"
      // Every count rides on the section itself so automation reads
      // structured state instead of scraping tile text.
      data-monitor-live={summary.live}
      data-monitor-runs-live={summary.runsLive}
      data-monitor-sessions-live={summary.sessionsLive}
      data-monitor-needs-you={summary.needsYou}
      data-monitor-gated-runs={summary.gatedRuns}
      data-monitor-sessions-needing-you={summary.sessionsNeedingYou}
      data-monitor-attention={summary.attention}
      data-monitor-failed={summary.failed}
      data-monitor-queued={summary.queued}
      data-monitor-total={summary.total}
      data-monitor-ready={ready ? 'true' : 'false'}
      style={{ marginBottom: 24 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          What is running
        </h2>
        {linked && (
          <Link
            href="/monitor"
            data-action="open-monitor"
            style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'none' }}
          >
            Open Monitor →
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {tiles.map((tile) => {
          const body = (
            <>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                {tile.count}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {tile.label}
              </span>
            </>
          );
          const style = {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 2,
            minWidth: 96,
            padding: '10px 14px',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            background: 'var(--panel)',
            textDecoration: 'none',
          };
          // The tile always renders, including at zero: a strip whose rows
          // appear and vanish makes "nothing is running" indistinguishable
          // from "the strip broke".
          return linked ? (
            <Link key={tile.id} href={tile.href} data-summary-tile={tile.id} data-count={tile.count} style={style}>
              {body}
            </Link>
          ) : (
            <div key={tile.id} data-summary-tile={tile.id} data-count={tile.count} style={style}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
