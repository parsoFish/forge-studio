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
import { test, expect, vi } from 'vitest';
import { makeCoalescedRefresh, COALESCED_REFRESH_TIMEOUT_MS } from './coalesce-refresh';

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

// ---------------------------------------------------------------------------
// W7-C3 review (A-M11) — the case the three tests above do NOT cover: a run
// that NEVER settles. `bridgeFetch` passes no signal and no timeout, so
// killing the bridge mid-fetch black-holes the request; `inFlight` cleared
// only in `.finally()`, so every subsequent 3s tick set `trailing = true` and
// returned and the panel froze until the OS socket timeout. Before the
// coalescing each tick issued an INDEPENDENT fetch, so recovery was
// automatic — this was a regression, and it is why the in-flight run now
// carries a bound.
// ---------------------------------------------------------------------------

test('A-M11: a never-settling run releases the coalescer at the bound, and the next call runs', async () => {
  vi.useFakeTimers();
  try {
    let runs = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The first run is a promise that never settles — the black-holed fetch.
    const refresh = makeCoalescedRefresh(() => {
      runs += 1;
      return runs === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    });

    refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);

    // Every tick while it hangs collapses into the trailing slot — that part
    // is correct, and is exactly what made the wedge permanent.
    refresh(); refresh();
    await vi.advanceTimersByTimeAsync(COALESCED_REFRESH_TIMEOUT_MS - 1);
    expect(runs, 'still wedged just before the bound').toBe(1);

    // At the bound the coalescer releases and the trailing call lands.
    await vi.advanceTimersByTimeAsync(2);
    expect(runs, 'the trailing call runs once the bound releases the coalescer').toBe(2);
    expect(warn, 'the timeout is reported, never silently swallowed').toHaveBeenCalled();

    // And the coalescer is usable again afterwards.
    refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(3);
    warn.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});

test('A-M11: a settled run clears its timer — the bound never fires late', async () => {
  vi.useFakeTimers();
  try {
    let runs = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refresh = makeCoalescedRefresh(async () => { runs += 1; });
    refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(COALESCED_REFRESH_TIMEOUT_MS * 2);
    expect(runs, 'a completed run must not be re-run by its own bound').toBe(1);
    expect(warn, 'no timeout was reached, so nothing is reported').not.toHaveBeenCalled();
    warn.mockRestore();
  } finally {
    vi.useRealTimers();
  }
});

test('A-M11: a rejection is REPORTED, not silently dropped', async () => {
  // The docstring claimed "swallowed-after-logging by design" while the code
  // was a bare `.catch(() => {})`; before the coalescing, `refreshShell`
  // surfaced rejections as console unhandled-rejections, so the change made
  // failures SILENTER than they had been. Either the code or the claim had to
  // change — the code did.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    let runs = 0;
    const refresh = makeCoalescedRefresh(async () => {
      runs += 1;
      if (runs === 1) throw new Error('boom');
    });
    refresh();
    await tick(); await tick();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0])).toMatch(/boom/);
  } finally {
    warn.mockRestore();
  }
});
