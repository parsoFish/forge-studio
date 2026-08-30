/**
 * W7-A3 (flows-29) — pinned contract for `run-elapsed.ts`.
 * Kills: an ELAPSED that keeps counting on a finished run ("908h 20m" for a
 * 37-day-old run) — a finished run's elapsed depends ONLY on its own
 * startedAt/completedAt, never on the wall clock.
 */
import { test, expect } from 'vitest';

import { formatRunElapsed } from './run-elapsed.ts';

const START = '2026-07-11T17:26:34.000Z';

test('finished run: completedAt − startedAt, independent of now', () => {
  const done = '2026-07-11T18:31:10.000Z'; // 1h 04m later
  const a = formatRunElapsed(START, done, Date.parse('2026-08-18T00:00:00Z'));
  const b = formatRunElapsed(START, done, Date.parse('2027-01-01T00:00:00Z'));
  expect(a).toBe('1h 4m');
  expect(b).toBe('1h 4m');
});

test('live run (no completedAt): now − startedAt', () => {
  expect(formatRunElapsed(START, undefined, Date.parse(START) + 5 * 60_000)).toBe('5m');
  expect(formatRunElapsed(START, undefined, Date.parse(START) + 125 * 60_000)).toBe('2h 5m');
});

test('no startedAt, negative, or unparseable → em dash (never NaN)', () => {
  expect(formatRunElapsed(undefined, undefined, Date.now())).toBe('—');
  expect(formatRunElapsed(START, undefined, Date.parse(START) - 1000)).toBe('—');
  expect(formatRunElapsed('garbage', undefined, Date.now())).toBe('—');
  expect(formatRunElapsed(START, 'garbage', Date.now())).toBe('—');
});
