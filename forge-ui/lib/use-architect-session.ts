'use client';

import { useEffect } from 'react';

import { fetchArchitectSessions, type ArchitectSessionSummary } from './bridge-client';

/**
 * Poll the architect session behind an `_architect-<sid>` runId so a hosting
 * surface (the /artifact PLAN gate) reflects phase transitions live. On
 * send-back the phase drops to drafting; the revised plan brings it back to
 * awaiting-verdict — driving the gate's detach→reattach lifecycle without a
 * page reload. No-op for non-architect runIds. Pushes each result through
 * `onSession`.
 */
export function useArchitectSessionPoll(
  runId: string,
  enabled: boolean,
  onSession: (session: ArchitectSessionSummary | null) => void,
  intervalMs = 2000,
): void {
  useEffect(() => {
    if (!enabled || !runId.startsWith('_architect-')) return;
    const sessionId = runId.slice('_architect-'.length);
    let cancelled = false;
    const refresh = () => {
      fetchArchitectSessions()
        .then((sessions) => {
          if (cancelled) return;
          onSession(sessions.find((s) => s.sessionId === sessionId) ?? null);
        })
        .catch(() => { /* keep last known */ });
    };
    const poll = setInterval(refresh, intervalMs);
    return () => { cancelled = true; clearInterval(poll); };
    // onSession is a stable setState updater from the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, enabled, intervalMs]);
}
