'use client';

/**
 * ArtifactPicker — popover shown immediately after edge creation, by BOTH the
 * port→port drag and the declared `connect-into-<station>` handle
 * (`forge-8vfn.5.12.1`). Lists the known artifact types; picking one sets the
 * edge's artifact label. "Leave unlabelled" closes without setting one.
 *
 * Every option declares a `data-action` beside its `data-artifact-option`, so
 * the choice is reachable through forge-ui's declared contract rather than by
 * a CSS selector no story is allowed to name. Until this existed the picker
 * could be OPENED by a story and never answered — `data-artifact-option` is a
 * qualifier, not an act, and `scripts/stories/beats.mjs` resolves a press as
 * `[data-action="…"]` only.
 */

import { useEffect, useRef } from 'react';
import { ARTIFACTS } from '@/lib/flow-artifact-catalog';

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
            data-action={`pick-artifact-${ar.id}`}
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
          data-action="leave-edge-unlabelled"
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
