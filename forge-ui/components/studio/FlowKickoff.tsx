'use client';

import { useRouter } from 'next/navigation';

import { NewIdeaBox } from '@/components/NewIdeaBox';
import type { Flow } from '@/lib/studio-client';

/**
 * Stage C — per-flow kickoff surface. Renders the launch UI that matches the
 * flow's declared `kickoff.kind` (the operator's three entry points):
 *
 *   - `idea`             → the architect NewIdeaBox (free-text idea); the
 *                          interactive entry point.
 *   - `initiative-select`→ NOT launched here — points to the roadmap, where the
 *                          operator picks a planned initiative ("Start development").
 *   - `trigger-only`     → no launcher — the flow runs only when its declared
 *                          FlowTrigger fires (e.g. forge-reflect on merge).
 *   - (none)             → the generic "Start Run" fallback (authored flows).
 */
export function FlowKickoff({
  flow,
  knownProjects,
  onStartGeneric,
}: {
  flow: Flow;
  knownProjects?: string[];
  onStartGeneric?: () => void;
}): JSX.Element {
  const kind = flow.kickoff?.kind;

  if (kind === 'idea') return <IdeaKickoff knownProjects={knownProjects} project={flow.project} />;
  if (kind === 'initiative-select') return <InitiativeSelectKickoff />;
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

function InitiativeSelectKickoff(): JSX.Element {
  // Develop-type flows are launched from the roadmap (pick a planned initiative
  // → "Start development"), NOT from a generic list here — keeping one entry
  // point per flow type. This is an informational note, not a launcher.
  return (
    <div data-section="flow-kickoff" data-kickoff-kind="initiative-select" style={{ ...barStyle }}>
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>
        Launched from a project&apos;s roadmap — open the project, pick a planned initiative, and
        press &ldquo;Start development&rdquo;.
      </span>
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
