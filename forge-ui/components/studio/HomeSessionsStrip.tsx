'use client';

import Link from 'next/link';
import type { HomeSessionsStrip as HomeSessionsStripData } from '@/lib/home-view';
import type { SessionIndexRow } from '@/lib/studio-client';
import { describeLifecycle, type CancelOutcome } from '@/lib/session-lifecycle-client';
import { sessionKindTitle } from '@/lib/session-kind-meta';
import { CancelOutcomeNotice } from '@/components/studio/session/CancelOutcomeNotice';
import { CancelSessionButton } from '@/components/studio/session/CancelSessionButton';
import { NeedsYouChip } from '@/components/studio/SessionsIndex';

// ---------------------------------------------------------------------------
// HomeSessionsStrip — Home's sessions strip (W6-B11; W7-B1 IA pass:
// `data-section="sessions-needing-you"`, the goal pack's named-strip
// contract). Extracted out of app/page.tsx so its data-* contract gets a
// `renderToStaticMarkup` pin (`lib/home-sessions-strip-render.test.ts`).
//
// W7-B1 changes (docs/roadmaps/wave-7-walkthrough-findings.md):
//   - home-sessions-01/02: the strip is NAMED on screen ("Sessions needing
//     you") — one of Home's two named, visually distinct strips (the other
//     is `kbs-needing-attention`, app/page.tsx).
//   - home-sessions-31: the section NEVER unmounts at zero — it owns Home's
//     only link to /sessions, and navigation must survive an empty data
//     set. Empty renders an honest one-liner + a start-a-session link.
//   - home-sessions-32: a truncated strip SAYS so — "showing 4 of 13" +
//     "+9 more →", so the "N need you" pill and the visible cards reconcile.
//   - home-sessions-20: cards name their kind by the descriptor's own title
//     (`sessionKindTitle`), raw id intact on `data-session-kind`.
//   - home-sessions-03: the needs-you signal is the shared labelled
//     `NeedsYouChip` (its own `needs-you` status token + aria-label) —
//     never a bare dot borrowing `data-status="retrying"`.
//
// Pure, props-driven — no fetch, no useEffect. `strip` is
// `home-view.ts`'s `buildHomeSessionsStrip(sessions)` output, computed by
// the caller (app/page.tsx); this component only renders it.
// ---------------------------------------------------------------------------

