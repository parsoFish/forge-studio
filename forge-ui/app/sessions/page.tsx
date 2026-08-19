'use client';

/**
 * /sessions — the aggregate in-flight sessions index (W6-B11).
 *
 * Reachable from Home's active-sessions strip ("all sessions (N) →" overflow
 * link) and from the Agents pillar's secondary nav (Sessions is deliberately
 * NOT its own top-level pillar — operator decision, see
 * docs/forge-ui-dom-and-harness.md's /sessions entry). Thin fetch-only
 * wrapper (mirrors `app/projects/page.tsx`'s own split exactly) around the
 * pure, props-driven `SessionsIndexBody`
 * (`components/studio/SessionsIndex.tsx`).
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchStudioSessions, type SessionIndexRow } from '@/lib/studio-client';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecovery } from '@/lib/use-bridge-status';
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
