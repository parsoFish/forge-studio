'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { subscribe } from '@/lib/bridge-client';
import { StudioNav } from '@/components/StudioNav';
import { FlowsIndexBody } from '@/components/studio/FlowsIndexBody';
import { SchedulerCard } from '@/components/SchedulerCard';
import { FetchErrorState } from '@/components/FetchErrorState';
import { useBridgeRecovery } from '@/lib/use-bridge-status';
import { FULL_LOAD_SCOPE, afterRefreshFailure, afterRefreshSuccess, scopedFetchError, type ScopedFetchError } from '@/lib/fetch-error-scope';
import {
  fetchStudioFlows,
  fetchRuns,
  fetchStudioProjects,
  type Flow,
  type Project,
  type Run,
} from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// Flows index — /flows (W6-IA-2).
//
// The flows pillar's own browse surface: every flow the operator can run, as
// a card grid (reusing the REAL FlowCard from the library shelf's flows
// section), with a first-run banner / true-empty state carrying the same
// "+ New flow" CTA (see `FlowsIndexBody`'s header for the three-state split).
// `StudioNav.tsx`'s Flows nav item points at this index (repointed in
// W6-IA-5).
//
// This is a thin connected shell: all render CONTRACT (grid rows,
// first-run/zero-state, card reuse) lives on `FlowsIndexBody`
// (components/studio/FlowsIndexBody.tsx), which is render-tested directly —
// see `lib/flows-index-render.test.ts`'s header for why the page itself
// isn't (a `useEffect` fetch that doesn't run under SSR-style rendering,
// same known gap as every other dynamic Studio page).
//
// The `cycle-list-changed` bridge subscription (mirrors
// `app/library/page.tsx:67-89`'s `loadAll`/`refreshRuns` split exactly) keeps
// FlowCard's run-derived badges (`data-flow-status`/gated/failed counts)
// live — without it a run starting/finishing after the initial load would
// leave every card frozen at its load-time snapshot.
// ---------------------------------------------------------------------------

export default function FlowsIndexPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);
  // W7-A1 (crosscut-01/-22): a failed read is an ERROR state, never "No flows
  // registered at all". `loadKey` re-runs the load on Retry + bridge recovery
  // (the WS subscription below stays mount-only — it is not re-opened).
  // W7-FIX-A1 (A1-03): the error carries the SCOPE of the read set that
  // failed — a successful runs-only refresh may clear only a runs-only
  // failure, never the full load's (see lib/fetch-error-scope.ts).
  const [error, setError] = useState<ScopedFetchError | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  useBridgeRecovery(reload);

  async function loadAll(signal: { cancelled: boolean }): Promise<void> {
    try {
      const [f, r, p] = await Promise.all([fetchStudioFlows(), fetchRuns(), fetchStudioProjects()]);
      if (signal.cancelled) return;
      setFlows(f);
      setRuns(r);
      setProjects(p);
      setError(null);
    } catch (err) {
      if (signal.cancelled) return;
      setError(scopedFetchError(err, FULL_LOAD_SCOPE));
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }

  const RUNS_SCOPE = 'runs';
  async function refreshRuns(signal: { cancelled: boolean }): Promise<void> {
    try {
      const r = await fetchRuns();
      if (signal.cancelled) return;
      setRuns(r);
      setError((prev) => afterRefreshSuccess(prev, RUNS_SCOPE));
    } catch (err) {
      if (signal.cancelled) return;
      setError((prev) => afterRefreshFailure(prev, scopedFetchError(err, RUNS_SCOPE)));
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    void loadAll(signal);
    return () => { signal.cancelled = true; };
    // intentional: re-runs ONLY on loadKey (Retry / bridge recovery) — loadAll is a stable fetch helper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  useEffect(() => {
    // intentional mount-only — refreshRuns is a stable fetch helper
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const signal = { cancelled: false };

    // Subscribe to bridge WS to re-fetch runs on cycle-list-changed (a run
    // starting/gating/completing anywhere) — same event/handler shape as
    // app/library/page.tsx's own subscription. Connection STATE is owned by
    // the app-wide bridge status store (W7-A1) — not re-derived here.
    const sub = subscribe({
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') {
          void refreshRuns(signal);
        }
      },
    });

    return () => {
      signal.cancelled = true;
      sub.close();
    };
  }, []);

  return (
    <main
      data-page="flows-index"
      data-page-ready={ready ? 'true' : 'false'}
      data-flow-count={flows.length}
      data-fetch-status={error ? 'error' : ready ? 'ok' : 'loading'}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div className="page-wrap" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 20 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Flows
          </h1>
          <span
            className="lib-count"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}
          >
            {flows.length}
          </span>
          <span style={{ flex: 1 }} />
          <Link
            href="/flows/new"
            className="btn btn-primary"
            data-action="new-flow"
            style={{ textDecoration: 'none' }}
          >
            + New flow
          </Link>
        </div>

        {/* W7-A3 (flows-01/23): the scheduler is what turns a queued run into
            a running one — surface it where the runs are. */}
        <section data-section="scheduler" aria-label="Scheduler" style={{ marginBottom: 20 }}>
          <SchedulerCard queuedCount={runs.filter((r) => r.status === 'planned').length} />
        </section>

        {error ? (
          <div style={{ marginBottom: flows.length > 0 ? 18 : 0 }}>
            <FetchErrorState what="flows and runs" error={error.message} status={error.status} onRetry={reload} />
          </div>
        ) : null}
        {error && flows.length === 0 ? null : ready ? (
          <FlowsIndexBody flows={flows} runs={runs} projects={projects} />
        ) : (
          <div style={{ color: 'var(--faint)', fontSize: 13, padding: '24px 0' }}>Loading flows…</div>
        )}
      </div>
    </main>
  );
}
