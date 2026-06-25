'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  listInstructionsSessions,
  instructionsBrief,
  type InstructionsSessionSummary,
} from '@/lib/bridge-client';
import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { StageHex } from '@/components/StageHex';
import { SessionBriefing } from '@/components/SessionBriefing';
import { InstructionsQuestionForm } from '@/components/InstructionsQuestionForm';
import { InstructionsVerdict } from '@/components/InstructionsVerdict';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { useNowTicker } from '@/lib/use-now-ticker';
import { useCycleEvents } from '@/lib/use-cycle-events';
import {
  architectHexMeta,
  isArchitectWorking,
  isSessionStale,
} from '@/lib/architect-hex';

/**
 * Instructions-creator interview surface (Stage A). Mirrors the native Studio
 * architect interview (`/architect/<sid>`): the instructions agent explores the
 * repo, poses an optional interview, drafts AGENTS.md, gates the draft, then
 * writes it. Reuses the same Studio chrome (StudioArchitectShell), the shared
 * StageHex primitive, and the architect-hex phase→hex mapping — the
 * `InstructionsPhase` union is identical to `ArchitectPhase`.
 *
 * Phase handling:
 *   - awaiting-answers (+questions) → InstructionsQuestionForm
 *   - interviewing | drafting | finalizing → Status + ArchitectActivityLog
 *   - awaiting-verdict → InstructionsVerdict (draft gate)
 *   - committed → success box, link back to the project builder
 *   - rejected → status
 */
export default function InstructionsInterviewPage({
  params,
}: {
  params: { sessionId: string };
}): JSX.Element {
  const sessionId = decodeURIComponent(params.sessionId);
  const cycleId = `_instructions-${sessionId}`;

  const [session, setSession] = useState<InstructionsSessionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nowMs = useNowTicker();

  const loadSession = useCallback(() => {
    listInstructionsSessions()
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
    if (msg.type === 'instructions-list-changed') loadSession();
  });

  const meta = session ? architectHexMeta(session.phase) : null;
  const active = session ? isArchitectWorking(session.phase) : false;
  const stale = session ? isSessionStale(session) : false;

  return (
    <StudioArchitectShell
      dataPage="instructions-interview"
      ready={loaded}
      title="instructions"
      idLabel={sessionId}
      maxWidth={1320}
      mainData={{ 'data-session-id': sessionId, 'data-instructions-phase': session?.phase ?? '' }}
    >
      {!loaded ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading session…</div>
      ) : !session ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>
          Session not found (it may still be starting, or has been committed/rejected).{' '}
          <Link href="/" style={{ color: 'var(--ember)' }}>
            Back to Forge Studio
          </Link>
          .
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          {meta && (
            <StageHex
              title="instructions"
              component="instructions-hex"
              statusLabel={meta.label}
              glow={meta.glow}
              frac={meta.frac}
              active={active}
              events={events}
              nowMs={nowMs}
              extraData={{
                'data-instructions-phase': session.phase,
                'data-instructions-active': active ? 'true' : 'false',
              }}
            />
          )}

          <div style={{ minWidth: 0 }}>
            <Link href={`/projects/${encodeURIComponent(session.project)}`} data-action="back-to-project" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)', textDecoration: 'none', marginBottom: 12 }}>← Back to project</Link>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, fontWeight: 600 }}>
              Authoring AGENTS.md
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>
              {session.project}
            </div>

            {stale && <StuckWarning session={session} />}

            {session.phase === 'briefing' && (
              <SessionBriefing
                heading="Instructions agent"
                modeLabel={session.mode === 'edit' ? 'edit AGENTS.md' : 'create AGENTS.md'}
                contextLabel={
                  session.currentInstructionsFile ? `Current ${session.currentInstructionsFile}` : undefined
                }
                contextContent={session.currentInstructions}
                notesPlaceholder={
                  session.mode === 'edit'
                    ? 'What should change about the current instructions? (optional)'
                    : 'Anything the agent should know up front? (optional)'
                }
                onSubmit={(notes) =>
                  instructionsBrief({
                    project: session.project,
                    sessionId: session.sessionId,
                    brief: notes,
                  }).then(() => loadSession())
                }
              />
            )}

            {session.phase === 'awaiting-answers' && session.questions && session.questions.length > 0 ? (
              <InstructionsQuestionForm
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
                      ? 'The instructions agent is drafting AGENTS.md…'
                      : session.phase === 'finalizing'
                      ? 'The instructions agent is writing AGENTS.md…'
                      : `The instructions agent is exploring the repo… (round ${session.round})`
                  }
                />
                <ArchitectActivityLog events={events} />
              </div>
            )}

            {session.phase === 'awaiting-verdict' && (
              <InstructionsVerdict
                project={session.project}
                sessionId={session.sessionId}
                draftUrl={session.draftUrl}
                onSettled={() => loadSession()}
              />
            )}

            {session.phase === 'committed' && (
              <div
                data-section="instructions-status"
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
                  AGENTS.md written — instructions are live.
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

            {session.phase === 'rejected' && (
              <Status label="Instructions draft rejected — start again when ready." />
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
      data-section="instructions-status"
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

/** Stale-session warning — driven by the shared {@link isSessionStale} predicate
 *  (the instructions runner shares the architect's working-phase + heartbeat
 *  staleness model). */
function StuckWarning({ session }: { session: InstructionsSessionSummary }): JSX.Element {
  const staleMinutes = Math.round((session.staleMs ?? 0) / 60_000);
  return (
    <div
      data-instructions-stale="true"
      data-instructions-stale-ms={session.staleMs}
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
      ⚠ No instructions-agent activity for {staleMinutes}m — it may have stalled. Check{' '}
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        _logs/_instructions-{session.sessionId}/stderr.log
      </code>{' '}
      or re-run.
    </div>
  );
}
