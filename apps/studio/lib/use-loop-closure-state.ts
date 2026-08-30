'use client';

/**
 * useLoopClosureState — session → initiative → run linkage + scheduler state
 * for the architect post-approve surfaces (W7-A3, sessions-kinds-08/12,
 * artifact-plan-22/23).
 *
 * The bridge's session row carries `initiativeIds` (derived from the session's
 * manifests dir); the runs list carries one run per queued/claimed manifest.
 * Joining them here (`deriveInitiativeLinkage`) gives the queue state + run
 * href per initiative with nothing stored anywhere. Runs are re-read on the
 * same slow, visible-only cadence as the scheduler status so a "queued" row
 * turns into "building" once the daemon claims it.
 */
import { useEffect, useRef, useState } from 'react';

import { fetchRuns, fetchStudioFlows, type Flow, type Run } from './studio-client';
import { deriveInitiativeLinkage, type InitiativeLinkage } from './architect-plan-view';
import { useSchedulerStatus, SCHEDULER_POLL_MS, type SchedulerStatusState } from './use-scheduler-status';

export type LoopClosureState = SchedulerStatusState & {
  linkage: InitiativeLinkage[];
  linkageReady: boolean;
};

export function useLoopClosureState(initiativeIds: string[] | undefined, enabled = true, pollMs: number = SCHEDULER_POLL_MS): LoopClosureState {
  const scheduler = useSchedulerStatus(pollMs, enabled);
  const [runs, setRuns] = useState<Run[]>([]);
  // W8-B3 (sessions-kinds-08) — the live flows roster, so a run naming a flow
  // that no longer exists (22 of 63 real runs carry the `"unknown"` sentinel)
  // does not mint a monitor link into a not-found page. `undefined` until it
  // resolves: an unresolved roster suppresses the link rather than guessing.
  const [flowIds, setFlowIds] = useState<string[] | undefined>(undefined);
  const [linkageReady, setLinkageReady] = useState(false);
  const alive = useRef(true);
  const idsKey = (initiativeIds ?? []).join('\n');

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    const load = async () => {
      // W7-A1: reads THROW on a bridge failure. Keep `linkageReady` false on a
      // failed read (the panel keeps saying "Reading the queue…" — never the
      // false negative "no queue entry found"); the next tick retries and the
      // app-shell BridgeStatus banner owns the outage message.
      let r: Run[];
      let flows: Flow[];
      try {
        [r, flows] = await Promise.all([fetchRuns(), fetchStudioFlows()]);
      } catch {
        return;
      }
      if (!alive.current) return;
      setRuns(r);
      setFlowIds(flows.map((f) => f.id));
      setLinkageReady(true);
    };
    void load();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void load();
    }, pollMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [enabled, pollMs]);

  const linkage = deriveInitiativeLinkage(idsKey ? idsKey.split('\n') : [], runs, flowIds);
  return { ...scheduler, linkage, linkageReady };
}
