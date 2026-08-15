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
import { debounceLeadingTrailing } from './debounce';

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
 *
 * ADR-044 P1 (`docs/decisions/044-read-path-memoization.md`, merged to main
 * as `feat/w6-p1-run-list-cache` AFTER this hook's own extraction landed —
 * re-targeted here on merge): the `cycle-list-changed` refetch is wrapped in
 * `debounceLeadingTrailing` (`./debounce.ts`, 500ms leading+trailing) so a
 * burst of WS messages collapses into at most two `fetchRuns()` round-trips
 * instead of one per message; `.cancel()` runs in the effect cleanup so no
 * stray trailing call fires after unmount. This is the SAME wiring
 * `app/page.tsx` carried directly before this hook existed — moved here
 * unchanged, not re-derived, since this hook is now the one place that
 * subscription lives.
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

/**
 * Extracted so the ADR-044 P1 debounce wiring is a plain, directly-testable
 * unit — a `Debounced<[]>` (`./debounce.ts`) wrapping `refreshRuns`, with NO
 * React/effect involvement — rather than only provable by reading the
 * hook's source text. `use-studio-home-data.test.ts` exercises this with
 * `vi.useFakeTimers()`, mirroring `debounce.test.ts`'s own style, to pin
 * that a burst of `cycle-list-changed` messages collapses into at most two
 * `refreshRuns` calls. The hook itself (below) is the only real caller.
 */
export function createDebouncedRefreshRuns(refreshRuns: () => void, waitMs = 500) {
  return debounceLeadingTrailing(refreshRuns, waitMs);
}

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
    // ADR-044 P1: debounce leading+trailing 500ms (createDebouncedRefreshRuns,
    // above) so a burst of cycle-list-changed messages collapses into at
    // most two /api/runs round-trips instead of one per message.
    const debouncedRefreshRuns = createDebouncedRefreshRuns(() => {
      void refreshRuns();
    });
    const sub = subscribe({
      onState: () => { /* this hook does not surface connection state */ },
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') {
          debouncedRefreshRuns();
        }
      },
    });

    return () => {
      signal.cancelled = true;
      debouncedRefreshRuns.cancel();
      sub.close();
    };
    // intentional mount-only — loadAll/refreshRuns are stable fetch helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { agents, flows, projects, kbs, runs, attention, ready };
}
