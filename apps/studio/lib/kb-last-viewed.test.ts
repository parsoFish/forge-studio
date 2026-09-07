// @vitest-environment jsdom
/**
 * A bare `/knowledge` returns the operator to their own knowledge base —
 * bead `forge-8vfn.5.14`'s third finding, the one the other two do not cover.
 *
 * MEASURED TWICE, on two separate funded runs (S6 run 1 2026-09-07, run 2
 * 2026-09-08, both `data-kb-id: expected "story-s6", got "cycles"`). The
 * operator creates a knowledge base, leaves to start a planner run on the
 * project it is bound to, comes back, and is looking at somebody else's KB,
 * because `/knowledge` with no `?id=` selected `allKbs[0].id` — whichever row
 * sorts first.
 *
 * WHY THE DECISION IS A PURE FUNCTION AND LIVES HERE. It has three cases and
 * two of them are the interesting ones: a remembered id that the roster no
 * longer contains (a deleted KB, or one belonging to a different forge this
 * browser last used) must NOT strand the operator on a not-found, and an
 * empty roster has nothing to choose. Testing that through the page would
 * mean mounting every fetch the knowledge route makes to assert a branch that
 * is three lines of arithmetic.
 *
 * The storage accessors are tested here too, because `localStorage` THROWS in
 * a private window and under a browser configured to block site data — a page
 * that cannot remember a selection must still render, so both directions
 * swallow and the read falls back to today's behaviour.
 *
 * This file opts into jsdom for those four cases alone. Under node there is
 * no `window`, and the accessors' own `typeof window === 'undefined'` guards
 * would make every storage test pass vacuously — green because nothing was
 * exercised, which is the shape this campaign keeps refusing.
 */
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

import { initialKbId, readLastViewedKb, writeLastViewedKb } from './kb-last-viewed.ts';

const KEY = 'kb-last-viewed';

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* not available in this env */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// initialKbId — the decision
// ---------------------------------------------------------------------------

test('5.14: a remembered KB the roster still has is the one the operator returns to', () => {
  expect(initialKbId(['cycles', 'forge-dev', 'story-s6'], 'story-s6')).toBe('story-s6');
});

test('5.14: with nothing remembered, the first roster entry is still the answer — this only ever improves on today', () => {
  expect(initialKbId(['cycles', 'story-s6'], null)).toBe('cycles');
});

test('5.14: a remembered KB the roster NO LONGER has falls back rather than stranding the operator on a not-found', () => {
  // The KB was deleted, or this browser last used a different forge.
  expect(initialKbId(['cycles', 'forge-dev'], 'story-s6')).toBe('cycles');
});

test('5.14: an empty roster has nothing to choose, and says so rather than inventing an id', () => {
  expect(initialKbId([], 'story-s6')).toBeNull();
  expect(initialKbId([], null)).toBeNull();
});

// ---------------------------------------------------------------------------
// the accessors — a page that cannot remember must still render
// ---------------------------------------------------------------------------

test('5.14: what is written is what comes back', () => {
  writeLastViewedKb('story-s6');
  expect(window.localStorage.getItem(KEY)).toBe('story-s6');
  expect(readLastViewedKb()).toBe('story-s6');
});

test('5.14: an empty id is not remembered — a page mid-resolution must not overwrite a real selection with nothing', () => {
  writeLastViewedKb('story-s6');
  writeLastViewedKb('');
  expect(readLastViewedKb()).toBe('story-s6');
});

test('5.14: a read that THROWS falls back to null, so the caller lands on the roster head instead of an error', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError: site data blocked'); });
  expect(readLastViewedKb()).toBeNull();
});

test('5.14: a write that THROWS is swallowed — the page simply does not remember', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
  expect(() => writeLastViewedKb('story-s6')).not.toThrow();
});
