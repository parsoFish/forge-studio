/**
 * Topological-level layout — forge-ui's own pure topological-level module.
 * There is no server-side counterpart today: `orchestrator/dep-levels.ts`
 * does not exist anywhere in this repo, and `packages/sessions/kinds/architect-plan.ts`'s
 * PLAN.html dependency graph carries no level algorithm of its own (verified
 * by reading both, not assumed) — this corrects a stale header claim that
 * had drifted from the as-built code.
 *
 * Real, current consumers: `forge-ui/lib/monitor-layout.ts` (the run-monitor
 * hex layout), `forge-ui/app/projects/[id]/page.tsx` (the project roadmap
 * spine, two call sites), and `forge-ui/lib/dependency-dag.ts` (R4-15's
 * shared dependency-DAG view model). All three reuse this module rather than
 * reimplementing the leveling algorithm — keep it that way.
 *
 * Drives the per-project roadmap spine: the same level-by-topo
 * algorithm applied to initiatives (INIT-ids) or work items (WI-ids).
 *
 * `topoLevels(items, depsOf)` assigns each item a level:
 *   - level 0   = no (resolvable) dependencies — a spine root
 *   - level n   = 1 + max(level of its dependencies)
 *
 * Dependencies that don't resolve to a known item id are skipped silently
 * (orphan-dep = an upstream validation concern; the layout still renders).
 * A dependency cycle is defended against (a back-edge resolves to level 0)
 * so the function is total — it never recurses forever and never throws.
 *
 * Pure + synchronous so it is unit-testable without any UI tree, and reusable
 * for work items (WI-ids) or initiatives (INIT-ids).
 */

export type TopoLevelResult<T> = {
  /** level per item id (0 = root). */
  levelById: Map<string, number>;
  /** Items bucketed by level. Key insertion order is the ITEMS scan order
   *  (first level a given level number is encountered while walking `items`
   *  top to bottom), NOT ascending level order — e.g. items declared
   *  `[C(lvl2), A(lvl0), B(lvl1)]` yield key order `[2, 0, 1]`. Every real
   *  consumer (monitor-layout.ts, app/projects/[id]/page.tsx x2) indexes this
   *  map by an explicit ascending `for (let level = 0; level <= maxLevel;
   *  level++)` loop rather than iterating the Map's own key order — callers
   *  MUST do the same; do not rely on `byLevel`'s iteration order. */
  byLevel: Map<number, T[]>;
  /** highest level present (0 when there are no items / all roots). */
  maxLevel: number;
};

/** One node's traversal frame in the explicit worklist below — the
 *  non-recursive stand-in for one `compute()` call-stack frame. `depIds` is
 *  pre-filtered to ids that actually resolve to a known item (an unresolved
 *  dep is skipped for levelling, same as the original recursive filter). */
type LevelFrame = {
  readonly id: string;
  readonly depIds: readonly string[];
  childIndex: number;
  readonly depLevels: number[];
};

/**
 * Computes the level of every item reachable from `startId`, using an
 * explicit stack (`frames`) instead of the call stack — the ONLY change from
 * the prior recursive `compute()` is that a ~2500+-deep chain/cycle no longer
 * throws `RangeError: Maximum call stack size exceeded`. Every other
 * behaviour is preserved byte-for-byte:
 *  - a cached id (`levelById.has`) short-circuits immediately, exactly like
 *    `compute`'s first line;
 *  - a back-edge (`path.has(depId)`, the worklist's per-top-level-call
 *    equivalent of the recursive `stack` argument) resolves to level 0
 *    WITHOUT caching — mirrors `compute`'s uncached `return 0`, which is why
 *    a cycle's levels are an accident of traversal order (dep-layout.test.ts
 *    AT-5/AT-6 pin the exact resulting numbers);
 *  - a completed frame's level is pushed into its PARENT frame's
 *    `depLevels` the moment the child is popped — the same order
 *    `depLevels.push(compute(d, stack))` produced one array entry per dep,
 *    in declared-dep order, whether resolved immediately (cache/back-edge)
 *    or after the child's own subtree finished.
 */
function computeLevelsFrom<T>(startId: string, idToItem: ReadonlyMap<string, T>, depsOf: (item: T) => readonly string[], levelById: Map<string, number>): void {
  if (levelById.has(startId)) return; // already resolved by an earlier top-level call

  const path = new Set<string>(); // ids on THIS top-level call's active DFS path
  const frames: LevelFrame[] = [];

  const pushFrame = (id: string): void => {
    const item = idToItem.get(id)!; // always present: callers only push resolved ids
    const depIds = depsOf(item).filter((d) => idToItem.has(d));
    path.add(id);
    frames.push({ id, depIds, childIndex: 0, depLevels: [] });
  };

  pushFrame(startId);

  while (frames.length > 0) {
    const top = frames[frames.length - 1];
    if (top.childIndex < top.depIds.length) {
      const depId = top.depIds[top.childIndex];
      top.childIndex += 1;
      const cached = levelById.get(depId);
      if (cached !== undefined) {
        top.depLevels.push(cached);
      } else if (path.has(depId)) {
        top.depLevels.push(0); // back-edge, uncached — matches the recursive fold
      } else {
        pushFrame(depId);
      }
    } else {
      const lvl = top.depLevels.length === 0 ? 0 : Math.max(...top.depLevels) + 1;
      levelById.set(top.id, lvl);
      path.delete(top.id);
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) parent.depLevels.push(lvl);
    }
  }
}

export function topoLevels<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  depsOf: (item: T) => readonly string[],
): TopoLevelResult<T> {
  const idToItem = new Map<string, T>();
  for (const it of items) idToItem.set(idOf(it), it);

  const levelById = new Map<string, number>();
  for (const it of items) computeLevelsFrom(idOf(it), idToItem, depsOf, levelById);

  const byLevel = new Map<number, T[]>();
  let maxLevel = 0;
  for (const it of items) {
    const lvl = levelById.get(idOf(it)) ?? 0;
    if (lvl > maxLevel) maxLevel = lvl;
    const bucket = byLevel.get(lvl) ?? [];
    bucket.push(it);
    byLevel.set(lvl, bucket);
  }
  return { levelById, byLevel, maxLevel };
}
