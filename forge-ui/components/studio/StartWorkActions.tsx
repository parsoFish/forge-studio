'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { planInitiative, startDevelopment, startFlowRun, type ProjectRoadmap } from '@/lib/bridge-client';
import type { Flow } from '@/lib/studio-client';
import { deriveStartWorkState } from '@/lib/start-work-view';
import { RepointConfirmBar } from '@/components/studio/RepointConfirmBar';

/**
 * StartWorkActions (W7-B6, operator note 11 / orch-02, projects-18/-20) —
 * the project page's PRIMARY action group, mounted ABOVE the fold (directly
 * under the tab bar) on both tabs: Plan · Start development · Run a flow ·
 * Architect. Replaces the inert bottom-of-page "Run a flow" select
 * (UsedByFlows — the chosen flow rode a ?flow= nothing read; projects-20).
 *
 * Every control is REAL: Plan dispatches `planInitiative` for the first
 * unplanned-ready initiative; Start development dispatches
 * `startDevelopment` for every eligible (planned+ready) initiative — the
 * batch semantics RoadmapView's own button uses; Run a flow posts a chosen
 * initiative onto a chosen flow via `POST /api/flows/:id/run` (W7-A3's
 * route) and links the run on success. Disabled actions explain themselves
 * (crosscut-25). data-* contract: `data-section="start-work"`,
 * `data-action="start-work-{plan|develop|run-flow|architect}"`,
 * `data-start-work-outcome` on the result line.
 *
 * W8-A3 (`flows-37`, review round 1 S2-3): Plan, Start development and Run a
 * flow all repoint a manifest's `flow_id`, and this surface pairs an initiative
 * with a target without ever showing which flow it is queued under — the roadmap
 * payload carries no flow id at all. The enqueue therefore refuses an
 * unconfirmed cross-flow move (409 `repoint-requires-confirm`), and this group
 * answers it the same way the flow monitor's picker does: an in-DOM
 * confirmation, `[data-component="repoint-confirm"]` +
 * `[data-action="confirm-repoint"|"cancel-repoint"]`, naming the flow of origin
 * the server reported. Without it these controls would 409 forever with no way
 * to proceed.
 */
