/**
 * bridge-client-resolve-url.test.ts — W6-P4: pins `resolveBridgeUrl()`'s
 * resolution ORDER (the `window.__FORGE_BRIDGE_PORT__` global first, the
 * `/api/forge-config` fetch as a fallback) and the WSL2 host rule
 * (brain/cycles/themes/windows-browser-to-wsl-via-window-location.md) — the
 * URL's HOST segment must ALWAYS come from `window.location.hostname`,
 * NEVER from the global (which the root layout inlines with the PORT only).
 *
 * This repo's `vitest.config.ts` runs `lib/**` under `environment: 'node'`
 * (no real DOM — see `connection-client.test.ts`'s header, which documents
 * the same constraint for a sibling bridge-backed client). `resolveBridgeUrl`
 * only ever touches `window.location` and `window.__FORGE_BRIDGE_PORT__` —
 * neither needs a real DOM — so each test stubs a minimal plain-object
 * `globalThis.window` (and `globalThis.fetch`) itself rather than pulling in
 * jsdom.
 *
 * `cachedBridgeUrl` is a module-level promise cache (by design — the doc
 * comment on it explains why: concurrent callers must share ONE network
 * request). It is deliberately NOT exported/resettable in production, so
 * each test here reloads the module fresh via `vi.resetModules()` +
 * `await import(...)` instead, matching this file's own "no test-only
 * production surface" constraint.
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
 *  simulates a build that predates the W6-P4 global (falls to fetch). */
function stubWindow(opts: { bridgePort?: number | null; hostname: string; protocol?: string }): void {
  const win: FakeWindow = { location: { protocol: opts.protocol ?? 'http:', hostname: opts.hostname } };
  if ('bridgePort' in opts) win.__FORGE_BRIDGE_PORT__ = opts.bridgePort;
  (globalThis as { window?: FakeWindow }).window = win;
}

test('global present: resolves the URL with ZERO fetch calls (the /api/forge-config round trip is skipped)', async () => {
  stubWindow({ bridgePort: 4123, hostname: 'my-wsl-host' });
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe('http://my-wsl-host:4123');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('global absent (pre-W6-P4 build): falls back to the /api/forge-config fetch, unchanged from before', async () => {
  stubWindow({ hostname: 'my-wsl-host' }); // no __FORGE_BRIDGE_PORT__ property at all
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bridgePort: 4123 }) });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe('http://my-wsl-host:4123');
  expect(fetchSpy).toHaveBeenCalledWith('/api/forge-config', { cache: 'no-store' });
});

test('global present but null (server-side: no FORGE_BRIDGE_URL configured) falls back to the fetch path, not a broken URL', async () => {
  stubWindow({ bridgePort: null, hostname: 'my-wsl-host' });
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bridgePort: 4123 }) });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe('http://my-wsl-host:4123');
  expect(fetchSpy).toHaveBeenCalled();
});

test('WSL rule: the host segment always comes from window.location.hostname, even though the global supplies the port', async () => {
  stubWindow({ bridgePort: 9999, hostname: 'windows-forwarded-host', protocol: 'https:' });
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const url = await resolveBridgeUrl();

  expect(url).toBe('https://windows-forwarded-host:9999');
  // The global never carries a host — only a number could ever be read as
  // the port, so a stray host-shaped value on the global couldn't leak in
  // even if one were set. Assert the whole URL is host-clean by construction:
  expect(url).not.toContain('__FORGE_BRIDGE_PORT__');
});

test('resolveBridgeUrl caches the PROMISE — a second call within the same module instance does not re-fetch or re-read the global twice', async () => {
  stubWindow({ hostname: 'my-wsl-host' }); // forces the fetch fallback so we can count calls
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bridgePort: 4123 }) });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const { resolveBridgeUrl } = await import('./bridge-client.ts');
  const [first, second] = await Promise.all([resolveBridgeUrl(), resolveBridgeUrl()]);

  expect(first).toBe('http://my-wsl-host:4123');
  expect(second).toBe(first);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
