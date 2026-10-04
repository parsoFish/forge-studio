/**
 * One serve-status poll per tab (row 207, forge-8vfn.8.5.57).
 *
 * StudioNav mounts on every page and the pages and run controls read the same
 * `GET /api/health` serve field. Each consumer owning an interval multiplied
 * the polls; the store behind `useServeStatus` is one subscriber-counted poll
 * that every consumer shares.
 *
 * Kills: N consumers => N fetches per tick; an interval that outlives its last
 * subscriber; a `refresh()` that only the caller sees.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const fetchServeStatus = vi.fn();
vi.mock('@/lib/bridge-client', () => ({ fetchServeStatus: () => fetchServeStatus() }));

import { createServeStatusStore, SERVE_STATUS_POLL_MS } from '@/lib/serve-status-store';

const RUNNING = { state: 'running', pid: 1, restarts: 0, nextRestartAt: null, halt: null };

beforeEach(() => {
  vi.useFakeTimers();
  fetchServeStatus.mockReset();
  fetchServeStatus.mockResolvedValue(RUNNING);
});
afterEach(() => vi.useRealTimers());

test('N subscribers share ONE fetch per interval tick', async () => {
  const store = createServeStatusStore();
  const unsubs = Array.from({ length: 5 }, () => store.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchServeStatus).toHaveBeenCalledTimes(1); // the first subscriber's initial read
  await vi.advanceTimersByTimeAsync(SERVE_STATUS_POLL_MS);
  expect(fetchServeStatus).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(SERVE_STATUS_POLL_MS);
  expect(fetchServeStatus).toHaveBeenCalledTimes(3);
  unsubs.forEach((u) => u());
});

test('unsubscribing the last consumer stops polling; the first one restarts it', async () => {
  const store = createServeStatusStore();
  const a = store.subscribe(() => {});
  const b = store.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  a();
  await vi.advanceTimersByTimeAsync(SERVE_STATUS_POLL_MS);
  expect(fetchServeStatus).toHaveBeenCalledTimes(2); // still one subscriber
  b();
  fetchServeStatus.mockClear();
  await vi.advanceTimersByTimeAsync(SERVE_STATUS_POLL_MS * 3);
  expect(fetchServeStatus).not.toHaveBeenCalled();
  const c = store.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchServeStatus).toHaveBeenCalledTimes(1);
  c();
});

test('refresh() is one shared fetch every consumer sees', async () => {
  const store = createServeStatusStore();
  const seen: unknown[] = [];
  const u1 = store.subscribe(() => seen.push(['a', store.getSnapshot().status]));
  const u2 = store.subscribe(() => seen.push(['b', store.getSnapshot().status]));
  await vi.advanceTimersByTimeAsync(0);
  seen.length = 0;
  fetchServeStatus.mockClear();
  const halted = { ...RUNNING, halt: { active: 0, queued: 0 } };
  fetchServeStatus.mockResolvedValue(halted);
  await store.refresh();
  expect(fetchServeStatus).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([['a', halted], ['b', halted]]);
  expect(store.getSnapshot()).toEqual({ status: halted, ready: true });
  u1();
  u2();
});

test('a failed read settles as ready with a null status', async () => {
  fetchServeStatus.mockRejectedValue(new Error('down'));
  const store = createServeStatusStore();
  const u = store.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getSnapshot()).toEqual({ status: null, ready: true });
  u();
});
