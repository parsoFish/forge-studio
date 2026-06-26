'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { NewIdeaBox } from '@/components/NewIdeaBox';
import { startRun } from '@/lib/bridge-client';
import { fetchPlannedInitiatives, type Flow, type PlannedInitiative } from '@/lib/studio-client';

/**
 * Stage C — per-flow kickoff surface. Renders the launch UI that matches the
 * flow's declared `kickoff.kind`:
 *
 *   - `idea`             → the architect NewIdeaBox (free-text idea).
 *   - `initiative-select`→ a picker of planned, develop-able initiatives; ready
 *                          ones launch, blocked ones are greyed with blockers.
 *   - `trigger-only`     → no launcher — the flow runs only when its declared
 *                          FlowTrigger fires (e.g. forge-reflect on merge).
 *   - (none)             → the generic "Start Run" fallback.
 */
export function FlowKickoff({
  flow,
  knownProjects,
  onLaunched,
  onStartGeneric,
}: {
  flow: Flow;
  knownProjects?: string[];
  onLaunched?: () => void;
  onStartGeneric?: () => void;
}): JSX.Element {
  const kind = flow.kickoff?.kind;

  if (kind === 'idea') return <IdeaKickoff knownProjects={knownProjects} project={flow.project} />;
  if (kind === 'initiative-select') return <InitiativeSelectKickoff onLaunched={onLaunched} />;
  if (kind === 'trigger-only') return <TriggerOnlyKickoff />;
  return <GenericKickoff onStartGeneric={onStartGeneric} />;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 20px',
  background: 'var(--panel)',
  borderBottom: '1px solid var(--line)',
  flexShrink: 0,
};

const launchButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 12px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

// ---- idea ----------------------------------------------------------------

function IdeaKickoff({ knownProjects, project }: { knownProjects?: string[]; project?: string }): JSX.Element {
  const router = useRouter();
  return (
    <div data-section="flow-kickoff" data-kickoff-kind="idea" style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel)', flexShrink: 0 }}>
      <div style={{ maxWidth: 560 }}>
        <NewIdeaBox
          key={project ?? ''}
          initialProject={project ?? ''}
          knownProjects={knownProjects}
          onStarted={(sessionId) => router.push(`/architect/${encodeURIComponent(sessionId)}/interview`)}
        />
      </div>
    </div>
  );
}

// ---- initiative-select ---------------------------------------------------

function InitiativeSelectKickoff({ onLaunched }: { onLaunched?: () => void }): JSX.Element {
  const [planned, setPlanned] = useState<PlannedInitiative[] | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchPlannedInitiatives().then(setPlanned).catch(() => setPlanned([]));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const launch = useCallback(
    async (initiativeId: string) => {
      setLaunching(initiativeId);
      try {
        const r = await startRun(initiativeId);
        if (r.ok) { reload(); onLaunched?.(); }
      } finally {
        setLaunching(null);
      }
    },
    [reload, onLaunched],
  );

  return (
    <div
      data-section="flow-kickoff"
      data-kickoff-kind="initiative-select"
      data-planned-count={planned?.length ?? 0}
      data-planned-ready={planned == null ? 'false' : 'true'}
      style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel)', flexShrink: 0 }}
    >
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
        Planned initiatives — pick one to develop. Blocked rows wait on a prerequisite.
      </div>
      {planned == null && <div style={{ fontSize: 12, color: 'var(--dim)' }}>Loading…</div>}
      {planned != null && planned.length === 0 && (
        <div data-kickoff-empty="true" style={{ fontSize: 12, color: 'var(--dim)' }}>
          No planned initiatives. Run the architect to decompose one first.
        </div>
      )}
      {planned != null && planned.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {planned.map((p) => (
            <li
              key={p.initiativeId}
              data-initiative-row
              data-initiative-id={p.initiativeId}
              data-initiative-ready={p.ready ? 'true' : 'false'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 10px',
                borderRadius: 4,
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                opacity: p.ready ? 1 : 0.55,
              }}
            >
              <span style={{ flex: 1, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>{p.title}</span>
                {p.project && <span style={{ color: 'var(--dim)' }}> · {p.project}</span>}
                {!p.ready && (
                  <span data-initiative-blockers style={{ color: 'var(--dim)', display: 'block', fontSize: 11 }}>
                    blocked by {p.blockedBy.join(', ')}
                  </span>
                )}
              </span>
              <button
                data-action="start-develop"
                disabled={!p.ready || launching === p.initiativeId}
                onClick={() => void launch(p.initiativeId)}
                style={{ ...launchButtonStyle, opacity: p.ready ? 1 : 0.4, cursor: p.ready ? 'pointer' : 'not-allowed' }}
              >
                {launching === p.initiativeId ? 'Launching…' : 'Develop'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- trigger-only --------------------------------------------------------

function TriggerOnlyKickoff(): JSX.Element {
  return (
    <div
      data-section="flow-kickoff"
      data-kickoff-kind="trigger-only"
      style={{ ...barStyle }}
    >
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>
        Auto-triggered — this flow has no manual launch. It runs when its declared trigger fires
        (e.g. forge-develop on merge).
      </span>
    </div>
  );
}

// ---- generic fallback ----------------------------------------------------

function GenericKickoff({ onStartGeneric }: { onStartGeneric?: () => void }): JSX.Element {
  return (
    <div data-section="flow-kickoff" data-kickoff-kind="generic" style={{ ...barStyle }}>
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>No runs yet.</span>
      <button data-action="start-run" onClick={() => onStartGeneric?.()} style={launchButtonStyle}>
        Start Run
      </button>
    </div>
  );
}
