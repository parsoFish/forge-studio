'use client';

import { useEffect, useState } from 'react';
import { subscribe, fetchProjectAttention, type ProjectAttentionItem } from './bridge-client';
import {
  fetchRuns,
  fetchStudioAgents,
  fetchStudioFlows,
  fetchStudioKbs,
  fetchStudioProjects,
  type Agent,
  type Flow,
  type Kb,
  type Project,
  type Run,
} from './studio-client';

/**
 * useStudioHomeData — the ONE cross-object aggregate fetch (W6-IA-4, sweep
 * finding C1#5). Before this, `app/page.tsx` (Home) and `app/library/page.tsx`
 * (the old Library landing page) each hand-carried a BYTE-IDENTICAL copy of
 * this exact loadAll/refreshRuns/subscribe() shape — six independent reads
 * (agents/flows/projects/kbs/runs/attention) joined with `Promise.all`, plus
 * a `cycle-list-changed` WS re-fetch of runs only. Library's W6-IA-4 rebuild
 * no longer needs any of these six reads at all (its five shelves — skills/
 * hooks/connections/templates/community — read entirely different sources),
 * so the duplication this hook removes was about to become ONE real copy
 * with a stale, unremovable sibling. This hook is that one real copy; Home
 * is now its only caller.
 *
 * PURITY / TRANSPORT CONTRACT (mirrors `scripts/home-no-new-polling.test.ts`,
 * relocated onto this file now that Home's own fetch identifiers moved
 * here): only the pre-existing `fetchStudioFlows` / `fetchStudioAgents` /
 * `fetchStudioProjects` / `fetchStudioKbs` / `fetchRuns` /
 * `fetchProjectAttention` / `subscribe` — no raw fetch call, no hardcoded
 * `/api/...` endpoint literal, no `setInterval`, no bespoke `WebSocket`. Live refresh is the
 * ONE bridge WebSocket (`subscribe()`): a `cycle-list-changed` message
 * re-fetches runs only, exactly as both callers did before extraction.
 */
export type StudioHomeData = {
  agents: Agent[];
  flows: Flow[];
  projects: Project[];
  kbs: Kb[];
  runs: Run[];
  attention: ProjectAttentionItem[];
  /** True once the first `loadAll` Promise.all has settled. */
  ready: boolean;
};

export function useStudioHomeData(): StudioHomeData {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [attention, setAttention] = useState<ProjectAttentionItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const signal = { cancelled: false };

    async function loadAll(): Promise<void> {
      try {
        const [a, f, p, k, r, at] = await Promise.all([
          fetchStudioAgents(),
          fetchStudioFlows(),
          fetchStudioProjects(),
          fetchStudioKbs(),
          fetchRuns(),
          fetchProjectAttention(),
        ]);
        if (signal.cancelled) return;
        setAgents(a);
        setFlows(f);
        setProjects(p);
        setKbs(k);
        setRuns(r);
        setAttention(at);
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    }

    async function refreshRuns(): Promise<void> {
      const r = await fetchRuns();
      if (signal.cancelled) return;
      setRuns(r);
    }

    void loadAll();

    // Subscribe to bridge WS to re-fetch runs on cycle-list-changed — the
    // ONE live-refresh transport Studio has.
    const sub = subscribe({
      onState: () => { /* this hook does not surface connection state */ },
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') {
          void refreshRuns();
        }
      },
    });

    return () => {
      signal.cancelled = true;
      sub.close();
    };
    // intentional mount-only — loadAll/refreshRuns are stable fetch helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { agents, flows, projects, kbs, runs, attention, ready };
}
