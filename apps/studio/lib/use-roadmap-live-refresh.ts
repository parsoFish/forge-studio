/**
 * Which bridge messages make the project roadmap re-read.
 *
 * `forge-8vfn.7.6.27` (T1 rulings 721(b)/728). The roadmap was the ONE live
 * surface with no live refresh: `/flows`, `/flows/[id]` and `/sessions` all
 * subscribe to the bridge socket, and `app/projects/[id]/page.tsx` never
 * imported `subscribe` — so a card on screen updated only on navigation, a
 * Retry, or an operator action. M6-C's run 11 measured what that costs:
 * `cycle.end` at 13:23:30 with the manifest already in
 * `_queue/ready-for-review/`, and beat 8 still reading `planning` at 13:24:30.
 * `RoadmapCanvas.tsx:563` was not disagreeing with the queue — it was never
 * re-run.
 *
 * TWO messages, carrying one half of the surface each:
 *
 *   `cycle-list-changed`  every `data-initiative-status` transition.
 *                         `watchQueue` (`apps/forge/ui-bridge.ts:495-508`)
 *                         watches all SIX queue dirs and broadcasts on any
 *                         change, so a manifest moving between them always
 *                         fires.
 *
 *   `event`               `data-plan-state`'s planning -> planned. That value
 *                         derives from the WI snapshot under
 *                         `_logs/<cycleId>/work-items-snapshot/`
 *                         (`bridge-studio.ts:984` -> `:1139`), which is NOT a
 *                         queue dir. `watchQueue` does not watch it, so that
 *                         transition fires no `cycle-list-changed` of its own
 *                         and the PM's own log lines are the only signal.
 *
 * **Either alone is a partial fix wearing a fix's clothes.** `event` only
 * refreshes busily while the PM runs and then not at the queue move;
 * `cycle-list-changed` only leaves run 11's beat 8 exactly as broken as it was.
 *
 * WHY NO NEW EMISSION (728, and it was the tempting alternative). Making the
 * WI-snapshot write emit its own message means watching `_logs/`, which churns
 * on every `events.jsonl` line of every live cycle — a firehose — or adding
 * and removing a targeted watcher per cycle, which is real new state in the
 * bridge. The information is ALREADY on the socket. Listening costs nothing
 * that emitting would not cost more.
 *
 * WHY THE CALLER MUST NOT FILTER BY KNOWN CYCLE ID. The obvious economy is to
 * refresh only for events whose `cycleId` the page already knows from
 * `cycleGroups`. It fails in exactly the case this file exists for: a cycle the
 * daemon claims AFTER the page loaded is not in that set, so the transition
 * beat 8 waited 180 s for is dropped as belonging to an unknown cycle. Take the
 * debounce instead — an identifier that looks like the obvious scope is the one
 * thing guaranteed to be missing in the case the fix exists for.
 */
import { useEffect, useRef } from 'react';

import { subscribe, type BridgeMessage } from './bridge-client';
import { createDebouncedRefreshRuns } from './use-studio-home-data';

/**
 * Fail CLOSED on the vocabulary: only the two named types refresh, and an
 * unrecognised message never does.
 *
 * `snapshot` arrives on connect, at the same instant the page's own mount
 * effect has already fetched — refreshing on it is a guaranteed duplicate read.
 * `architect-list-changed`, `instructions-list-changed` and `demo-list-changed`
 * describe lists the roadmap does not render at all, and a refresh is a
 * filesystem scan of six queue dirs plus a run read.
 *
 * A message type added to the bridge tomorrow reaches this predicate as
 * `false`, not as a default `true` — whoever adds it adds a case here and a
 * line to the doc above, deliberately.
 */
export function refreshesRoadmap(msg: BridgeMessage): boolean {
  return msg.type === 'cycle-list-changed' || msg.type === 'event';
}

/**
 * Subscribe the project roadmap to the bridge socket.
 *
 * MOUNT-ONLY, like `use-studio-home-data.ts:196-222`, and for the same reason:
 * the subscription must not be torn down and rebuilt every time a Retry bumps
 * `loadKey` or a fetch changes a callback's identity. The ref keeps that from
 * costing a stale closure — the effect never re-runs, but it always calls the
 * CURRENT refresher.
 *
 * `isNew` is the `/projects/new` guard W7-A4 established: that route is the
 * onboarding form, not a project, and no per-project read may fire for it.
 *
 * The debounce is ADR-044 P1's (leading+trailing 500 ms). `event` arrives per
 * log line while the PM runs, so the roadmap would otherwise refetch per line.
 * `makeCoalescedRefresh` (`lib/coalesce-refresh.ts`) is the neighbouring tool
 * and the wrong one here — it collapses same-tick bursts and in-flight overlap
 * but does not rate-limit a steady stream spread over minutes, which is exactly
 * the shape of a PM writing work items.
 */
export function useRoadmapLiveRefresh(isNew: boolean, refreshRoadmap: () => void | Promise<void>): void {
  const refreshRef = useRef(refreshRoadmap);
  refreshRef.current = refreshRoadmap;
  useEffect(() => {
    if (isNew) return;
    const signal = { cancelled: false };
    const debouncedRefresh = createDebouncedRefreshRuns(() => {
      if (signal.cancelled) return;
      void refreshRef.current();
    });
    const sub = subscribe({
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (refreshesRoadmap(msg)) debouncedRefresh();
      },
    });
    return () => {
      signal.cancelled = true;
      debouncedRefresh.cancel();
      sub.close();
    };
    // intentional mount-only — the ref above carries the current refresher
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);
}
