'use client';

import { useEffect, useState } from 'react';
import { subscribe, fetchProjectAttention, type ProjectAttentionItem } from './bridge-client';
import {
  fetchRuns,
  fetchStudioAgents,
  fetchStudioFlows,
  fetchStudioKbs,
  fetchStudioProjects,
  fetchStudioSessions,
  type Agent,
  type Flow,
  type Kb,
  type Project,
  type Run,
  type SessionIndexRow,
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
 * burst of WS messages collapses into at most two round-trips instead of one
 * per message; `.cancel()` runs in the effect cleanup so no stray trailing
 * call fires after unmount. This is the SAME wiring `app/page.tsx` carried
 * directly before this hook existed — moved here unchanged, not re-derived,
 * since this hook is now the one place that subscription lives.
 *
 * W6-B11 — `sessions` (the aggregate in-flight sessions index,
 * `fetchStudioSessions()`, `?active=1` default) is a SEVENTH read folded into
 * the same `loadAll` `Promise.all` and the SAME `cycle-list-changed` refetch
 * as `runs` (a session-kickoff or session-completion is exactly the kind of
 * event that changes both the cycle list AND the in-flight session set, so
 * one shared debounced refetch covers both — no second WS handler, no second
 * debounce timer). `scripts/home-no-new-polling.test.ts`'s closed
 * `ALLOWED_FETCH_IDENTIFIERS` list was extended to include
 * `fetchStudioSessions` for this addition specifically — it is not a new,
 * bespoke endpoint invented for Home; it is the existing W6-B11 bridge route
 * this hook composes exactly like the other six reads.
 */
export type StudioHomeData = {
  agents: Agent[];
  flows: Flow[];
  projects: Project[];
  kbs: Kb[];
  runs: Run[];
  attention: ProjectAttentionItem[];
  sessions: SessionIndexRow[];
  /** True once the first `loadAll` Promise.all has settled. */
  ready: boolean;
};

/**
 * Extracted so the ADR-044 P1 debounce wiring is a plain, directly-testable
 * unit — a `Debounced<[]>` (`./debounce.ts`) wrapping a refetch callback,
 * with NO React/effect involvement — rather than only provable by reading
 * the hook's source text. `use-studio-home-data.test.ts` exercises this with
 * `vi.useFakeTimers()`, mirroring `debounce.test.ts`'s own style, to pin
 * that a burst of `cycle-list-changed` messages collapses into at most two
 * calls. The hook itself (below) is the only real caller — it now wraps a
 * combined runs+sessions refetch (W6-B11), unchanged as far as this function
 * itself is concerned (it takes any `() => void`).
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
  const [sessions, setSessions] = useState<SessionIndexRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const signal = { cancelled: false };

    async function loadAll(): Promise<void> {
      try {
        const [a, f, p, k, r, at, s] = await Promise.all([
          fetchStudioAgents(),
          fetchStudioFlows(),
          fetchStudioProjects(),
          fetchStudioKbs(),
          fetchRuns(),
          fetchProjectAttention(),
          fetchStudioSessions(),
        ]);
        if (signal.cancelled) return;
        setAgents(a);
        setFlows(f);
        setProjects(p);
        setKbs(k);
        setRuns(r);
        setAttention(at);
        setSessions(s);
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    }

    // W6-B11: refreshes BOTH runs and the sessions index off the same
    // cycle-list-changed signal — see this file's header for why one shared
    // debounced refetch covers both rather than a second WS handler.
    async function refreshRunsAndSessions(): Promise<void> {
      const [r, s] = await Promise.all([fetchRuns(), fetchStudioSessions()]);
      if (signal.cancelled) return;
      setRuns(r);
      setSessions(s);
    }

    void loadAll();

    // Subscribe to bridge WS to re-fetch runs (+ sessions, W6-B11) on
    // cycle-list-changed — the ONE live-refresh transport Studio has.
    // ADR-044 P1: debounce leading+trailing 500ms (createDebouncedRefreshRuns,
    // above) so a burst of cycle-list-changed messages collapses into at
    // most two round-trips instead of one per message.
    const debouncedRefresh = createDebouncedRefreshRuns(() => {
      void refreshRunsAndSessions();
    });
    const sub = subscribe({
      onState: () => { /* this hook does not surface connection state */ },
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') {
          debouncedRefresh();
        }
      },
    });

    return () => {
      signal.cancelled = true;
      debouncedRefresh.cancel();
      sub.close();
    };
    // intentional mount-only — loadAll/refreshRunsAndSessions are stable fetch helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { agents, flows, projects, kbs, runs, attention, sessions, ready };
}
