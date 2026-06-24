'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  listDemoSessions,
  type DemoSessionSummary,
  type DemoBuilderPhase,
} from '@/lib/bridge-client';
import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { StageHex } from '@/components/StageHex';
import { DemoReview } from '@/components/DemoReview';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { useNowTicker } from '@/lib/use-now-ticker';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { STATUS_COLOR } from '@/lib/status-colors';

/**
 * Demo-builder review surface (Stage B). Mirrors the instructions-creator
 * interview surface (`/instructions/<sid>`): the demo agent builds a
 * reproducible DEMO.html for the managed project, gates it for review, then
 * locks it. Reuses the same Studio chrome (StudioArchitectShell), the shared
 * StageHex primitive, and the live event tail (useCycleEvents).
 *
 * The `DemoBuilderPhase` union differs from the architect/instructions phases,
 * so a small local {@link demoHexMeta} maps it onto the shared StageHex
 * `{label, glow, frac, active}` shape rather than forcing the architect-hex
 * helpers.
 *
 * Phase handling:
 *   - generating | locking → Status + ArchitectActivityLog
 *   - awaiting-review → DemoReview (the DEMO.html gate + feedback/lock/abandon)
 *   - locked → success box, link back to the project
 *   - abandoned → status
 */

type DemoHexMeta = { label: string; glow: string; frac: number; active: boolean };

/** Demo phase → hex visual meta. generating/locking read active (working);
 *  awaiting-review needs the operator; locked is complete; abandoned is idle. */
function demoHexMeta(phase: DemoBuilderPhase): DemoHexMeta {
  switch (phase) {
    case 'generating':
      return { label: 'building the demo', glow: STATUS_COLOR.active, frac: 0.4, active: true };
    case 'awaiting-review':
      return { label: 'demo ready — your call', glow: STATUS_COLOR.attention, frac: 0.8, active: false };
    case 'locking':
      return { label: 'locking the demo in', glow: STATUS_COLOR.active, frac: 0.92, active: true };
    case 'locked':
      return { label: 'locked', glow: STATUS_COLOR.complete, frac: 1, active: false };
    case 'abandoned':
      return { label: 'abandoned', glow: STATUS_COLOR.idle, frac: 1, active: false };
    default:
      return { label: phase, glow: STATUS_COLOR.idle, frac: 0, active: false };
  }
}

export default function DemoBuilderPage({
  params,
}: {
  params: { sessionId: string };
}): JSX.Element {
  const sessionId = decodeURIComponent(params.sessionId);
  const cycleId = `_demo-${sessionId}`;

  const [session, setSession] = useState<DemoSessionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nowMs = useNowTicker();

  const loadSession = useCallback(() => {
    listDemoSessions()
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
    if (msg.type === 'demo-list-changed') loadSession();
  });

  const meta = session ? demoHexMeta(session.phase) : null;

  return (
    <StudioArchitectShell
      dataPage="demo-builder"
      ready={loaded}
      title="demo"
      idLabel={sessionId}
      maxWidth={1480}
      mainData={{ 'data-session-id': sessionId, 'data-demo-phase': session?.phase ?? '' }}
    >
      {!loaded ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading session…</div>
      ) : !session ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>
          Session not found (it may still be starting, or has been locked/abandoned).{' '}
          <Link href="/" style={{ color: 'var(--ember)' }}>
            Back to Forge Studio
          </Link>
          .
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          {meta && (
            <StageHex
              title="demo"
              component="demo-hex"
              statusLabel={meta.label}
              glow={meta.glow}
              frac={meta.frac}
              active={meta.active}
              events={events}
              nowMs={nowMs}
              extraData={{
                'data-demo-phase': session.phase,
                'data-demo-active': meta.active ? 'true' : 'false',
              }}
            />
          )}

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, fontWeight: 600 }}>
              Building DEMO.html
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>
              {session.project}
            </div>

            {(session.phase === 'generating' || session.phase === 'locking') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Status
                  label={
                    session.phase === 'locking'
                      ? 'Locking the demo in…'
                      : 'The demo agent is building the demo…'
                  }
                />
                <ArchitectActivityLog events={events} />
              </div>
            )}

            {session.phase === 'awaiting-review' && (
              <DemoReview
                project={session.project}
                sessionId={session.sessionId}
                demoUrl={session.demoUrl}
                iteration={session.iteration}
              />
            )}

            {session.phase === 'locked' && (
              <div
                data-section="demo-status"
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
                  Demo locked — reproducible from .forge/demo/.
                </span>
                <Link
                  href={`/projects/${encodeURIComponent(session.project)}`}
                  data-action="back-to-project"
                  style={btnLinkStyle}
                >
                  Back to the project →
                </Link>
              </div>
            )}

            {session.phase === 'abandoned' && <Status label="Demo abandoned." />}
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
      data-section="demo-status"
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
