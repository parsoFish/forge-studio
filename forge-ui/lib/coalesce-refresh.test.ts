/**
 * W7-C3 (home-sessions-27) — coalesced refresh.
 *
 * Answering one demo-session question fired FOUR identical
 * `GET /api/demo-builder/sessions`: multiple uncoordinated refresh callbacks
 * (WS list-changed burst + poll + onChanged) each ran their own refetch.
 *
 * `makeCoalescedRefresh(fn)` is the ONE rule both the summary and shell
 * refreshers on `/sessions/[kind]/[sessionId]` wrap themselves in:
 *   - a synchronous BURST of calls collapses to a single execution
 *     (scheduled on a microtask, so the four same-tick WS callbacks share it);
 *   - calls arriving WHILE a run is in flight collapse to exactly ONE
 *     trailing re-run (freshness is preserved — the last caller's intent
 *     always lands);
 *   - a rejected run never wedges the coalescer (the next call still runs).
 *
 * RUN: cd forge-ui && npx vitest run lib/coalesce-refresh.test.ts
 */
import { test, expect } from 'vitest';
import { makeCoalescedRefresh } from './coalesce-refresh';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

test('a synchronous burst of four calls executes the underlying fn ONCE', async () => {
  let runs = 0;
  const refresh = makeCoalescedRefresh(async () => { runs += 1; });
  refresh(); refresh(); refresh(); refresh();
  await tick();
  await tick();
  expect(runs).toBe(1);
});

test('calls during an in-flight run collapse to one trailing re-run', async () => {
  let runs = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const refresh = makeCoalescedRefresh(async () => { runs += 1; if (runs === 1) await gate; });
  refresh();
  await tick(); // first run started, now blocked on the gate
  expect(runs).toBe(1);
  refresh(); refresh(); refresh(); // burst while in flight
  release();
  await tick(); await tick(); await tick();
  expect(runs).toBe(2); // exactly one trailing run, not three
});

test('a rejecting run does not wedge the coalescer', async () => {
  let runs = 0;
  const refresh = makeCoalescedRefresh(async () => {
    runs += 1;
    if (runs === 1) throw new Error('boom');
  });
  refresh();
  await tick(); await tick();
  refresh();
  await tick(); await tick();
  expect(runs).toBe(2);
});
