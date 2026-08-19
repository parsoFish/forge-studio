/**
 * bridge-client-resolve-url.test.ts — W6-P4 (redesigned per review): pins
 * `resolveBridgeUrl()`'s resolution order (the OPTIMISTIC fixed-port
 * default first — global-or-DEFAULT_BRIDGE_PORT, zero fetch calls — the
 * authoritative `/api/forge-config` fetch ONLY on re-resolution after an
 * invalidation) and the WSL2 host rule
 * (brain/cycles/themes/windows-browser-to-wsl-via-window-location.md) — the
 * URL's HOST segment must ALWAYS come from `window.location.hostname`,
 * NEVER from the global or the fixed-port default.
 *
 * Also pins the one-shot correction (`bridgeFetch`, exercised here via the
 * exported `fetchCycles`): the FIRST real bridge call failing outright
 * triggers exactly one `/api/forge-config` re-resolution + retry; a SECOND
 * failure does not re-trigger it.
 *
 * This repo's `vitest.config.ts` runs `lib/**` under `environment: 'node'`
 * (no real DOM — see `connection-client.test.ts`'s header, which documents
 * the same constraint for a sibling bridge-backed client). Each test stubs
 * a minimal plain-object `globalThis.window` (and `globalThis.fetch`)
 * itself rather than pulling in jsdom.
 *
 * Module-level state (`cachedBridgeUrl`, `hasResolvedBefore`,
 * `correctionAttempted`) is deliberately NOT exported/resettable in
 * production, so each test reloads the module fresh via
 * `vi.resetModules()` + `await import(...)`.
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-client-resolve-url.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

type FakeWindow = { location: { protocol: string; hostname: string }; __FORGE_BRIDGE_PORT__?: number | null };

const HAD_WINDOW = 'window' in globalThis;
const ORIGINAL_WINDOW = (globalThis as { window?: FakeWindow }).window;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (HAD_WINDOW) {
    (globalThis as { window?: FakeWindow }).window = ORIGINAL_WINDOW;
  } else {
    delete (globalThis as { window?: FakeWindow }).window;
  }
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

/** Stub a minimal `window` — no jsdom, just the two properties
 *  `resolveBridgeUrl` actually reads. Omitting `bridgePort` entirely
 *  simulates an entry point that isn't behind the root layout (falls to
 *  DEFAULT_BRIDGE_PORT — still zero fetch calls). */
function stubWindow(opts: { bridgePort?: number | null; hostname: string; protocol?: string }): void {
  const win: FakeWindow = { location: { protocol: opts.protocol ?? 'http:', hostname: opts.hostname } };
  if ('bridgePort' in opts) win.__FORGE_BRIDGE_PORT__ = opts.bridgePort;
  (globalThis as { window?: FakeWindow }).window = win;
}

