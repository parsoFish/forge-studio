/**
 * W7-A1 — bridge-client's reads fail CLOSED and both clients share ONE
 * transport policy (crosscut-01 / crosscut-22 / crosscut-26).
 *
 * Drives the REAL module (fresh instance per test via `vi.resetModules()` +
 * dynamic import — `correctionAttempted` and the URL cache are module state)
 * with a stubbed `window` + `fetch`, mirroring
 * `bridge-client-resolve-url.test.ts`'s harness exactly.
 *
 * Kills:
 *  - `bridgeGet(path, fallback)`: `fetchProjectAttention()` resolving `[]` on
 *    a 500 (Home's attention strip reading "nothing needs you" on an outage);
 *  - a 404-is-null read (`fetchRoadmap`) that ALSO swallows a 500 as null;
 *  - a one-shot port correction that is NEVER re-armed (crosscut-22/-26:
 *    after a successful call, a later transport failure must get exactly ONE
 *    more `/api/forge-config` correction);
 *  - `probeBridgeHealth` accepting any 2xx as "up" (a foreign process on the
 *    port must be `ok:false`);
 *  - a transport failure that notifies nobody (the status store must be told).
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-client-read-fail-closed.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

type FakeWindow = { location: { protocol: string; hostname: string }; __FORGE_BRIDGE_PORT__?: number | null };

const HAD_WINDOW = 'window' in globalThis;
const ORIGINAL_WINDOW = (globalThis as { window?: FakeWindow }).window;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  (globalThis as { window?: FakeWindow }).window = { location: { protocol: 'http:', hostname: 'h' }, __FORGE_BRIDGE_PORT__: 4123 };
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

const BASE = 'http://h:4123';

function jsonRes(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** Route table for the stubbed fetch: url → responder (may throw). */
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url === k || url === `${BASE}${k}`);
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return routes[key]();
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

test('fetchProjectAttention: 500 → REJECTS BridgeReadError{status:500,message:"boom"} — never resolves [] (Home attention strip)', async () => {
  stubFetch({ '/api/studio/projects/attention': () => jsonRes(500, { error: 'boom' }) });
  const { fetchProjectAttention } = await import('./bridge-client.ts');
  await expect(fetchProjectAttention()).rejects.toMatchObject({ name: 'BridgeReadError', status: 500, message: 'boom' });
});

test('fetchProjectAttention: transport throw → REJECTS with "bridge unreachable (…)" and NO status', async () => {
  stubFetch({
    '/api/studio/projects/attention': () => { throw new TypeError('Failed to fetch'); },
    '/api/forge-config': () => jsonRes(200, { bridgePort: 4123 }),
  });
  const { fetchProjectAttention } = await import('./bridge-client.ts');
  let caught: unknown;
  try { await fetchProjectAttention(); } catch (e) { caught = e; }
  expect(caught).toMatchObject({ name: 'BridgeReadError', message: 'bridge unreachable (Failed to fetch)' });
  expect((caught as { status?: number }).status).toBeUndefined();
});

test('fetchProjectAttention: positive control — a real 200 resolves the rows', async () => {
  stubFetch({ '/api/studio/projects/attention': () => jsonRes(200, { attention: [{ projectId: 'p', name: 'P', link: '/projects/p', planned: 1, inFlight: 0, gated: 0, merged: 0, flagged: 0 }] }) });
  const { fetchProjectAttention } = await import('./bridge-client.ts');
  expect((await fetchProjectAttention()).length).toBe(1);
});

for (const [name, path] of [
  ['fetchArchitectSessions', '/api/architect/sessions'],
  ['listInstructionsSessions', '/api/instructions/sessions'],
  ['listDemoSessions', '/api/demo-builder/sessions'],
  ['fetchProjectBrainSessions', '/api/project-brain/sessions'],
  ['listDemoElements', '/api/studio/demo-elements'],
] as const) {
  test(`${name}: 503 → REJECTS BridgeReadError{status:503} — a session/element list read never resolves [] on failure`, async () => {
    stubFetch({ [path]: () => jsonRes(503, { error: 'down' }) });
    const mod = await import('./bridge-client.ts');
    await expect((mod as unknown as Record<string, () => Promise<unknown>>)[name]()).rejects.toMatchObject({ name: 'BridgeReadError', status: 503, message: 'down' });
  });
}

test('fetchRoadmap: 404 → null (no such project) but 500 → REJECTS (a broken bridge is not "no roadmap")', async () => {
  stubFetch({ '/api/studio/projects/p/roadmap': () => jsonRes(404, { error: 'unknown project' }) });
  let mod = await import('./bridge-client.ts');
  await expect(mod.fetchRoadmap('p')).resolves.toBeNull();

  vi.resetModules();
  stubFetch({ '/api/studio/projects/p/roadmap': () => jsonRes(500, { error: 'boom' }) });
  mod = await import('./bridge-client.ts');
  await expect(mod.fetchRoadmap('p')).rejects.toMatchObject({ name: 'BridgeReadError', status: 500 });
});

