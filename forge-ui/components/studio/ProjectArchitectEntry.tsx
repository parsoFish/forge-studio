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
/** The resume probe's own observable outcome (Fix 4, adversarial-review
 *  round, 2026-08-06) — distinct from `activeSession` being null, which is
 *  ALSO the legitimate "no in-flight session" result. Without this, "no
 *  session to resume" and "the lookup itself broke" rendered identically:
 *  no resume link, no trace. */
type ResumeProbeState = 'pending' | 'ok' | 'failed';

export function ProjectArchitectEntry({ projectId }: { projectId: string }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<ArchitectSessionSummary | null>(null);
  const [resumeProbe, setResumeProbe] = useState<ResumeProbeState>('pending');

  useEffect(() => {
    let cancelled = false;
    setResumeProbe('pending');
    fetchArchitectSessions()
      .then((sessions) => {
        if (cancelled) return;
        setActiveSession(sessions.find((s) => s.project === projectId && !ARCHITECT_TERMINAL_PHASES.has(s.phase)) ?? null);
        setResumeProbe('ok');
      })
      .catch(() => {
        // The resume link stays a convenience, never load-bearing — the
        // start-a-session path below doesn't depend on this fetch, so a
        // failure here still means no resume link is offered. But the
        // FAILURE itself must be observable (data-architect-resume-probe),
        // not silently indistinguishable from "genuinely no in-flight
        // session" (which is also `activeSession: null`).
        if (!cancelled) {
          setActiveSession(null);
          setResumeProbe('failed');
        }
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
      data-architect-resume-probe={resumeProbe}
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
        <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <NewIdeaBox key={projectId} initialProject={projectId} onStarted={goToSession} />
          <button
            data-action="cancel-plan-with-architect"
            onClick={() => setOpen(false)}
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start' }}
          >
            Cancel
          </button>
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
