'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { fetchStudioSessions, type SessionIndexRow } from '@/lib/studio-client';
import { describeLifecycle } from '@/lib/session-lifecycle-client';

/**
 * OpenSessionsPanel (W7-B6, projects-19) — the project page used to be a
 * session factory: every agent button minted a NEW session while the page
 * never showed the ones already open. This lists THIS project's non-terminal
 * sessions (the same `GET /api/studio/sessions?active=1` read /sessions and
 * Home use) with resume links, so the operator lands back in an open session
 * instead of minting a duplicate. Cancel lives on the session shell (A2).
 *
 * Rendered only when there is something to show OR the read failed (an
 * honest read-failure line — never a silently-absent panel). data-* contract:
 * `data-section="project-open-sessions"`, `data-open-session-count`.
 */
export function OpenSessionsPanel({ projectId }: { projectId: string }): JSX.Element | null {
  const [rows, setRows] = useState<SessionIndexRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    fetchStudioSessions()
      .then((all) => {
        if (cancelled) return;
        setRows(all.filter((r) => r.project === projectId && !r.terminal));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error === null && (rows === null || rows.length === 0)) return null;

  return (
    <section
      data-section="project-open-sessions"
      data-open-session-count={rows?.length ?? 0}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px' }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
        Open sessions
      </div>
      {error !== null ? (
        <div data-open-sessions-error style={{ fontSize: 12, color: 'var(--red, #f87171)' }}>
          could not read this project&apos;s sessions: {error}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows?.map((r) => (
            <li key={`${r.kind}-${r.sessionId}`} data-open-session data-session-kind={r.kind} data-session-state={r.state} style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Link href={r.href} data-action="resume-open-session" style={{ color: 'var(--c-project)', textDecoration: 'none' }}>
                {r.kind} · {r.sessionId} →
              </Link>
              <span style={{ color: 'var(--faint)', fontSize: 11 }}>{r.phase} · {describeLifecycle(r.state, r.error, r.idleMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
