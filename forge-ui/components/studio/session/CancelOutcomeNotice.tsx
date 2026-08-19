'use client';

import { describeCancelOutcome, type CancelOutcome } from '@/lib/session-lifecycle-client';

// ---------------------------------------------------------------------------
// CancelOutcomeNotice — W7-FIX-A2 (W7A2-02): the ONE rendering of what a
// successful cancel POST actually did. The bridge answers `killed` honestly
// (true only when a tracked, provably-ours turn process was signalled);
// before this the value reached the UI and was discarded, so a cancel read
// identically whether or not anything was stopped. Rendered by the /sessions
// index, Home's active-sessions strip and the session page's lifecycle bar
// — each holds the LAST cancel result in page state so the notice survives
// the post-cancel refetch that drops the row/card.
// DOM: div[data-cancel-outcome="killed"|"unconfirmed"] — the shared
// `describeCancelOutcome` sentence, verbatim.
// ---------------------------------------------------------------------------

export function CancelOutcomeNotice({ outcome, subject }: { outcome: CancelOutcome; /** e.g. `demo · 2026-…` — names the session the notice is about */ subject?: string }): JSX.Element {
  const d = describeCancelOutcome(outcome);
  return (
    <div
      data-cancel-outcome={d.kind}
      role="status"
      style={{
        fontSize: 11.5, fontFamily: 'var(--font-mono)', marginTop: 6,
        color: d.kind === 'killed' ? 'var(--dim)' : 'var(--ember)',
      }}
    >
      {subject !== undefined ? <span style={{ color: 'var(--faint)' }}>{subject}: </span> : null}
      {d.text}
    </div>
  );
}
