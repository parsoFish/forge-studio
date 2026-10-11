/**
 * One side (before or after) of a checkpoint in the mode the operator chose —
 * shared by the gallery and its lightbox.
 */
import type { SideMode } from '@/lib/gate-view';

export type Side = 'before' | 'after';
export type SideMedia = { output: string; image: string | null; video: string | null; note: string };

export function SideBody({ media, mode, side, size }: { media: SideMedia; mode: SideMode; side: Side; size: 'small' | 'large' }): JSX.Element {
  if (mode === 'frame' && media.image) {
    // Only data: URIs reach here (validateDemoModel rejects remote/scheme refs).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media.image} alt={`${side} frame`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
  }
  if (mode === 'output' || (mode === 'video' && !media.video)) {
    return (
      <pre data-captured-output style={{ margin: 0, height: '100%', overflow: 'auto', padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: size === 'large' ? 'var(--text-md)' : 'var(--text-xs)', lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {media.output || '(no output captured)'}
      </pre>
    );
  }
  if (mode === 'video' && media.video) {
    return <video controls preload="metadata" playsInline src={media.video} style={{ width: '100%', height: '100%', display: 'block', background: 'var(--bg)' }} />;
  }
  return <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-base)', color: 'var(--dim)' }}>{media.note || '—'}</div>;
}
