/**
 * Topological-level layout — forge-ui mirror of `orchestrator/dep-levels.ts`
 * (the server-side SSOT that `cli/architect-plan.ts`'s PLAN.html dependency
 * graph uses). forge-ui is a hard runtime boundary that cannot import orchestrator
 * code, so this is a byte-for-byte algorithm mirror — same convention as
 * `forge-ui/lib/phases.ts` ↔ `orchestrator/logging.ts`. Keep the two in sync.
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
  /** items bucketed by level, in ascending level order. */
  byLevel: Map<number, T[]>;
  /** highest level present (0 when there are no items / all roots). */
  maxLevel: number;
};

export function topoLevels<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  depsOf: (item: T) => readonly string[],
): TopoLevelResult<T> {
  const idToItem = new Map<string, T>();
  for (const it of items) idToItem.set(idOf(it), it);

  const levelById = new Map<string, number>();
  const compute = (id: string, stack: Set<string>): number => {
    const cached = levelById.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0; // cycle protection (back-edge → treat as root)
    stack.add(id);
    const it = idToItem.get(id);
    if (!it) {
      stack.delete(id);
      return 0;
    }
    const depLevels = depsOf(it)
      .filter((d) => idToItem.has(d))
      .map((d) => compute(d, stack));
    const lvl = depLevels.length === 0 ? 0 : Math.max(...depLevels) + 1;
    stack.delete(id);
    levelById.set(id, lvl);
    return lvl;
  };
  for (const it of items) compute(idOf(it), new Set());

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
