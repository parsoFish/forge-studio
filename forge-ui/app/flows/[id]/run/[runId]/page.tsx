'use client';

/**
 * Standalone flow run-detail — /flows/[id]/run/[runId] (R6-01 WI-2 / F4).
 *
 * D1: this route shape, mirroring `app/agents/[id]/run/[runId]/page.tsx`
 * (R6-04 WI-4) closely — `useParams()`, a `loaded` flag kept DISTINCT from
 * `found` — rather than the flat `/flows/run/<id>` form (`app/flows/[id]/
 * page.tsx` already owns the `[id]` dynamic segment for the monitor).
 *
 * A thin client shell: fetches the run (`lib/flow-run-detail-client.ts`'s
 * `fetchFlowRunDetail`, a THREE-state resolver — found / not-found /
 * unresolved, D9), the flow definition (`lib/studio-client.ts`'s
 * `fetchFlow`) and, once a run is actually found, its review findings
 * (`fetchReviewFindings`) — then derives the timeline
 * (`lib/flow-run-timeline.ts`'s `deriveFlowRunTimeline`) and hands
 * everything to the pure, props-driven `FlowRunDetail`.
 *
 * D9: `unresolved` (5xx, other 4xx, bridge unreachable, thrown fetch, a
 * malformed 2xx body) is rendered as a THIRD state here — neither
 * `FlowRunDetail`'s timeline nor its honest not-found body, since either
 * would misrepresent a transient bridge failure as a fact about the run
 * ("this run never existed" vs. "the bridge is having a bad day").
 *
 * KNOWN GAP (documented, not closed here — same class as `run-view-client.
 * ts`'s own header): this fetch/render wiring is verified by `tsc` only, no
 * jsdom / `@testing-library/react` in this repo. A real-browser journey
 * beat (`scripts/journeys/flows-run.mjs`'s `flows-run-detail-reachable`)
 * proves the rest end to end.
 *
 * R6-01 WI-3 (F5): node click-through. A row click toggles `expandedNodeId`
 * (re-clicking the SAME row collapses it — no state is left permanently
 * open) and, on first expand only, fetches that node's own raw log via
 * `lib/flow-node-log.ts`'s `fetchNodeLog` and caches it in `nodeLogLines`
 * keyed by nodeId — a node already cached is never re-fetched. Both pieces
 * of state live HERE, not on `FlowRunDetail`, which stays a pure,
 * props-driven renderer (its own header).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FlowRunDetail } from '@/components/studio/FlowRunDetail';
import { deriveFlowRunTimeline } from '@/lib/flow-run-timeline';
import { fetchFlowRunDetail, fetchReviewFindings, type FlowRunDetailResolution } from '@/lib/flow-run-detail-client';
import { fetchNodeLog } from '@/lib/flow-node-log';
import { fetchFlow, type Flow, type Run } from '@/lib/studio-client';
import type { ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';
import type { RunLogLine } from '@/lib/run-log-line';

export default function FlowRunPage() {
  const params = useParams();
  const flowId = decodeURIComponent((params?.id as string) ?? '');
  const runId = decodeURIComponent((params?.runId as string) ?? '');

  const [resolution, setResolution] = useState<FlowRunDetailResolution | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [findings, setFindings] = useState<ReviewFindingsDoc | null>(null);
  // Distinct from `resolution?.kind === 'found'` — the fetch simply hasn't
  // resolved yet, so the page must not render either the timeline or the
  // not-found body for a run it hasn't actually checked yet (mirrors
  // app/agents/[id]/run/[runId]/page.tsx's own `loaded` precedent).
  const [loaded, setLoaded] = useState(false);

  // R6-01 WI-3 (F5): which row is expanded (null = none), and each expanded
  // node's own log lines, cached by nodeId so re-collapsing/re-expanding the
  // SAME node never re-fetches.
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [nodeLogLines, setNodeLogLines] = useState<Record<string, RunLogLine[]>>({});

  // W6-SW-3 (sweep C3#5): pulled out of the effect so the unresolved-run
  // body's Retry button can re-invoke the exact same load, not just the
  // browser reload the operator previously had to know to do manually.
  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoaded(false);
    const [res, flowDef] = await Promise.all([fetchFlowRunDetail(runId), fetchFlow(flowId)]);
    if (signal.cancelled) return;
    const findingsDoc = res.kind === 'found' ? await fetchReviewFindings(res.run.id) : null;
    if (signal.cancelled) return;
    setResolution(res);
    setFlow(flowDef);
    setFindings(findingsDoc);
    setLoaded(true);
  }, [flowId, runId]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  // Toggle a row's expand state; fetch that node's own raw log on first
  // expand only — a node already cached in `nodeLogLines` is never
  // re-fetched, and re-clicking the SAME row collapses it back.
  function handleNodeClick(nodeId: string) {
    if (expandedNodeId === nodeId) {
      setExpandedNodeId(null);
      return;
    }
    setExpandedNodeId(nodeId);
    if (nodeLogLines[nodeId] === undefined) {
      void fetchNodeLog(runId, nodeId).then((lines) => {
        setNodeLogLines((prev) => ({ ...prev, [nodeId]: lines }));
      });
    }
  }

  if (!loaded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
        <StudioNav />
        {/* <main>, matching FlowRunDetail's own root element: a route's
            [data-page] must sit on the SAME element type in every state, or a
            selector written against one state silently misses the others. */}
        <main data-page="flow-run" data-run-id={runId} data-page-ready="false" className="muted" style={{ padding: 20, fontSize: 13 }}>
          Loading run…
        </main>
      </div>
    );
  }

  if (resolution?.kind === 'unresolved') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
        <StudioNav />
        <main
          data-page="flow-run"
          data-run-id={runId}
          data-flow-id={flowId}
          data-run-resolution="unresolved"
          className="muted"
          style={{ padding: 20, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}
        >
          Could not reach the bridge to resolve this run right now — try again shortly.
          <button
            type="button"
            className="btn btn-ghost"
            data-action="retry-run-load"
            onClick={() => void load({ cancelled: false })}
            style={{ fontSize: 12.5 }}
          >
            Retry
          </button>
        </main>
      </div>
    );
  }

  // W7-A4 (crosscut-27 / artifact-plan-08's run-page sibling): a run id the
  // bridge does not know renders the ONE shared NotFound (back to the flow's
  // monitor, or to /flows when the flow itself is unknown).
  if (resolution?.kind === 'not-found') {
    return (
      <NotFound
        kind="run"
        id={runId}
        backHref={flow ? `/flows/${encodeURIComponent(flowId)}` : '/flows'}
        backLabel={flow ? `${flow.name} monitor` : 'Flows'}
      />
    );
  }

  const found = resolution?.kind === 'found';
  const run: Run | null = resolution?.kind === 'found' ? resolution.run : null;
  // W7-A4 (flows-05 / crosscut-04): a missing flow DEFINITION (retired id, or
  // the pre-flow_id `unknown` sentinel) is passed through as `null` — the
  // timeline then derives from the run's OWN recorded phases and FlowRunDetail
  // says so, instead of an empty timeline that reads as valid.
  const rows = deriveFlowRunTimeline(flow, run);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <StudioNav />
      <FlowRunDetail
        runId={runId}
        found={found}
        flow={flow}
        run={run}
        rows={rows}
        findings={findings}
        expandedNodeId={expandedNodeId}
        nodeLogLines={nodeLogLines}
        onNodeClick={handleNodeClick}
      />
    </div>
  );
}
