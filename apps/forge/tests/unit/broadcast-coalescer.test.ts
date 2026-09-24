/**
 * `makeTrailingCoalescer` — forge-6gv.5.2 sub-finding R27
 * (`_1.0/cull/m7-c-epics-decomp.md` ~line 49): `watchQueue()`'s 6 `fs.watch()`
 * calls used to broadcast `{type:'cycle-list-changed'}` once PER RAW EVENT,
 * so one queue move (rename out + rename in + a metadata write, spread across
 * 2-3 of the 6 watched dirs) fanned out to several frames per client. This
 * pins the fix at the unit the bridge wires up: a burst inside the window
 * collapses to one trailing call; events spaced further apart than the
 * window each get their own; and nothing fires after `close()`.
 *
 * A fake clock drives time explicitly (`advance`) so the test is fast and
 * deterministic — no real timers, no flaky real-time waits.
 *
 * RUN: node --experimental-strip-types --test apps/forge/tests/unit/broadcast-coalescer.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { makeTrailingCoalescer, type CoalescerClock } from '../../broadcast-coalescer.ts';

const WINDOW_MS = 75;

/** A `CoalescerClock` with a manually-advanced `now`, so tests never sleep. */
function makeFakeClock(): CoalescerClock & { advance: (ms: number) => void } {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; cb: () => void }>();

  return {
    setTimeout: (cb, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, cb });
      return id as unknown as NodeJS.Timeout;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number);
    },
    advance: (ms) => {
      now += ms;
      // Snapshot the due set before running any callback: a callback that
      // reschedules (the coalescer's own `trigger` never does, but a future
      // caller might) must not fire again within this same advance unless
      // its new deadline is also already due.
      const due = [...pending.entries()]
        .filter(([, v]) => v.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id] of due) pending.delete(id);
      for (const [, v] of due) v.cb();
    },
  };
}

test('a burst of 6 triggers across 3 "dirs", all inside the window, yields exactly 1 fire', () => {
  const clock = makeFakeClock();
  const fires: number[] = [];
  const coalescer = makeTrailingCoalescer(() => fires.push(1), WINDOW_MS, clock);

  // Simulates 6 raw fs.watch callbacks landing across pending/inFlight/done
  // in one queue move, each a few ms apart — well inside the window.
  for (let i = 0; i < 6; i += 1) {
    coalescer.trigger();
    clock.advance(5);
  }
  // Let the trailing timer (armed by the LAST trigger) run out.
  clock.advance(WINDOW_MS + 5);

  assert.equal(fires.length, 1, `expected exactly 1 coalesced fire for a burst of 6, got ${fires.length}`);
});

test('two triggers separated by more than the window yield 2 fires', () => {
  const clock = makeFakeClock();
  const fires: number[] = [];
  const coalescer = makeTrailingCoalescer(() => fires.push(1), WINDOW_MS, clock);

  coalescer.trigger();
  clock.advance(WINDOW_MS + 10); // first trailing fire runs out
  assert.equal(fires.length, 1, 'first burst must have fired before the second starts');

  coalescer.trigger();
  clock.advance(WINDOW_MS + 10); // second trailing fire runs out

  assert.equal(fires.length, 2, `two triggers a window apart must yield 2 fires, got ${fires.length}`);
});

test('close() cancels a pending trailing fire — nothing fires after shutdown', () => {
  const clock = makeFakeClock();
  const fires: number[] = [];
  const coalescer = makeTrailingCoalescer(() => fires.push(1), WINDOW_MS, clock);

  coalescer.trigger();
  coalescer.close();
  clock.advance(WINDOW_MS + 50); // well past the window the pending timer wanted

  assert.equal(fires.length, 0, 'close() must cancel the pending trailing fire');
});

test('trigger() after close() is a no-op', () => {
  const clock = makeFakeClock();
  const fires: number[] = [];
  const coalescer = makeTrailingCoalescer(() => fires.push(1), WINDOW_MS, clock);

  coalescer.close();
  coalescer.trigger();
  clock.advance(WINDOW_MS + 50);

  assert.equal(fires.length, 0, 'trigger() after close() must not schedule a fire');
});
