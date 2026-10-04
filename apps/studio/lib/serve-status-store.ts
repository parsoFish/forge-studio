/**
 * serve-status-store — ONE `forge serve` status poll per tab (row 207,
 * forge-8vfn.8.5.57).
 *
 * The nav on every page and each page's own notice read the same
 * `GET /api/health` serve field. They share this store: the interval starts
 * with the first subscriber, stops when the last one leaves, and `refresh()`
 * is one fetch that every subscriber sees. The snapshot is a new object only
 * when a read settles, so `useSyncExternalStore` sees a stable reference between reads.
 */
import { fetchServeStatus, type ServeStatus } from './bridge-client';

export const SERVE_STATUS_POLL_MS = 10_000;

export type ServeStatusSnapshot = {
  status: ServeStatus | null;
  /** True once the first read settled (success or failure). */
  ready: boolean;
};

export type ServeStatusStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ServeStatusSnapshot;
  refresh: () => Promise<void>;
};

export function createServeStatusStore(pollMs: number = SERVE_STATUS_POLL_MS): ServeStatusStore {
  const listeners = new Set<() => void>();
  let snapshot: ServeStatusSnapshot = { status: null, ready: false };
  let timer: ReturnType<typeof setInterval> | null = null;

  const refresh = async (): Promise<void> => {
    let status: ServeStatus | null;
    try {
      status = await fetchServeStatus();
    } catch {
      status = null; // an unreadable serve is "unknown", never a stale claim
    }
    snapshot = { status, ready: true };
    listeners.forEach((l) => l());
  };

  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void refresh();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        void refresh();
        timer = setInterval(tick, pollMs);
      }
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot: () => snapshot,
    refresh,
  };
}

/** The tab-wide store every `useServeStatus` consumer shares. */
export const serveStatusStore: ServeStatusStore = createServeStatusStore();
