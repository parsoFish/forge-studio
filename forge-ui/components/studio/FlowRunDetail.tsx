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
 *     gains [data-node-expanded="true"|"false"]           (R6-01 WI-3 / F5, additive)
 *   [data-node-note]                                      ONLY when note != null
 *   [data-section="run-trigger"][data-trigger-kind][data-trigger-source][data-trigger-scope]
 *   [data-section="review-findings"]                      ReviewFindingsPanel's OWN contract
 *
 * R6-01 WI-3 (F5) — node click-through, ADDITIVE, only when `expandedNodeId`
 * matches a row's own nodeId:
 *   [data-section="node-detail"][data-detail-for-node]     the expanded panel
 *     -- deliberately NOT `data-node-id`: that attribute is the EXACT-MATCH
 *        anchor `./flow-run-detail-render.test.ts`'s own `rowMarkup()`
 *        keys off (`html.indexOf('data-node-id="<id>"')`); a second element
 *        carrying the same value, ahead of the row in markup order, would
 *        silently break that pinned helper for every one of its tests.
 *     [data-section="node-log"]  wrapping the composed, UNFORKED `<RunLog>`
 *       -> RunLog's OWN contract, reused verbatim:
 *          [data-component="run-log"|"run-log-empty"][data-log-line="true"][data-log-kind]
 *     [data-section="node-outputs"][data-outputs-count]
 *       -> [data-component="node-outputs-empty"] when count is 0 — honestly
 *          always 0 today: `row.artifacts` (`lib/flow-run-timeline.ts`) is
 *          the only legitimate per-node output source and it is always `[]`
 *          (no per-node artifact data exists anywhere in the run model —
 *          `run.artifactsReady` is run-level, keyed by artifact TYPE, and is
 *          NEVER read here to fabricate a per-node entry).
 *
 * `data-phase-cost-usd` is `.toFixed(2)`, matching FlowTopology's own
 * `data-phase-cost-usd={(hex.costUsd ?? 0).toFixed(2)}` verbatim.
 *
 * D3: there is no per-finding `state` anywhere in this repo — rendering one
 * would be the UI asserting a fact the system cannot know. Findings render
 * through the EXISTING `ReviewFindingsPanel`, never a forked renderer.
 */

import { Fragment } from 'react';
import Link from 'next/link';

