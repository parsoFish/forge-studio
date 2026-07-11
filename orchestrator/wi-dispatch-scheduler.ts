/**
 * Phase 4 step 6 — concurrent WI dispatcher.
 *
 * Generic dependency-graph scheduler: dispatches items whose prerequisites
 * have all settled, filling up to `cap` concurrent in-flight dispatch tasks,
 * FIFO by each item's position in the caller-supplied topological order
 * (`topologicalOrder` in work-item.ts already produces that order — this
 * module never re-derives it, it only walks it). Deliberately decoupled from
 * `WorkItem` / `WiOutcome` — the `dispatch` callback owns its own outcome
 * bookkeeping (settling into whatever map/log the caller uses); this
 * scheduler only tracks WHETHER an item's dispatch has finished, never HOW it
 * finished. That keeps it trivially testable with stub dispatch functions,
 * independent of the real dev-loop / Ralph / git worktree machinery — see
 * `wi-dispatch-scheduler.test.ts` (the 2026-07-10 false-total-failure race
 * regression coverage for concurrent dispatch).
 *
 * At cap 1 this degenerates to the pre-step-6 serial loop: only one item is
 * ever in flight, so the next ready item is always the earliest still-
 * unresolved position in `items` — the same order `topologicalOrder`'s own
 * Kahn's-algorithm walk produces (see the module doc on `topologicalOrder`).
 */

export type DispatchScheduleOptions<T> = {
  /** Items in a valid topological order (every prerequisite before its dependents). */
  items: readonly T[];
  /** Stable identity for an item (matches the id used in `dependsOn`). */
  idOf: (item: T) => string;
  /**
   * This item's prerequisite ids. An id absent from `items` is treated as a
   * root (mirrors `topologicalOrder` / `prerequisiteBlockage`'s orphan-
   * dependency handling) — it never blocks readiness.
   */
  dependsOn: (item: T) => readonly string[];
  /** Max concurrently in-flight dispatch tasks. Must be a finite number >= 1. */
  cap: number;
  /**
   * Dispatch one item. Must resolve only once that item's own outcome
   * bookkeeping is fully settled (whatever "settled" means for the caller —
   * e.g. the dev-loop's `settleWiOutcome`) — dependents become eligible to
   * dispatch only after this promise resolves, so a WI's worktree always
   * branches from a tip that already contains every prerequisite (Phase 4
   * step 5's merge-back ordering).
   */
  dispatch: (item: T) => Promise<void>;
};

/**
 * Run `dispatch` over `items`, respecting the dependency graph, up to `cap`
 * concurrent in-flight tasks. Resolves once every item has been dispatched
 * and its dispatch promise has settled.
 *
 * "Ready" = every prerequisite id present in `items` has already finished
 * dispatching (successfully or not — readiness is about the prerequisite
 * having CONCLUDED, not about it having succeeded; the caller's `dispatch`
 * decides what to do with a failed/skipped prerequisite, exactly as the old
 * serial loop's `prerequisiteBlockage` check did).
 *
 * Deadlock (nothing in-flight, nothing ready, items remain unresolved) is an
 * internal-invariant violation — a real dependency cycle is caught earlier by
 * `validateWorkItemSet` / `topologicalOrder`, so this should be unreachable
 * in production — hard-throw naming the stuck items rather than hanging
 * forever.
 */
export async function runConcurrentDispatch<T>(opts: DispatchScheduleOptions<T>): Promise<void> {
  const { items, idOf, dependsOn, cap, dispatch } = opts;
  if (!Number.isFinite(cap) || cap < 1) {
    throw new Error(`runConcurrentDispatch: cap must be a finite number >= 1 (got ${cap})`);
  }

  const idSet = new Set(items.map(idOf));
  const completed = new Set<string>();
  const remaining = new Set(items.map(idOf));
  const inFlight = new Map<string, Promise<string>>();

  const isReady = (item: T): boolean =>
    dependsOn(item).every((dep) => !idSet.has(dep) || completed.has(dep));

  while (remaining.size > 0 || inFlight.size > 0) {
    // Fill open slots walking `items` in order (topological + FIFO) for
    // determinism — the same tie-break `topologicalOrder` itself uses.
    for (const item of items) {
      if (inFlight.size >= cap) break;
      const id = idOf(item);
      if (!remaining.has(id) || !isReady(item)) continue;
      remaining.delete(id);
      inFlight.set(id, dispatch(item).then(() => id));
    }

    if (inFlight.size === 0) {
      if (remaining.size === 0) break;
      throw new Error(
        `runConcurrentDispatch: internal error — dispatch deadlock; unresolved items: ${[...remaining].join(', ')}`,
      );
    }

    const finishedId = await Promise.race(inFlight.values());
    inFlight.delete(finishedId);
    completed.add(finishedId);
  }
}
