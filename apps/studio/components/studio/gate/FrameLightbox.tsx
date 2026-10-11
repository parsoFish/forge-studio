'use client';

/**
 * Enlarged before/after for the selected checkpoint — a plain modal <dialog>
 * (no dependency): Esc closes it natively, ← / → step through the
 * checkpoints, both sides render in the mode the operator picked on the page.
 * The <dialog> is always mounted so `[data-section="evidence-lightbox"]` is
 * stable; its body renders only while open, so a closed lightbox holds no
 * second copy of the frames and no playing video.
 */
import { forwardRef } from 'react';

import type { SideMode } from '@/lib/gate-view';
import { SideBody, type Side, type SideMedia } from './SideBody';
import { miniBtn, word, DELTA_COLOUR } from './styles';

export const FrameLightbox = forwardRef<HTMLDialogElement, {
  caption: string;
  delta: string;
  media: Record<Side, SideMedia> | null;
  modeOf: (side: Side) => SideMode;
  onStep: (by: number) => void;
  open: boolean;
  onClosed: () => void;
}>(function FrameLightbox({ caption, delta, media, modeOf, onStep, open, onClosed }, ref) {
  return (
    <dialog
      ref={ref}
      data-section="evidence-lightbox"
      aria-label={`Enlarged before and after: ${caption}`}
      onClose={onClosed}
      onKeyDown={(e) => {
        // A focused <video> seeks with the arrows, an input moves its caret — leave those keys alone.
        if (e.target instanceof HTMLVideoElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
      }}
      style={{
        width: '96vw', maxWidth: '96vw', height: '92vh', maxHeight: '92vh', padding: 'var(--space-4)',
        background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ ...word, fontSize: 'var(--text-sm)', color: DELTA_COLOUR[delta] ?? 'var(--faint)', border: '2px solid currentColor', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-3)' }}>{delta}</span>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 600, flex: 1, minWidth: 0 }}>{caption}</h3>
          <button data-action="lightbox-step" data-step="-1" onClick={() => onStep(-1)} style={miniBtn}>← Previous</button>
          <button data-action="lightbox-step" data-step="1" onClick={() => onStep(1)} style={miniBtn}>Next →</button>
          <button data-action="close-lightbox" onClick={(e) => (e.currentTarget.closest('dialog') as HTMLDialogElement | null)?.close()} style={miniBtn}>Close (Esc)</button>
        </div>
        {open && media && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
            {(['before', 'after'] as const).map((side) => (
              <figure key={side} data-lightbox-side={side} style={{ margin: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <figcaption style={{ ...word, letterSpacing: '.1em', color: 'var(--faint)', marginBottom: 'var(--space-1)' }}>{side}</figcaption>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
                  <SideBody media={media[side]} mode={modeOf(side)} side={side} size="large" />
                </div>
              </figure>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
});