test('global present: resolves the OPTIMISTIC URL with ZERO fetch calls', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe('http://my-wsl-host:4123');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('global absent: falls back to DEFAULT_BRIDGE_PORT — STILL zero fetch calls (no /api/forge-config round trip on the first resolution)', async () => {
  stubWindow({ hostname: 'my-wsl-host' }); // no __FORGE_BRIDGE_PORT__ property at all
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const { DEFAULT_BRIDGE_PORT } = await import('./bridge-port.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe(`http://my-wsl-host:${DEFAULT_BRIDGE_PORT}`);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('global present but null: falls back to DEFAULT_BRIDGE_PORT, not a broken URL', async () => {
  stubWindow({ bridgePort: null, hostname: 'my-wsl-host' });
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const { DEFAULT_BRIDGE_PORT } = await import('./bridge-port.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe(`http://my-wsl-host:${DEFAULT_BRIDGE_PORT}`);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('WSL rule: the host segment always comes from window.location.hostname, even though the global supplies the port', async () => {
  stubWindow({ bridgePort: 9999, hostname: 'windows-forwarded-host', protocol: 'https:' });
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe('https://windows-forwarded-host:9999');
});

test('resolveBridgeUrl caches the PROMISE — a second call within the same module instance returns the exact same promise reference', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const first = resolveBridgeUrl();
  const second = resolveBridgeUrl();

  expect(second).toBe(first); // same Promise object, not just an equal value
  expect(await first).toBe('http://my-wsl-host:4123');
});

test('one-shot correction: the FIRST real bridge call failing outright falls back to /api/forge-config and retries once', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('http://my-wsl-host:4123')) {
      throw new TypeError('Failed to fetch'); // nothing listening on the guessed port
    }
    if (url === '/api/forge-config') {
      return { ok: true, json: async () => ({ bridgePort: 5555 }) } as Response;
    }
    if (url.startsWith('http://my-wsl-host:5555')) {
      return { ok: true, json: async () => ({ live: [], recent: [] }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { fetchCycles } = await import('./bridge-client.ts');
  const result = await fetchCycles();

  expect(result).toEqual({ live: [], recent: [] });
  expect(fetchSpy).toHaveBeenCalledTimes(3); // guessed port (throws) → /api/forge-config → corrected port
});

test('one-shot correction: a SECOND failure does not re-trigger /api/forge-config a second time', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  let forgeConfigCalls = 0;
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/forge-config') {
      forgeConfigCalls += 1;
      return { ok: true, json: async () => ({ bridgePort: 5555 }) } as Response;
    }
    // Every real bridge endpoint — the guessed 4123 port AND the
    // "corrected" 5555 port — is broken here: the bridge is genuinely
    // down, not just guessed on the wrong port, so BOTH calls below fail,
    // exercising the `correctionAttempted` gate itself (not just the
    // cached-URL side effect of the first correction).
    throw new TypeError('Failed to fetch');
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { fetchCycles } = await import('./bridge-client.ts');

  await expect(fetchCycles()).rejects.toThrow(); // 4123 fails → corrects to 5555 → retry ALSO fails
  await expect(fetchCycles()).rejects.toThrow(); // 5555 fails again → one-shot gate: no second /api/forge-config call

  expect(forgeConfigCalls).toBe(1); // the one-shot gate held across both calls
});

// ---- W7-FIX-A1 A1-06: only a SUCCESSFUL non-null authoritative answer is final ---

test('A1-06: a transient blip + /api/forge-config answering {bridgePort:null} must NOT wedge the tab — the default port is retried once the bridge is back', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  let bridgeUp = false;
  let forgeConfigCalls = 0;
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/forge-config') {
      forgeConfigCalls += 1;
      // The Next process was started without FORGE_BRIDGE_URL — its route
      // durably answers null. Not an authoritative "there is no bridge".
      return { ok: true, json: async () => ({ bridgePort: null }) } as Response;
    }
    if (url.startsWith('http://my-wsl-host:4123')) {
      if (!bridgeUp) throw new TypeError('Failed to fetch'); // one transient blip
      return { ok: true, json: async () => ({ live: [], recent: [] }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { fetchCycles, resolveBridgeUrl } = await import('./bridge-client.ts');

  await expect(fetchCycles()).rejects.toThrow('Failed to fetch'); // blip: guess fails, forge-config gives nothing better
  expect(forgeConfigCalls).toBe(1);

  bridgeUp = true;
  // Pre-fix: cachedBridgeUrl is a resolved '' forever → every later call throws
  // 'no bridge configured' before any fetch, and Retry/probe can never recover.
  await expect(fetchCycles()).resolves.toEqual({ live: [], recent: [] });
  await expect(resolveBridgeUrl()).resolves.toBe('http://my-wsl-host:4123');
});

test('A1-06: /api/forge-config failing outright (non-2xx) after a blip likewise falls back to the default port instead of an empty base', async () => {
  stubWindow({ hostname: 'my-wsl-host' }); // no global → DEFAULT_BRIDGE_PORT
  const { DEFAULT_BRIDGE_PORT } = await import('./bridge-port.ts');
  let bridgeUp = false;
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/forge-config') return { ok: false, status: 500, json: async () => ({}) } as Response;
    if (url.startsWith(`http://my-wsl-host:${DEFAULT_BRIDGE_PORT}`)) {
      if (!bridgeUp) throw new TypeError('Failed to fetch');
      return { ok: true, json: async () => ({ live: [], recent: [] }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { fetchCycles, resolveBridgeUrl } = await import('./bridge-client.ts');
  await expect(fetchCycles()).rejects.toThrow('Failed to fetch');
  bridgeUp = true;
  await expect(fetchCycles()).resolves.toEqual({ live: [], recent: [] });
  await expect(resolveBridgeUrl()).resolves.toBe(`http://my-wsl-host:${DEFAULT_BRIDGE_PORT}`);
});

test('A1-06 (positive control kept): a REAL corrected port from /api/forge-config still wins over the default guess', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('http://my-wsl-host:4123')) throw new TypeError('Failed to fetch');
    if (url === '/api/forge-config') return { ok: true, json: async () => ({ bridgePort: 5555 }) } as Response;
    if (url.startsWith('http://my-wsl-host:5555')) return { ok: true, json: async () => ({ live: [], recent: [] }) } as Response;
    throw new Error(`unexpected fetch: ${url}`);
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  const { fetchCycles, resolveBridgeUrl } = await import('./bridge-client.ts');
  await expect(fetchCycles()).resolves.toEqual({ live: [], recent: [] });
  await expect(resolveBridgeUrl()).resolves.toBe('http://my-wsl-host:5555');
});
