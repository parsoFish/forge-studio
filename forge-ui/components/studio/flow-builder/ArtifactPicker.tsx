'use client';

/**
 * ArtifactPicker — popover shown immediately after port→port edge creation.
 * Lists the known artifact types; picking one sets the edge's artifact label.
 * "Leave unlabelled" closes without setting an artifact.
 */

import { useEffect, useRef } from 'react';

export type ArtifactDef = {
  id: string;
  name: string;
  desc: string;
};

// Fixed artifact list matching the forge flow artifacts catalog
const ARTIFACTS: ArtifactDef[] = [
  { id: 'plan',        name: 'PLAN.md',           desc: 'Approved plan: scope, ACs, decomposition.' },
  { id: 'work-items',  name: 'work-items/*.md',    desc: 'Self-contained work item specs.' },
  { id: 'wi-branches', name: 'wi-branches',        desc: 'One reviewed branch per completed WI.' },
  { id: 'pr',          name: 'PR',                 desc: 'Unified PR with demo evidence attached.' },
  { id: 'verdict',     name: 'verdict.json',       desc: 'Approve / send-back decision with reasons.' },
  { id: 'reflection',  name: 'reflection.md',      desc: 'Honest as-built retro; feeds knowledge ingestion.' },
  { id: 'demo',        name: 'demo-evidence/',     desc: 'Video + screenshots + live resource captures.' },
];

export { ARTIFACTS };

type Props = {
  /** Screen position to anchor the popover near */
  anchorX: number;
  anchorY: number;
  /** Called with the chosen artifact id, or null for "leave unlabelled" */
  onPick: (artifactId: string | null) => void;
  /** Called when the picker should close without a pick */
  onClose: () => void;
};

export function ArtifactPicker({ anchorX, anchorY, onPick, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position so the picker stays in viewport
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const PICKER_W = 240;
  const PICKER_H = 340;
  const left = Math.min(anchorX, viewportW - PICKER_W - 16);
  const top = anchorY + PICKER_H > viewportH ? anchorY - PICKER_H : anchorY;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        width: PICKER_W,
        zIndex: 9999,
        background: 'var(--panel)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
      }}
      data-component="artifact-picker"
    >
      <div style={{
        padding: '8px 12px',
        background: 'var(--panel-2)',
        borderBottom: '1px solid var(--line)',
        fontFamily: 'var(--font-display)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--dim)',
      }}>
        Choose artifact for this edge
      </div>

      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ARTIFACTS.map((ar) => (
          <button
            key={ar.id}
            onClick={() => onPick(ar.id)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              width: '100%',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-3)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            data-artifact-option={ar.id}
          >
            <span style={{
              width: 7,
              height: 7,
              borderRadius: 2,
              background: 'var(--c-artifact)',
              flexShrink: 0,
              marginTop: 3,
            }} />
            <span>
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--c-artifact)',
              }}>{ar.name}</span>
              <span style={{
                display: 'block',
                fontSize: 10.5,
                color: 'var(--faint)',
                lineHeight: 1.35,
              }}>{ar.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <div style={{ padding: '4px 10px 10px', fontSize: 11.5, color: 'var(--faint)', fontStyle: 'italic' }}>
        Or{' '}
        <button
          onClick={() => onPick(null)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--steel)',
            cursor: 'pointer',
            fontSize: 11.5,
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          leave unlabelled
        </button>
      </div>
    </div>
  );
}
