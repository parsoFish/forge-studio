'use client';

import type { Run } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// RunRail — left panel listing runs grouped by status.
// Groups: NEEDS YOU (gated) / ACTIVE / FAILED / QUEUED (planned) / COMPLETE.
// ---------------------------------------------------------------------------

interface RunRailProps {
  runs: Run[];
  activeRunId: string | null;
  onSelect: (runId: string) => void;
}

const GROUPS: Array<{ label: string; status: Run['status'] }> = [
  { label: 'NEEDS YOU', status: 'gated' },
  { label: 'ACTIVE',    status: 'active' },
  { label: 'FAILED',    status: 'failed' },
  { label: 'QUEUED',    status: 'planned' },
  { label: 'COMPLETE',  status: 'complete' },
];

function statusDotStatus(status: Run['status']): string {
  if (status === 'gated') return 'active';   // gated pulses like active
  return status;
}

export function RunRail({ runs, activeRunId, onSelect }: RunRailProps) {
  if (runs.length === 0) {
    return (
      <div
        style={{
          width: 220,
          flexShrink: 0,
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="panel-head">Runs</div>
        <div style={{ padding: 16, fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic' }}>
          No runs yet for this flow.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--panel)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div className="panel-head">Runs</div>

      {GROUPS.map(({ label, status }) => {
        const group = runs.filter((r) => r.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--faint)',
                padding: '10px 14px 4px',
              }}
            >
              {label}
            </div>
            {group.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                isSelected={run.id === activeRunId}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunCard — individual run card
// ---------------------------------------------------------------------------

function RunCard({
  run,
  isSelected,
  onSelect,
}: {
  run: Run;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const isGated   = run.status === 'gated';
  const isFailed  = run.status === 'failed';

  const borderLeft = isGated
    ? '3px solid var(--ember)'
    : isFailed
    ? '3px solid var(--red)'
    : '3px solid transparent';

  const bg = isGated
    ? 'rgba(255,158,74,0.04)'
    : isSelected
    ? 'var(--panel-2)'
    : 'transparent';

  return (
    <div
      className={`fb-run-card${isSelected ? ' active-card' : ''}${isGated ? ' gated-card' : ''}${isFailed ? ' failed-card' : ''}`}
      data-run-id={run.id}
      data-run-status={run.status}
      onClick={() => onSelect(run.id)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: isGated || isFailed ? '10px 14px 10px 11px' : '10px 14px',
        borderBottom: '1px solid var(--line)',
        borderLeft,
        cursor: 'pointer',
        background: bg,
        transition: 'background 0.1s',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--faint)',
        }}
      >
        {run.id}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: 'var(--text)',
          lineHeight: 1.35,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {run.initiative}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="status-dot"
          data-status={statusDotStatus(run.status)}
        />
        <span className="badge badge-dim" style={{ fontSize: 10 }}>
          {run.status === 'gated' ? 'gated' : run.status}
        </span>
        {run.costUsd > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--dim)',
            }}
          >
            ${run.costUsd.toFixed(2)}
          </span>
        )}
      </div>

      {isGated && run.gateNote && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--ember)',
            lineHeight: 1.4,
            marginTop: 2,
          }}
        >
          {run.gateNote}
        </div>
      )}

      {isGated && (
        <a
          href={`/artifact?run=${encodeURIComponent(run.id)}&type=verdict&mode=gate`}
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 5,
            alignSelf: 'flex-start',
            fontSize: 11,
            padding: '3px 9px',
            borderRadius: 4,
            background: 'rgba(255,158,74,0.15)',
            border: '1px solid rgba(255,158,74,0.45)',
            color: 'var(--ember)',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-block',
            transition: 'background 0.12s',
          }}
        >
          Open gate →
        </a>
      )}

      {isFailed && run.failNote && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--red)',
            lineHeight: 1.4,
            marginTop: 2,
          }}
        >
          {run.failNote}
        </div>
      )}
    </div>
  );
}
