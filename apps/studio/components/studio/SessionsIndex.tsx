'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { SessionIndexRow } from '@/lib/studio-client';
import { StudioPage } from '@/components/StudioPage';
import { describeLifecycle, type CancelOutcome } from '@/lib/session-lifecycle-client';
import { CancelOutcomeNotice } from '@/components/studio/session/CancelOutcomeNotice';
import { CancelSessionButton } from '@/components/studio/session/CancelSessionButton';
import { NeedsYouChip } from '@/components/studio/session/NeedsYouChip';
import { FetchErrorState } from '@/components/FetchErrorState';
import { KICKOFF_ENTRIES, sessionKindTitle } from '@/lib/session-kind-meta';
import {
  NO_SESSION_FILTERS,
  hasActiveSessionFilters,
  filterSessionRows,
  filterOptions,
  distinctSessionKinds,
  distinctSessionProjects,
  distinctSessionStates,
  type SessionFilters,
} from '@/lib/sessions-index-filter';

// ---------------------------------------------------------------------------
// SessionsIndexBody — the /sessions in-flight index (W6-B11; W7-B1 IA pass).
//
// Mirrors the retired session-surface-v1/sessions-index.html mockup's table
// (docs/reference/studio-copy.md): kind,
// project, phase (with a needs-you chip), model tier, updated, resume
// link. `sessions` arrives ALREADY sorted needs-you-first-then-updated-desc
// off the bridge (`GET /api/studio/sessions?active=1` ->
// `sortAndCapSessionIndexRows`, apps/forge/ui-bridge.ts) — this component renders
// that order verbatim, never re-sorting client-side. W7-B1 adds a FILTER
// bar (home-sessions-07): pure derivation via `lib/sessions-index-filter.ts`
// — filtering only REMOVES rows, never re-orders them, and the current
// filter state is mirrored to `data-filter-*` on the table section.
//
// Props-driven presentational component — no fetch, no `useEffect` — so it
// renders identically under `react-dom/server`'s `renderToStaticMarkup`
// (`lib/sessions-index-render.test.ts`) and inside the real
// `app/sessions/page.tsx` fetch-and-`useState` wrapper, mirroring
// `ProjectsIndexBody`'s established split. (The filter `useState` is
// render-safe: static markup renders the all-pass default.)
//
// Kickoff CTAs (W7-B1, crosscut-13/home-sessions-19): ONE shared list —
// `lib/session-kind-meta.ts`'s KICKOFF_ENTRIES (the generic
// `/sessions/<kind>/new` kinds, plus architect's bespoke `/architect/new`,
// ADR-043 amendment §4 — community-refresh was one of them until it was
// retired, W8-B5b WI-3) — rendered in
// BOTH the populated AND the empty state, so the only in-app way to start a
// session never disappears the moment work is in flight. The old
// hand-kept KICKOFF_LINKS array (which had drifted against the kickoff
// page's own list in both directions) is deleted, not shadowed.
//
// Kind labels (W7-B1, home-sessions-20/community-21): the descriptor's own
// authored title via `sessionKindTitle` — never the raw registry id pushed
// through CSS capitalize ("Kb-Cleanup").
// ---------------------------------------------------------------------------

const cellHeadStyle: CSSProperties = {
  padding: '10px 14px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontWeight: 600,
};
const cellStyle: CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
const filterSelectStyle: CSSProperties = {
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)',
  borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'var(--font-mono)',
};

/** `''` (honest-absent — the wire never fabricates a timestamp; see
 *  `SessionIndexRow.updatedAt`'s own header, apps/forge/ui-bridge.ts) and a
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

/** W7-B1 (crosscut-13 / home-sessions-19) — the kickoff CTA row, rendered in
 *  BOTH index states from the ONE shared KICKOFF_ENTRIES list. */
