'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { SessionIndexRow } from '@/lib/studio-client';
import { StudioPage } from '@/components/StudioPage';
import { describeLifecycle, type CancelOutcome } from '@/lib/session-lifecycle-client';
import { CancelOutcomeNotice } from '@/components/studio/session/CancelOutcomeNotice';
import { CancelSessionButton } from '@/components/studio/session/CancelSessionButton';
import { FetchErrorState } from '@/components/FetchErrorState';

// ---------------------------------------------------------------------------
// SessionsIndexBody — the /sessions in-flight index (W6-B11).
//
// Mirrors mockups/session-surface-v1/sessions-index.html's table: kind,
// project, phase (with a needs-you indicator), model tier, updated, resume
// link. `sessions` arrives ALREADY sorted needs-you-first-then-updated-desc
// off the bridge (`GET /api/studio/sessions?active=1` ->
// `sortAndCapSessionIndexRows`, cli/ui-bridge.ts) — this component renders
// that order verbatim, never re-sorting client-side.
//
// Pure, props-driven presentational component — no fetch, no `useEffect` —
// so it renders identically under `react-dom/server`'s `renderToStaticMarkup`
// (`lib/sessions-index-render.test.ts`) and inside the real
// `app/sessions/page.tsx` fetch-and-`useState` wrapper, mirroring
// `ProjectsIndexBody`'s established split exactly.
//
// Kickoff CTAs (the empty state) — the 5 generic kickoff kinds
// (`/sessions/<kind>/new`, `app/sessions/[kind]/new/page.tsx`'s own
// KICKOFF_KINDS) plus architect's bespoke native entry (`/architect/new`,
// ADR-043 amendment §4 — architect never gets a generic kickoff row).
// ---------------------------------------------------------------------------

const KICKOFF_LINKS: readonly { kind: string; label: string; href: string }[] = [
  { kind: 'architect', label: 'Planning session', href: '/architect/new' },
  { kind: 'instructions', label: 'Instructions session', href: '/sessions/instructions/new' },
  { kind: 'demo', label: 'Demo capability session', href: '/sessions/demo/new' },
  { kind: 'project-brain', label: 'Brain creation session', href: '/sessions/project-brain/new' },
  { kind: 'kb-cleanup', label: 'KB cleanup session', href: '/sessions/kb-cleanup/new' },
  { kind: 'authoring', label: 'Authoring session', href: '/sessions/authoring/new' },
];

const cellHeadStyle: CSSProperties = {
  padding: '10px 14px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontWeight: 600,
};
const cellStyle: CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };

/** `''` (honest-absent — the wire never fabricates a timestamp; see
 *  `SessionIndexRow.updatedAt`'s own header, cli/ui-bridge.ts) and a
 *  malformed value both render as "—", never a garbage `Invalid Date`
 *  string on screen. */
function formatUpdatedAt(iso: string): string {
  if (!iso) return '—';
  const parsedMs = Date.parse(iso);
  if (Number.isNaN(parsedMs)) return '—';
  return new Date(parsedMs).toLocaleString();
}

/** W7-A2 — the lifecycle chip's colour per state (the chip text itself is
 *  `describeLifecycle`, shared with Home and the session page). */
function stateTone(state: SessionIndexRow['state']): string {
  switch (state) {
    case 'crashed': return 'var(--red, #f87171)';
    case 'stalled': return 'var(--ember)';
    case 'awaiting-operator': return 'var(--ember)';
    case 'terminal': return 'var(--faint)';
    default: return 'var(--dim)';
  }
}

export type SessionsIndexFetchError = { message: string; status?: number };

/** W7A2-02 — the last successful cancel on this page: the row it was for
 *  and what the bridge said it did. Held by the owning page (survives the
 *  refetch that drops the row from the active set). */
export type SessionsLastCancel = { row: SessionIndexRow; outcome: CancelOutcome };

