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
 * strongly-connected-components pass, run over an EXPLICIT stack rather than
 * the call stack (adversarial-review fix, 2026-08-06 — the original
 * recursive `strongConnect` independently blew the call stack on a deep
 * acyclic chain at the same n where `topoLevels`' own recursion did, a
 * second, separate unbounded-recursion bug flagged by dependency-dag.test.ts's
 * AT-16/17 header note): total, never throws, never recurses forever — every
 * node is visited at most once via the `indices` map, so even a fully-cyclic
 * or 10,000-deep acyclic input terminates in linear time. A node is "in a
 * cycle" iff its SCC has size > 1, or size 1 with a self-loop (a node
 * declaring itself as a dependency).
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
  /** The DECLARED-ORDER, DE-DUPLICATED union of every dependency id this
   *  node declares, resolved or not (adversarial-review fix, 2026-08-06) —
   *  the ONE value both this DAG and any sibling table rendered beside it
   *  must read, so the two structurally cannot disagree on what a manifest
   *  declared. Deliberately NOT `[...resolvedDeps, ...unresolvedDeps]` —
   *  that concatenation always reorders (every resolved id before every
   *  unresolved one, regardless of what was actually declared first). */
  readonly deps: string[];
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

/** One node's simulated `strongConnect` call frame — `neighborIndex` is the
 *  non-recursive stand-in for the recursive version's `for (const w of ...)`
 *  cursor, so a re-entered frame resumes its neighbour scan rather than
 *  restarting it. */
type TarjanFrame = { readonly id: string; neighborIndex: number };

function detectCycles(adjacency: ReadonlyMap<string, readonly string[]>): { hasCycle: boolean; cycleMembers: string[] } {
  let indexCounter = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = []; // the algorithm's own "on this SCC path" stack
  const cycleMemberSet = new Set<string>();

  const popComponent = (root: string): void => {
    const component: string[] = [];
    let w: string;
    do {
      w = tarjanStack.pop()!;
      onStack.delete(w);
      component.push(w);
    } while (w !== root);
    const selfLoop = component.length === 1 && (adjacency.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfLoop) {
      for (const id of component) cycleMemberSet.add(id);
    }
  };

  const visit = (start: string): void => {
    const work: TarjanFrame[] = [{ id: start, neighborIndex: 0 }];
    indices.set(start, indexCounter);
    lowlink.set(start, indexCounter);
    indexCounter += 1;
    tarjanStack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adjacency.get(frame.id) ?? [];
      if (frame.neighborIndex < neighbors.length) {
        const w = neighbors[frame.neighborIndex];
        frame.neighborIndex += 1;
        if (!indices.has(w)) {
          indices.set(w, indexCounter);
          lowlink.set(w, indexCounter);
          indexCounter += 1;
          tarjanStack.push(w);
          onStack.add(w);
          work.push({ id: w, neighborIndex: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(frame.id, Math.min(lowlink.get(frame.id)!, indices.get(w)!));
        }
      } else {
        work.pop();
        const parent = work[work.length - 1];
        if (parent) lowlink.set(parent.id, Math.min(lowlink.get(parent.id)!, lowlink.get(frame.id)!));
        if (lowlink.get(frame.id) === indices.get(frame.id)) popComponent(frame.id);
      }
    }
  };

  for (const id of adjacency.keys()) {
    if (!indices.has(id)) visit(id);
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
    const deps: string[] = [];
    const seen = new Set<string>();
    for (const dep of depsOf(item)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      deps.push(dep);
      const resolved = idSet.has(dep);
      if (resolved) resolvedDeps.push(dep);
      else unresolvedDeps.push(dep);
      edges.push({ from: dep, to: id, resolved });
    }
    adjacency.set(id, resolvedDeps);
    nodes.push({ id, item, level: levelById.get(id) ?? 0, resolvedDeps, unresolvedDeps, deps });
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
