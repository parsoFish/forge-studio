'use client';

/**
 * /sessions — the aggregate in-flight sessions index (W6-B11).
 *
 * Reachable from Home's sessions-needing-you strip ("all sessions (N) →" —
 * W7-B1: the strip never unmounts, so this link survives an empty session
 * set) and from the Agents pillar's secondary nav (Sessions is deliberately
 * NOT its own top-level pillar — operator decision, see
 * docs/forge-ui-dom-and-harness.md's /sessions entry). Thin fetch-owning
 * wrapper (mirrors `app/projects/page.tsx`'s own split) around the
 * pure, props-driven `SessionsIndexBody`
 * (`components/studio/SessionsIndex.tsx`), plus the ONE live-refresh
 * subscribe (W7-B1, home-sessions-12 — see the effect below).
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchStudioSessions, type SessionIndexRow } from '@/lib/studio-client';
import { subscribe } from '@/lib/bridge-client';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecovery } from '@/lib/use-bridge-status';
import { createDebouncedRefreshRuns } from '@/lib/use-studio-home-data';
import { SessionsIndexBody, type SessionsIndexFetchError, type SessionsLastCancel } from '@/components/studio/SessionsIndex';

export default function SessionsIndexPage() {
  const [sessions, setSessions] = useState<SessionIndexRow[]>([]);
  const [ready, setReady] = useState(false);
  // W7-A1 (home-sessions-29): a failed fetch is an ERROR state, never the
  // "No sessions in flight" zero-state. `loadKey` re-runs the load on Retry
  // and on bridge recovery (no page-level poll).
  const [error, setError] = useState<SessionsIndexFetchError | null>(null);
  // W7A2-02 — the last cancel's real outcome, kept across the refetch that
  // drops the row so the operator sees whether anything was stopped.
  const [lastCancel, setLastCancel] = useState<SessionsLastCancel | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  useBridgeRecovery(reload);

  // Default (`?active=1`) — operator-locked: in-flight sessions ONLY, never
  // terminal history. Re-run after a row's cancel succeeds (W7-A2) — the
  // cancelled session is terminal and drops out of the active set. W7A2-06:
  // a FAILED refetch routes into the page's error state (the shared
  // FetchErrorState) instead of escaping — the cancelled row must never
  // linger as "in flight" with no explanation.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const s = await fetchStudioSessions();
      setSessions(s);
      setError(null);
    } catch (err) {
      const { error: message, status } = fetchErrorPropsFrom(err);
      setError(status !== undefined ? { message, status } : { message });
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      try {
        const s = await fetchStudioSessions();
        if (signal.cancelled) return;
        setSessions(s);
        setError(null);
      } catch (err) {
        if (signal.cancelled) return;
        const { error: message, status } = fetchErrorPropsFrom(err);
        setError(status !== undefined ? { message, status } : { message });
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [loadKey]);

  // W7-B1 (home-sessions-12) — the index stays LIVE: the same
  // `cycle-list-changed` bridge-WS signal Home already refetches on (a
  // session kickoff/completion is exactly the event that changes the
  // in-flight set), debounced through the SAME `createDebouncedRefreshRuns`
  // wrapper (ADR-044 P1) so a burst collapses into at most two round-trips.
  // No page-level poll, no new transport — one subscribe, mount-only,
  // mirroring `use-studio-home-data.ts`'s own wiring. A failed refetch
  // routes into the SAME error state the page already renders (`refresh`).
  useEffect(() => {
    const signal = { cancelled: false };
    const debouncedRefresh = createDebouncedRefreshRuns(() => {
      if (!signal.cancelled) void refresh();
    });
    const sub = subscribe({
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') debouncedRefresh();
      },
    });
    return () => {
      signal.cancelled = true;
      debouncedRefresh.cancel();
      sub.close();
    };
    // mount-only — `refresh` is a stable useCallback([], above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SessionsIndexBody
      sessions={sessions}
      ready={ready}
      error={error}
      onRetry={reload}
      lastCancel={lastCancel}
      onCancelled={(row, outcome) => { setLastCancel({ row, outcome }); void refresh(); }}
    />
  );
}
