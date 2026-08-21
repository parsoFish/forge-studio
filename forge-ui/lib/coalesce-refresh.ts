/**
 * coalesce-refresh — collapse refresh-callback bursts to single fetches
 * (W7-C3, home-sessions-27).
 *
 * Answering one demo-session question fired four identical
 * `GET /api/demo-builder/sessions`: the WS list-changed burst, the poll, and
 * the panel's onChanged each ran their own refetch. Wrapping a refresher in
 * `makeCoalescedRefresh` gives it two properties:
 *
 *   - a SAME-TICK burst schedules exactly one run (microtask-deferred, so
 *     the four synchronous WS callbacks share it);
 *   - calls arriving while a run is IN FLIGHT collapse to one trailing
 *     re-run (the last caller's intent still lands — freshness preserved).
 *
 * Rejections are swallowed-after-logging by design: every wrapped refresher
 * here already `.catch(() => {})`'d its own poll, and a failed poll must
 * never wedge the coalescer.
 */
export function makeCoalescedRefresh(fn: () => Promise<unknown>): () => void {
  let scheduled = false; // a run is queued for this tick's microtask
  let inFlight = false; // fn is currently running
  let trailing = false; // calls arrived during the in-flight run

  const run = () => {
    scheduled = false;
    inFlight = true;
    void Promise.resolve()
      .then(fn)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (trailing) {
          trailing = false;
          schedule();
        }
      });
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
