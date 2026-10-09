'use client';

/**
 * useReflectionPoll — a BOUNDED poll for the live Stage-2 reflection
 * questions (forge-8vfn.8.1.42, ruling 1849).
 *
 * THE DEFECT. `/artifact?type=reflection`'s `load()` effect
 * (app/artifact/page.tsx) calls `fetchReflection` exactly ONCE, on mount /
 * route change. Real S10 run 39: the operator opened the reflection view
 * (`data-action="open-reflect"`) ~35s BEFORE the reflector started; the read
 * came back with no questions, and nothing on the page ever asked again —
 * `useBridgeRecoveryWhenFailed` fires only on a TRANSPORT failure, and this
 * read SUCCEEDED, it just answered "not yet". The reflector filed 4 real
 * questions 10 minutes later and the screen stayed "No reflection questions
 * filed for this cycle yet." forever.
 *
 * THE FIX. Re-fetch on an interval, mirroring `useArchitectSessionPoll`'s
 * shape (an interval id, a `cancelled` guard, cleanup on every dependency
 * change and on unmount, "keep the last known value" on a transient
 * failure) — see `./use-architect-session.ts`. `needsReflectionPoll` is the
 * single stop/go decision: keep polling while there are no questions AND
 * the cycle isn't answered; a `null` read (`fetchReflection`'s
 * `bridgeReadOr404` — a 404 for a reflection that hasn't started yet) is the
 * same "keep waiting" case, not a reason to stop. The poll NEVER runs past
 * `boundMs`: the API exposes no terminal "no questions coming" state, so an
 * automated cycle stuck at zero questions (`mode: 'automated'`) would
 * otherwise poll forever.
 */
import { useEffect } from 'react';

import { fetchReflection, type ReflectionData } from './bridge-client';

/** A few seconds — frequent enough the operator sees questions land without
 *  a manual refresh, sparse enough not to hammer the bridge. */
export const REFLECTION_POLL_INTERVAL_MS = 4000;

/** Real S10 run 39's questions landed ~10.5 minutes after the page opened (the
 *  reflector starts after closure, then ran ~10 minutes), so the bound is 30 minutes;
 *  `needsReflectionPoll` alone is not a backstop for a cycle that never gets a question. */
export const REFLECTION_POLL_BOUND_MS = 30 * 60 * 1000;

/** True while the wait for reflection questions isn't over: no questions yet,
 *  not answered, and not filed (forge-nk1y.3: a filed EMPTY list is the
 *  reflector's final word — the gate offers the close act). Exported so the stop/go decision is provable by
 *  execution without mounting React (mirrors `createDebouncedRefreshRuns`'s
 *  extracted-pure-logic technique in `use-studio-home-data.ts`). */
export function needsReflectionPoll(data: ReflectionData | null): boolean {
  if (data === null) return true;
  if (data.answered) return false;
  if (data.filed === true) return false;
  return data.questions.length === 0;
}

export function useReflectionPoll(
  cycleId: string,
  enabled: boolean,
  data: ReflectionData | null,
  onData: (next: ReflectionData | null) => void,
  intervalMs = REFLECTION_POLL_INTERVAL_MS,
  boundMs = REFLECTION_POLL_BOUND_MS,
): void {
  const waiting = enabled && needsReflectionPoll(data);
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt >= boundMs) {
        clearInterval(id);
        return;
      }
      fetchReflection(cycleId)
        .then((next) => { if (!cancelled) onData(next); })
        .catch(() => { /* transient — keep the last known value, retry next tick */ });
    }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
    // onData is a stable setState updater from the caller — same contract as
    // useArchitectSessionPoll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, waiting, intervalMs, boundMs]);
}
