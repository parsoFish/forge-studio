/**
 * forge-ui/lib/debounce.ts — leading+trailing debounce.
 *
 * ADR-044 (`docs/decisions/044-read-path-memoization.md`) P1 consequence: the
 * `/api/runs` cache still costs one full pass per uncached call, so a client
 * that fires a `fetchRuns()` HTTP round-trip for every `cycle-list-changed`
 * WS message in a burst (home page + library page, both subscribed to the
 * same bridge socket) re-amplifies exactly the cost the server-side memo
 * exists to remove. This collapses a burst into: one immediate call (leading
 * edge — no visible lag reacting to a single change) plus at most one more
 * call after the burst settles (trailing edge — the LAST state in the burst
 * is never silently dropped).
 */

const DEFAULT_WAIT_MS = 500;

export type Debounced<Args extends unknown[]> = {
  (...args: Args): void;
  /** Cancel any pending trailing call. Does not un-fire a leading call that
   *  already ran. Call on unmount to avoid a stray call after teardown. */
  cancel: () => void;
};

/**
 * Wrap `fn` so bursts of calls within `waitMs` of each other collapse to a
 * leading call (fires immediately) plus, only if further calls arrived
 * during the window, one trailing call (fires once the window elapses,
 * using the most recent call's arguments).
 */
export function debounceLeadingTrailing<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number = DEFAULT_WAIT_MS,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const debounced = ((...args: Args) => {
    if (timer === null) {
      // Leading edge: no window currently open — call immediately and open one.
      fn(...args);
      timer = setTimeout(() => {
        timer = null;
        if (pendingArgs !== null) {
          const latest = pendingArgs;
          pendingArgs = null;
          fn(...latest);
        }
      }, waitMs);
      return;
    }
    // Inside an open window — remember only the LATEST args for the trailing call.
    pendingArgs = args;
  }) as Debounced<Args>;

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  return debounced;
}
