/**
 * FlowRunDetail — the pure, props-driven presentational component behind
 * route `/flows/[id]/run/[runId]` (R6-01 WI-2 / F4). Mirrors the R6-04 WI-4
 * `RunView` precedent (`components/studio/agent-builder/RunView.tsx`)
 * exactly: the actual page is a thin `'use client'` shell that fetches and
 * hands resolved props here — ALL the judgement (timeline derivation,
 * found/not-found/unresolved resolution) lives in the pure modules this
 * component only renders.
 *
 * DOM-as-metrics contract — REUSING vocabulary that already exists, no
 * parallel vocabulary invented:
 *   [data-page="flow-run"][data-run-id][data-run-found][data-run-status][data-flow-id]
 *   [data-component="run-not-found"]                     the honest 404 body
 *   [data-section="run-timeline"]                         the timeline container
 *   [data-timeline-row="true"][data-node-id][data-status][data-phase-cost-usd]
 *   [data-node-note]                                      ONLY when note != null
 *   [data-section="run-trigger"][data-trigger-kind][data-trigger-source][data-trigger-scope]
 *   [data-section="review-findings"]                      ReviewFindingsPanel's OWN contract
 *
 * `data-phase-cost-usd` is `.toFixed(2)`, matching FlowTopology's own
 * `data-phase-cost-usd={(hex.costUsd ?? 0).toFixed(2)}` verbatim.
 *
 * D3: there is no per-finding `state` anywhere in this repo — rendering one
 * would be the UI asserting a fact the system cannot know. Findings render
 * through the EXISTING `ReviewFindingsPanel`, never a forked renderer.
 */

import { ReviewFindingsPanel, type ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';
import type { Flow, Run } from '@/lib/studio-client';
import type { FlowRunTimelineRow } from '@/lib/flow-run-timeline';

export type FlowRunDetailProps = {
  runId: string;
  found: boolean;
  flow: Flow | null;
  run: Run | null;
  rows: FlowRunTimelineRow[];
  findings: ReviewFindingsDoc | null;
};

export function FlowRunDetail({ runId, found, flow, run, rows, findings }: FlowRunDetailProps) {
  const flowId = flow?.id ?? run?.flowId ?? '';

  return (
    // <main>, not <div>: the Studio page convention (27 routes render their
    // primary content as a `main[data-page=...]` landmark) and what the
    // `flows-run-detail-reachable` journey beat selects on
    // (`main[data-page="flow-run"][data-run-found="true"]`). The pinned
    // render tests assert on the ATTRIBUTES only and are element-agnostic,
    // so they cannot catch this — a `<div>` here passes every unit test and
    // fails the gate's real selector.
    <main
      data-page="flow-run"
      data-run-id={runId}
      data-run-found={found ? 'true' : 'false'}
      data-run-status={run?.status ?? ''}
      data-flow-id={flowId}
      style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{run?.initiative || runId}</h2>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
          {runId} · flow {flowId || '—'}
        </div>
      </header>

      {!found ? (
        <RunNotFound runId={runId} />
      ) : (
        <>
          <RunTrigger run={run} />
          <RunTimeline rows={rows} />
          <ReviewFindingsPanel doc={findings} />
        </>
      )}
    </main>
  );
}

function RunNotFound({ runId }: { runId: string }) {
  return (
    <div data-component="run-not-found" className="muted" style={{ fontSize: 13 }}>
      No run found for id <code>{runId}</code>.
    </div>
  );
}

/** D9/`docs/forge-ui-dom-and-harness.md:830-836`: the reserved trigger-
 *  provenance vocabulary, verbatim. Absent entirely when the run carries no
 *  derivable trigger — never a placeholder block. */
function RunTrigger({ run }: { run: Run | null }) {
  const trigger = run?.trigger;
  if (!trigger) return null;
  return (
    <section
      data-section="run-trigger"
      data-trigger-kind={trigger.kind}
      data-trigger-source={trigger.source}
      data-trigger-scope={trigger.scope ?? ''}
      style={{ fontSize: 12, color: 'var(--dim)' }}
    >
      Triggered by <strong>{trigger.kind}</strong> ({trigger.source}){trigger.scope ? ` · scope ${trigger.scope}` : ''}
    </section>
  );
}

/** One row per flow node, in the flow definition's own order — every fact
 *  on a row comes from that node's own derived data (`FlowRunTimelineRow`),
 *  never re-derived or borrowed from a neighbour/the run total. */
function RunTimeline({ rows }: { rows: FlowRunTimelineRow[] }) {
  return (
    <section data-section="run-timeline" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 13 }}>Timeline</h3>
      {rows.map((row) => (
        <div
          key={row.nodeId}
          data-timeline-row="true"
          data-node-id={row.nodeId}
          data-status={row.status}
          data-phase-cost-usd={row.costUsd.toFixed(2)}
          {...(row.note !== null ? { 'data-node-note': row.note } : {})}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            padding: '8px 12px',
            border: '1px solid var(--line)',
            borderRadius: 6,
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 140 }}>{row.nodeId}</span>
          <span className="status-dot" data-status={row.status} />
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>{row.status}</span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>{row.agent ?? 'gate'}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--dim)' }}>
            ${row.costUsd.toFixed(2)}
          </span>
          {row.note !== null && (
            <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>{row.note}</span>
          )}
        </div>
      ))}
    </section>
  );
}
