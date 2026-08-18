'use client';

/**
 * use-bridge-status — the React glue for `lib/bridge-status.ts` (W7-A1).
 *
 * ONE store per tab, wired here to the real transport: bridge-client's
 * `subscribe()` (the existing WS — no second liveness protocol),
 * `probeBridgeHealth()` (`GET /api/health` + the forge-bridge identity) and
 * `window` timers; bridge-client's transport-failure registry feeds it so a
 * page's failed read confirms the outage at once. `<BridgeStatus />`
 * (components/BridgeStatus.tsx, mounted in app/layout.tsx) is the ONE reader
 * of the snapshot; pages subscribe to RECOVERY only, via `useBridgeRecovery`,
 * to re-run their own load — never a page-level poll.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { onBridgeTransportFailure, probeBridgeHealth, subscribe } from './bridge-client';
import {
  createBridgeStatusStore,
  INITIAL_BRIDGE_STATUS,
  type BridgeStatusSnapshot,
  type BridgeStatusStore,
} from './bridge-status';

let singleton: BridgeStatusStore | null = null;

/** The app-wide store. Created lazily (pure — no side effect at creation);
 *  STARTED (WS + probe) from the hooks' effects below, browser-only. */
export function getBridgeStatusStore(): BridgeStatusStore {
  if (singleton) return singleton;
  const store = createBridgeStatusStore({
    subscribe: (h) => subscribe({ onMessage: () => h.onMessage(undefined), onState: h.onState }),
    probeHealth: probeBridgeHealth,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  });
  onBridgeTransportFailure((error) => store.noteTransportFailure(error));
  singleton = store;
  return store;
}

const getServerSnapshot = (): BridgeStatusSnapshot => INITIAL_BRIDGE_STATUS;

/** Start the store once, from an effect (never during render). Idempotent;
 *  the store lives for the tab — nothing stops it on unmount. */
function useEnsureBridgeStatusStarted(): void {
  useEffect(() => {
    if (typeof window !== 'undefined') getBridgeStatusStore().start();
  }, []);
}

/** The live bridge status snapshot (re-renders on change). */
export function useBridgeStatus(): BridgeStatusSnapshot {
  const store = getBridgeStatusStore();
  useEnsureBridgeStatusStarted();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}

/**
 * Run `onRecovered` when the bridge comes back after an outage / lost socket
 * (see bridge-status.ts's recovery rule). Pages pass their own load function
 * so a pinned tab refills itself instead of waiting for F5 (crosscut-22).
 * The latest callback is always used; no page-level polling is added.
 */
export function useBridgeRecovery(onRecovered: () => void): void {
  const cbRef = useRef(onRecovered);
  cbRef.current = onRecovered;
  useEnsureBridgeStatusStarted();
  useEffect(() => {
    const store = getBridgeStatusStore();
    return store.onRecovered(() => { cbRef.current(); });
  }, []);
}
