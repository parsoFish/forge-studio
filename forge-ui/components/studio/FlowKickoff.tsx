'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { NewIdeaBox } from '@/components/NewIdeaBox';
import { EnqueueOutcomeLine } from '@/components/studio/EnqueueOutcomeLine';
import { startFlowRun } from '@/lib/bridge-client';
import type { Flow } from '@/lib/studio-client';

/** An initiative the generic kickoff can enqueue onto this flow — derived
 *  from the runs list (one run per queued manifest), never invented. */
export type KickoffCandidate = { initiativeId: string; project: string | null };

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
 *   - (none)             → the generic "Start Run" (authored flows): W7-A3
 *                          (flows-02) an INITIATIVE PICKER that POSTs a real
 *                          initiative to `/api/flows/:id/run` (enqueueFlowRun
 *                          onto THIS flow) — it used to post the flow id as an
 *                          initiativeId (always 400, silently). The outcome
 *                          line is scheduler-aware and links the run.
 *
 * W7-A3 (flows-03): the monitor renders this in EVERY state behind a header
 * toggle (open by default when the flow has no runs), so a flow never loses
 * its launch control after its first run.
 */
export function FlowKickoff({
  flow,
  knownProjects,
  candidates = [],
  onEnqueued,
}: {
  flow: Flow;
  knownProjects?: string[];
  /** Generic kickoff only: the initiatives that can be enqueued onto this flow. */
  candidates?: KickoffCandidate[];
  /** Generic kickoff only: fired after a successful enqueue with the initiative
   *  id (= the planned run's id in the rail; the page refetches + selects it). */
  onEnqueued?: (initiativeId: string) => void;
}): JSX.Element {
  const kind = flow.kickoff?.kind;

  if (kind === 'idea') return <IdeaKickoff knownProjects={knownProjects} project={flow.project} />;
  if (kind === 'initiative-select') return <InitiativeSelectKickoff />;
  if (kind === 'trigger-only') return <TriggerOnlyKickoff />;
  return <GenericKickoff flowId={flow.id} candidates={candidates} onEnqueued={onEnqueued} />;
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
          onStarted={(sessionId) => router.push(`/sessions/architect/${encodeURIComponent(sessionId)}`)}
        />
      </div>
    </div>
  );
}

// ---- initiative-select ---------------------------------------------------

function InitiativeSelectKickoff(): JSX.Element {
  // Develop-type flows are launched from the roadmap (pick a planned initiative
  // → "Start development"), NOT from a generic list here — keeping one entry
  // point per flow type. This is an informational note with the way there.
  return (
    <div data-section="flow-kickoff" data-kickoff-kind="initiative-select" style={{ ...barStyle }}>
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>
        Launched from a project&apos;s roadmap — open the project, pick a planned initiative, and
        press &ldquo;Start development&rdquo;.
      </span>
      <Link href="/projects" data-action="open-projects" style={{ fontSize: 12, color: 'var(--accent)' }}>Projects →</Link>
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

function GenericKickoff({
  flowId,
  candidates,
  onEnqueued,
}: {
  flowId: string;
  candidates: KickoffCandidate[];
  onEnqueued?: (initiativeId: string) => void;
}): JSX.Element {
  const [initiativeId, setInitiativeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'enqueued'; initiativeId: string; flowId?: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  async function start(): Promise<void> {
    if (submitting) return;
    if (!initiativeId) {
      setResult({ kind: 'error', message: 'Pick an initiative to run this flow against.' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const r = await startFlowRun(flowId, initiativeId);
      if (r.ok) {
        setResult({ kind: 'enqueued', initiativeId, flowId: r.flowId ?? flowId });
        onEnqueued?.(initiativeId);
      } else {
        setResult({ kind: 'error', message: r.error ?? r.status ?? 'enqueue failed' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-section="flow-kickoff" data-kickoff-kind="generic" style={{ ...barStyle, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>Run this flow against an initiative:</span>
      <select
        data-field="kickoff-initiative"
        value={initiativeId}
        onChange={(e) => setInitiativeId(e.target.value)}
        style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', maxWidth: 360 }}
      >
        <option value="">— pick an initiative —</option>
        {candidates.map((c) => (
          <option key={c.initiativeId} value={c.initiativeId}>
            {c.initiativeId}{c.project ? ` · ${c.project}` : ''}
          </option>
        ))}
      </select>
      <button data-action="start-run" disabled={submitting} onClick={() => void start()} style={launchButtonStyle}>
        {submitting ? 'Starting…' : 'Start Run'}
      </button>
      {candidates.length === 0 && (
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>No queued initiatives yet — plan one with the architect first.</span>
      )}
      {result?.kind === 'error' && (
        <span data-kickoff-result="error" style={{ fontSize: 12, color: 'var(--red)', width: '100%' }}>{result.message}</span>
      )}
      {result?.kind === 'enqueued' && (
        <div data-kickoff-result="enqueued" style={{ width: '100%' }}>
          <EnqueueOutcomeLine kind="flow" runAction="open-kickoff-run" runId={result.initiativeId} flowId={result.flowId} />
        </div>
      )}
    </div>
  );
}