test('fetchEvents: 404 (no event log yet) → [] but 500 → REJECTS', async () => {
  stubFetch({ '/api/events/c1': () => jsonRes(404, { error: 'no log' }) });
  let mod = await import('./bridge-client.ts');
  await expect(mod.fetchEvents('c1')).resolves.toEqual([]);

  vi.resetModules();
  stubFetch({ '/api/events/c1': () => jsonRes(500, { error: 'boom' }) });
  mod = await import('./bridge-client.ts');
  await expect(mod.fetchEvents('c1')).rejects.toMatchObject({ name: 'BridgeReadError', status: 500 });
});

test('port correction is RE-ARMED after a successful call: success → later throw gets exactly one more /api/forge-config correction (crosscut-22/-26)', async () => {
  let attentionMode: 'ok' | 'throw' = 'ok';
  let forgeConfigCalls = 0;
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/forge-config') { forgeConfigCalls += 1; return jsonRes(200, { bridgePort: 4123 }); }
    if (url.endsWith('/api/studio/projects/attention')) {
      if (attentionMode === 'throw') throw new TypeError('Failed to fetch');
      return jsonRes(200, { attention: [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  const { fetchProjectAttention } = await import('./bridge-client.ts');

  await fetchProjectAttention();                       // success #1 — armed
  attentionMode = 'throw';
  await expect(fetchProjectAttention()).rejects.toThrow(); // failure: spends the correction (1 forge-config)
  await expect(fetchProjectAttention()).rejects.toThrow(); // failure again: gate held (still 1)
  expect(forgeConfigCalls).toBe(1);

  attentionMode = 'ok';
  await fetchProjectAttention();                       // success #2 — RE-ARMS
  attentionMode = 'throw';
  await expect(fetchProjectAttention()).rejects.toThrow(); // one more correction (2)
  await expect(fetchProjectAttention()).rejects.toThrow(); // gate held again (still 2)
  expect(forgeConfigCalls).toBe(2);
});

test('probeBridgeHealth: 2xx {service:"forge-bridge"} → ok; a foreign 2xx body → ok:false; non-2xx → ok:false with the bridge text; transport throw → ok:false "bridge unreachable"', async () => {
  stubFetch({ '/api/health': () => jsonRes(200, { service: 'forge-bridge', pid: 1, startedAt: 't' }) });
  let mod = await import('./bridge-client.ts');
  expect(await mod.probeBridgeHealth()).toEqual({ ok: true });

  vi.resetModules();
  stubFetch({ '/api/health': () => jsonRes(200, { service: 'something-else' }) });
  mod = await import('./bridge-client.ts');
  expect(await mod.probeBridgeHealth()).toEqual({ ok: false, error: 'port answered, but not by the forge bridge' });

  vi.resetModules();
  stubFetch({ '/api/health': () => jsonRes(503, { error: 'draining' }) });
  mod = await import('./bridge-client.ts');
  expect(await mod.probeBridgeHealth()).toEqual({ ok: false, error: 'draining' });

  vi.resetModules();
  stubFetch({
    '/api/health': () => { throw new TypeError('Failed to fetch'); },
    '/api/forge-config': () => jsonRes(200, { bridgePort: 4123 }),
  });
  mod = await import('./bridge-client.ts');
  expect(await mod.probeBridgeHealth()).toEqual({ ok: false, error: 'bridge unreachable (Failed to fetch)' });
});

test('onBridgeTransportFailure: a listener is told (once per failed call, with the thrown text) when a bridge fetch throws; NOT told on a non-2xx; unsubscribe stops it', async () => {
  stubFetch({
    '/api/studio/projects/attention': () => { throw new TypeError('Failed to fetch'); },
    '/api/forge-config': () => jsonRes(200, { bridgePort: 4123 }),
    '/api/architect/sessions': () => jsonRes(500, { error: 'boom' }),
  });
  const mod = await import('./bridge-client.ts');
  const heard: string[] = [];
  const off = mod.onBridgeTransportFailure((e) => heard.push(e));

  await expect(mod.fetchProjectAttention()).rejects.toThrow();
  expect(heard).toEqual(['Failed to fetch']);

  await expect(mod.fetchArchitectSessions()).rejects.toThrow(); // 500 — reachable, no transport failure
  expect(heard).toEqual(['Failed to fetch']);

  off();
  await expect(mod.fetchProjectAttention()).rejects.toThrow();
  expect(heard).toEqual(['Failed to fetch']);
});
