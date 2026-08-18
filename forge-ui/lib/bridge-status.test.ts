/**
 * W7-A1 — `lib/bridge-status.ts`, the pure bridge-liveness store behind the
 * shared BridgeStatus banner + recovery refetch (home-sessions-13, crosscut-22).
 *
 * Fake timers + injected deps; every rule in the store's header is a test
 * here. Kills:
 *  - a store that polls while up (page-level polling by another name);
 *  - a store that fires "recovered" on the very first connect (every page
 *    would double-fetch on mount) or NEVER fires it (crosscut-22 stays open);
 *  - a store that never confirms `down` (banner never appears when the WS
 *    just keeps reconnecting);
 *  - a burst of failing reads causing a probe storm;
 *  - a snapshot that changes identity without changing content
 *    (useSyncExternalStore would re-render forever).
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-status.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createBridgeStatusStore,
  BRIDGE_HEALTH_POLL_MS,
  BRIDGE_INITIAL_PROBE_DELAY_MS,
  BRIDGE_LOST_PROBE_DELAY_MS,
  INITIAL_BRIDGE_STATUS,
  type BridgeStatusStore,
} from './bridge-status';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

type Harness = {
  store: BridgeStatusStore;
  ws: { onState?: (s: string) => void; closed: number; opened: number };
  probe: ReturnType<typeof vi.fn>;
  probeResult: { ok: true } | { ok: false; error: string };
  recovered: number;
  changes: number;
};

function harness(): Harness {
  const h: Harness = {
    store: null as unknown as BridgeStatusStore,
    ws: { closed: 0, opened: 0 },
    probe: vi.fn(),
    probeResult: { ok: false, error: 'bridge unreachable (ECONNREFUSED)' },
    recovered: 0,
    changes: 0,
  };
  h.probe.mockImplementation(async () => h.probeResult);
  h.store = createBridgeStatusStore({
    subscribe: (handlers) => {
      h.ws.onState = handlers.onState;
      h.ws.opened += 1;
      return { close: () => { h.ws.closed += 1; } };
    },
    probeHealth: h.probe as unknown as () => Promise<{ ok: true } | { ok: false; error: string }>,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  });
  h.store.subscribe(() => { h.changes += 1; });
  h.store.onRecovered(() => { h.recovered += 1; });
  return h;
}

/** Let pending microtasks (a resolved probe promise) settle without advancing timers. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('initial snapshot = INITIAL_BRIDGE_STATUS (reconnecting, never up, no error, 0 recoveries) and start() opens the WS exactly once', () => {
  const h = harness();
  expect(h.store.getSnapshot()).toEqual(INITIAL_BRIDGE_STATUS);
  h.store.start();
  h.store.start();
  expect(h.ws.opened).toBe(1);
  expect(h.probe).not.toHaveBeenCalled();
});

test('happy path: WS open before the initial probe → up, NO probe ever runs, NO recovery fired, no timers pending', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('connecting');
  h.ws.onState?.('open');
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', everUp: true, lastError: null, recoveries: 0 });
  expect(h.recovered).toBe(0);
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS + BRIDGE_HEALTH_POLL_MS * 5);
  await flush();
  expect(h.probe).not.toHaveBeenCalled(); // probes run ONLY while not up
  expect(vi.getTimerCount()).toBe(0);
});

test('bridge down at load: WS never opens → the initial probe fails → status "down" with the probe error; then polls every BRIDGE_HEALTH_POLL_MS (never faster)', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('connecting');
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS - 1);
  await flush();
  expect(h.probe).not.toHaveBeenCalled();
  expect(h.store.getSnapshot().status).toBe('reconnecting');
  vi.advanceTimersByTime(1);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(1);
  expect(h.store.getSnapshot()).toMatchObject({ status: 'down', lastError: 'bridge unreachable (ECONNREFUSED)', everUp: false });
  vi.advanceTimersByTime(BRIDGE_HEALTH_POLL_MS - 1);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2);
  // the WS reconnect loop's repeated 'reconnecting' states do NOT add probes
  h.ws.onState?.('reconnecting');
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_HEALTH_POLL_MS - 1);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2);
});

test('down → probe succeeds → up, recovery fires ONCE (recoveries=1), and no probe timer remains', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS);
  await flush();
  expect(h.store.getSnapshot().status).toBe('down');
  h.probeResult = { ok: true };
  vi.advanceTimersByTime(BRIDGE_HEALTH_POLL_MS);
  await flush();
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', everUp: true, lastError: null, recoveries: 1 });
  expect(h.recovered).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(BRIDGE_HEALTH_POLL_MS * 3);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2); // no polling while up
});

test('down → WS opens (before any probe succeeds) → up + recovery fires; a pending poll is cancelled', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS);
  await flush();
  expect(h.store.getSnapshot().status).toBe('down');
  h.ws.onState?.('open');
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', recoveries: 1 });
  expect(h.recovered).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('lost socket after being up: "reconnecting" (everUp) → probe after BRIDGE_LOST_PROBE_DELAY_MS; probe ok → up + recovery (a regained socket may have dropped messages)', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('open');
  h.ws.onState?.('reconnecting');
  expect(h.store.getSnapshot()).toMatchObject({ status: 'reconnecting', everUp: true });
  h.probeResult = { ok: true };
  vi.advanceTimersByTime(BRIDGE_LOST_PROBE_DELAY_MS - 1);
  await flush();
  expect(h.probe).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(1);
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', recoveries: 1 });
  expect(h.recovered).toBe(1);
});

test('lost socket after being up, bridge really gone: probe fails → down; WS reopen later → up + ONE recovery', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('open');
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_LOST_PROBE_DELAY_MS);
  await flush();
  expect(h.store.getSnapshot()).toMatchObject({ status: 'down', everUp: true, lastError: 'bridge unreachable (ECONNREFUSED)' });
  h.ws.onState?.('reconnecting');
  h.ws.onState?.('connecting');
  h.ws.onState?.('open');
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', recoveries: 1, lastError: null });
  expect(h.recovered).toBe(1);
});

test('first-ever connect via a successful probe (WS slow) does NOT fire recovery', async () => {
  const h = harness();
  h.probeResult = { ok: true };
  h.store.start();
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS);
  await flush();
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', everUp: true, recoveries: 0 });
  expect(h.recovered).toBe(0);
});

test('noteTransportFailure while up: → reconnecting with the error, ONE immediate probe for a burst of failures; probe ok → up + recovery', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('open');
  h.probeResult = { ok: true };
  h.store.noteTransportFailure('Failed to fetch');
  h.store.noteTransportFailure('Failed to fetch');
  h.store.noteTransportFailure('Failed to fetch');
  expect(h.store.getSnapshot()).toMatchObject({ status: 'reconnecting', lastError: 'Failed to fetch' });
  vi.advanceTimersByTime(0);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(1);
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', recoveries: 1, lastError: null });
});

test('noteTransportFailure while up, bridge really gone: probe fails → down (banner) and the poll continues', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('open');
  h.store.noteTransportFailure('Failed to fetch');
  vi.advanceTimersByTime(0);
  await flush();
  expect(h.store.getSnapshot()).toMatchObject({ status: 'down', lastError: 'bridge unreachable (ECONNREFUSED)' });
  vi.advanceTimersByTime(BRIDGE_HEALTH_POLL_MS);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2);
});

test('noteTransportFailure while already down: refreshes lastError and probes now instead of waiting the full poll interval — but never stacks probes', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS);
  await flush();
  expect(h.store.getSnapshot().status).toBe('down');
  expect(h.probe).toHaveBeenCalledTimes(1);
  h.store.noteTransportFailure('ECONNRESET');
  h.store.noteTransportFailure('ECONNRESET');
  expect(h.store.getSnapshot().lastError).toBe('ECONNRESET');
  vi.advanceTimersByTime(0);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1); // exactly one poll armed
});

test('retryNow: probes immediately (cancelling the armed poll); ignored while a probe is in flight', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(1);
  // make the next probe hang so we can test the in-flight guard
  let resolveProbe: (r: { ok: true }) => void = () => {};
  h.probe.mockImplementationOnce(() => new Promise((res) => { resolveProbe = res; }));
  h.store.retryNow();
  vi.advanceTimersByTime(0);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2);
  h.store.retryNow(); // in flight → ignored
  vi.advanceTimersByTime(0);
  await flush();
  expect(h.probe).toHaveBeenCalledTimes(2);
  resolveProbe({ ok: true });
  await flush();
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', recoveries: 1 });
  expect(vi.getTimerCount()).toBe(0);
});

test('snapshot identity: unchanged content keeps the SAME reference; each real change is a NEW object and notifies subscribers once', () => {
  const h = harness();
  const s0 = h.store.getSnapshot();
  h.store.start();
  expect(h.store.getSnapshot()).toBe(s0);
  h.ws.onState?.('connecting');
  expect(h.store.getSnapshot()).toBe(s0);
  expect(h.changes).toBe(0);
  h.ws.onState?.('open');
  const s1 = h.store.getSnapshot();
  expect(s1).not.toBe(s0);
  expect(h.changes).toBe(1);
  h.ws.onState?.('open'); // already up: no change, no notification
  expect(h.store.getSnapshot()).toBe(s1);
  expect(h.changes).toBe(1);
});

test('stop(): closes the WS, clears timers, and a probe result arriving late is ignored; start() again works', async () => {
  const h = harness();
  h.store.start();
  h.ws.onState?.('reconnecting');
  h.store.stop();
  expect(h.ws.closed).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS * 2);
  await flush();
  expect(h.probe).not.toHaveBeenCalled();
  h.store.start();
  expect(h.ws.opened).toBe(2);
});

test('a throwing recovery callback or change listener never breaks the store', async () => {
  const h = harness();
  h.store.onRecovered(() => { throw new Error('consumer bug'); });
  h.store.subscribe(() => { throw new Error('listener bug'); });
  h.store.start();
  h.ws.onState?.('reconnecting');
  vi.advanceTimersByTime(BRIDGE_INITIAL_PROBE_DELAY_MS);
  await flush();
  h.ws.onState?.('open');
  expect(h.store.getSnapshot()).toMatchObject({ status: 'up', recoveries: 1 });
  expect(h.recovered).toBe(1);
});
