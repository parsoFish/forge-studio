'use client';

/**
 * useServeStatus — the live, READ-ONLY `forge serve` supervisor status
 * (M7-E row 205, ADR 011/031). `forge studio` supervises serve directly
 * and the operator has no lifecycle control over it, so this hook only
 * reads: every consumer shares the ONE tab-wide poll in
 * `lib/serve-status-store.ts` (row 207), and renders the single shared
 * `<ServeStatusNotice>` wherever a "is this actually being claimed right now"
 * signal is needed. `enabled=false` subscribes to nothing.
 */
import { useSyncExternalStore } from 'react';

import {
  serveStatusStore,
  SERVE_STATUS_POLL_MS,
  type ServeStatusSnapshot,
} from './serve-status-store';

export { SERVE_STATUS_POLL_MS };

export type ServeStatusState = ServeStatusSnapshot & {
  refresh: () => Promise<void>;
};

const NOT_READ: ServeStatusSnapshot = { status: null, ready: false };
const noSubscription = () => () => {};
const getNotRead = () => NOT_READ;

export function useServeStatus(enabled = true): ServeStatusState {
  const snapshot = useSyncExternalStore(
    enabled ? serveStatusStore.subscribe : noSubscription,
    enabled ? serveStatusStore.getSnapshot : getNotRead,
    getNotRead,
  );
  return { status: snapshot.status, ready: snapshot.ready, refresh: serveStatusStore.refresh };
}
