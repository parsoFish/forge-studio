'use client';

import { useState } from 'react';

import { cancelStudioSession } from '@/lib/session-lifecycle-client';

// ---------------------------------------------------------------------------
// CancelSessionButton — W7-A2: the ONE cancel control every session surface
// mounts (the /sessions row, Home's active-sessions card, and the session
// page's SessionLifecycleBar). Two-step confirm (first click arms it —
// `data-confirming="true"`, label "Confirm cancel"; second click POSTs;
// an inline "keep" link disarms) so a stray click never kills a live turn.
// POSTs the generic `POST /api/studio/sessions/:kind/:sessionId/cancel`
// (cli/bridge-studio-session-cancel.ts) via `cancelStudioSession`; the
// server's own error text (409 already-terminal naming the phase, 404, 400)
// renders verbatim in `[data-cancel-error]`, never swallowed. On success the
// caller's `onCancelled` fires so it can refetch — this component never
// navigates or re-derives state itself.
//
// `action` is the `data-action` value the surface's DOM contract names:
// `cancel` on the session page (docs/forge-ui-dom-and-harness.md, session
// route), `cancel-session` on the index row / Home card.
// ---------------------------------------------------------------------------

export function CancelSessionButton({
  kind,
  sessionId,
  project,
  action = 'cancel-session',
  onCancelled,
  compact = false,
}: {
  kind: string;
  sessionId: string;
  project: string | null;
  action?: 'cancel' | 'cancel-session';
  onCancelled?: (result: { killed: boolean; previousPhase: string }) => void;
  /** Smaller footprint for a table row / card corner. */
  compact?: boolean;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fire(): Promise<void> {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await cancelStudioSession(kind, sessionId, project);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    onCancelled?.({ killed: result.killed, previousPhase: result.previousPhase });
  }

  const fontSize = compact ? 11 : 12.5;
  return (
    <span data-component="cancel-session" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="btn"
        data-action={action}
        data-confirming={confirming}
        disabled={busy}
        aria-label={confirming ? `Confirm cancel of ${kind} session ${sessionId}` : `Cancel ${kind} session ${sessionId}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void fire(); }}
        style={{
          fontSize,
          padding: compact ? '2px 8px' : '4px 10px',
          color: confirming ? 'var(--red, #f87171)' : 'var(--dim)',
          borderColor: confirming ? 'var(--red, #f87171)' : 'var(--line)',
          opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? 'Cancelling…' : confirming ? 'Confirm cancel' : 'Cancel'}
      </button>
      {confirming && !busy && (
        <button
          type="button"
          data-action={`${action}-abort`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(false); setError(null); }}
          style={{ fontSize, background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
        >
          keep
        </button>
      )}
      {error && (
        <span data-cancel-error style={{ fontSize, color: 'var(--red, #f87171)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
