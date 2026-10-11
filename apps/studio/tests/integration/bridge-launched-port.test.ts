/**
 * forge-nk1y.29 — the FIRST bridge call uses the LAUNCHED port, never the fixed-port default.
 *
 * Repro (verdict-page lane, 2026-10-10): with a forge Studio on 4123/4124 running, a second Studio
 * launched on --bridge-port 4423 rendered the 4123 bridge's data, because `app/layout.tsx` inlined
 * `window.__FORGE_BRIDGE_PORT__=4123` (a build-time literal) and the first call used it
 * optimistically; `/api/forge-config` (env-derived, correct) was consulted only after a FAILURE —
 * and against a live foreign bridge nothing fails. A page that writes (verdict, comments) would
 * have written to the other session's bridge.
 *
 * Two real HTTP "bridges" stand on two ports; only the launched one (B) may see a request. The
 * port reaches the page either through the serve-time script (`bridgePortScript`, what
 * `/api/forge-config/script` serves) or, when that has not run, through `/api/forge-config`
 * BEFORE the first bridge call.
 *
 * RUN: cd apps/studio && npx vitest run tests/integration/bridge-launched-port.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FakeWindow = { location: { protocol: string; hostname: string }; __FORGE_BRIDGE_PORT__?: number | null };
const ORIGINAL_FETCH = globalThis.fetch;
const HAD_WINDOW = 'window' in globalThis;
const ORIGINAL_WINDOW = (globalThis as { window?: FakeWindow }).window;

type Bridge = { port: number; hits: string[]; close: () => Promise<void> };
async function bridge(): Promise<Bridge> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ live: [], recent: [] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { port, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let A: Bridge; // the OTHER session's bridge — stands where the default guess would land
let B: Bridge; // the bridge this Studio was launched with
beforeEach(async () => {
  vi.resetModules();
  A = await bridge();
  B = await bridge();
});
afterEach(async () => {
  await A.close();
  await B.close();
  globalThis.fetch = ORIGINAL_FETCH;
  if (HAD_WINDOW) (globalThis as { window?: FakeWindow }).window = ORIGINAL_WINDOW;
  else delete (globalThis as { window?: FakeWindow }).window;
  vi.restoreAllMocks();
});

/** Route `/api/forge-config` (the Next route) to an env-derived answer; everything else is real HTTP. */
function stubForgeConfig(launchedPort: number): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/forge-config') return { ok: true, json: async () => ({ bridgePort: launchedPort }) } as Response;
    return ORIGINAL_FETCH(input, init);
  }) as typeof fetch;
}

test('the serve-time script carries the launched port from FORGE_BRIDGE_URL, and null without it', async () => {
  const { bridgePortScript } = await import('../../lib/bridge-port.ts');
  expect(bridgePortScript({ FORGE_BRIDGE_URL: 'http://127.0.0.1:4423' } as NodeJS.ProcessEnv)).toBe('window.__FORGE_BRIDGE_PORT__=4423;');
  expect(bridgePortScript({} as NodeJS.ProcessEnv)).toBe('window.__FORGE_BRIDGE_PORT__=null;');
});

test('the root layout no longer inlines the build-time default; it loads the serve-time script before hydration', () => {
  const layout = readFileSync(resolve(__dirname, '../../app/layout.tsx'), 'utf8');
  expect(layout).not.toMatch(/__FORGE_BRIDGE_PORT__=\$\{DEFAULT_BRIDGE_PORT\}/);
  expect(layout).toMatch(/src="\/api\/forge-config\/script"/);
  expect(layout).toMatch(/strategy="beforeInteractive"/);
});

test('script ran: the page reads and writes only the launched bridge (B), never the other session\'s (A)', async () => {
  const { bridgePortScript } = await import('../../lib/bridge-port.ts');
  const win: FakeWindow = { location: { protocol: 'http:', hostname: '127.0.0.1' } };
  (globalThis as { window?: FakeWindow }).window = win;
  // Evaluate exactly what the route serves, against this page's window.
  new Function('window', bridgePortScript({ FORGE_BRIDGE_URL: `http://127.0.0.1:${B.port}` } as NodeJS.ProcessEnv))(win);
  stubForgeConfig(B.port);
  const { fetchCycles } = await import('../../lib/bridge-client.ts');
  await fetchCycles();
  expect(B.hits.length).toBe(1);
  expect(A.hits).toEqual([]);
});

test('script not yet run: the first bridge call waits for /api/forge-config and goes to B, never a default guess', async () => {
  (globalThis as { window?: FakeWindow }).window = { location: { protocol: 'http:', hostname: '127.0.0.1' } };
  stubForgeConfig(B.port);
  const { fetchCycles, resolveBridgeUrl } = await import('../../lib/bridge-client.ts');
  expect(await resolveBridgeUrl()).toBe(`http://127.0.0.1:${B.port}`);
  await fetchCycles();
  expect(B.hits.length).toBe(1);
  expect(A.hits).toEqual([]);
});
