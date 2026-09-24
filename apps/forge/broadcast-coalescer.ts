/**
 * broadcast-coalescer.ts — collapse a burst of same-purpose triggers into
 * one trailing call.
 *
 * WHY (forge-6gv.5.2 sub-finding R27, `_1.0/cull/m7-c-epics-decomp.md`
 * ~line 49). `watchQueue()` in `ui-bridge.ts` opens 6 independent
 * `fs.watch()` calls, one per queue-state dir (pending/inFlight/
 * readyForReview/merged/done/failed). Moving a manifest through the queue —
 * rename out of one dir, rename into the next, plus a metadata write — fires
 * raw fs events across 2-3 of those watchers in the same tick, and each used
 * to call `broadcast({type:'cycle-list-changed'})` unconditionally: several
 * redundant WS frames to every connected client for one logical change. The
 * client already debounces the incoming burst (`use-studio-home-data.ts`),
 * which is why this was rated low operator-visible impact — the fan-out is
 * still real and belongs fixed at the source, not patched over client-side.
 *
 * `makeTrailingCoalescer` is that fix, factored out as a small
 * pure/injectable unit so it is unit-testable without a real bridge, real
 * fs.watch or real timers: the thing that actually fires (`fire`) and the
 * clock (`setTimeout`/`clearTimeout`) are both passed in.
 */

export type CoalescerClock = {
  setTimeout: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearTimeout: (handle: NodeJS.Timeout) => void;
};

const REAL_CLOCK: CoalescerClock = { setTimeout, clearTimeout };

/** The window's width — a named constant, never a magic number buried at the
 *  call site. 75ms sits inside the brief's 50-100ms range. */
export const QUEUE_BROADCAST_COALESCE_WINDOW_MS = 75;

export type TrailingCoalescer = {
  /** Record one event. Schedules — or, if one is already pending, extends —
   *  the trailing fire. A no-op once `close()` has run. */
  trigger: () => void;
  /** Cancel any pending timer. No `fire` call happens after this returns,
   *  even if a `trigger()` had already scheduled one — the bridge's own
   *  `close()` needs to be able to guarantee no broadcast fires after
   *  shutdown. */
  close: () => void;
};

/**
 * `fire` runs once, `windowMs` after the LAST `trigger()` in a burst — a
 * trailing debounce, not a leading-edge throttle: events inside the window
 * reset the timer, so a burst of any length collapses to exactly one `fire`;
 * events spaced more than `windowMs` apart each get their own.
 */
export function makeTrailingCoalescer(
  fire: () => void,
  windowMs: number = QUEUE_BROADCAST_COALESCE_WINDOW_MS,
  clock: CoalescerClock = REAL_CLOCK,
): TrailingCoalescer {
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const trigger = (): void => {
    if (closed) return;
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = clock.setTimeout(() => {
      timer = undefined;
      fire();
    }, windowMs);
  };

  const close = (): void => {
    closed = true;
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      timer = undefined;
    }
  };

  return { trigger, close };
}
