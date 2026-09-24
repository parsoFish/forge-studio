'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchPhaseLog } from './studio-client';
import type { Run, PhaseLogLine } from './studio-client';
import { phaseLogRefreshSignal } from './phase-log-refresh';
import { phaseLogErrorMessage } from './phase-log-panel-view';

export type UsePhaseLogResult = {
  logLines: PhaseLogLine[];
  logLoading: boolean;
  /** `null` = no failure recorded (loading, settled-empty, or settled-with-
   *  lines). See `./phase-log-panel-view.ts`'s `derivePhaseLogPanelState`
   *  for how a caller turns this + `logLoading` + `logLines.length` into
   *  one render state. */
  logError: string | null;
  stderrOnly: boolean;
  setStderrOnly: (value: boolean) => void;
};

/**
 * `PhaseDrawer.tsx`'s phase-log panel data lifecycle (forge-7wc).
 *
 * Extracted out of `PhaseDrawer.tsx`'s `DrawerBody` so the fix below lives
 * with the rest of this panel's own single-responsibility unit, rather than
 * growing `PhaseDrawer.tsx` past its file-size ratchet for a bug whose
 * render-side change is a one-line branch (see `PhaseDrawer.tsx`'s own log
 * section for that wiring).
 *
 * THE DEFECT (found R6-01-F1, 2026-08-07; deliberately not fixed there —
 * unpinned, no jsdom in this repo to test a React effect): Effect 1 wrapped
 * its async IIFE in try/finally with NO catch. A rejected `fetchPhaseLog`
 * became an unhandled promise rejection and left the pane in the exact same
 * state a genuinely empty log renders — nothing told the operator the fetch
 * had failed. Effect 2 (live refresh) already had its own catch, so a LIVE
 * node self-healed on its next attributed event; the residual hole was a
 * node that is idle or terminal when the INITIAL fetch fails — the pane
 * stayed empty indefinitely. Fixed by catching in Effect 1 too and
 * recording the failure as `logError`, a state distinct from "empty" (see
 * `./phase-log-panel-view.ts`).
 */
export function usePhaseLog(args: {
  run: Run;
  nodeId: string;
  cycleId: string;
  isWi: boolean;
  wiId?: string;
  /** W7-A3 (flows-15): a node that never started has no log — the caller's
   *  own pending-status check, so the identity effect never fires a
   *  guaranteed-404 fetch (a console error per hex click on a queued run).
   *  Keyed on this BOOLEAN, not the raw status, so a later active→complete
   *  flip does not re-run the identity effect (Effect 2 owns live refresh). */
  pendingNode: boolean;
}): UsePhaseLogResult {
  const { run, nodeId, cycleId, isWi, wiId, pendingNode } = args;

  const [logLines, setLogLines] = useState<PhaseLogLine[]>([]);
  const [stderrOnly, setStderrOnly] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // Effect 1 — identity: clear + fetch on identity change (new node / filter toggle)
  useEffect(() => {
    const signal = { cancelled: false };
    if (pendingNode) {
      setLogLines([]);
      setLogLoading(false);
      setLogError(null);
      return () => { signal.cancelled = true; };
    }
    setLogLoading(true);
    setLogLines([]);
    setLogError(null);
    void (async () => {
      try {
        const lines = await fetchPhaseLog(cycleId, nodeId, stderrOnly, isWi ? wiId : undefined);
        if (!signal.cancelled) setLogLines(lines);
      } catch (err) {
        // forge-7wc: the fix. Was try/FINALLY with no catch — see this
        // file's header.
        if (!signal.cancelled) setLogError(phaseLogErrorMessage(err));
      } finally {
        if (!signal.cancelled) setLogLoading(false);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [cycleId, nodeId, stderrOnly, isWi, wiId, pendingNode]);

  // R6-01 WI-1 F1: the log-refresh effect keys off lastEventAt (via this
  // signal), not lastProgressAt — lastProgressAt only advances on
  // tool_use/file_change/test_run/iteration (PROGRESS_EVENT_TYPES), so a node
  // narrating purely via 'log'/'error' events never refetched its log pane.
  const logRefreshSignal = phaseLogRefreshSignal(run, nodeId);

  // R6-01 WI-1 F2: the (identity, signal) pair the lines currently on screen
  // were fetched for. Written ONLY inside Effect 2 (never during render —
  // StrictMode double-invokes render, so a render-phase write would record a
  // fetch that never happened).
  const lastFetchedRef = useRef<{ identity: string; signal: string } | null>(null);

  // Effect 2 — live refresh: re-fetch IN PLACE (no flicker) whenever a NEW
  // event has been attributed to this node since the lines on screen were
  // fetched, keyed on logRefreshSignal so we refetch on each new attributed
  // event (any type), not just tool-progress ticks.
  //
  // The guard is "has the signal moved since our last fetch", NOT "is the
  // node still running" — a node's FINAL event advances lastEventAt AND
  // flips its status to complete/failed in the same React render
  // (`app/flows/[id]/page.tsx`'s `refreshActiveRun` refetches the whole Run
  // on every WebSocket event for the active run), so this effect still runs
  // once more to fetch the line that says how — or, for a failed node, WHY —
  // the node ended. A terminal node still cannot spin: `logRefreshSignal`
  // stops advancing once no further event is attributed to the node, so the
  // deps stop changing and the ref comparison short-circuits any further run.
  //
  // A successful refresh clears any earlier `logError` (self-heal); a failed
  // one stays best-effort, unchanged — a LIVE node gets another chance on
  // its next event, which is exactly what the Effect 1 fix above covers for
  // an idle/terminal node that never gets one.
  useEffect(() => {
    const identity = JSON.stringify([cycleId, nodeId, stderrOnly, isWi, wiId ?? null]);
    const prev = lastFetchedRef.current;
    lastFetchedRef.current = { identity, signal: logRefreshSignal };
    // First run for this identity. Effect 1's deps ARE this identity, so it
    // re-ran in this same commit and has already cleared + fetched this
    // node's log at this same signal value — fetching again here would
    // double-fetch the same content (and race Effect 1's setLogLines).
    if (prev === null || prev.identity !== identity) return;
    // Same identity and nothing new since the lines on screen were fetched.
    if (prev.signal === logRefreshSignal) return;
    const signal = { cancelled: false };
    void (async () => {
      try {
        const lines = await fetchPhaseLog(cycleId, nodeId, stderrOnly, isWi ? wiId : undefined);
        // Replace lines in place — do NOT setLogLines([]) first to avoid flicker.
        if (!signal.cancelled) { setLogLines(lines); setLogError(null); }
      } catch { /* best-effort — a live node self-heals on its next event */ }
    })();
    return () => { signal.cancelled = true; };
  }, [logRefreshSignal, cycleId, nodeId, stderrOnly, isWi, wiId]);

  return { logLines, logLoading, logError, stderrOnly, setStderrOnly };
}
