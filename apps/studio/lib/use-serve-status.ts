'use client';

/**
 * useServeStatus — the live, READ-ONLY `forge serve` supervisor status
 * (M7-E row 205, ADR 011/031). `forge studio` supervises serve directly
 * and the operator has no lifecycle control over it, so this hook only
 * reads: a slow poll (while the tab is visible) of `GET /api/health`'s `serve` field, which every
 * consumer renders as the single shared `<ServeStatusNotice>` wherever a
 * "is this actually being claimed right now" signal is needed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchServeStatus, type ServeStatus } from './bridge-client';

export type ServeStatusState = {
  status: ServeStatus | null;
  /** True once the first read settled (success or failure). */
  ready: boolean;
  refresh: () => Promise<void>;
};

export const SERVE_STATUS_POLL_MS = 10_000;

export function useServeStatus(pollMs: number = SERVE_STATUS_POLL_MS, enabled = true): ServeStatusState {
  const [status, setStatus] = useState<ServeStatus | null>(null);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    let s: ServeStatus | null = null;
    try {
      s = await fetchServeStatus();
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

  return { status, ready, refresh };
}
