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
/** The resume probe's own observable outcome: has the lookup for an in-flight
 *  session SETTLED yet, distinct from `activeSession` being null (the
 *  legitimate "no in-flight session" result).
 *
 *  HONEST LIMIT, stated rather than implied away (adversarial-review round 2,
 *  2026-08-06): there is deliberately NO `'failed'` value, because this
 *  component cannot observe one. `fetchArchitectSessions` goes through
 *  `bridgeGet` (`lib/bridge-client.ts`), whose whole contract is
 *  "no-bridge / non-ok / throw → return the fallback" — every transport
 *  failure, HTTP error and JSON parse failure resolves to `{sessions: []}`
 *  and NOTHING ever rejects. A `'failed'` state here would be a value that
 *  can never occur: a guard that cannot fire, and a claim in the DOM contract
 *  that the code does not honour. Distinguishing a broken bridge from an empty
 *  result requires the shared envelope to stop swallowing hard errors — a
 *  change to a client with dozens of callers that depend on the benign
 *  fallback, so it is FILED, not smuggled in here. */
type ResumeProbeState = 'pending' | 'settled';

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
        setResumeProbe('settled');
      })
      .catch(() => {
        // Defensive only — `bridgeGet` never rejects (see ResumeProbeState).
        // The resume link is a convenience, never load-bearing: the
        // start-a-session path below does not depend on this fetch.
        if (!cancelled) {
          setActiveSession(null);
          setResumeProbe('settled');
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
 *  set `SessionArchitectPanel` already branches on to distinguish a finished
 *  session from one still in flight. Anything not in this set is a session
 *  an operator could resume. */
const ARCHITECT_TERMINAL_PHASES = new Set<ArchitectPhase>(['committed', 'rejected']);
