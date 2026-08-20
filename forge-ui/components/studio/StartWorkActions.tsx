'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { planInitiative, startDevelopment, startFlowRun, type ProjectRoadmap } from '@/lib/bridge-client';
import type { Flow } from '@/lib/studio-client';
import { deriveStartWorkState } from '@/lib/start-work-view';

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
  const state = useMemo(
    () => deriveStartWorkState(roadmap?.initiatives ?? null, flows),
    [roadmap, flows],
  );
  const [busy, setBusy] = useState<'plan' | 'develop' | 'run-flow' | null>(null);
  const [outcome, setOutcome] = useState<{ kind: 'ok' | 'error'; text: string; href?: string } | null>(null);
  const [flowId, setFlowId] = useState('');
  const [initiativeId, setInitiativeId] = useState('');

  const chosenFlow = flowId || state.runnableFlows[0]?.id || '';
  const chosenInitiative = initiativeId || state.runCandidates[0]?.initiativeId || '';

  async function onPlan(): Promise<void> {
    const target = state.unplannedReady[0];
    if (!target || busy) return;
    setBusy('plan');
    setOutcome(null);
    try {
      const r = await planInitiative(target.initiativeId);
      setOutcome(
        r.status === 'enqueued'
          ? { kind: 'ok', text: `planning ${target.initiativeId} enqueued` }
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
      const started = (r.results ?? []).filter((x) => x.ok).length;
      setOutcome(
        started > 0
          ? { kind: 'ok', text: `${started}/${ids.length} initiative${ids.length === 1 ? '' : 's'} enqueued for development` }
          : { kind: 'error', text: r.error ?? r.results?.[0]?.detail ?? 'nothing started' },
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function onRunFlow(): Promise<void> {
    if (!chosenFlow || !chosenInitiative || busy) return;
    setBusy('run-flow');
    setOutcome(null);
    try {
      const r = await startFlowRun(chosenFlow, chosenInitiative);
      setOutcome(
        r.ok
          ? { kind: 'ok', text: `${chosenInitiative} enqueued onto ${chosenFlow}`, href: `/flows/${encodeURIComponent(chosenFlow)}/run/${encodeURIComponent(chosenInitiative)}` }
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
    color: 'var(--text)', fontSize: 11.5, padding: '4px 8px', outline: 'none', maxWidth: 220,
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
              onChange={(e) => setFlowId(e.target.value)}
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
              onChange={(e) => setInitiativeId(e.target.value)}
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
