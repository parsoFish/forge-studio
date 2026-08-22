'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { NewIdeaBox } from '@/components/NewIdeaBox';
import { EnqueueOutcomeLine } from '@/components/studio/EnqueueOutcomeLine';
import { RepointConfirmBar } from '@/components/studio/RepointConfirmBar';
import { startFlowRun } from '@/lib/bridge-client';
import type { Flow } from '@/lib/studio-client';
import type { KickoffCandidate } from '@/lib/kickoff-candidates';
import { kickoffSurfaceId } from '@/lib/kickoff-surface';
import { disabledAttrs } from '@/lib/disabled-reason';

export type { KickoffCandidate } from '@/lib/kickoff-candidates';

/**
 * Stage C — per-flow kickoff surface. Renders the launch UI that matches the
 * flow's declared `kickoff.kind` (the operator's three entry points):
 *
 *   - `idea`             → the architect NewIdeaBox (free-text idea); the
 *                          interactive entry point.
 *   - `initiative-select`→ NOT launched here — points to the roadmap, where the
 *                          operator picks a planned initiative ("Start development").
 *   - `trigger-only`     → no launcher — the flow runs only when its declared
 *                          FlowTrigger fires (an authorable kind; no seed
 *                          flow declares it since W7-C1).
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
 *
 * W8-A3 (flows-25): the dispatch below is driven by `kickoffSurfaceId`, and
 * `lib/kickoff-surface.ts`'s table — the same rows `data-can-start` is read
 * from — is what says which of these surfaces launches anything. There is no
 * second enumeration to fall out of step with what renders here.
 */
export function FlowKickoff({
  flow,
  candidates = [],
  onEnqueued,
}: {
  flow: Flow;
  /** W7-B6: unused — NewIdeaBox now owns its roster (a SELECT over real
   *  project ids, crosscut-21); kept in the type so existing callers that
   *  still pass it stay compiling (B5 owns the flows page). */
  knownProjects?: string[];
  /** Generic kickoff only: the initiatives that can be enqueued onto this flow. */
  candidates?: KickoffCandidate[];
  /** Generic kickoff only: fired after a successful enqueue with the initiative
   *  id (= the planned run's id in the rail; the page refetches + selects it). */
  onEnqueued?: (initiativeId: string) => void;
}): JSX.Element {
  switch (kickoffSurfaceId(flow)) {
    case 'idea': return <IdeaKickoff project={flow.project} />;
    case 'initiative-select': return <InitiativeSelectKickoff />;
    case 'trigger-only': return <TriggerOnlyKickoff />;
    case 'generic': return <GenericKickoff flowId={flow.id} candidates={candidates} onEnqueued={onEnqueued} />;
  }
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
  color: 'var(--accent-fg)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

// ---- idea ----------------------------------------------------------------

function IdeaKickoff({ project }: { project?: string }): JSX.Element {
  const router = useRouter();
  return (
    <div data-section="flow-kickoff" data-kickoff-kind="idea" style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel)', flexShrink: 0 }}>
      <div style={{ maxWidth: 560 }}>
        <NewIdeaBox
          key={project ?? ''}
          initialProject={project ?? ''}
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
  // W8-A3 (flows-37): the repoint the operator has been asked about but has
  // not yet answered. Non-null ⇒ the confirmation step is on screen and
  // NOTHING has been posted.
  const [pendingRepoint, setPendingRepoint] = useState<{ initiativeId: string; currentFlowId: string } | null>(null);
  const [result, setResult] = useState<
    | { kind: 'enqueued'; initiativeId: string; flowId?: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  async function submit(id: string, confirmRepointFrom?: string): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const r = await startFlowRun(flowId, id, confirmRepointFrom !== undefined ? { confirmRepointFrom } : {});
      if (r.ok) {
        setPendingRepoint(null);
        setResult({ kind: 'enqueued', initiativeId: id, flowId: r.flowId ?? flowId });
        onEnqueued?.(id);
        return;
      }
      // Defence in depth: the bridge refuses an unconfirmed repoint on its own
      // (`enqueueFlowRun` owns the rule), so a candidate whose flow of origin
      // the client could not derive still lands on the confirmation step
      // rather than on a bare error string.
      if (r.status === 'repoint-requires-confirm') {
        setPendingRepoint({ initiativeId: id, currentFlowId: r.currentFlowId ?? 'another flow' });
        return;
      }
      setPendingRepoint(null);
      setResult({ kind: 'error', message: r.error ?? r.status ?? 'enqueue failed' });
    } finally {
      setSubmitting(false);
    }
  }

  async function start(): Promise<void> {
    if (submitting) return;
    if (!initiativeId) {
      setResult({ kind: 'error', message: 'Pick an initiative to run this flow against.' });
      return;
    }
    const picked = candidates.find((c) => c.initiativeId === initiativeId) ?? null;
    // A repoint takes the initiative away from the flow it is queued under.
    // Ask before posting — never after.
    if (picked?.isRepoint && picked.currentFlowId) {
      setResult(null);
      setPendingRepoint({ initiativeId, currentFlowId: picked.currentFlowId });
      return;
    }
    await submit(initiativeId);
  }

  return (
    <div data-section="flow-kickoff" data-kickoff-kind="generic" style={{ ...barStyle, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>Run this flow against an initiative:</span>
      <select
        data-field="kickoff-initiative"
        value={initiativeId}
        onChange={(e) => { setInitiativeId(e.target.value); setPendingRepoint(null); }}
        style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', maxWidth: 420 }}
      >
        <option value="">— pick an initiative —</option>
        {candidates.map((c) => (
          <option key={c.initiativeId} value={c.initiativeId} data-repoint={c.isRepoint ? 'true' : 'false'}>
            {c.initiativeId}{c.project ? ` · ${c.project}` : ''}
            {c.isRepoint && c.currentFlowId ? ` — queued under ${c.currentFlowId}` : ''}
          </option>
        ))}
      </select>
      <button data-action="start-run" {...disabledAttrs(submitting ? 'Starting the run…' : null)} onClick={() => void start()} style={launchButtonStyle}>
        {submitting ? 'Starting…' : 'Start Run'}
      </button>
      {candidates.length === 0 && (
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>No queued initiatives yet — plan one with the architect first.</span>
      )}
      {pendingRepoint && (
        <RepointConfirmBar
          initiativeId={pendingRepoint.initiativeId}
          currentFlowId={pendingRepoint.currentFlowId}
          targetFlowId={flowId}
          verb="Run"
          busy={submitting}
          onConfirm={() => void submit(pendingRepoint.initiativeId, pendingRepoint.currentFlowId)}
          onCancel={() => setPendingRepoint(null)}
          style={{ width: '100%', marginTop: 6 }}
        />
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
