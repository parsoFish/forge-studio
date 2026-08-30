'use client';

/**
 * useSchedulerStatus — the scheduler daemon's live status for the
 * SchedulerCard and every scheduler-aware banner (W7-A3, flows-01/23,
 * projects-16, sessions-kinds-08/12).
 *
 * The bridge exposes `GET /api/scheduler/status` + start/pause/resume/stop
 * (cli/ui-bridge.ts) but broadcasts no WS message when the daemon starts or
 * stops (an operator may `forge serve` from a shell), so this hook reads on
 * mount, after every action it dispatched itself, and on a slow poll ONLY
 * while the tab is visible. `status === null` means "could not read" — the
 * card renders that as its own honest state with no controls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchSchedulerStatus,
  startScheduler,
  pauseScheduler,
  resumeScheduler,
  stopScheduler,
  type SchedulerStatus,
} from './bridge-client';
import type { SchedulerAction } from './scheduler-view';

export type SchedulerStatusState = {
  status: SchedulerStatus | null;
  /** True once the first read settled (success or failure). */
  ready: boolean;
  /** True while an action POST is in flight. */
  busy: boolean;
  /** The last action's bridge error, verbatim; cleared on the next action. */
  error: string | null;
  refresh: () => Promise<void>;
  act: (action: SchedulerAction) => Promise<void>;
};

const ACTIONS: Record<SchedulerAction, () => Promise<{ ok: boolean; error?: string }>> = {
  start: startScheduler,
  pause: pauseScheduler,
  resume: resumeScheduler,
  stop: stopScheduler,
};

export const SCHEDULER_POLL_MS = 10_000;

export function useSchedulerStatus(pollMs: number = SCHEDULER_POLL_MS, enabled = true): SchedulerStatusState {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    // W7-A1 made bridge reads THROW on failure (BridgeReadError). An
    // unreachable bridge is `status: null` here — the card renders that as
    // its own honest "unknown" state with NO controls (fail-closed), and the
    // next poll tick retries.
    let s: SchedulerStatus | null = null;
    try {
      s = await fetchSchedulerStatus();
    } catch {
      s = null;
    }
    if (!alive.current) return;
    setStatus(s);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    void refresh();
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refresh();
    };
    const id = setInterval(tick, pollMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh, pollMs, enabled]);

  const act = useCallback(async (action: SchedulerAction) => {
    setError(null);
    setBusy(true);
    try {
      const r = await ACTIONS[action]();
      if (!alive.current) return;
      if (!r.ok) setError(r.error ?? `${action} failed`);
    } catch (err) {
      if (alive.current) setError(String(err));
    } finally {
      if (alive.current) setBusy(false);
    }
    await refresh();
  }, [refresh]);

  return { status, ready, busy, error, refresh, act };
}