function KickoffRow(): JSX.Element {
  return (
    <section
      data-section="sessions-kickoff"
      aria-label="Start a new session"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}
    >
      <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Start new
      </span>
      {KICKOFF_ENTRIES.map((k) => (
        <Link
          key={k.kind}
          className="btn"
          href={k.href}
          data-action={`kickoff-${k.kind}`}
          style={{ textDecoration: 'none', fontSize: 12 }}
        >
          {k.label}
        </Link>
      ))}
    </section>
  );
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
  // W7-B1 (home-sessions-07) — the filter state lives here; every derivation
  // off it is pure (lib/sessions-index-filter.ts). Default = all-pass, so
  // the static render is byte-stable and the bridge's order is untouched.
  const [filters, setFilters] = useState<SessionFilters>(NO_SESSION_FILTERS);
  const filtered = filterSessionRows(sessions, filters);

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
      {/* W7-B1 (crosscut-13): the kickoff CTAs render whenever the read
          settled honestly — populated AND empty alike; only a FAILED read
          keeps them out (the failure state is the whole story then). */}
      {ready && !error && <KickoffRow />}
      {/* Review round 1: while the FIRST fetch is still in flight
          (`!ready`, no rows yet) render NO body at all — the filter-empty
          line below would otherwise claim "No sessions match these filters
          — 0 in flight in total" before any data exists, the exact false
          flash the isEmpty gate already forbids for the zero-state. */}
      {!ready && sessions.length === 0 ? null : error && sessions.length === 0 ? null : isEmpty ? (
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
            Nothing is waiting on you right now. Start a new session with the buttons above.
          </p>
        </section>
      ) : (
        <>
          {/* W7-B1 (home-sessions-07) — filter by kind / project / state /
              needs-you. Options come from the rows actually present (pure
              helpers), labels from the descriptors' own titles. */}
          {sessions.length > 0 && (
            <section
              data-section="sessions-filters"
              aria-label="Filter sessions"
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}
            >
              <select
                value={filters.kind}
                onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
                data-field="filter-kind"
                aria-label="Filter by kind"
                style={filterSelectStyle}
              >
                <option value="">all kinds</option>
                {/* Review round 1: `filterOptions` keeps the ACTIVE value in
                    the option list even when the live refetch removed its
                    last row — a controlled select whose value has no option
                    silently displays "all kinds" while the stale constraint
                    keeps filtering (contradictory UI). Same for project and
                    state below. */}
                {filterOptions(distinctSessionKinds(sessions), filters.kind).map((k) => (
                  <option key={k} value={k}>{sessionKindTitle(k)}</option>
                ))}
              </select>
              <select
                value={filters.project}
                onChange={(e) => setFilters({ ...filters, project: e.target.value })}
                data-field="filter-project"
                aria-label="Filter by project"
                style={filterSelectStyle}
              >
                <option value="">all projects</option>
                {filterOptions(distinctSessionProjects(sessions), filters.project).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                value={filters.state}
                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
                data-field="filter-state"
                aria-label="Filter by state"
                style={filterSelectStyle}
              >
                <option value="">all states</option>
                {filterOptions(distinctSessionStates(sessions), filters.state).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                type="button"
                data-action="filter-needs-you"
                aria-pressed={filters.needsYouOnly}
                onClick={() => setFilters({ ...filters, needsYouOnly: !filters.needsYouOnly })}
                style={{
                  fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  border: `1px solid ${filters.needsYouOnly ? 'var(--ember)' : 'var(--line)'}`,
                  color: filters.needsYouOnly ? 'var(--ember)' : 'var(--dim)',
                  background: 'var(--bg)', borderRadius: 999, padding: '4px 12px',
                }}
              >
                needs you only
              </button>
              {hasActiveSessionFilters(filters) && (
                <button
                  type="button"
                  data-action="clear-filters"
                  onClick={() => setFilters(NO_SESSION_FILTERS)}
                  style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  clear
                </button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                {filtered.length} of {sessions.length}
              </span>
            </section>
          )}
          <section
            data-section="sessions-table"
            data-session-count={filtered.length}
            data-filter-kind={filters.kind}
            data-filter-project={filters.project}
            data-filter-state={filters.state}
            data-filter-needs-you={filters.needsYouOnly ? 'true' : 'false'}
            style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflowX: 'auto' }}
          >
            {filtered.length === 0 ? (
              <div
                data-component="sessions-filter-empty"
                style={{ padding: '18px 20px', fontSize: 12.5, color: 'var(--dim)', fontStyle: 'italic' }}
              >
                No sessions match these filters — {sessions.length} in flight in total.
              </div>
            ) : (
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
                {filtered.map((s) => (
                  <tr
                    key={`${s.kind}-${s.sessionId}`}
                    data-session-kind={s.kind}
                    data-session-phase={s.phase}
                    data-needs-you={s.needsYou}
                    data-session-state={s.state}
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <td style={cellStyle}>
                      {/* W7-B1 (home-sessions-20/community-21): the
                          descriptor's own authored title, and a second
                          row-level click target into the session
                          (home-sessions-24's "the row itself is not
                          clickable"). The raw registry id stays on the
                          <tr>'s data-session-kind, untouched. */}
                      <Link
                        href={s.href}
                        data-action="open-session"
                        style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}
                      >
                        {sessionKindTitle(s.kind)}
                      </Link>
                    </td>
                    <td style={cellStyle}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--steel)' }}>{s.project}</span>
                    </td>
                    <td style={cellStyle}>
                      <span style={{ color: s.needsYou ? 'var(--ember)' : 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                        {s.phase}
                      </span>
                      {/* W7-B1 (home-sessions-03/24, community-24): a
                          labelled chip with its own status token — never
                          the borrowed "retrying", never colour-only. */}
                      {s.needsYou && (
                        <span style={{ marginLeft: 8, verticalAlign: 'middle', display: 'inline-flex' }}>
                          <NeedsYouChip />
                        </span>
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
            )}
          </section>
        </>
      )}
    </StudioPage>
  );
}
