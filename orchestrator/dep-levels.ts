/**
 * Topological-level layout — server-side SSOT.
 *
 * The proven level-by-topo algorithm: each item's level = 1 + max(level of its
 * dependencies); items with no resolvable deps are level 0 (roots). Deps that
 * reference an unknown id are skipped silently (orphan-dep = upstream-validation
 * concern; the layout still renders). A dependency cycle is defended against (a
 * back-edge resolves to level 0) so the function is total — never recurses
 * forever, never throws.
 *
 * Extracted out of `cli/architect-plan.ts`'s PLAN.html dependency-graph render so
 * the CLI and any other server-side caller share ONE implementation. The
 * forge-ui client mirrors this in `forge-ui/lib/dep-layout.ts` (forge-ui is a
 * hard runtime boundary that cannot import orchestrator code — same mirror
 * convention as `forge-ui/lib/phases.ts` ↔ `orchestrator/logging.ts`).
 */

export type DepLevels<T> = {
  /** level per item id (0 = root). */
  levelById: Map<string, number>;
  /** items bucketed by level. */
  byLevel: Map<number, T[]>;
  /** highest level present (0 when there are no items / all roots). */
  maxLevel: number;
};

export function topoLevels<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  depsOf: (item: T) => readonly string[],
): DepLevels<T> {
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
