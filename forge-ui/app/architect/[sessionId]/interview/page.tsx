'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  fetchArchitectSessions,
  type ArchitectSessionSummary,
} from '@/lib/bridge-client';
import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { StageHex } from '@/components/StageHex';
import { ArchitectQuestionForm } from '@/components/ArchitectQuestionForm';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { useNowTicker } from '@/lib/use-now-ticker';
import { useCycleEvents } from '@/lib/use-cycle-events';
import {
  architectHexMeta,
  isArchitectWorking,
  isSessionStale,
} from '@/lib/architect-hex';

/**
 * Native Studio architect interview surface (M7-4, ADR-031). Replaces the
 * retired ScreenShell/MomentHex standalone `/architect/<sid>` screen: the
 * interview now runs inside Studio chrome (StudioNav + data-page), reusing
 * ArchitectQuestionForm + ArchitectActivityLog + the shared StageHex.
 *
 * The PLAN gate is no longer embedded here — once the architect reaches
 * `awaiting-verdict` the operator is routed to the native gate surface
 * `/artifact?run=_architect-<sid>&type=plan&mode=gate` (the path M7-3 wired).
 *
 * P1 (stale), P2 (free-text override), P3 (activity panel) are preserved with
 * identical data-* semantics. P4 (real architect cost) is asserted downstream
 * on the Studio flow monitor (M7-1).
 */
export default function ArchitectInterviewPage({
  params,
}: {
  params: { sessionId: string };
}): JSX.Element {
  const sessionId = decodeURIComponent(params.sessionId);
  const cycleId = `_architect-${sessionId}`;

  const [session, setSession] = useState<ArchitectSessionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nowMs = useNowTicker();

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
    const poll = setInterval(loadSession, 3000);
    return () => clearInterval(poll);
  }, [loadSession]);

  const events = useCycleEvents(cycleId, (msg) => {
    if (msg.type === 'architect-list-changed') loadSession();
  });

  const meta = session ? architectHexMeta(session.phase) : null;
  const active = session ? isArchitectWorking(session.phase) : false;
  const stale = session ? isSessionStale(session) : false;

  return (
    <StudioArchitectShell
      dataPage="architect-interview"
      ready={loaded}
      title="architect"
      idLabel={sessionId}
      mainData={{ 'data-session-id': sessionId, 'data-architect-phase': session?.phase ?? '' }}
    >
      {!loaded ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading session…</div>
      ) : !session ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>
          Session not found (it may still be starting, or has been committed/rejected).{' '}
          <Link href="/architect/new" style={{ color: 'var(--ember)' }}>
            Start a new idea
          </Link>
          .
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          {meta && (
            <StageHex
              title="architect"
              component="architect-hex"
              statusLabel={meta.label}
              glow={meta.glow}
              frac={meta.frac}
              active={active}
              events={events}
              nowMs={nowMs}
              extraData={{
                'data-architect-phase': session.phase,
                'data-architect-active': active ? 'true' : 'false',
              }}
            />
          )}

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, fontWeight: 600 }}>
              {session.idea}
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>
              {session.project}
            </div>

            {stale && <StuckWarning session={session} />}

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Status label="Plan ready — opening the review gate…" />
                <Link
                  href={`/artifact?run=_architect-${encodeURIComponent(sessionId)}&type=plan&mode=gate`}
                  data-action="open-plan"
                  style={btnLinkStyle}
                >
                  Review the plan →
                </Link>
              </div>
            )}

            {session.phase === 'committed' && (
              <div
                data-section="architect-status"
                style={{
                  border: '1px solid rgba(74,222,128,.4)',
                  borderRadius: 10,
                  padding: '16px 18px',
                  background: 'rgba(74,222,128,.07)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--green)' }}>
                  Approved — manifests queued; the autonomous loop is building it now.
                </span>
                <Link href="/flows/forge-cycle" data-action="watch-it-build" style={btnLinkStyle}>
                  Watch it build →
                </Link>
              </div>
            )}

            {session.phase === 'rejected' && (
              <Status label="Plan rejected — start a new idea when you're ready." />
            )}
          </div>
        </div>
      )}
    </StudioArchitectShell>
  );
}

const btnLinkStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: '#238636',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '6px 14px',
  textDecoration: 'none',
  alignSelf: 'flex-start',
};

function Status({ label }: { label: string }): JSX.Element {
  return (
    <div
      data-section="architect-status"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 18px',
        background: 'var(--panel)',
        fontSize: 13,
        color: 'var(--dim)',
      }}
    >
      {label}
    </div>
  );
}

/** P1 — stale-session warning. Mirrors the retired screen's StuckWarning,
 *  driven by the shared {@link isSessionStale} predicate. */
function StuckWarning({ session }: { session: ArchitectSessionSummary }): JSX.Element {
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
      ⚠ No architect activity for {staleMinutes}m — it may have stalled. Check{' '}
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        _logs/_architect-{session.sessionId}/stderr.log
      </code>{' '}
      or re-run.
    </div>
  );
}
