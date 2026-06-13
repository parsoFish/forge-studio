'use client';

import type { Run, Flow } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// MonitorSummary — horizontal strip showing cost, elapsed, phase tally,
// run badge, and optionally a cost gauge when flow.costCeilingUsd is set.
// ---------------------------------------------------------------------------

interface MonitorSummaryProps {
  run: Run | null;
  flow: Flow;
}

// Snapshot elapsed time — refreshed on run-update events, not on a timer.
function elapsed(startedAt: string | undefined): string {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  const totalM = Math.floor(ms / 60_000);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function phaseTally(run: Run): {
  complete: number;
  active: number;
  retrying: number;
  pending: number;
  failed: number;
} {
  const counts = { complete: 0, active: 0, retrying: 0, pending: 0, failed: 0 };
  for (const s of Object.values(run.phases)) {
    if (s in counts) (counts as Record<string, number>)[s]++;
  }
  // pending = nodes not in phases map yet
  counts.pending += Math.max(
    0,
    (run.workItems?.length ?? 0) - Object.values(run.phases).length,
  );
  return counts;
}

function runBadgeClass(status: Run['status']): string {
  if (status === 'active' || status === 'gated') return 'badge-agent';
  if (status === 'complete') return 'badge-kb';
  if (status === 'failed') return 'badge-dim';
  return 'badge-dim';
}

export function MonitorSummary({ run, flow }: MonitorSummaryProps) {
  if (!run) {
    return (
      <div
        className="fb-summary-strip"
        data-active-run=""
        data-run-cost-usd="0"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '10px 20px',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <SummaryKV label="Cost" value="—" ember />
        <SummaryKV label="Elapsed" value="—" />
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>—</span>
      </div>
    );
  }

  const tally = phaseTally(run);
  const ceiling = flow.costCeilingUsd;
  const pct = ceiling ? Math.min((run.costUsd / ceiling) * 100, 100) : 0;
  const fillClass = pct >= 90 ? ' crit' : pct >= 70 ? ' warn' : '';
  const elapsedStr = elapsed(run.startedAt);

  return (
    <div
      className="fb-summary-strip"
      data-active-run={run.id}
      data-run-cost-usd={run.costUsd.toFixed(4)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '10px 20px',
        background: 'var(--panel)',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <SummaryKV
        label="Cost"
        value={`$${run.costUsd.toFixed(2)}`}
        ember
      />
      <SummaryKV label="Elapsed" value={elapsedStr} />

      <div style={{ fontSize: 12, color: 'var(--dim)' }}>
        <span style={{ color: 'var(--green)' }}>{tally.complete} complete</span>
        {' · '}
        <span style={{ color: 'var(--ember)' }}>{tally.active} active</span>
        {' · '}
        <span style={{ color: 'var(--amber)' }}>{tally.retrying} retrying</span>
        {' · '}
        <span style={{ color: 'var(--faint)' }}>{tally.pending} pending</span>
      </div>

      {/* Cost gauge — only when ceiling is configured */}
      {ceiling != null && ceiling > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minWidth: 140,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              color: 'var(--dim)',
            }}
          >
            ${run.costUsd.toFixed(2)} of ${ceiling} ceiling
          </div>
          <div
            style={{
              height: 5,
              background: 'var(--line)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 3,
                width: `${pct.toFixed(1)}%`,
                background: fillClass.includes('crit')
                  ? 'var(--red)'
                  : fillClass.includes('warn')
                  ? 'var(--amber)'
                  : 'var(--ember)',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Run badge */}
      <span className={`badge ${runBadgeClass(run.status)}`}>{run.id}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function SummaryKV({
  label,
  value,
  ember,
}: {
  label: string;
  value: string;
  ember?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          color: ember ? 'var(--ember)' : 'var(--text)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
