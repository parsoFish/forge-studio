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

import { useEffect, useState } from 'react';
import { StudioNav } from '@/components/StudioNav';
import { AgentsIndexView } from '@/components/studio/AgentsIndexView';
import { fetchStudioAgents, type Agent } from '@/lib/studio-client';
import { fetchRecentAgentRuns } from '@/lib/agents-index';
import type { LedgerRow } from '@/lib/history-ledger';

export default function AgentsIndexPage() {
  const [ready, setReady] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [recentRunsReady, setRecentRunsReady] = useState(false);
  const [recentRuns, setRecentRuns] = useState<LedgerRow[]>([]);

  // ---- roster fetch ----
  useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      const a = await fetchStudioAgents();
      if (cancelled) return;
      setAgents(a);
      setReady(true);
    }
    void loadAgents();
    return () => { cancelled = true; };
  }, []);

  // ---- recent-runs fetch — depends on the roster, so it waits for `ready` ----
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadRecentRuns() {
      const rows = await fetchRecentAgentRuns(agents);
      if (cancelled) return;
      setRecentRuns(rows);
      setRecentRunsReady(true);
    }
    void loadRecentRuns();
    return () => { cancelled = true; };
    // `agents` intentionally omitted: this effect should fire ONCE the
    // roster first becomes ready, not re-fire on every roster identity
    // change (the roster fetch above only ever runs once, on mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <StudioNav />
      <AgentsIndexView
        ready={ready}
        agents={agents}
        recentRunsReady={recentRunsReady}
        recentRuns={recentRuns}
        nowMs={Date.now()}
      />
    </div>
  );
}
