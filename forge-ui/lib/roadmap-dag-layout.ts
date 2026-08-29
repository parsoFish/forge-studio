/**
 * R4-13 — pure dependency-DAG layout for the roadmap tab.
 *
 * Replaces the time-ordered serpentine timeline with a layout over DEPENDENCY
 * DEPTH: an initiative's COLUMN is one past its DEEPEST in-set parent —
 * `column = max(parent column) + 1` over ALL of `dependsOnInitiatives`, with
 * roots (no in-set parents) at column 0. This is the longest-path-from-a-root
 * depth, NOT a hop count along a single dependency chain.
 *
 * Generalises the mockup's single-`dep` walk
 * (recorded in docs/reference/studio-copy.md) to `string[]` parents,
 * and hardens it: the walk is memoised and cycle-guarded so a dependency cycle
 * terminates instead of hanging, and every column is clamped to `MAX_COLUMN`
 * so a pathological deep chain never explodes the column count.
 */

import type { RoadmapInitiative } from '@/lib/bridge-client';

/**
 * Column cap — mirrors the mockup DAG cap (recorded in docs/reference/studio-copy.md).
 * A node whose natural depth would exceed this clamps to it; a cycle can never
 * push a column past it.
 */
export const MAX_COLUMN = 12;

/**
 * Assign every initiative its dependency-depth column.
 *
 * @returns a Map from `initiativeId` to its column (0..MAX_COLUMN).
 */
export function byDepth(
  initiatives: readonly RoadmapInitiative[],
): Map<string, number> {
  const byId = new Map<string, RoadmapInitiative>();
  for (const initiative of initiatives) {
    byId.set(initiative.initiativeId, initiative);
  }

  const memo = new Map<string, number>();

  // Longest path from a root, memoised. `onPath` breaks dependency cycles: a
  // back-edge to a node already on the current traversal path contributes no
  // depth (treated as a root along that path), so the walk always terminates.
  const depthOf = (id: string, onPath: Set<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) {
      return cached;
    }

    const node = byId.get(id);
    if (node === undefined || onPath.has(id)) {
      return 0;
    }

    onPath.add(id);
    let column = 0;
    for (const parentId of node.dependsOnInitiatives) {
      if (!byId.has(parentId)) {
        // Out-of-set parent: not a layout parent, contributes no depth.
        continue;
      }
      const parentColumn = depthOf(parentId, onPath);
      if (parentColumn + 1 > column) {
        column = parentColumn + 1;
      }
    }
    onPath.delete(id);

    if (column > MAX_COLUMN) {
      column = MAX_COLUMN;
    }

    memo.set(id, column);
    return column;
  };

  const columns = new Map<string, number>();
  for (const initiative of initiatives) {
    columns.set(initiative.initiativeId, depthOf(initiative.initiativeId, new Set()));
  }
  return columns;
}

/**
 * The dependency-depth column of a single initiative. Agrees with
 * `byDepth(initiatives).get(initiativeId)`; returns 0 for an unknown id.
 */
export function columnFor(
  initiativeId: string,
  initiatives: readonly RoadmapInitiative[],
): number {
  return byDepth(initiatives).get(initiativeId) ?? 0;
}
