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
import { SessionsIndexBody } from '@/components/studio/SessionsIndex';

export default function SessionsIndexPage() {
  const [sessions, setSessions] = useState<SessionIndexRow[]>([]);
  const [ready, setReady] = useState(false);

  // Default (`?active=1`) — operator-locked: in-flight sessions ONLY, never
  // terminal history. Re-run after a row's cancel succeeds (W7-A2) — the
  // cancelled session is terminal and drops out of the active set.
  const refresh = useCallback(async (): Promise<void> => {
    const s = await fetchStudioSessions();
    setSessions(s);
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      try {
        const s = await fetchStudioSessions();
        if (signal.cancelled) return;
        setSessions(s);
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    })();
    return () => { signal.cancelled = true; };
  }, []);

  return <SessionsIndexBody sessions={sessions} ready={ready} onCancelled={() => { void refresh(); }} />;
}
