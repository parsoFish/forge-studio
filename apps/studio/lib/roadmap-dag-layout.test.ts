/**
 * AT3 (R4-13) — acceptance for the NOT-YET-EXISTING pure layout functions
 * `byDepth` / `columnFor` in forge-ui/lib/roadmap-dag-layout.ts.
 *
 * R4-13 replaces `SerpentineTimeline` (roadmap laid out over TIME, ordered by
 * the INIT-YYYY-MM-DD date in the id) with a dependency DAG laid out over
 * DEPENDENCY DEPTH. An initiative's COLUMN is one past its DEEPEST parent —
 * `column = max(parent column) + 1` over ALL of `dependsOnInitiatives`, with
 * roots (no in-set parents) at column 0. This is the longest-path-from-a-root
 * depth, NOT a hop count along a single dependency chain.
 *
 * CONTRACT this file pins:
 *   byDepth(initiatives: RoadmapInitiative[]): Map<initiativeId, column>
 *   columnFor(initiativeId: string, initiatives: RoadmapInitiative[]): column
 * `RoadmapInitiative` (forge-ui/lib/bridge-client.ts:199-215) carries
 * `initiativeId` and `dependsOnInitiatives: string[]`.
 *
 * KILLS:
 *  - a naive single-dep-chain walk (e.g. `1 + columnFor(dependsOnInitiatives[0])`,
 *    or "hops to the nearest root") that mis-columns a real MULTI-parent node —
 *    the central fixture below gives a node parents at depth 0 AND depth 2 and
 *    requires column 3, which a single-parent hop returns as 1;
 *  - assuming the input is topologically pre-sorted parent-before-child (the
 *    reversed-input case pins order-independence);
 *  - an UNBOUNDED walk that hangs on a dependency cycle or blows the column
 *    count on a pathological deep chain (the cap-guard: cap at 12, mirroring
 *    the mockup cap — see docs/reference/studio-copy.md).
 *
 * RED AT BASE: forge-ui/lib/roadmap-dag-layout.ts does NOT exist on this branch
 * yet — the `byDepth`/`columnFor` import below fails to resolve, so the whole
 * file fails to load and every test is RED until the implementer creates the
 * module. Marker to grep in the runner output: `R4-13-AT3`.
 *
 * RUN: npx vitest run lib/roadmap-dag-layout.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';

import type { RoadmapInitiative } from '@/lib/bridge-client';
import { byDepth, columnFor } from '@/lib/roadmap-dag-layout';

/** Pinned cap — mirrors the mockup DAG cap (round-6/7 notes). A node whose
 *  natural depth would exceed this clamps to it; a cycle never exceeds it. */
const MAX_COLUMN = 12;

function init(id: string, dependsOnInitiatives: string[] = []): RoadmapInitiative {
  return {
    initiativeId: id,
    title: id,
    status: 'pending',
    dependsOnInitiatives,
    ready: true,
    blockedBy: [],
  };
}

// ---------------------------------------------------------------------------
// The central multi-parent fixture.
//
//   R0 (root, col 0)
//     └─> R1 (col 1) ──> B (col 2)
//   A  (root, col 0)
//   X depends on [A, B]  ->  col = max(0, 2) + 1 = 3
//
// X's dependsOnInitiatives lists the SHALLOW parent (A, depth 0) FIRST, so a
// `1 + columnFor(dependsOnInitiatives[0])` walk yields 1, and a "hops to the
// nearest root" walk (X -> A -> root) also yields 1 — both wrong. The only
// correct answer is max(parent column) + 1 = 3.
// ---------------------------------------------------------------------------

const MULTI_PARENT: RoadmapInitiative[] = [
  init('R0'),
  init('R1', ['R0']),
  init('B', ['R1']),
  init('A'),
  init('X', ['A', 'B']),
];

test('R4-13-AT3: roots (no in-set parents) are column 0', () => {
  const cols = byDepth(MULTI_PARENT);
  expect(cols.get('R0')).toBe(0);
  expect(cols.get('A')).toBe(0);
});

test('R4-13-AT3: a linear chain columns 0,1,2 by dependency depth (not by id/date order)', () => {
  const cols = byDepth(MULTI_PARENT);
  expect(cols.get('R1')).toBe(1);
  expect(cols.get('B')).toBe(2);
});

test('R4-13-AT3: a MULTI-parent node columns to max(parent column)+1 = 3, NOT a single-parent hop count (=1)', () => {
  const cols = byDepth(MULTI_PARENT);
  expect(cols.get('X')).toBe(3);
  // Explicitly reject the single-parent-hop / nearest-root answers.
  expect(cols.get('X')).not.toBe(1);
  expect(cols.get('X')).not.toBe(2);
});

test('R4-13-AT3: columnFor(id, initiatives) agrees with byDepth for the multi-parent node', () => {
  expect(columnFor('X', MULTI_PARENT)).toBe(3);
  expect(columnFor('X', MULTI_PARENT)).toBe(byDepth(MULTI_PARENT).get('X'));
});

test('R4-13-AT3: depth is order-independent — reversing the input (child before parents) still columns X at 3 (kills "assumes input is topologically pre-sorted")', () => {
  const reversed = [...MULTI_PARENT].reverse(); // X now appears first
  expect(columnFor('X', reversed)).toBe(3);
  const cols = byDepth(reversed);
  expect(cols.get('B')).toBe(2);
  expect(cols.get('X')).toBe(3);
});

// ---------------------------------------------------------------------------
// Cap-guard: an unbounded walk hangs on a cycle or explodes the column count
// on a pathological deep chain. Both must be clamped to MAX_COLUMN.
// ---------------------------------------------------------------------------

test('R4-13-AT3: a dependency CYCLE terminates and clamps within the cap (kills an unbounded walk that would hang)', () => {
  const cyclic: RoadmapInitiative[] = [init('C1', ['C2']), init('C2', ['C1'])];
  // Reaching the assertions at all is the proof it terminated (no hang / no
  // stack overflow throw from unbounded recursion).
  const cols = byDepth(cyclic);
  const c1 = cols.get('C1');
  const c2 = cols.get('C2');
  expect(Number.isFinite(c1)).toBe(true);
  expect(Number.isFinite(c2)).toBe(true);
  expect(c1 as number).toBeLessThanOrEqual(MAX_COLUMN);
  expect(c2 as number).toBeLessThanOrEqual(MAX_COLUMN);
});

test('R4-13-AT3: a chain DEEPER than the cap clamps to MAX_COLUMN (12), while under-cap nodes keep their real depth', () => {
  const chain: RoadmapInitiative[] = [];
  for (let i = 0; i <= 15; i++) {
    chain.push(init(`n${i}`, i === 0 ? [] : [`n${i - 1}`]));
  }
  const cols = byDepth(chain);

  // Under the cap: real depth preserved (not everything flattened to the cap).
  expect(cols.get('n0')).toBe(0);
  expect(cols.get('n5')).toBe(5);
  expect(cols.get('n12')).toBe(12);

  // Past the cap: clamped to MAX_COLUMN, never unbounded.
  expect(cols.get('n15')).toBe(MAX_COLUMN);
  expect(columnFor('n15', chain)).toBe(MAX_COLUMN);

  for (const node of chain) {
    expect(cols.get(node.initiativeId) as number).toBeLessThanOrEqual(MAX_COLUMN);
  }
});
