'use client';

import type { SaveState } from '@/lib/useSaveState';

/**
 * SaveStatus — the single, consistent save-feedback affordance (X1).
 * Renders nothing when idle; otherwise a coloured inline status carrying
 * `data-save-status` so automation can read the outcome.
 */
export function SaveStatus({ saving, saved, error, locked }: SaveState) {
  let kind: 'saving' | 'ok' | 'error' | null = null;
  let text = '';
  if (saving) { kind = 'saving'; text = 'Saving…'; }
  else if (locked) { kind = 'error'; text = 'Locked — a run is in flight'; }
  else if (error) { kind = 'error'; text = error; }
  else if (saved) { kind = 'ok'; text = '✓ Saved'; }
  if (!kind) return null;

  const color = kind === 'ok' ? 'var(--green)' : kind === 'error' ? 'var(--red)' : 'var(--dim)';
  return (
    <span
      data-component="save-status"
      data-save-status={kind}
      aria-live="polite"
      style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color, whiteSpace: 'nowrap' }}
    >
      {text}
    </span>
  );
}
