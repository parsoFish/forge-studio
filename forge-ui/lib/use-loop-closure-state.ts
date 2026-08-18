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

import { fetchRuns, type Run } from './studio-client';
import { deriveInitiativeLinkage, type InitiativeLinkage } from './architect-plan-view';
import { useSchedulerStatus, SCHEDULER_POLL_MS, type SchedulerStatusState } from './use-scheduler-status';

export type LoopClosureState = SchedulerStatusState & {
  linkage: InitiativeLinkage[];
  linkageReady: boolean;
};

export function useLoopClosureState(initiativeIds: string[] | undefined, enabled = true, pollMs: number = SCHEDULER_POLL_MS): LoopClosureState {
  const scheduler = useSchedulerStatus(pollMs);
  const [runs, setRuns] = useState<Run[]>([]);
  const [linkageReady, setLinkageReady] = useState(false);
  const alive = useRef(true);
  const idsKey = (initiativeIds ?? []).join('\n');

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    const load = async () => {
      const r = await fetchRuns();
      if (!alive.current) return;
      setRuns(r);
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

  const linkage = deriveInitiativeLinkage(idsKey ? idsKey.split('\n') : [], runs);
  return { ...scheduler, linkage, linkageReady };
}
