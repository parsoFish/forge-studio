'use client';

import { useCallback, useEffect, useState } from 'react';
import { subscribe, fetchProjectAttention, type ProjectAttentionItem } from './bridge-client';
import { FULL_LOAD_SCOPE, afterRefreshFailure, afterRefreshSuccess, scopedFetchError, type ScopedFetchError } from './fetch-error-scope';
import { useBridgeRecovery } from './use-bridge-status';
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
 *
 * W7-A1 (home-sessions-30 / crosscut-01 / crosscut-22): the seven reads now
 * THROW on a bridge failure (lib/studio-client.ts, lib/bridge-client.ts) —
 * `loadAll` catches and exposes `error`, so Home renders the shared failure
 * state instead of the "Nothing registered yet — Onboard your first project"
 * first-run screen. Recovery is `useBridgeRecovery` (the app-wide bridge
 * status store, `lib/use-bridge-status.ts`): when the bridge comes back the
 * hook re-runs `loadAll` — no page-level poll, no new transport. `reload`
 * is the same re-run, for the failure state's Retry button.
 */
/** W7-FIX-A1 (A1-03): carries the failed read set's `scope` (lib/fetch-error-scope.ts). */
export type StudioHomeFetchError = ScopedFetchError;

export type StudioHomeData = {
  agents: Agent[];
  flows: Flow[];
  projects: Project[];
  kbs: Kb[];
  runs: Run[];
  attention: ProjectAttentionItem[];
  sessions: SessionIndexRow[];
  /** True once the first `loadAll` Promise.all has settled (success OR failure). */
  ready: boolean;
  /** W7-A2 — refetch ONLY the sessions index (the SAME `fetchStudioSessions`
   *  read `loadAll` folds in), for a caller that just changed a session
   *  (Home's card cancel) — never a new endpoint, never a poll. */
  refreshSessions: () => Promise<void>;
  /** W7-A1: the last load's failure (bridge unreachable / refused), null when the last load succeeded. */
  error: StudioHomeFetchError | null;
  /** W7-A1: re-run the full load (Retry button + bridge recovery). */
  reload: () => void;
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
  const [error, setError] = useState<StudioHomeFetchError | null>(null);
  // W7-A1: bumping this re-runs the load effect (Retry / bridge recovery)
  // WITHOUT re-subscribing the WS — the subscription lives in its own,
  // mount-only effect below.
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  useBridgeRecovery(reload);

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
        setError(null);
      } catch (err) {
        // W7-A1: a failed read is a FAILURE, not an empty fleet — every
        // derivation below keeps whatever it last knew, and Home renders the
        // shared failure state off `error` (home-sessions-30 / crosscut-01).
        if (signal.cancelled) return;
        setError(scopedFetchError(err, FULL_LOAD_SCOPE));
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    }

    void loadAll();
    return () => { signal.cancelled = true; };
  }, [loadKey]);

  useEffect(() => {
    const signal = { cancelled: false };

    // W6-B11: refreshes BOTH runs and the sessions index off the same
    // cycle-list-changed signal — see this file's header for why one shared
    // debounced refetch covers both rather than a second WS handler.
    // W7-FIX-A1 (A1-03): this refresh reads runs+sessions ONLY — its success
    // clears only an error of ITS scope, never the seven-read full load's
    // (else a failed full load would fall through to "Nothing registered
    // yet" the moment one runs refresh succeeded).
    const REFRESH_SCOPE = 'runs+sessions';
    async function refreshRunsAndSessions(): Promise<void> {
      try {
        const [r, s] = await Promise.all([fetchRuns(), fetchStudioSessions()]);
        if (signal.cancelled) return;
        setRuns(r);
        setSessions(s);
        setError((prev) => afterRefreshSuccess(prev, REFRESH_SCOPE));
      } catch (err) {
        if (signal.cancelled) return;
        setError((prev) => afterRefreshFailure(prev, scopedFetchError(err, REFRESH_SCOPE)));
      }
    }

    // Subscribe to bridge WS to re-fetch runs (+ sessions, W6-B11) on
    // cycle-list-changed — the ONE live-refresh transport Studio has.
    // ADR-044 P1: debounce leading+trailing 500ms (createDebouncedRefreshRuns,
    // above) so a burst of cycle-list-changed messages collapses into at
    // most two round-trips instead of one per message.
    // W7-A1: connection STATE is no longer discarded here — it is owned by
    // the app-wide bridge status store (lib/use-bridge-status.ts), which
    // renders the shared banner and drives `reload` on recovery.
    const debouncedRefresh = createDebouncedRefreshRuns(() => {
      void refreshRunsAndSessions();
    });
    const sub = subscribe({
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
    // intentional mount-only — refreshRunsAndSessions is a stable fetch helper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSessions = useCallback(async (): Promise<void> => {
    setSessions(await fetchStudioSessions());
  }, []);

  return { agents, flows, projects, kbs, runs, attention, sessions, ready, error, reload, refreshSessions };
}