export function StartWorkActions({
  projectId,
  roadmap,
  flows,
  onChanged,
}: {
  projectId: string;
  roadmap: ProjectRoadmap | null;
  flows: Flow[];
  /** Fired after any successful dispatch so the page refetches roadmap state. */
  onChanged: () => void | Promise<void>;
}): JSX.Element {
  // W7-B6 review F7: ids whose develop dispatch this session came back ok.
  // The queue keeps them `pending` until the scheduler claims, so a refetched
  // roadmap re-reports them eligible — the derivation excludes them so the
  // button can't re-fire the same ids (RoadmapView's batch button applies the
  // same exclusion via its per-card DevelopCardState).
  const [dispatchedDevelop, setDispatchedDevelop] = useState<string[]>([]);
  const state = useMemo(
    () => deriveStartWorkState(roadmap?.initiatives ?? null, flows, dispatchedDevelop),
    [roadmap, flows, dispatchedDevelop],
  );
  const [busy, setBusy] = useState<'plan' | 'develop' | 'run-flow' | null>(null);
  // W8-A3 (flows-37): the repoint the server refused, awaiting the operator's
  // answer. Non-null ⇒ the confirmation is on screen and nothing has been moved.
  const [pendingRepoint, setPendingRepoint] = useState<
    { kind: 'plan' | 'run-flow'; initiativeId: string; currentFlowId: string; targetFlowId: string } | null
  >(null);
  const [outcome, setOutcome] = useState<{ kind: 'ok' | 'error'; text: string; href?: string } | null>(null);
  const [flowId, setFlowId] = useState('');
  const [initiativeId, setInitiativeId] = useState('');

  const chosenFlow = flowId || state.runnableFlows[0]?.id || '';
  const chosenInitiative = initiativeId || state.runCandidates[0]?.initiativeId || '';

  async function onPlan(confirm?: { initiativeId: string }): Promise<void> {
    // W8-A3 (review round 2 finding 3): a CONFIRMED dispatch posts the id the
    // confirmation NAMED, never a freshly re-derived one. `unplannedReady[0]`
    // moves the moment the daemon claims something or the roadmap refetches, so
    // the first cut could confirm a panel reading INIT-A and repoint INIT-B —
    // flows-37's exact harm, re-created inside the confirmation built to
    // prevent it.
    const initiative = confirm?.initiativeId ?? state.unplannedReady[0]?.initiativeId;
    if (!initiative || busy) return;
    setBusy('plan');
    setOutcome(null);
    try {
      const r = await planInitiative(initiative, { confirmRepoint: confirm !== undefined });
      if (r.status === 'repoint-requires-confirm') {
        setPendingRepoint({
          kind: 'plan',
          initiativeId: initiative,
          currentFlowId: r.currentFlowId ?? 'another flow',
          targetFlowId: 'forge-architect',
        });
        return;
      }
      setPendingRepoint(null);
      setOutcome(
        r.status === 'enqueued'
          ? { kind: 'ok', text: `planning ${initiative} enqueued` }
          : { kind: 'error', text: r.detail ?? r.status },
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function onDevelop(): Promise<void> {
    const ids = state.eligible.map((i) => i.initiativeId);
    if (ids.length === 0 || busy) return;
    setBusy('develop');
    setOutcome(null);
    try {
      const r = await startDevelopment(ids);
      const okIds = (r.results ?? []).filter((x) => x.ok).map((x) => x.initiativeId);
      // Review F7: remember what was really enqueued so the refetched (still
      // `pending`) roadmap can't re-arm the button with the same ids. Failed
      // ids stay eligible — a retry is legitimate for them.
      if (okIds.length > 0) setDispatchedDevelop((prev) => [...prev, ...okIds]);
      // W8-A3 (`flows-37`, review round 1 S1-1): this button posts a BATCH and the
      // roadmap carries no flow id, so it cannot disclose a flow of origin — which
      // is exactly why the develop hand-off is auto-authorised ONLY from
      // `forge-architect`. An initiative queued under an authored flow is refused
      // here on purpose, and it is deliberately NOT offered a batch "confirm
      // everything": rubber-stamping N destructive moves the surface cannot show
      // is the shape this whole lane exists to remove. It is named, with the way
      // to move it deliberately — the flow monitor's picker, which discloses the
      // flow of origin per candidate.
      const refused = (r.results ?? []).filter((x) => x.status === 'repoint-requires-confirm');
      setOutcome(
        okIds.length > 0
          ? { kind: 'ok', text: `${okIds.length}/${ids.length} initiative${ids.length === 1 ? '' : 's'} enqueued for development` }
          : refused.length > 0
            ? {
                kind: 'error',
                text: `${refused.map((x) => x.initiativeId).join(', ')} ${refused.length === 1 ? 'is' : 'are'} queued under another flow — open ${refused.length === 1 ? 'it' : 'them'} on the Roadmap tab and use that card's own Start development, which names the flow being moved from and asks first.`,
              }
            : { kind: 'error', text: r.error ?? r.results?.[0]?.detail ?? 'nothing started' },
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function onRunFlow(confirm?: { flowId: string; initiativeId: string }): Promise<void> {
    // Review round 2 finding 3, as above: the confirmed dispatch uses the PAIR
    // the panel named. `chosenFlow`/`chosenInitiative` fall back to
    // `runnableFlows[0]`/`runCandidates[0]`, which move under a refetch.
    const flow = confirm?.flowId ?? chosenFlow;
    const initiative = confirm?.initiativeId ?? chosenInitiative;
    if (!flow || !initiative || busy) return;
    setBusy('run-flow');
    setOutcome(null);
    try {
      const r = await startFlowRun(flow, initiative, { confirmRepoint: confirm !== undefined });
      if (r.status === 'repoint-requires-confirm') {
        setPendingRepoint({
          kind: 'run-flow',
          initiativeId: initiative,
          currentFlowId: r.currentFlowId ?? 'another flow',
          targetFlowId: flow,
        });
        return;
      }
      setPendingRepoint(null);
      setOutcome(
        r.ok
          ? { kind: 'ok', text: `${initiative} enqueued onto ${flow}`, href: `/flows/${encodeURIComponent(flow)}/run/${encodeURIComponent(initiative)}` }
          : { kind: 'error', text: r.error ?? r.status ?? 'failed to start the flow run' },
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  const groupBtn: React.CSSProperties = { fontSize: 12, whiteSpace: 'nowrap' };
  const hint: React.CSSProperties = { fontSize: 10.5, color: 'var(--faint)' };
  const selectStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text)', fontSize: 11.5, padding: '4px 8px', maxWidth: 220,
  };

  return (
    <section
      data-section="start-work"
      aria-label="Start work"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '10px 28px', borderBottom: '1px solid var(--line)', background: 'var(--bg-2)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>
        Start work
      </span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          className="btn btn-sm"
          data-action="start-work-plan"
          disabled={busy !== null || state.planDisabledReason !== null}
          onClick={() => void onPlan()}
          {...(state.planDisabledReason ? { 'data-disabled-reason': state.planDisabledReason, title: state.planDisabledReason } : {})}
          style={groupBtn}
        >
          {busy === 'plan' ? 'Planning…' : `Plan${state.unplannedReady.length > 0 ? ` (${state.unplannedReady.length})` : ''}`}
        </button>
        {state.planDisabledReason && <span style={hint}>{state.planDisabledReason}</span>}
      </span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          data-action="start-work-develop"
          disabled={busy !== null || state.startDisabledReason !== null}
          onClick={() => void onDevelop()}
          {...(state.startDisabledReason ? { 'data-disabled-reason': state.startDisabledReason, title: state.startDisabledReason } : {})}
          style={groupBtn}
        >
          {busy === 'develop' ? 'Starting…' : `Start development${state.eligible.length > 0 ? ` (${state.eligible.length})` : ''}`}
        </button>
        {state.startDisabledReason && <span style={hint}>{state.startDisabledReason}</span>}
      </span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {state.runFlowDisabledReason === null ? (
          <>
            <select
              data-field="start-work-flow"
              value={chosenFlow}
              onChange={(e) => { setFlowId(e.target.value); setPendingRepoint(null); }}
              aria-label="Flow to run"
              style={selectStyle}
            >
              {state.runnableFlows.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select
              data-field="start-work-initiative"
              value={chosenInitiative}
              onChange={(e) => { setInitiativeId(e.target.value); setPendingRepoint(null); }}
              aria-label="Initiative to enqueue"
              style={selectStyle}
            >
              {state.runCandidates.map((i) => (
                <option key={i.initiativeId} value={i.initiativeId}>{i.initiativeId}</option>
              ))}
            </select>
            <button
              className="btn btn-sm"
              data-action="start-work-run-flow"
              disabled={busy !== null}
              onClick={() => void onRunFlow()}
              style={groupBtn}
            >
              {busy === 'run-flow' ? 'Enqueuing…' : 'Run a flow'}
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-sm"
              data-action="start-work-run-flow"
              disabled
              data-disabled-reason={state.runFlowDisabledReason}
              title={state.runFlowDisabledReason}
              style={groupBtn}
            >
              Run a flow
            </button>
            <span style={hint}>{state.runFlowDisabledReason}</span>
          </>
        )}
      </span>

      <Link
        className="btn btn-sm"
        data-action="start-work-architect"
        href={`/architect/new?project=${encodeURIComponent(projectId)}`}
        style={{ ...groupBtn, textDecoration: 'none' }}
      >
        Architect →
      </Link>

      {pendingRepoint && (
        <RepointConfirmBar
          initiativeId={pendingRepoint.initiativeId}
          currentFlowId={pendingRepoint.currentFlowId}
          targetFlowId={pendingRepoint.targetFlowId}
          verb={pendingRepoint.kind === 'plan' ? 'Plan' : 'Run'}
          busy={busy !== null}
          onConfirm={() => void (pendingRepoint.kind === 'plan'
            ? onPlan({ initiativeId: pendingRepoint.initiativeId })
            : onRunFlow({ flowId: pendingRepoint.targetFlowId, initiativeId: pendingRepoint.initiativeId }))}
          onCancel={() => setPendingRepoint(null)}
        />
      )}

      {outcome && (
        <span data-start-work-outcome={outcome.kind} style={{ fontSize: 11.5, color: outcome.kind === 'ok' ? 'var(--green, #3fb950)' : 'var(--red, #f87171)' }}>
          {outcome.text}
          {outcome.href && (
            <>
              {' '}
              <Link href={outcome.href} data-action="start-work-open-run" style={{ color: 'inherit' }}>
                view run →
              </Link>
            </>
          )}
        </span>
      )}
    </section>
  );
}