export function SessionsIndexBody({
  sessions,
  ready,
  onCancelled,
  lastCancel = null,
  error = null,
  onRetry,
}: {
  sessions: SessionIndexRow[];
  ready: boolean;
  /** W7-A2 — fired after a row's cancel POST succeeds so the owning page
   *  refetches; this component stays props-driven and never re-derives a
   *  row's state itself. W7A2-02: carries the cancel's real outcome. */
  onCancelled?: (row: SessionIndexRow, outcome: CancelOutcome) => void;
  lastCancel?: SessionsLastCancel | null;
  /** W7-A1 (home-sessions-29): the last fetch's failure — renders the shared
   *  failure state INSTEAD of the "No sessions in flight" zero-state. */
  error?: SessionsIndexFetchError | null;
  onRetry?: () => void;
}) {
  // Honest zero-state: only once the first fetch has actually settled
  // (`ready`) AND the set is genuinely empty AND the fetch did not fail — an
  // in-flight fetch must never flash a false "no sessions" before real data
  // arrives, and a FAILED fetch must never claim "nothing is waiting on you".
  const isEmpty = ready && !error && sessions.length === 0;

  return (
    <StudioPage
      dataPage="sessions-index"
      ready={ready}
      data={{
        'data-session-count': sessions.length,
        'data-fetch-status': error ? 'error' : ready ? 'ok' : 'loading',
      }}
      eyebrow="forge studio"
      title="Sessions"
      lede="Every in-flight interactive session, across kinds and projects. Sorted needs-you first, then last-updated. Terminal sessions are not listed here — they live on their artifacts."
    >
      {error ? (
        <div style={{ marginBottom: sessions.length > 0 ? 18 : 0 }}>
          <FetchErrorState what="sessions" error={error.message} status={error.status} onRetry={onRetry} />
        </div>
      ) : null}
      {/* W7A2-02 — what the last cancel on this page actually did; the row
          itself has (rightly) dropped out of the active set, so the notice
          is the only trace the operator gets. */}
      {lastCancel !== null && (
        <div style={{ marginBottom: 14 }}>
          <CancelOutcomeNotice outcome={lastCancel.outcome} subject={`${lastCancel.row.kind} · ${lastCancel.row.sessionId}`} />
        </div>
      )}
      {error && sessions.length === 0 ? null : isEmpty ? (
        <section
          data-section="sessions-empty"
          aria-label="No sessions in flight"
          style={{
            padding: '28px 30px', background: 'var(--panel)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: 14,
          }}
        >
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            No sessions in flight
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6, margin: 0 }}>
            Nothing is waiting on you right now. Start a new session below.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {KICKOFF_LINKS.map((k) => (
              <Link
                key={k.kind}
                className="btn"
                href={k.href}
                data-action={`kickoff-${k.kind}`}
                style={{ textDecoration: 'none' }}
              >
                {k.label}
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section
          data-section="sessions-table"
          data-session-count={sessions.length}
          style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflowX: 'auto' }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line-2)', background: 'var(--panel-2)' }}>
                <th style={cellHeadStyle}>Kind</th>
                <th style={cellHeadStyle}>Project</th>
                <th style={cellHeadStyle}>Phase</th>
                <th style={cellHeadStyle}>State</th>
                <th style={cellHeadStyle}>Model</th>
                <th style={cellHeadStyle}>Updated</th>
                <th style={cellHeadStyle} />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={`${s.kind}-${s.sessionId}`}
                  data-session-kind={s.kind}
                  data-session-phase={s.phase}
                  data-needs-you={s.needsYou}
                  data-session-state={s.state}
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <td style={cellStyle}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, textTransform: 'capitalize', color: 'var(--text)' }}>
                      {s.kind}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--steel)' }}>{s.project}</span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: s.needsYou ? 'var(--ember)' : 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                      {s.phase}
                    </span>
                    {s.needsYou && (
                      <span className="status-dot" data-status="retrying" title="needs you" style={{ marginLeft: 8 }} />
                    )}
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 360 }}>
                    {/* W7-A2 — the bridge-derived lifecycle, verbatim: a crashed
                        row shows the runner's own error, a stalled row the
                        silence; never re-derived from phase/timestamps here. */}
                    <span
                      data-session-state-chip
                      title={s.error ?? undefined}
                      style={{
                        display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontSize: 11.5, color: stateTone(s.state), fontFamily: 'var(--font-mono)', verticalAlign: 'middle',
                      }}
                    >
                      {describeLifecycle(s.state, s.error, s.idleMs, s.phase)}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{s.modelTier ?? '—'}</span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {formatUpdatedAt(s.updatedAt)}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    <Link
                      href={s.href}
                      data-action="resume-session"
                      style={{ color: 'var(--ember)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', marginRight: 10 }}
                    >
                      Open →
                    </Link>
                    {/* W7-A2 — cancel for every kind, from the row (two-step
                        confirm inside the button); a terminal row has nothing
                        to cancel. */}
                    {s.state !== 'terminal' && (
                      <CancelSessionButton kind={s.kind} sessionId={s.sessionId} project={s.project} compact onCancelled={(outcome) => onCancelled?.(s, outcome)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </StudioPage>
  );
}
