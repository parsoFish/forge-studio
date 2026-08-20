'use client';

/**
 * Agents index — `/agents` (T2 lane W6-IA-3).
 *
 * Ground truth this route fills: no `/agents` index existed before this —
 * `StudioNav`'s "Agents" nav item now points here (repointed in
 * W6-IA-5) and previously the only way to an agent's
 * run-history ledger was via the per-agent builder's own `HistoryLedger`
 * section (`app/agents/[id]/page.tsx:838-864`). This route gives agents
 * their own browsable index — a roster (mirroring `/library`'s own agents
 * pillar) plus a cross-agent "recent runs" view — without touching
 * `StudioNav` or its test (IA-5's lane) and without adding any new bridge
 * route (out of scope for this lane — see `lib/agents-index.ts`'s header).
 *
 * Thin client shell (mirrors `app/agents/[id]/run/[runId]/page.tsx`'s own
 * precedent): fetches the agent roster (`fetchStudioAgents`, the SAME
 * fetch `/library` already makes) and the merged "recent agent runs"
 * ledger (`lib/agents-index.ts`'s `fetchRecentAgentRuns`) as two
 * INDEPENDENT effects, then renders the pure `AgentsIndexView`
 * (`components/studio/AgentsIndexView.tsx`) with whatever has resolved so
 * far. `StudioNav` lives HERE, not inside the pure view, so the view stays
 * renderable via `renderToStaticMarkup` in tests — `StudioNav` reads the
 * current route via a client-only hook that needs the Next.js router
 * context bare SSR rendering cannot provide (the same reason `RunView.tsx`'s
 * own header documents for its sibling page).
 *
 * The runs fetch deliberately waits for the roster fetch to resolve first
 * (it needs the roster's agent ids to fan out per-agent history requests) —
 * see the second effect's `if (!ready) return;` guard below.
 */

import { useCallback, useEffect, useState } from 'react';
import { StudioNav } from '@/components/StudioNav';
import { AgentsIndexView } from '@/components/studio/AgentsIndexView';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecovery } from '@/lib/use-bridge-status';
import { fetchStudioAgents, type Agent } from '@/lib/studio-client';
import { fetchRecentAgentRunsWithMeta, RECENT_AGENT_RUNS_LIMIT, RECENT_AGENT_RUNS_EXPANDED_LIMIT } from '@/lib/agents-index';
import type { LedgerRow } from '@/lib/history-ledger';

export default function AgentsIndexPage() {
  const [ready, setReady] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [recentRunsReady, setRecentRunsReady] = useState(false);
  const [recentRuns, setRecentRuns] = useState<LedgerRow[]>([]);
  // W7-FIX-A1 (A1-09): how many per-agent history reads were 'unresolved'
  // (of the roster total) — surfaced beside the rows, never discarded.
  const [recentRunsMeta, setRecentRunsMeta] = useState<{ unresolved: number; total: number }>({ unresolved: 0, total: 0 });
  const [recentRunsKey, setRecentRunsKey] = useState(0);
  const retryRecentRuns = useCallback(() => setRecentRunsKey((k) => k + 1), []);
  // W7-B5 (agents-40): the section's fetch bound — "View all runs" expands
  // it to the server route's own hard cap and refetches.
  const [recentRunsLimit, setRecentRunsLimit] = useState(RECENT_AGENT_RUNS_LIMIT);
  const showAllRecentRuns = useCallback(() => {
    setRecentRunsLimit(RECENT_AGENT_RUNS_EXPANDED_LIMIT);
    setRecentRunsKey((k) => k + 1);
  }, []);
  // W7-A1 (crosscut-01/-22): a failed roster read is an ERROR state, never
  // "No agents yet"; `loadKey` re-runs the load on Retry + bridge recovery.
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  useBridgeRecovery(reload);

  // ---- roster fetch ----
  useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      try {
        const a = await fetchStudioAgents();
        if (cancelled) return;
        setAgents(a);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const { error: message, status } = fetchErrorPropsFrom(err);
        setError(status !== undefined ? { message, status } : { message });
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void loadAgents();
    return () => { cancelled = true; };
  }, [loadKey]);

  // ---- recent-runs fetch — depends on the roster, so it waits for `ready` ----
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadRecentRuns() {
      const { rows, unresolved, total } = await fetchRecentAgentRunsWithMeta(agents, recentRunsLimit);
      if (cancelled) return;
      setRecentRuns(rows);
      setRecentRunsMeta({ unresolved, total });
      setRecentRunsReady(true);
    }
    void loadRecentRuns();
    return () => { cancelled = true; };
    // `agents` is set ONLY by the roster load (mount / Retry / bridge
    // recovery), so depending on it re-runs the fan-out exactly when the
    // roster was re-read — after an outage the histories refill with the
    // roster instead of freezing at the outage result (W7-FIX-A1 review).
    // `recentRunsKey`: the unresolved-notice Retry re-runs the fan-out alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, agents, recentRunsKey]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <StudioNav />
      <AgentsIndexView
        ready={ready}
        agents={agents}
        recentRunsReady={recentRunsReady}
        recentRuns={recentRuns}
        recentRunsUnresolved={recentRunsMeta.unresolved}
        recentRunsTotal={recentRunsMeta.total}
        onRetryRecentRuns={retryRecentRuns}
        recentRunsLimit={recentRunsLimit}
        onShowAllRecentRuns={recentRunsLimit < RECENT_AGENT_RUNS_EXPANDED_LIMIT ? showAllRecentRuns : null}
        nowMs={Date.now()}
        error={error}
        onRetry={reload}
      />
    </div>
  );
}
