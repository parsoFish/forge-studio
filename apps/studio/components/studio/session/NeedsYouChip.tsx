'use client';

// ---------------------------------------------------------------------------
// NeedsYouChip — the ONE needs-you signal (W7-B1: home-sessions-03/24,
// community-24; re-homed here from SessionsIndex.tsx per review round 1 —
// a shared leaf primitive lives beside its session siblings
// (CancelSessionButton, CancelOutcomeNotice), so Home's strip no longer has
// to import the whole /sessions index module to get a 15-line chip).
//
// A labelled text chip carrying the dedicated `needs-you` status token
// (globals.css) — never the borrowed `retrying` run state, never a
// colour-only dot. Shared by the /sessions rows and Home's session cards.
// ---------------------------------------------------------------------------

export function NeedsYouChip(): JSX.Element {
  return (
    <span
      data-needs-you-chip
      aria-label="needs you"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 10.5, fontWeight: 600, color: 'var(--ember)',
        border: '1px solid var(--ember)', borderRadius: 999, padding: '1px 8px',
        fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
      }}
    >
      <span className="status-dot" data-status="needs-you" aria-hidden="true" />
      needs you
    </span>
  );
}
