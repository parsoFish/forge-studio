/**
 * Tests for the ADR-044 P1 debounce wiring in
 * `use-studio-home-data.ts`'s `createDebouncedRefreshRuns` — the exact
 * function `useStudioHomeData()`'s `cycle-list-changed` handler calls,
 * extracted as a plain, effect-free unit so this claim is provable by
 * EXECUTION (fake timers), not just by reading the hook's source text
 * (`scripts/home-no-new-polling.test.ts` covers the source-text side: no
 * setInterval, no raw fetch, no bespoke WebSocket).
 *
 * Mirrors `debounce.test.ts`'s own fake-timer style — this file pins the
 * INTEGRATION (a real refetch callback wrapped with the hook's own default
 * wait), not a re-test of `debounceLeadingTrailing` itself.
 *
 * A P1 merge landed on main (feat/w6-p1-run-list-cache, AFTER this hook's
 * own W6-IA-4 extraction) wiring `debounceLeadingTrailing` DIRECTLY into
 * app/page.tsx's own loadAll/refreshRuns/subscribe() effect — the exact
 * shape this hook now owns. Re-targeted here on merge: the wrapped-refetch
 * behaviour a careless resolution could have shipped un-debounced.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedRefreshRuns } from './use-studio-home-data.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a single cycle-list-changed message refetches immediately (leading edge)', () => {
  const refreshRuns = vi.fn();
  const debounced = createDebouncedRefreshRuns(refreshRuns);

  debounced();

  expect(refreshRuns).toHaveBeenCalledTimes(1);
});

test('a burst of cycle-list-changed messages collapses into at most TWO refreshRuns calls', () => {
  // The exact defect a careless merge resolution would have shipped: one
  // fetchRuns() HTTP round-trip per WS message, re-amplifying the cost
  // ADR-044's server-side memo exists to remove.
  const refreshRuns = vi.fn();
  const debounced = createDebouncedRefreshRuns(refreshRuns);

  for (let i = 0; i < 20; i++) {
    debounced();
    vi.advanceTimersByTime(10);
  }
  vi.advanceTimersByTime(500);

  expect(refreshRuns).toHaveBeenCalledTimes(2);
});

test('defaults to a 500ms wait — the hook never passes a different value', () => {
  const refreshRuns = vi.fn();
  const debounced = createDebouncedRefreshRuns(refreshRuns);

  debounced(); // leading
  debounced(); // pending trailing
  vi.advanceTimersByTime(499);
  expect(refreshRuns).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1);
  expect(refreshRuns).toHaveBeenCalledTimes(2);
});

test('cancel() (the effect cleanup call) suppresses a pending trailing refetch', () => {
  const refreshRuns = vi.fn();
  const debounced = createDebouncedRefreshRuns(refreshRuns);

  debounced(); // leading
  debounced(); // would-be trailing
  debounced.cancel(); // mirrors the hook's unmount cleanup

  vi.advanceTimersByTime(500);

  expect(refreshRuns).toHaveBeenCalledTimes(1);
});

test('after a quiet period (no messages within the window), a new message fires immediately again', () => {
  const refreshRuns = vi.fn();
  const debounced = createDebouncedRefreshRuns(refreshRuns);

  debounced();
  vi.advanceTimersByTime(500); // window fully elapses, no follow-up message
  expect(refreshRuns).toHaveBeenCalledTimes(1);

  debounced(); // a fresh leading call
  expect(refreshRuns).toHaveBeenCalledTimes(2);
});
