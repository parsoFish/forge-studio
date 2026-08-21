/**
 * coalesce-refresh — collapse refresh-callback bursts to single fetches
 * (W7-C3, home-sessions-27).
 *
 * Answering one demo-session question fired four identical
 * `GET /api/demo-builder/sessions`: the WS list-changed burst, the poll, and
 * the panel's onChanged each ran their own refetch. Wrapping a refresher in
 * `makeCoalescedRefresh` gives it three properties:
 *
 *   - a SAME-TICK burst schedules exactly one run (microtask-deferred, so
 *     the four synchronous WS callbacks share it);
 *   - calls arriving while a run is IN FLIGHT collapse to one trailing
 *     re-run (the last caller's intent still lands — freshness preserved);
 *   - the in-flight run is BOUNDED (W7-C3 review, A-M11).
 *
 * The bound is not decoration. `bridgeFetch` passes no signal and no
 * timeout, so killing the bridge mid-fetch black-holes the request. With
 * `inFlight` cleared only in `.finally()`, every subsequent 3s tick set
 * `trailing = true` and returned, and the panel froze until the OS socket
 * timeout — where BEFORE the coalescing each tick issued an independent
 * fetch and recovery was automatic the moment the bridge came back. The
 * bound restores that: at `timeoutMs` the coalescer releases and the
 * trailing call runs. The abandoned promise is left to settle whenever it
 * likes; its late result is dropped, never re-entered.
 *
 * Failures are REPORTED, not swallowed. The first cut's docstring said
 * "swallowed-after-logging by design" while the code was a bare
 * `.catch(() => {})` and nothing logged — quieter than the unhandled
 * rejection it replaced. `console.warn` (not `error`: the ui-walkthrough
 * gate fails a PR on a new `console.error`, and a transient refresh failure
 * the next tick retries is not a page defect).
 */

/** How long a single run may occupy the coalescer. Five poll intervals at
 *  the 3s `SUMMARY_POLL_MS` the session panel uses. */
export const COALESCED_REFRESH_TIMEOUT_MS = 15_000;

export function makeCoalescedRefresh(
  fn: () => Promise<unknown>,
  timeoutMs: number = COALESCED_REFRESH_TIMEOUT_MS,
): () => void {
  let scheduled = false; // a run is queued for this tick's microtask
  let inFlight = false; // fn is currently running
  let trailing = false; // calls arrived during the in-flight run

  const run = () => {
    scheduled = false;
    inFlight = true;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const settle = (problem?: unknown) => {
      if (settled) return; // a late result from an abandoned run
      settled = true;
      clearTimeout(timer);
      if (problem !== undefined) console.warn('[coalesce-refresh]', problem);
      inFlight = false;
      if (trailing) {
        trailing = false;
        schedule();
      }
    };

    timer = setTimeout(
      () => settle(new Error(`refresh did not settle within ${timeoutMs}ms — releasing the coalescer`)),
      timeoutMs,
    );
    void Promise.resolve().then(fn).then(() => settle(), (err) => settle(err ?? new Error('refresh rejected')));
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  };

  return () => {
    if (inFlight) {
      trailing = true;
      return;
    }
    schedule();
  };
}
