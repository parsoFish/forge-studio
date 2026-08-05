'use client';

import Link from 'next/link';

import { instructionsBrief, type InstructionsSessionSummary, type EventLogEntry } from '@/lib/bridge-client';
import { StageHex } from '@/components/StageHex';
import { SessionBriefing } from '@/components/SessionBriefing';
import { InstructionsQuestionForm } from '@/components/InstructionsQuestionForm';
import { InstructionsVerdict } from '@/components/InstructionsVerdict';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { architectHexMeta, isArchitectWorking, isSessionStale } from '@/lib/architect-hex';

// ---------------------------------------------------------------------------
// SessionInstructionsPanel — the instructions kind's live interactive
// affordance, carried over UNCHANGED from `/instructions/[sessionId]`
// (R2-10 PR2, WI-7): the back-to-project link, the briefing form, the
// stale-warning, the question form, the working-phase activity log, the
// draft verdict gate, and the committed/rejected terminal states. Every
// `data-action`/`data-section`/`data-component` name below is byte-identical
// to the retired page's.
// ---------------------------------------------------------------------------

export function SessionInstructionsPanel({
  session,
  events,
  nowMs,
  onRefresh,
}: {
  session: InstructionsSessionSummary;
  events: EventLogEntry[];
  nowMs: number;
  onRefresh: () => void;
}): JSX.Element {
  const meta = architectHexMeta(session.phase);
  const active = isArchitectWorking(session.phase);
  const stale = isSessionStale(session);

  return (
    <div>
      <Link
        href={`/projects/${encodeURIComponent(session.project)}`}
        data-action="back-to-project"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)', textDecoration: 'none', marginBottom: 12 }}
      >
        ← Back to project
      </Link>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 180px' }}>
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
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {stale && <StuckWarning session={session} />}

          {session.phase === 'briefing' && (
            <SessionBriefing
              heading="Instructions agent"
              modeLabel={session.mode === 'edit' ? 'edit AGENTS.md' : 'create AGENTS.md'}
              contextLabel={session.currentInstructionsFile ? `Current ${session.currentInstructionsFile}` : undefined}
              contextContent={session.currentInstructions}
              notesPlaceholder={
                session.mode === 'edit'
                  ? 'What should change about the current instructions? (optional)'
                  : 'Anything the agent should know up front? (optional)'
              }
              onSubmit={(notes) =>
                instructionsBrief({ project: session.project, sessionId: session.sessionId, brief: notes }).then(() => onRefresh())
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
              onSettled={() => onRefresh()}
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
              <span style={{ fontSize: 13, color: 'var(--green)' }}>AGENTS.md written — instructions are live.</span>
              <Link href={`/projects/${encodeURIComponent(session.project)}`} data-action="back-to-project" style={btnLinkStyle}>
                Back to the project →
              </Link>
            </div>
          )}

          {session.phase === 'rejected' && <Status label="Instructions draft rejected — start again when ready." />}
        </div>
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

/** Stale-session warning — no rerun affordance (the instructions runner has
 *  none, matching the retired page). */
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
