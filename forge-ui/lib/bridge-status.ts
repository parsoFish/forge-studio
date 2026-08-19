/**
 * bridge-status — the ONE bridge-liveness store behind Studio's shared
 * `BridgeStatus` banner and the recovery refetch (W7-A1: home-sessions-13,
 * crosscut-22).
 *
 * Before this, connection state was surfaced only on the flow monitor and the
 * connections pages; Home's data hook literally discarded it
 * (`onState: () => {}`), `/sessions` never opened a socket, and NO page
 * re-read anything when the bridge came back — a pinned tab stayed on its
 * outage render until F5. This store is deliberately PURE and dependency-
 * injected (no React, no bridge-client import) so its rules are unit-tested
 * with fake timers; `lib/use-bridge-status.ts` wires it to the real WS
 * (`subscribe`), the real health probe (`probeBridgeHealth`) and `window`
 * timers, and mounts it ONCE for the whole app.
 *
 * Rules (each pinned in bridge-status.test.ts):
 *   - `up` = the WS is open OR the last health probe answered with the forge
 *     bridge identity. `reconnecting` = we are between (initial connect, a
 *     lost socket, a suspect transport failure). `down` = a health probe
 *     FAILED — confirmed unreachable.
 *   - The health probe runs ONLY while not up (initial delay, then every
 *     BRIDGE_HEALTH_POLL_MS); the moment we are up, no timer is pending —
 *     the WS carries liveness from there. No page-level polling anywhere.
 *   - Recovery (`onRecovered`) fires on down→up, and on reconnecting→up when
 *     the bridge had ALREADY been up in this tab (a lost-then-regained
 *     socket may have dropped `cycle-list-changed` messages) — never on the
 *     very first connect.
 *   - A page's failed bridge fetch (`noteTransportFailure`) is a suspect
 *     signal: while `up`, it flips to `reconnecting` and probes at once —
 *     coalesced, so a burst of failing reads yields one probe.
 */

export type BridgeStatusValue = 'up' | 'down' | 'reconnecting';

export type BridgeStatusSnapshot = {
  status: BridgeStatusValue;
  /** Seen up at least once in this store's life. */
  everUp: boolean;
  /** Last probe/transport error text; null when up. */
  lastError: string | null;
  /** Count of recoveries fired (see the header's recovery rule). */
  recoveries: number;
  /** W7-FIX-A1 (A1-08): true exactly while a health probe is in flight — the
   *  banner's Retry renders pending (`aria-busy`, "Checking…") instead of a
   *  silent no-op click. */
  probing: boolean;
};

