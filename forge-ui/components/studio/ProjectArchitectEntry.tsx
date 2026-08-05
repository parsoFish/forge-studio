'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { NewIdeaBox } from '@/components/NewIdeaBox';
import { fetchArchitectSessions, type ArchitectPhase, type ArchitectSessionSummary } from '@/lib/bridge-client';

/**
 * R4-15 — the project page's entry into an architect planning session
 * (mockups/studio-endstate-v2/views-projects.jsx:121, run-agent-architect
 * journey step 2 "Trigger: manual, from a project page"). The real page had
 * none: the empty-roadmap state was a dead-end sentence and the populated
 * state had no "plan more" affordance at all.
 *
 * Collapsed by default — a "Plan with Architect" button that reveals the ONE
 * real start-a-session surface, `NewIdeaBox` (→ `startArchitect` → POST
 * /api/architect/start → /sessions/architect/<sid>), the same path
 * `/architect/new` and `FlowKickoff`'s idea-kickoff already use. This
 * component does not implement a second start-a-session code path.
 */
export function ProjectArchitectEntry({ projectId }: { projectId: string }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<ArchitectSessionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchArchitectSessions()
      .then((sessions) => {
        if (cancelled) return;
        setActiveSession(sessions.find((s) => s.project === projectId && !ARCHITECT_TERMINAL_PHASES.has(s.phase)) ?? null);
      })
      .catch(() => {
        // Best-effort only: the resume link is a convenience, never load-bearing
        // — the start-a-session path below doesn't depend on this fetch, so a
        // failure here just means no resume link is offered, not a broken page.
        if (!cancelled) setActiveSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const goToSession = (sessionId: string): void => {
    router.push(`/sessions/architect/${encodeURIComponent(sessionId)}`);
  };

  return (
    <div
      data-component="project-architect-entry"
      data-architect-entry-open={open ? 'true' : 'false'}
      data-project-id={projectId}
    >
      {!open && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            data-action="plan-with-architect"
            onClick={() => setOpen(true)}
            className="btn btn-sm btn-primary"
          >
            Plan with Architect
          </button>
          {activeSession && (
            <button
              data-action="resume-architect-session"
              data-session-id={activeSession.sessionId}
              onClick={() => goToSession(activeSession.sessionId)}
              className="btn btn-sm"
              title={`Resume in-flight session (${activeSession.phase})`}
            >
              Resume session →
            </button>
          )}
        </div>
      )}
      {open && (
        <div style={{ maxWidth: 480 }}>
          <NewIdeaBox key={projectId} initialProject={projectId} onStarted={goToSession} />
        </div>
      )}
    </div>
  );
}

/** Terminal architect phases (bridge-client.ts `ArchitectPhase`) — the same
 *  set `SessionArchitectPanel`/`SessionInstructionsPanel` already branch on
 *  to distinguish a finished session from one still in flight. Anything not
 *  in this set is a session an operator could resume. */
const ARCHITECT_TERMINAL_PHASES = new Set<ArchitectPhase>(['committed', 'rejected']);
