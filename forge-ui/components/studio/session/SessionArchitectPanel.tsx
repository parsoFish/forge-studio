'use client';

import { useState } from 'react';
import Link from 'next/link';

import { rerunArchitectSession, type ArchitectSessionSummary, type EventLogEntry } from '@/lib/bridge-client';
import { StageHex } from '@/components/StageHex';
import { ArchitectQuestionForm } from '@/components/ArchitectQuestionForm';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { architectHexMeta, isArchitectWorking, isSessionStale } from '@/lib/architect-hex';

// ---------------------------------------------------------------------------
// SessionArchitectPanel — the architect kind's live interactive affordance,
// carried over UNCHANGED from `/architect/[sessionId]/interview` (R2-10 PR2,
// WI-7): the stale-warning + one-click re-run, the question form, the
// working-phase activity log, the plan-gate handoff, and the committed/
// rejected terminal states. Every `data-action`/`data-section`/`data-component`
// name below is byte-identical to the retired page's — the journeys that
// drive it by name must not need to change when this panel replaces it.
// ---------------------------------------------------------------------------

export function SessionArchitectPanel({
  session,
  events,
  nowMs,
}: {
  session: ArchitectSessionSummary;
  events: EventLogEntry[];
  nowMs: number;
}): JSX.Element {
  const meta = architectHexMeta(session.phase);
  const active = isArchitectWorking(session.phase);
  const stale = isSessionStale(session);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 180px' }}>
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
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {stale && <StuckWarning session={session} />}

        {session.phase === 'awaiting-answers' && session.questions && session.questions.length > 0 ? (
          <ArchitectQuestionForm
            project={session.project}
            sessionId={session.sessionId}
            round={session.round}
            questions={session.questions}
          />
        ) : null}

        {(session.phase === 'interviewing' || session.phase === 'exploring' || session.phase === 'drafting' || session.phase === 'finalizing') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Status
              label={
                session.phase === 'exploring'
                  ? 'The architect is exploring edge cases…'
                  : session.phase === 'drafting'
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
              href={`/artifact?run=_architect-${encodeURIComponent(session.sessionId)}&type=plan&mode=gate`}
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
            <Link href="/flows/forge-develop" data-action="watch-it-build" style={btnLinkStyle}>
              Watch it build →
            </Link>
          </div>
        )}

        {session.phase === 'rejected' && (
          <Status label="Plan rejected — start a new idea when you're ready." />
        )}
      </div>
    </div>
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

/** P1 — stale-session warning, with the F5 one-click re-run affordance. */
function StuckWarning({ session }: { session: ArchitectSessionSummary }): JSX.Element {
  const staleMinutes = Math.round((session.staleMs ?? 0) / 60_000);
  const [rerunState, setRerunState] = useState<'idle' | 'rerunning' | 'error'>('idle');

  async function onRerun(): Promise<void> {
    if (rerunState === 'rerunning') return;
    setRerunState('rerunning');
    try {
      const res = await rerunArchitectSession(session.project, session.sessionId);
      setRerunState(res.ok ? 'idle' : 'error');
    } catch {
      setRerunState('error');
    }
  }

  return (
    <div
      data-architect-stale="true"
      data-architect-stale-ms={session.staleMs}
      data-rerun-state={rerunState}
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
      <div>
        ⚠ No architect activity for {staleMinutes}m — it may have stalled. Check{' '}
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          _logs/_architect-{session.sessionId}/stderr.log
        </code>{' '}
        or re-run below.
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => void onRerun()}
          disabled={rerunState === 'rerunning'}
          data-action="architect-rerun"
          style={{
            background: rerunState === 'rerunning' ? '#21262d' : '#9e6a03',
            color: '#fff',
            border: '1px solid #9e6a0388',
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: rerunState === 'rerunning' ? 'not-allowed' : 'pointer',
          }}
        >
          {rerunState === 'rerunning' ? 'Re-running…' : 'Re-run'}
        </button>
        {rerunState === 'error' && (
          <span style={{ color: '#f85149', fontSize: 12 }}>Failed to re-run — try again.</span>
        )}
      </div>
    </div>
  );
}
