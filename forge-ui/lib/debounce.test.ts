/**
 * Tests for forge-ui/lib/debounce.ts — leading+trailing debounce used to
 * collapse bursts of `cycle-list-changed` WS messages into at most two
 * `fetchRuns()` calls (see debounce.ts's header for the ADR-044 rationale).
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounceLeadingTrailing } from './debounce.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('first call fires immediately (leading edge)', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn, 500);

  debounced('a');

  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith('a');
});

test('a single call with no follow-up produces no trailing call', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn, 500);

  debounced('a');
  vi.advanceTimersByTime(500);

  expect(fn).toHaveBeenCalledTimes(1);
});

test('calls inside the window collapse into one trailing call after it elapses', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn, 500);

  debounced('a'); // leading — fires immediately
  vi.advanceTimersByTime(100);
  debounced('b'); // collapsed
  vi.advanceTimersByTime(100);
  debounced('c'); // collapsed — latest args win
  vi.advanceTimersByTime(100);

  expect(fn).toHaveBeenCalledTimes(1); // no additional calls yet

  vi.advanceTimersByTime(300); // window elapses (500ms since the leading call)

  expect(fn).toHaveBeenCalledTimes(2);
  expect(fn).toHaveBeenNthCalledWith(2, 'c');
});

test('a burst of many rapid calls still produces exactly two invocations total', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn, 500);

  for (let i = 0; i < 20; i++) {
    debounced(i);
    vi.advanceTimersByTime(10);
  }
  vi.advanceTimersByTime(500);

  expect(fn).toHaveBeenCalledTimes(2);
  expect(fn).toHaveBeenNthCalledWith(1, 0);
  expect(fn).toHaveBeenNthCalledWith(2, 19);
});

test('after a quiet period, a new call fires immediately again (fresh leading edge)', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn, 500);

  debounced('a');
  vi.advanceTimersByTime(500); // window fully elapses, no trailing call (no follow-up)
  expect(fn).toHaveBeenCalledTimes(1);

  debounced('b'); // a fresh leading call
  expect(fn).toHaveBeenCalledTimes(2);
  expect(fn).toHaveBeenNthCalledWith(2, 'b');
});

test('cancel() suppresses a pending trailing call', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn, 500);

  debounced('a'); // leading
  debounced('b'); // would-be trailing
  debounced.cancel();

  vi.advanceTimersByTime(500);

  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith('a');
});

test('defaults to a 500ms window when no wait is given', () => {
  const fn = vi.fn();
  const debounced = debounceLeadingTrailing(fn);

  debounced('a');
  debounced('b');
  vi.advanceTimersByTime(499);
  expect(fn).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(2);
});
