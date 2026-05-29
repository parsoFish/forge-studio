'use client';

import { NewIdeaBox } from './NewIdeaBox';
import { ArchitectQuestionForm } from './ArchitectQuestionForm';
import { PlanGate } from './PlanGate';
import type { ArchitectSessionSummary } from '@/lib/bridge-client';

/**
 * ADR 020 — the in-UI architect surface. Hosts the "new idea" entry box and one
 * card per live architect session, rendering the right control for the
 * session's phase: the interview form (interviewing / awaiting-answers), the
 * PLAN gate (awaiting-verdict), or a status chip (drafting / finalizing /
 * terminal). Mounted above the cycles tab.
 */
export function ArchitectPanel({
  sessions,
  knownProjects,
}: {
  sessions: ArchitectSessionSummary[];
  knownProjects: string[];
}) {
  // Hide terminal sessions from the active surface — they've left the loop.
  const active = sessions.filter((s) => s.phase !== 'committed' && s.phase !== 'rejected');

  return (
    <section
      data-section="architect"
      data-architect-session-count={active.length}
      data-pending-plan-count={active.filter((s) => s.phase === 'awaiting-verdict').length}
      style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <NewIdeaBox knownProjects={knownProjects} />

      {active.map((s) => (
        <div
          key={s.sessionId}
          data-architect-session-id={s.sessionId}
          data-architect-phase={s.phase}
          data-architect-project={s.project}
        >
          {(s.phase === 'interviewing' || s.phase === 'awaiting-answers') &&
            (s.questions && s.questions.length > 0 ? (
              <ArchitectQuestionForm
                project={s.project}
                sessionId={s.sessionId}
                round={s.round}
                questions={s.questions}
              />
            ) : (
              <StatusChip label={`Architect thinking… (round ${s.round})`} session={s} />
            ))}

          {s.phase === 'drafting' && (
            <StatusChip label="Architect drafting the plan…" session={s} />
          )}

          {s.phase === 'awaiting-verdict' && (
            <PlanGate
              project={s.project}
              sessionId={s.sessionId}
              planUrl={s.planUrl}
              escalations={s.escalations ?? []}
              idea={s.idea}
            />
          )}

          {s.phase === 'finalizing' && (
            <StatusChip label="Approved — finalizing manifests…" session={s} />
          )}
        </div>
      ))}
    </section>
  );
}

function StatusChip({ label, session }: { label: string; session: ArchitectSessionSummary }) {
  return (
    <div
      data-section="architect-status"
      style={{
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: '12px 16px',
        background: '#0d1117',
        fontSize: 13,
        color: '#8b949e',
        display: 'flex',
        justifyContent: 'space-between',
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>
        {session.project} · {session.sessionId}
      </span>
    </div>
  );
}