export function HomeSessionsStrip({
  strip,
  onCancelled,
  lastCancel = null,
}: {
  strip: HomeSessionsStripData;
  /** W7-A2 — fired after a card's cancel succeeds so Home refetches;
   *  W7A2-02: carries the cancel's real outcome. */
  onCancelled?: (row: SessionIndexRow, outcome: CancelOutcome) => void;
  /** W7A2-02 — the last cancel from this strip (held by Home so the notice
   *  survives the refetch that drops the card). */
  lastCancel?: { row: SessionIndexRow; outcome: CancelOutcome } | null;
}) {
  const shown = strip.cards.length;
  const truncated = strip.totalCount > shown;

  return (
    <section
      data-section="sessions-needing-you"
      aria-label="Sessions needing you"
      data-active-session-count={strip.totalCount}
      data-needs-you-count={strip.needsYouCount}
      data-session-cards-shown={shown}
      style={{ marginBottom: 32 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          Sessions needing you
        </h2>
        {strip.needsYouCount > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ember)',
              background: 'var(--panel-2)',
              border: '1px solid var(--ember)',
              borderRadius: 999,
              padding: '1px 8px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {strip.needsYouCount} need you
          </span>
        )}
        {/* W7-B1 (home-sessions-32): the cards below are a SLICE — say so,
            right where the "N need you" number lives, so the two reconcile. */}
        {truncated && (
          <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            showing {shown} of {strip.totalCount}
          </span>
        )}
        <Link
          href="/sessions"
          data-action="view-all-sessions"
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}
        >
          all sessions ({strip.totalCount}) →
        </Link>
      </div>
      {/* W7A2-02 — what the last cancel from this strip actually did (the
          card itself has dropped out; the notice is the operator's trace). */}
      {lastCancel !== null && (
        <div style={{ marginBottom: 10 }}>
          <CancelOutcomeNotice outcome={lastCancel.outcome} subject={`${lastCancel.row.kind} · ${lastCancel.row.sessionId}`} />
        </div>
      )}
      {strip.totalCount === 0 ? (
        // W7-B1 (home-sessions-31): an honest empty line — never an
        // unmounted section that takes Home's only /sessions link with it.
        <div
          data-component="sessions-strip-empty"
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 12.5, color: 'var(--dim)', padding: '8px 2px' }}
        >
          <span style={{ fontStyle: 'italic' }}>Nothing in flight right now.</span>
          <Link
            href="/sessions"
            data-action="start-a-session"
            style={{ color: 'var(--ember)', fontWeight: 600, textDecoration: 'none', fontSize: 12.5 }}
          >
            start a session →
          </Link>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {strip.cards.map((s) => (
          // W7-A2 — the card is a DIV wrapping the link + a cancel control
          // (a button inside an <a> is nested-interactive).
          <div
            key={`${s.kind}-${s.sessionId}`}
            data-session-card
            data-session-kind={s.kind}
            data-session-id={s.sessionId}
            data-session-phase={s.phase}
            data-needs-you={s.needsYou}
            data-session-state={s.state}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '10px 12px',
              background: 'var(--panel)',
              border: `1px solid ${s.state === 'crashed' ? 'var(--red, #f87171)' : s.needsYou ? 'var(--ember)' : 'var(--line)'}`,
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              position: 'relative',
            }}
          >
            {/* W7-B1 (home-sessions-03): the labelled chip, not a colour-only
                dot hardcoded to "retrying". */}
            {s.needsYou && (
              <span style={{ position: 'absolute', top: 8, right: 8 }}>
                <NeedsYouChip />
              </span>
            )}
            <Link href={s.href} data-action="open-session" style={{ display: 'flex', flexDirection: 'column', gap: 4, textDecoration: 'none', color: 'inherit' }}>
              {/* W7-B1 (home-sessions-20): the descriptor's own title. */}
              <span style={{ fontSize: 11.5, fontWeight: 600, paddingRight: s.needsYou ? 84 : 0 }}>
                {sessionKindTitle(s.kind)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{s.project}</span>
              <span style={{ fontSize: 11, color: s.needsYou ? 'var(--ember)' : 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                {s.phase}
              </span>
              <span
                data-session-state-chip
                title={s.error ?? undefined}
                style={{
                  fontSize: 10.5, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: s.state === 'crashed' ? 'var(--red, #f87171)' : s.state === 'stalled' ? 'var(--ember)' : 'var(--faint)',
                }}
              >
                {describeLifecycle(s.state, s.error, s.idleMs, s.phase)}
              </span>
            </Link>
            {s.state !== 'terminal' && (
              <div style={{ marginTop: 4 }}>
                <CancelSessionButton kind={s.kind} sessionId={s.sessionId} project={s.project} compact onCancelled={(outcome) => onCancelled?.(s, outcome)} />
              </div>
            )}
          </div>
        ))}
        {/* W7-B1 (home-sessions-32): the overflow card — the +N that makes
            the header's arithmetic visible and clickable. */}
        {truncated && (
          <Link
            href="/sessions"
            data-action="sessions-strip-more"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '10px 12px', border: '1px dashed var(--line-2)', borderRadius: 'var(--radius-sm)',
              color: 'var(--dim)', textDecoration: 'none', fontSize: 12.5, fontFamily: 'var(--font-mono)',
            }}
          >
            +{strip.totalCount - shown} more →
          </Link>
        )}
      </div>
      )}
    </section>
  );
}
