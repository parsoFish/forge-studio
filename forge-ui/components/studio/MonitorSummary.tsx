'use client';

import Link from 'next/link';
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

  // Normalise artifactsReady: 'work-items' → 'workitems' so the /artifact
  // page type param resolves correctly (mirrors artifact/page.tsx ~:479-487).
  const ARTIFACT_KEYS: { key: string; label: string }[] = [
    { key: 'plan',       label: 'PLAN.md' },
    { key: 'workitems',  label: 'work-items/' },
    { key: 'pr',         label: 'PR' },
    { key: 'demo',       label: 'demo-evidence/' },
    { key: 'verdict',    label: 'verdict.json' },
    { key: 'reflection', label: 'reflection.md' },
  ];
  const ar = run.artifactsReady as Record<string, 'view' | 'gate'>;
  const readyChips = ARTIFACT_KEYS.filter(({ key }) => {
    const rawKey = key === 'workitems' ? 'work-items' : key;
    return !!ar[rawKey];
  }).map(({ key, label }) => {
    const rawKey = key === 'workitems' ? 'work-items' : key;
    return { key, label, mode: ar[rawKey] };
  });

  return (
    <div
      className="fb-summary-strip"
      data-active-run={run.id}
      data-run-cost-usd={run.costUsd.toFixed(4)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 20px',
        background: 'var(--panel)',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        gap: 8,
      }}
    >
      {/* Stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
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

      {/* Artifact pill row — one chip per ready artifact, linking to /artifact */}
      {readyChips.length > 0 && (
        <div
          data-section="monitor-artifacts"
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
          {readyChips.map(({ key, label, mode }) => (
            <Link
              key={key}
              href={`/artifact?run=${encodeURIComponent(run.id)}&type=${encodeURIComponent(key)}`}
              data-artifact-pill={key}
              data-artifact-mode={mode}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                fontWeight: 500,
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${mode === 'gate' ? 'rgba(251,191,36,.55)' : 'rgba(251,191,36,.25)'}`,
                background: mode === 'gate' ? 'rgba(251,191,36,.12)' : 'rgba(251,191,36,.05)',
                color: mode === 'gate' ? 'var(--amber)' : 'var(--c-artifact)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {mode === 'gate' && (
                <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
              )}
              {label}
            </Link>
          ))}
        </div>
      )}
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
