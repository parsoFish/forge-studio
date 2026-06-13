'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  fetchArchitectSessions,
  type ArchitectSessionSummary,
} from '@/lib/bridge-client';
import { ArchitectStageHex } from '@/components/MomentHex';
import { ArchitectQuestionForm } from '@/components/ArchitectQuestionForm';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { PlanGate } from '@/components/PlanGate';
import { ScreenShell } from '@/components/ScreenShell';
import { useNowTicker } from '@/lib/use-now-ticker';
import { useCycleEvents } from '@/lib/use-cycle-events';

/**
 * ADR 020 — the dedicated architect / plan screen. Keeps the primary dashboard
 * uncluttered: this is where the operator runs the interview and reviews the
 * rich PLAN on its own page. Shows the focused architect hex (live tool bursts
 * from the session's event stream) plus the phase-appropriate feedback surface.
 */
export default function ArchitectSessionPage({
  params,
}: {
  params: { sessionId: string };
}): JSX.Element {
  const sessionId = decodeURIComponent(params.sessionId);
  const cycleId = `_architect-${sessionId}`;

  const [session, setSession] = useState<ArchitectSessionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nowMs = useNowTicker();

  // Resolve this session from the full list; re-fetch on architect changes.
  const loadSession = useCallback(() => {
    fetchArchitectSessions()
      .then((list) => {
        setSession(list.find((s) => s.sessionId === sessionId) ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sessionId]);
  useEffect(() => {
    loadSession();
    // Poll fallback for a just-created session whose status.json is still settling.
    const poll = setInterval(loadSession, 3000);
    return () => clearInterval(poll);
  }, [loadSession]);
  const events = useCycleEvents(cycleId, (msg) => {
    if (msg.type === 'architect-list-changed') loadSession();
  });

  return (
    <ScreenShell
      dataPage="architect-session"
      ready={loaded}
      title="architect"
      idLabel={sessionId}
      maxWidth={1100}
      mainData={{ 'data-session-id': sessionId, 'data-architect-phase': session?.phase ?? '' }}
    >
      {!loaded ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>Loading session…</div>
      ) : !session ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>
          Session not found (it may still be starting, or has been committed/rejected).{' '}
          <Link href="/dashboard" style={{ color: '#58a6ff' }}>Back to dashboard</Link>.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          <ArchitectStageHex phase={session.phase} events={events} nowMs={nowMs} />

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#e6edf3', marginBottom: 4, fontWeight: 600 }}>{session.idea}</div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {session.project}
            </div>

            <StuckWarning session={session} />

            {/* The question FORM only appears once the architect has emitted
                questions (phase 'awaiting-answers'); interviewing/drafting are
                working states that show the live activity panel + a status line. */}
            {session.phase === 'awaiting-answers' && session.questions && session.questions.length > 0 ? (
              <ArchitectQuestionForm
                project={session.project}
                sessionId={session.sessionId}
                round={session.round}
                questions={session.questions}
              />
            ) : null}

            {(session.phase === 'interviewing' || session.phase === 'drafting' || session.phase === 'finalizing') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Status
                  label={
                    session.phase === 'drafting'
                      ? 'The architect is drafting the plan…'
                      : session.phase === 'finalizing'
                      ? 'The architect is finalizing the plan…'
                      : `The architect is thinking… (round ${session.round})`
                  }
                />
                <ArchitectActivityLog events={events} />
              </div>
            )}

            {session.phase === 'awaiting-verdict' && (
              <PlanGate
                fullPage
                project={session.project}
                sessionId={session.sessionId}
                planUrl={session.planUrl}
                idea={session.idea}
              />
            )}

            {session.phase === 'committed' && (
              <div
                data-section="architect-status"
                style={{ border: '1px solid #2ea04366', borderRadius: 10, padding: '16px 18px', background: '#07140d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
              >
                <span style={{ fontSize: 13, color: '#3fb950' }}>
                  Approved — manifests queued; the autonomous loop is building it now.
                </span>
                <Link
                  href="/dashboard"
                  data-action="watch-it-build"
                  style={{ flex: '0 0 auto', fontSize: 13, fontWeight: 600, color: '#fff', background: '#238636', border: '1px solid #30363d', borderRadius: 6, padding: '6px 14px', textDecoration: 'none' }}
                >
                  Watch it build →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </ScreenShell>
  );
}

function Status({ label }: { label: string }): JSX.Element {
  return (
    <div
      data-section="architect-status"
      style={{ border: '1px solid #30363d', borderRadius: 10, padding: '14px 18px', background: '#0d1117', fontSize: 13, color: '#8b949e' }}
    >
      {label}
    </div>
  );
}

const WORKING_PHASES = new Set<ArchitectSessionSummary['phase']>(['interviewing', 'drafting', 'finalizing']);
const STALE_THRESHOLD_MS = 120_000;

function StuckWarning({ session }: { session: ArchitectSessionSummary }): JSX.Element | null {
  if (!WORKING_PHASES.has(session.phase)) return null;
  if ((session.staleMs ?? 0) <= STALE_THRESHOLD_MS) return null;
  const staleMinutes = Math.round((session.staleMs ?? 0) / 60_000);
  return (
    <div
      data-architect-stale="true"
      data-architect-stale-ms={session.staleMs}
      style={{
        marginBottom: 12,
        border: '1px solid #9e6a0388',
        borderRadius: 8,
        padding: '10px 14px',
        background: '#1a110033',
        fontSize: 13,
        color: '#d29922',
      }}
    >
      ⚠ No architect activity for {staleMinutes}m — it may have stalled.
      Check{' '}
      <code style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
        _logs/_architect-{session.sessionId}/stderr.log
      </code>{' '}
      or re-run.
    </div>
  );
}
