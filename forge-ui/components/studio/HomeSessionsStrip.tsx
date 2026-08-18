'use client';

import Link from 'next/link';
import type { HomeSessionsStrip as HomeSessionsStripData } from '@/lib/home-view';
import type { SessionIndexRow } from '@/lib/studio-client';
import { describeLifecycle } from '@/lib/session-lifecycle-client';
import { CancelSessionButton } from '@/components/studio/session/CancelSessionButton';

// ---------------------------------------------------------------------------
// HomeSessionsStrip — Home's active-sessions strip (W6-B11, the IA-4 marked
// slot). Extracted out of app/page.tsx (review fix) so its data-* contract
// (section/counts/cards) gets a `renderToStaticMarkup` pin, mirroring
// `SessionsIndexBody`'s own split (`components/studio/SessionsIndex.tsx` +
// `lib/sessions-index-render.test.ts`).
//
// Mirrors mockups/session-surface-v1/sessions-index.html's "Home
// active-sessions strip" variant: <=4 cards, needs-you first, "N need you"
// in the header, overflow to /sessions. Renders NOTHING when there is no
// in-flight session — a real condition, mirroring the attention strip's own
// "never on mere existence" rule.
//
// Pure, props-driven — no fetch, no useEffect. `strip` is
// `home-view.ts`'s `buildHomeSessionsStrip(sessions)` output, computed by
// the caller (app/page.tsx); this component only renders it.
// ---------------------------------------------------------------------------

export function HomeSessionsStrip({
  strip,
  onCancelled,
}: {
  strip: HomeSessionsStripData;
  /** W7-A2 — fired after a card's cancel succeeds so Home refetches. */
  onCancelled?: (row: SessionIndexRow) => void;
}) {
  if (strip.totalCount === 0) return null;

  return (
    <section
      data-section="active-sessions"
      aria-label="Active in-flight sessions"
      data-active-session-count={strip.totalCount}
      data-needs-you-count={strip.needsYouCount}
      style={{ marginBottom: 32 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          Active sessions
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
        <Link
          href="/sessions"
          data-action="view-all-sessions"
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}
        >
          all sessions ({strip.totalCount}) →
        </Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {strip.cards.map((s) => (
          // W7-A2 — the card is a DIV wrapping the link + a cancel control
          // (a button inside an <a> is nested-interactive; the whole card
          // used to be the <Link>). Layout otherwise unchanged (B1 owns
          // Home's IA — this lane adds the button only).
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
            {s.needsYou && (
              <span
                className="status-dot"
                data-status="retrying"
                title="needs you"
                style={{ position: 'absolute', top: 10, right: 10 }}
              />
            )}
            <Link href={s.href} data-action="open-session" style={{ display: 'flex', flexDirection: 'column', gap: 4, textDecoration: 'none', color: 'inherit' }}>
              <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', textTransform: 'capitalize' }}>
                {s.kind}
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
                {describeLifecycle(s.state, s.error, s.idleMs)}
              </span>
            </Link>
            {s.state !== 'terminal' && (
              <div style={{ marginTop: 4 }}>
                <CancelSessionButton kind={s.kind} sessionId={s.sessionId} project={s.project} compact onCancelled={() => onCancelled?.(s)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
