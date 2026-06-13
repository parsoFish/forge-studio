'use client';

import Link from 'next/link';

export type ArtifactKey = 'plan' | 'workitems' | 'pr' | 'demo' | 'verdict' | 'reflection';

export type ArtifactsReady = Partial<Record<ArtifactKey, 'view' | 'gate'>>;

const TRAIL: { key: ArtifactKey; label: string }[] = [
  { key: 'plan',       label: 'PLAN.md' },
  { key: 'workitems',  label: 'work-items/' },
  { key: 'pr',         label: 'PR' },
  { key: 'demo',       label: 'demo-evidence/' },
  { key: 'verdict',    label: 'verdict.json' },
  { key: 'reflection', label: 'reflection.md' },
];

export function ArtifactTrail({
  runId,
  currentType,
  artifactsReady,
}: {
  runId: string;
  currentType: ArtifactKey;
  artifactsReady: ArtifactsReady;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        marginTop: 20,
        flexWrap: 'wrap',
        rowGap: 8,
      }}
    >
      {TRAIL.map((t, i) => {
        const isCurrent = t.key === currentType;
        const isPresent = !!artifactsReady[t.key];

        let trailState: 'current' | 'present' | 'absent';
        if (isCurrent) trailState = 'current';
        else if (isPresent) trailState = 'present';
        else trailState = 'absent';

        const chipStyle: React.CSSProperties = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 500,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid',
          whiteSpace: 'nowrap',
          textDecoration: 'none',
          transition: 'border-color 0.12s, background 0.12s, color 0.12s',
          ...(isCurrent
            ? {
                color: 'var(--text)',
                borderColor: 'var(--c-artifact)',
                background: 'rgba(251,191,36,.14)',
                boxShadow: '0 0 10px rgba(251,191,36,.18)',
              }
            : isPresent
            ? {
                color: 'var(--c-artifact)',
                borderColor: 'rgba(251,191,36,.35)',
                background: 'rgba(251,191,36,.07)',
              }
            : {
                color: 'var(--faint)',
                borderColor: 'var(--line)',
                borderStyle: 'dashed',
                background: 'transparent',
                cursor: 'default',
              }),
        };

        const dot = (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'currentColor',
              opacity: 0.7,
              flexShrink: 0,
            }}
          />
        );

        const chip = isPresent && !isCurrent ? (
          <Link
            href={`/artifact?run=${encodeURIComponent(runId)}&type=${t.key}`}
            style={chipStyle}
            data-artifact-trail-chip={t.key}
            data-trail-state={trailState}
          >
            {dot}
            {t.label}
          </Link>
        ) : (
          <span
            style={chipStyle}
            data-artifact-trail-chip={t.key}
            data-trail-state={trailState}
            title={isPresent ? undefined : 'Not yet produced'}
          >
            {dot}
            {t.label}
          </span>
        );

        return (
          <div key={t.key} style={{ display: 'flex', alignItems: 'center' }}>
            {chip}
            {i < TRAIL.length - 1 && (
              <div
                style={{
                  width: 24,
                  height: 1,
                  background: 'var(--line-2)',
                  position: 'relative',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: -3,
                    width: 0,
                    height: 0,
                    borderTop: '3px solid transparent',
                    borderBottom: '3px solid transparent',
                    borderLeft: '5px solid var(--line-2)',
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
