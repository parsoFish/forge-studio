/**
 * Pure, generic dependency-DAG view model (R4-15).
 *
 * A SHARED, DOM-free, network-free view module — the same convention as
 * `forge-ui/lib/file-package.ts` (a pure `lib/*.ts` view model paired with
 * one shared component whose only prop is its data,
 * `forge-ui/components/studio/DependencyDag.tsx`). Given a set of items each
 * carrying an id and a list of declared dependency ids, `dependencyDagView`
 * computes a topologically-leveled DAG: nodes (input order preserved),
 * dense per-level columns, edges (direction: "from must complete before
 * to"), and cycle detection.
 *
 * Generic over `T` and free of any roadmap-specific vocabulary — this is
 * deliberate. Today's caller is the architect session's roadmap-draft
 * artifact (`session-artifact-view.ts`'s `roadmapDraftView`); R4-13's future
 * project-roadmap tab is a second, differently-shaped caller (work items,
 * not initiatives) that must be able to reuse this module unchanged.
 *
 * Levels come from the SHARED `topoLevels` (forge-ui/lib/dep-layout.ts) —
 * this module is a thin wrapper that adds edges/resolvedDeps/unresolvedDeps/
 * cycle-detection on top, never a parallel reimplementation of the leveling
 * algorithm. `dep-layout.ts` is off-limits (not modified here) and has three
 * live consumers of its own (`monitor-layout.ts`, the project page twice) —
 * its cycle-folding totality is depended on by all of them, this module
 * included.
 *
 * Cycle detection here is a SEPARATE, own pure pass over RESOLVED edges only
 * (an unresolved target — a dep id with no matching item — cannot
 * participate in a cycle by definition). It is a standard Tarjan
 * strongly-connected-components pass: total, never throws, never recurses
 * forever — every node is visited at most once via the `indices` map, so
 * even a fully-cyclic input terminates. A node is "in a cycle" iff its SCC
 * has size > 1, or size 1 with a self-loop (a node declaring itself as a
 * dependency).
 *
 * Immutability: every return value is a freshly-built object/array; the
 * caller's `items` (and each item) is never mutated.
 */

import { topoLevels } from './dep-layout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DependencyDagNode<T> = {
  readonly id: string;
  readonly item: T;
  readonly level: number;
  /** Declared deps that resolve to a real item in this same item set, in
   *  declared order, de-duplicated (first occurrence wins). */
  readonly resolvedDeps: string[];
  /** Declared deps that do NOT resolve to any item in this set — surfaced,
   *  never silently dropped. A draft may legitimately depend on an
   *  already-merged initiative outside the set. */
  readonly unresolvedDeps: string[];
};

export type DependencyDagEdge = {
  /** The dependency's id — "must complete before `to`". */
  readonly from: string;
  /** The dependent item's id. */
  readonly to: string;
  readonly resolved: boolean;
};

export type DependencyDagView<T> = {
  /** Preserves INPUT order — never re-sorted by level or id. */
  readonly nodes: DependencyDagNode<T>[];
  /** Input node order; within a node, declared dep order (deduplicated). */
  readonly edges: DependencyDagEdge[];
  /** Dense `0..maxLevel` buckets — even an empty input yields `[[]]` (one
   *  level-0 bucket with zero nodes), never a bare `[]`. */
  readonly columns: DependencyDagNode<T>[][];
  readonly maxLevel: number;
  readonly isEmpty: boolean;
  readonly hasCycle: boolean;
  /** Lexicographically sorted ids of every node participating in a cycle. */
  readonly cycleMembers: string[];
};

// ---------------------------------------------------------------------------
// Cycle detection — Tarjan SCC over resolved-edge adjacency only.
// ---------------------------------------------------------------------------

function detectCycles(adjacency: ReadonlyMap<string, readonly string[]>): { hasCycle: boolean; cycleMembers: string[] } {
  let indexCounter = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleMemberSet = new Set<string>();

  function strongConnect(v: string): void {
    indices.set(v, indexCounter);
    lowlink.set(v, indexCounter);
    indexCounter += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const selfLoop = component.length === 1 && (adjacency.get(component[0]) ?? []).includes(component[0]);
      if (component.length > 1 || selfLoop) {
        for (const id of component) cycleMemberSet.add(id);
      }
    }
  }

  for (const id of adjacency.keys()) {
    if (!indices.has(id)) strongConnect(id);
  }

  return { hasCycle: cycleMemberSet.size > 0, cycleMembers: [...cycleMemberSet].sort((a, b) => a.localeCompare(b)) };
}

// ---------------------------------------------------------------------------
// dependencyDagView
// ---------------------------------------------------------------------------

export function dependencyDagView<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  depsOf: (item: T) => readonly string[],
): DependencyDagView<T> {
  const idSet = new Set(items.map(idOf));

  // Levels: the SHARED topoLevels, never reimplemented here.
  const { levelById, maxLevel } = topoLevels(items, idOf, depsOf);

  const nodes: DependencyDagNode<T>[] = [];
  const edges: DependencyDagEdge[] = [];
  const adjacency = new Map<string, string[]>();

  for (const item of items) {
    const id = idOf(item);
    const resolvedDeps: string[] = [];
    const unresolvedDeps: string[] = [];
    const seen = new Set<string>();
    for (const dep of depsOf(item)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const resolved = idSet.has(dep);
      if (resolved) resolvedDeps.push(dep);
      else unresolvedDeps.push(dep);
      edges.push({ from: dep, to: id, resolved });
    }
    adjacency.set(id, resolvedDeps);
    nodes.push({ id, item, level: levelById.get(id) ?? 0, resolvedDeps, unresolvedDeps });
  }

  const columns: DependencyDagNode<T>[][] = [];
  for (let lvl = 0; lvl <= maxLevel; lvl++) columns.push([]);
  for (const node of nodes) columns[node.level].push(node);

  const { hasCycle, cycleMembers } = detectCycles(adjacency);

  return {
    nodes,
    edges,
    columns,
    maxLevel,
    isEmpty: items.length === 0,
    hasCycle,
    cycleMembers,
  };
}