import { ReviewFindingsPanel, type ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';
import { RunLog } from '@/components/studio/RunLog';
import type { Flow, Run } from '@/lib/studio-client';
import type { FlowRunTimelineRow } from '@/lib/flow-run-timeline';
import type { RunLogLine } from '@/lib/run-log-line';

export type FlowRunDetailProps = {
  runId: string;
  found: boolean;
  flow: Flow | null;
  run: Run | null;
  rows: FlowRunTimelineRow[];
  findings: ReviewFindingsDoc | null;
  /** R6-01 WI-3 / F5 — which row (if any) is expanded. Optional/defaulted so
   *  every existing caller (WI-2's own pinned render tests) that never sets
   *  it keeps rendering exactly as before: fully collapsed. */
  expandedNodeId?: string | null;
  /** Cached node log lines, keyed by nodeId — already resolved via
   *  `lib/flow-node-log.ts`'s `resolveNodeLogFromResponse`/`deriveLogLine`.
   *  A missing key is treated the same as an empty array (RunLog's own
   *  honest-empty state), never a throw. */
  nodeLogLines?: Record<string, RunLogLine[]>;
  /** Invoked with a row's nodeId when that row is clicked. The actual
   *  expand/collapse + fetch-on-demand STATE lives in the page shell
   *  (`app/flows/[id]/run/[runId]/page.tsx`) — this component stays pure and
   *  props-driven, only reporting the click. */
  onNodeClick?: (nodeId: string) => void;
  /** W7-A3 (crosscut-05 / flows-06): mirrored to `data-page-ready` — the page
   *  shell's loading branch renders "false"; this resolved surface renders
   *  "true" (default) so the route honours the DOM-as-metrics contract. */
  ready?: boolean;
};

export function FlowRunDetail({
  runId,
  found,
  flow,
  run,
  rows,
  findings,
  expandedNodeId = null,
  nodeLogLines = {},
  onNodeClick,
  ready = true,
}: FlowRunDetailProps) {
  const flowId = flow?.id ?? run?.flowId ?? '';
  const monitorHref = flowId ? `/flows/${encodeURIComponent(flowId)}` : '/flows';

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
      data-flow-resolution={flow ? 'registered' : 'unregistered'}
      data-page-ready={ready ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}
    >
      {/* W7-A3 (crosscut-23): the run page is no longer a dead end — back to
          the flow monitor, into the run's artifacts, and to its project. */}
      <nav data-section="run-breadcrumb" aria-label="Run breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
        <Link href="/flows" style={{ color: 'var(--dim)', textDecoration: 'none' }}>Flows</Link>
        <span style={{ color: 'var(--line-2)' }}>/</span>
        <Link href={monitorHref} data-action="back-to-monitor" style={{ color: 'var(--dim)', textDecoration: 'none' }}>
          {flowId || 'flow'}
        </Link>
        <span style={{ color: 'var(--line-2)' }}>/</span>
        <span>run</span>
        <span style={{ flex: 1 }} />
        {/* W7-FIX-A3 (A3-03): keyed on the RESOLVED run id (`run.id`, the
            cycle id once claimed) — the URL segment is the initiative id since
            W7-A3, and /artifact keys its reads on the id it is given. */}
        {found && (
          <Link
            href={`/artifact?run=${encodeURIComponent(run?.id ?? runId)}&type=plan&mode=view`}
            data-action="open-artifacts"
            style={{ color: 'var(--c-artifact, var(--amber))', textDecoration: 'none' }}
          >
            artifacts →
          </Link>
        )}
        {found && run?.project && (
          <Link href={`/projects/${encodeURIComponent(run.project)}`} data-action="open-project" style={{ color: 'var(--c-project, var(--accent))', textDecoration: 'none' }}>
            project {run.project} →
          </Link>
        )}
      </nav>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* W7-C3 (crosscut-18/agents-35): the page's ONE h1 — was an h2. */}
        <h1 style={{ margin: 0, fontSize: 15 }}>{run?.initiative || runId}</h1>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
          {run?.id ?? runId} · flow {flowId || '—'}
        </div>
      </header>

      {/* W7-A4 (flows-05 / crosscut-04): a found run whose flow DEFINITION is
          gone (retired id, or the pre-flow_id `unknown` sentinel) says so —
          and still renders its own recorded phases below (see
          deriveFlowRunTimeline's null-flow arm), never an empty timeline. */}
      {found && !flow && (
        <div
          data-component="flow-unregistered"
          style={{ fontSize: 12.5, color: 'var(--dim)', padding: '8px 12px', border: '1px dashed var(--line-2)', borderRadius: 'var(--radius-sm, 6px)' }}
        >
          Flow &ldquo;{flowId || 'unknown'}&rdquo; is no longer registered (retired, or this run predates flow ids) — showing the run&apos;s own recorded phases.
        </div>
      )}

      {!found ? (
        <RunNotFound runId={runId} />
      ) : (
        <>
          <RunTrigger run={run} />
          <RunTimeline
            rows={rows}
            expandedNodeId={expandedNodeId}
            nodeLogLines={nodeLogLines}
            onNodeClick={onNodeClick}
          />
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
 *  never re-derived or borrowed from a neighbour/the run total. R6-01 WI-3
 *  (F5): a row also reports its own expand state (`data-node-expanded`) and,
 *  when expanded, is followed by that node's own detail panel — never a
 *  sibling row's. */
function RunTimeline({
  rows,
  expandedNodeId,
  nodeLogLines,
  onNodeClick,
}: {
  rows: FlowRunTimelineRow[];
  expandedNodeId: string | null;
  nodeLogLines: Record<string, RunLogLine[]>;
  onNodeClick?: (nodeId: string) => void;
}) {
  return (
    <section data-section="run-timeline" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 13 }}>Timeline</h3>
      {rows.map((row) => {
        const expanded = row.nodeId === expandedNodeId;
        return (
          <Fragment key={row.nodeId}>
            <div
              data-timeline-row="true"
              data-node-id={row.nodeId}
              data-status={row.status}
              data-phase-cost-usd={row.costUsd.toFixed(2)}
              data-node-expanded={expanded ? 'true' : 'false'}
              {...(row.note !== null ? { 'data-node-note': row.note } : {})}
              onClick={() => onNodeClick?.(row.nodeId)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                cursor: onNodeClick ? 'pointer' : undefined,
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
            {expanded && (
              <NodeDetail
                nodeId={row.nodeId}
                lines={nodeLogLines[row.nodeId] ?? []}
                outputsCount={row.artifacts.length}
              />
            )}
          </Fragment>
        );
      })}
    </section>
  );
}

/** The expanded detail panel behind one timeline row (R6-01 WI-3 / F5): that
 *  node's OWN log, through the shared, unforked `RunLog`, and its typed
 *  outputs — honestly empty today (see this file's own header: no per-node
 *  artifact data source exists anywhere in the run model). */
function NodeDetail({
  nodeId,
  lines,
  outputsCount,
}: {
  nodeId: string;
  lines: RunLogLine[];
  outputsCount: number;
}) {
  return (
    <div
      data-section="node-detail"
      data-detail-for-node={nodeId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '10px 12px',
        marginTop: -2,
        border: '1px solid var(--line)',
        borderTop: 'none',
        borderRadius: '0 0 6px 6px',
        background: 'var(--surface-2, transparent)',
      }}
    >
      <section data-section="node-log" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h4 style={{ margin: 0, fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase' }}>Log</h4>
        <RunLog lines={lines} />
      </section>
      <section
        data-section="node-outputs"
        data-outputs-count={outputsCount}
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <h4 style={{ margin: 0, fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase' }}>Outputs</h4>
        {outputsCount === 0 ? (
          <div data-component="node-outputs-empty" className="muted" style={{ fontStyle: 'italic', fontSize: 12 }}>
            No typed outputs for this node.
          </div>
        ) : null}
      </section>
    </div>
  );
}