export type BridgeStatusDeps = {
  subscribe: (h: { onMessage: (m: unknown) => void; onState?: (s: string) => void }) => { close: () => void };
  probeHealth: () => Promise<{ ok: true } | { ok: false; error: string }>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type BridgeStatusStore = {
  /** SAME object reference until something changes (useSyncExternalStore). */
  getSnapshot(): BridgeStatusSnapshot;
  subscribe(listener: () => void): () => void;
  onRecovered(cb: () => void): () => void;
  /** Idempotent: opens the WS once; arms the initial probe. */
  start(): void;
  /** Closes the WS subscription + clears timers; a later start() works again. */
  stop(): void;
  /** A bridge fetch threw (transport-level). */
  noteTransportFailure(error: string): void;
  /** Operator pressed Retry → probe immediately. */
  retryNow(): void;
};

export const BRIDGE_HEALTH_POLL_MS = 3000;
export const BRIDGE_INITIAL_PROBE_DELAY_MS = 1500;
export const BRIDGE_LOST_PROBE_DELAY_MS = 500;

export const INITIAL_BRIDGE_STATUS: BridgeStatusSnapshot = Object.freeze({
  status: 'reconnecting',
  everUp: false,
  lastError: null,
  recoveries: 0,
  probing: false,
}) as BridgeStatusSnapshot;

export function createBridgeStatusStore(deps: BridgeStatusDeps): BridgeStatusStore {
  let snapshot: BridgeStatusSnapshot = INITIAL_BRIDGE_STATUS;
  const listeners = new Set<() => void>();
  const recoveredCbs = new Set<() => void>();

  let started = false;
  let sub: { close: () => void } | null = null;
  let probeTimer: unknown = null;
  // The delay the armed probe was scheduled with — coalescing compares a new
  // request's delay against it (an armed probe is always AT MOST that far
  // away, so keeping it when its delay is <= the new one is never later).
  let probeDelay = Number.POSITIVE_INFINITY;
  let probeInFlight = false;

  const set = (patch: Partial<BridgeStatusSnapshot>): void => {
    const next = { ...snapshot, ...patch };
    if (
      next.status === snapshot.status &&
      next.everUp === snapshot.everUp &&
      next.lastError === snapshot.lastError &&
      next.recoveries === snapshot.recoveries &&
      next.probing === snapshot.probing
    ) return;
    snapshot = next;
    for (const l of listeners) {
      try { l(); } catch { /* a listener must never break the store */ }
    }
  };

  const cancelProbeTimer = (): void => {
    if (probeTimer !== null) {
      deps.clearTimeout(probeTimer);
      probeTimer = null;
    }
    probeDelay = Number.POSITIVE_INFINITY;
  };

  const fireRecovered = (): void => {
    for (const cb of recoveredCbs) {
      try { cb(); } catch { /* a consumer's refetch must never break the store */ }
    }
  };

  const transitionUp = (): void => {
    const prev = snapshot.status;
    const recovered = prev === 'down' || (prev === 'reconnecting' && snapshot.everUp);
    cancelProbeTimer();
    set({
      status: 'up',
      lastError: null,
      everUp: true,
      recoveries: recovered ? snapshot.recoveries + 1 : snapshot.recoveries,
    });
    if (recovered) fireRecovered();
  };

  const runProbe = async (): Promise<void> => {
    if (probeInFlight || !started) return;
    probeInFlight = true;
    set({ probing: true });
    let result: { ok: true } | { ok: false; error: string };
    try {
      result = await deps.probeHealth();
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      probeInFlight = false;
    }
    if (!started) { set({ probing: false }); return; }
    if (result.ok) {
      set({ probing: false });
      transitionUp();
      return;
    }
    set({ status: 'down', lastError: result.error, probing: false });
    scheduleProbe(BRIDGE_HEALTH_POLL_MS);
  };

  /** Schedule a probe `ms` from now unless one is already armed sooner-or-equal. */
  const scheduleProbe = (ms: number): void => {
    if (!started) return;
    if (snapshot.status === 'up' && ms > 0) return; // probes run only while not up
    if (probeTimer !== null && probeDelay <= ms) return; // an earlier-or-equal probe is already armed
    cancelProbeTimer();
    probeDelay = ms;
    probeTimer = deps.setTimeout(() => {
      probeTimer = null;
      probeDelay = Number.POSITIVE_INFINITY;
      void runProbe();
    }, ms);
  };

  const onWsState = (s: string): void => {
    if (!started) return;
    if (s === 'open') { transitionUp(); return; }
    if (s === 'connecting') return; // every (re)connect attempt passes through here
    // 'reconnecting' | 'no-bridge' | 'daemon-stalled' — the socket is not open.
    if (snapshot.status === 'up') {
      set({ status: 'reconnecting' });
      scheduleProbe(BRIDGE_LOST_PROBE_DELAY_MS);
    }
    // not up: a probe cycle is already armed/in flight — leave it alone.
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onRecovered(cb) {
      recoveredCbs.add(cb);
      return () => { recoveredCbs.delete(cb); };
    },
    start() {
      if (started) return;
      started = true;
      sub = deps.subscribe({ onMessage: () => { /* liveness only */ }, onState: onWsState });
      scheduleProbe(BRIDGE_INITIAL_PROBE_DELAY_MS);
    },
    stop() {
      if (!started) return;
      started = false;
      cancelProbeTimer();
      try { sub?.close(); } catch { /* ignore */ }
      sub = null;
    },
    noteTransportFailure(error) {
      if (!started) return;
      // A probe already in flight decides on its own — its result (not this
      // side signal) sets the state; ignoring the signal here also keeps a
      // failing probe's OWN transport error from double-notifying.
      if (probeInFlight) return;
      // While up this is a SUSPECT signal (flip to reconnecting); while not
      // up it merely refreshes the reason. Either way, confirm NOW rather
      // than waiting for the armed poll — coalesced: an already-immediate
      // probe absorbs a burst of failing reads.
      set(snapshot.status === 'up' ? { status: 'reconnecting', lastError: error } : { lastError: error });
      scheduleProbe(0);
    },
    retryNow() {
      if (!started || probeInFlight) return;
      cancelProbeTimer();
      scheduleProbe(0);
    },
  };
}
