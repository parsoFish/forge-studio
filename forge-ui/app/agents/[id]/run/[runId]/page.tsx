'use client';

/**
 * Standalone run view — /agents/[id]/run/[runId] (R6-04 WI-4 item 4).
 *
 * A thin client shell: fetches this run's detail (`../../../../lib/
 * run-view-client.ts`'s `fetchRunDetail`, which reads `GET
 * /api/agents/runs/:runId`'s `lines` field, WI-4 item 1) and renders the
 * pure, props-driven `RunView` (`../../../../components/studio/
 * agent-builder/RunView.tsx`) with the resolved data. Mirrors
 * `app/agents/[id]/page.tsx`'s own `useParams()` precedent (the sibling
 * dynamic route this task brief calls out) rather than reading `params` as
 * a prop.
 *
 * KNOWN GAP (documented, not closed here): this fetch/render wiring is
 * verified by `tsc` only — no jsdom / `@testing-library/react` in this
 * repo, and `useParams()` needs the Next.js app router context mounted,
 * which bare `react-dom/server` rendering (used by this WI's acceptance
 * tests) cannot provide. See `run-view-client.ts`'s header for the full
 * rationale and for why `found` means "fetch resolved", not "this runId
 * was definitely dispatched" (the underlying API has no way to distinguish
 * those today). A real-browser journey beat (a later work item) closes
 * this gap.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { StudioNav } from '@/components/StudioNav';
import { RunView } from '@/components/studio/agent-builder/RunView';
import { fetchRunDetail, type RunDetail } from '@/lib/run-view-client';

const EMPTY_DETAIL: RunDetail = {
  found: false,
  state: 'unknown',
  costUsd: 0,
  lines: [],
  materials: [],
  ceilingUsd: undefined,
  outputs: [],
};

export default function AgentRunPage() {
  const params = useParams();
  const runId = decodeURIComponent((params?.runId as string) ?? '');

  const [detail, setDetail] = useState<RunDetail>(EMPTY_DETAIL);
  // Distinct from `detail.found` — the fetch simply hasn't resolved yet, so
  // the page must not render RunView's "not found" state (which would read
  // as a false claim about a run that was never actually checked).
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    async function load() {
      const d = await fetchRunDetail(runId);
      if (cancelled) return;
      setDetail(d);
      setLoaded(true);
    }
    void load();
    return () => { cancelled = true; };
  }, [runId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <StudioNav />
      {!loaded ? (
        <div data-page="agent-run" data-run-id={runId} data-page-ready="false" className="muted" style={{ padding: 20, fontSize: 13 }}>
          Loading run…
        </div>
      ) : (
        <RunView
          runId={runId}
          found={detail.found}
          state={detail.state}
          costUsd={detail.costUsd}
          lines={detail.lines}
          materials={detail.materials}
          ceilingUsd={detail.ceilingUsd}
          outputs={detail.outputs}
          trigger={detail.trigger}
        />
      )}
    </div>
  );
}
