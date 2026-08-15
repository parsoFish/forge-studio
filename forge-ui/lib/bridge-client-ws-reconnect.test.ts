/**
 * bridge-client-ws-reconnect.test.ts — W6-P4 review fix #2: pins
 * `subscribe()`'s WS reconnect loop. Pre-fix, `ws.onclose` → 'reconnecting'
 * never cleared `cachedBridgeUrl` — an open tab whose bridge restarted on a
 * NEW port (e.g. a `--bridge-port` override across a `forge watch` restart)
 * would retry the dead port forever. Fixed: after N (3) consecutive close
 * failures with no intervening `onopen`, the cache is invalidated so the
 * next attempt re-derives via the authoritative `/api/forge-config` route.
 *
 * `environment: 'node'` (this repo's vitest config — see
 * `connection-client.test.ts`'s header) has no real `window`/`WebSocket`;
 * both are stubbed here as plain objects/a minimal fake class, matching
 * `bridge-client-resolve-url.test.ts`'s established technique. Fake timers
 * (`vi.useFakeTimers` + `advanceTimersByTimeAsync`, which flushes the
 * promise chains a timer callback kicks off, not just the timer itself)
 * drive the exponential backoff without a real 3.5s+ wall-clock wait.
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-client-ws-reconnect.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

type FakeWindow = { location: { protocol: string; hostname: string }; __FORGE_BRIDGE_PORT__?: number | null };

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close(): void { /* no-op — tests drive onclose() directly */ }
}

const HAD_WINDOW = 'window' in globalThis;
const ORIGINAL_WINDOW = (globalThis as { window?: FakeWindow }).window;
const HAD_WS = 'WebSocket' in globalThis;
const ORIGINAL_WS = (globalThis as { WebSocket?: unknown }).WebSocket;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  if (HAD_WINDOW) (globalThis as { window?: FakeWindow }).window = ORIGINAL_WINDOW;
  else delete (globalThis as { window?: FakeWindow }).window;
  if (HAD_WS) (globalThis as { WebSocket?: unknown }).WebSocket = ORIGINAL_WS;
  else delete (globalThis as { WebSocket?: unknown }).WebSocket;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function stubWindow(opts: { bridgePort: number; hostname: string }): void {
  (globalThis as { window?: FakeWindow }).window = {
    location: { protocol: 'http:', hostname: opts.hostname },
    __FORGE_BRIDGE_PORT__: opts.bridgePort,
  };
}

test('after 3 consecutive close failures, the WS reconnect loop re-derives the bridge URL via /api/forge-config instead of retrying the dead port forever', async () => {
  vi.useFakeTimers();
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;

  let forgeConfigCalls = 0;
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/forge-config') {
      forgeConfigCalls += 1;
      return { ok: true, json: async () => ({ bridgePort: 6000 }) } as Response;
    }
    throw new Error(`unexpected fetch in this test: ${url}`);
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { subscribe } = await import('./bridge-client.ts');
  const sub = subscribe({ onMessage: vi.fn(), onState: vi.fn() });

  await vi.advanceTimersByTimeAsync(0); // flush the initial connect()

  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(FakeWebSocket.instances[0].url).toBe('ws://my-wsl-host:4123/ws');

  // 3 consecutive close failures, no intervening open — exponential backoff
  // (500 → 1000 → 2000ms). A generous 5s advance per step comfortably
  // covers whichever backoff is currently scheduled.
  for (let i = 0; i < 3; i++) {
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].onclose?.();
    await vi.advanceTimersByTimeAsync(5000);
  }

  expect(forgeConfigCalls).toBe(1);
  expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  const latest = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  expect(latest.url).toBe('ws://my-wsl-host:6000/ws');

  sub.close();
});

test('a successful onopen resets the close-failure streak — 2 failures, then an open, then 2 more failures never trips the reprobe', async () => {
  vi.useFakeTimers();
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;

  const fetchSpy = vi.fn(async () => {
    throw new Error('should not be called — the streak must reset on open');
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { subscribe } = await import('./bridge-client.ts');
  const sub = subscribe({ onMessage: vi.fn(), onState: vi.fn() });

  await vi.advanceTimersByTimeAsync(0);

  const closeOnce = async () => {
    FakeWebSocket.instances[FakeWebSocket.instances.length - 1].onclose?.();
    await vi.advanceTimersByTimeAsync(5000);
  };

  await closeOnce(); // failure 1
  await closeOnce(); // failure 2
  FakeWebSocket.instances[FakeWebSocket.instances.length - 1].onopen?.(); // resets the streak
  await closeOnce(); // failure 1 again (post-reset)
  await closeOnce(); // failure 2 again — still short of the threshold

  expect(fetchSpy).not.toHaveBeenCalled(); // /api/forge-config never triggered

  sub.close();
});
