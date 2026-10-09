/**
 * forge-nk1y.9 follow-up — a bridge READ is bounded by BRIDGE_READ_TIMEOUT_MS.
 *
 * A read that never settles left the project page loading forever (no fetch in
 * Studio carried a deadline). Now a stalled read rejects with a NAMED failure —
 * `BridgeReadError{timedOut:true, message:"timed out after N s"}` — that the
 * shared failure states already render. Writes (POST/PUT/DELETE through
 * `bridgeFetch`) are NOT bounded: a flow-run or install POST may legitimately
 * outlast any read deadline.
 *
 * Same harness as bridge-client-read-fail-closed.test.ts (fresh module per test,
 * stubbed window + fetch), plus fake timers to cross the deadline.
 */
import { test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

type FakeWindow = { location: { protocol: string; hostname: string }; __FORGE_BRIDGE_PORT__?: number | null };

const HAD_WINDOW = 'window' in globalThis;
const ORIGINAL_WINDOW = (globalThis as { window?: FakeWindow }).window;
const ORIGINAL_FETCH = globalThis.fetch;

beforeAll(async () => {
  await import('../../lib/bridge-client-core.ts');
  await import('../../lib/studio-client.ts');
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  (globalThis as { window?: FakeWindow }).window = { location: { protocol: 'http:', hostname: 'h' }, __FORGE_BRIDGE_PORT__: 4123 };
});

afterEach(() => {
  vi.useRealTimers();
  if (HAD_WINDOW) (globalThis as { window?: FakeWindow }).window = ORIGINAL_WINDOW;
  else delete (globalThis as { window?: FakeWindow }).window;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

/** A fetch that never answers on its own — only an abort of its signal ends it. */
function stallingFetch() {
  const spy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

test('a stalled read rejects with a named BridgeReadError{timedOut} once BRIDGE_READ_TIMEOUT_MS passes — and aborts the fetch', async () => {
  const spy = stallingFetch();
  const { bridgeReadOrThrow, BRIDGE_READ_TIMEOUT_MS } = await import('../../lib/bridge-client-core.ts');
  const read = bridgeReadOrThrow('/api/studio/flows');
  const outcome = expect(read).rejects.toMatchObject({
    name: 'BridgeReadError',
    timedOut: true,
    message: `timed out after ${BRIDGE_READ_TIMEOUT_MS / 1000} s`,
  });
  await vi.advanceTimersByTimeAsync(BRIDGE_READ_TIMEOUT_MS - 1);
  expect((spy.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await outcome;
  expect((spy.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(true);
});

test('studio-client reads share the deadline: fetchStudioFlows rejects timed out, framed by describeBridgeError', async () => {
  stallingFetch();
  const { fetchStudioFlows } = await import('../../lib/studio-client.ts');
  const { BRIDGE_READ_TIMEOUT_MS } = await import('../../lib/bridge-client-core.ts');
  const { describeBridgeError } = await import('../../lib/bridge-result.ts');
  const failed = fetchStudioFlows().catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(BRIDGE_READ_TIMEOUT_MS);
  expect(describeBridgeError(await failed)).toEqual({
    message: `timed out after ${BRIDGE_READ_TIMEOUT_MS / 1000} s`,
    reachable: false,
    timedOut: true,
  });
});

test('a read that answers inside the deadline is untouched and leaves no timer behind', async () => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ flows: [] }) }) as unknown as Response) as unknown as typeof fetch;
  const { bridgeReadOrThrow } = await import('../../lib/bridge-client-core.ts');
  await expect(bridgeReadOrThrow('/api/studio/flows')).resolves.toEqual({ flows: [] });
  expect(vi.getTimerCount()).toBe(0);
});

test('a write (POST through bridgeFetch) is NOT bounded: it outlives the read deadline and resolves', async () => {
  const { bridgeFetch, BRIDGE_READ_TIMEOUT_MS } = await import('../../lib/bridge-client-core.ts');
  const spy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => {
    setTimeout(() => resolve({ ok: true, status: 200 } as Response), BRIDGE_READ_TIMEOUT_MS * 3);
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  const post = bridgeFetch('/api/flows/develop/run', { method: 'POST' });
  await vi.advanceTimersByTimeAsync(BRIDGE_READ_TIMEOUT_MS * 3);
  await expect(post).resolves.toMatchObject({ status: 200 });
  expect((spy.mock.calls[0]![1] as RequestInit).signal).toBeUndefined();
});
