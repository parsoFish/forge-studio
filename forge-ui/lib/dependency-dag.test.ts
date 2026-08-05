/**
 * Tests for forge-ui/lib/dependency-dag.ts (R4-15) — DOES NOT EXIST YET.
 * Vitest cannot even collect this file until it lands (module-not-found is
 * the expected red, matching this file set's established convention — see
 * e.g. session-artifact-view.test.ts's / session-client.test.ts's own
 * headers).
 *
 * `dependencyDagView` is a SHARED, generic (over T) view model: given a set
 * of items each carrying an id and a list of declared dependency ids, it
 * computes a topologically-leveled DAG — nodes (input order preserved),
 * columns (dense 0..maxLevel bucketed by level), edges (direction: "from
 * must complete before to"), and cycle detection. Two callers reuse it:
 * the architect session's roadmap-draft artifact (session-artifact-view.
 * ts's `roadmapDraftView`, R4-15) and, per the R4-15 contract, R4-13's
 * future project-roadmap tab — this module must stay generic over item
 * shape, never hardcoded to `RoadmapDraftRow`'s fields (AT-15 pins this
 * explicitly with a non-roadmap item shape).
 *
 * Levels come from the SHARED `topoLevels` (forge-ui/lib/dep-layout.ts) —
 * this module is a thin wrapper that adds edges/resolvedDeps/unresolvedDeps/
 * cycle-detection on top, never a parallel reimplementation of the leveling
 * algorithm itself. `dep-layout.ts` is off-limits (not modified by this
 * round) and is verified by its own tests; here we only pin that
 * `dependencyDagView` genuinely reuses it (AT-6/7/8 exercise real leveling
 * scenarios — chain, diamond, and the documented "unresolved dep doesn't
 * raise level" quirk `topoLevels` itself already carries).
 *
 * NOTE on a discrepancy found while writing these tests: dep-layout.ts's
 * own header claims it is "a byte-for-byte mirror of orchestrator/dep-
 * levels.ts" — that file does not exist anywhere in this repo today (only
 * forge-ui/lib/dep-layout.ts defines `topoLevels`). Not a blocker for this
 * test file (we only depend on the REAL, present `topoLevels` export), but
 * flagged per the task brief's "say so plainly" instruction rather than
 * silently treated as verified.
 *
 * AT numbers start fresh at AT-1 (new file, no prior sequence to continue).
 */
import { test, expect } from 'vitest';
import { dependencyDagView, type DependencyDagView } from './dependency-dag.ts';

// ---------------------------------------------------------------------------
// Fixtures — a generic Item shape (deliberately NOT RoadmapDraftRow's field
// names) used across most tests; AT-15 goes further and uses a THIRD,
// differently-named shape to prove genuine reuse across item types.
// ---------------------------------------------------------------------------

type Item = { id: string; deps: string[] };
const idOf = (i: Item) => i.id;
const depsOf = (i: Item) => i.deps;

// ===========================================================================
// Edge direction + order (AT-1, AT-2)
// ===========================================================================

test('AT-1: dependencyDagView: edge direction — a node N declaring dependsOn:[D] produces an edge {from:D, to:N.id} ("D must complete before N") — a reversed implementation ({from:N,to:D}) fails this', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.edges).toEqual([{ from: 'A', to: 'B', resolved: true }]);
});

test('AT-2: dependencyDagView: edge order follows INPUT node order, and within a node, deps in DECLARED order — never re-sorted by id or by level', () => {
  const items: Item[] = [
    { id: 'C', deps: ['B', 'A'] }, // declared order: B then A
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  // Node order in `items` is C, A, B — edges are built walking nodes in
  // that order, and for C, its two deps in DECLARED order (B, then A).
  expect(view.edges).toEqual([
    { from: 'B', to: 'C', resolved: true },
    { from: 'A', to: 'C', resolved: true },
    { from: 'A', to: 'B', resolved: true },
  ]);
});

// ===========================================================================
// Duplicate deps (AT-3)
// ===========================================================================

test('AT-3: dependencyDagView: a node declaring the same dep twice yields ONE edge and ONE resolvedDeps entry — first-occurrence order preserved, never silently doubled', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A', 'A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  const nodeB = view.nodes.find((n) => n.id === 'B')!;
  expect(nodeB.resolvedDeps).toEqual(['A']);
  expect(nodeB.unresolvedDeps).toEqual([]);
  expect(view.edges.filter((e) => e.to === 'B')).toEqual([{ from: 'A', to: 'B', resolved: true }]);
});

// ===========================================================================
// Unresolved deps — surfaced, never dropped (AT-4, AT-5)
// ===========================================================================

test('AT-4: dependencyDagView: a dep id NOT present in the item set is surfaced in unresolvedDeps AND as an edge with resolved:false — never silently dropped (the whole point of this module: a draft may legitimately depend on an already-merged initiative outside the set)', () => {
  const items: Item[] = [{ id: 'B', deps: ['GHOST-not-in-set'] }];
  const view = dependencyDagView(items, idOf, depsOf);
  const nodeB = view.nodes.find((n) => n.id === 'B')!;
  expect(nodeB.unresolvedDeps).toEqual(['GHOST-not-in-set']);
  expect(nodeB.resolvedDeps).toEqual([]);
  expect(view.edges).toEqual([{ from: 'GHOST-not-in-set', to: 'B', resolved: false }]);
});

test('AT-5: dependencyDagView: a node with BOTH a resolved and an unresolved dep splits them correctly — a resolved dep never leaks into unresolvedDeps and vice versa', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A', 'GHOST'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  const nodeB = view.nodes.find((n) => n.id === 'B')!;
  expect(nodeB.resolvedDeps).toEqual(['A']);
  expect(nodeB.unresolvedDeps).toEqual(['GHOST']);
  expect(view.edges).toEqual([
    { from: 'A', to: 'B', resolved: true },
    { from: 'GHOST', to: 'B', resolved: false },
  ]);
});

// ===========================================================================
// Levels via the SHARED topoLevels (AT-6, AT-7, AT-8)
// ===========================================================================

test('AT-6: dependencyDagView: a linear chain (A: no deps; B depends on A; C depends on B) yields levels 0/1/2', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
    { id: 'C', deps: ['B'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.nodes.map((n) => n.level)).toEqual([0, 1, 2]);
  expect(view.maxLevel).toBe(2);
  expect(view.columns.length).toBe(3); // dense 0..maxLevel
  expect(view.columns[0].map((n) => n.id)).toEqual(['A']);
  expect(view.columns[1].map((n) => n.id)).toEqual(['B']);
  expect(view.columns[2].map((n) => n.id)).toEqual(['C']);
});

test('AT-7: dependencyDagView: a diamond (A root; B and C both depend on A; D depends on B and C) levels A=0, B=1, C=1, D=2', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
    { id: 'C', deps: ['A'] },
    { id: 'D', deps: ['B', 'C'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  const levelById = new Map(view.nodes.map((n) => [n.id, n.level]));
  expect(levelById.get('A')).toBe(0);
  expect(levelById.get('B')).toBe(1);
  expect(levelById.get('C')).toBe(1);
  expect(levelById.get('D')).toBe(2);
  expect(view.maxLevel).toBe(2);
  expect(view.columns.length).toBe(3);
  expect(view.columns[1].map((n) => n.id).sort()).toEqual(['B', 'C']);
  expect(view.edges).toEqual([
    { from: 'A', to: 'B', resolved: true },
    { from: 'A', to: 'C', resolved: true },
    { from: 'B', to: 'D', resolved: true },
    { from: 'C', to: 'D', resolved: true },
  ]);
});

test('AT-8: dependencyDagView: the documented quirk — an unresolvable dep does NOT raise a node\'s level (mirrors topoLevels\' own quirk in dep-layout.ts: unresolved deps are filtered out of the max-level computation)', () => {
  const items: Item[] = [{ id: 'X', deps: ['GHOST-not-in-set'] }];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.nodes[0].level).toBe(0);
  expect(view.maxLevel).toBe(0);
});

// ===========================================================================
// Cycle detection (AT-9..AT-12)
// ===========================================================================

test('AT-9: dependencyDagView: a 2-node cycle (A depends on B, B depends on A) sets hasCycle:true and cycleMembers sorted lexicographically', () => {
  const items: Item[] = [
    { id: 'A', deps: ['B'] },
    { id: 'B', deps: ['A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.hasCycle).toBe(true);
  expect(view.cycleMembers).toEqual(['A', 'B']);
});

test('AT-10: dependencyDagView: a SELF-dependency (a node declaring itself as a dep) is a cycle of one — hasCycle:true, cycleMembers:[that id]', () => {
  const items: Item[] = [{ id: 'A', deps: ['A'] }];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.hasCycle).toBe(true);
  expect(view.cycleMembers).toEqual(['A']);
});

test('AT-11: dependencyDagView: an acyclic graph is genuinely hasCycle:false with cycleMembers:[] — the positive control proving the guard can pass, not just fail (a guard that always reports true would also "pass" AT-9/10 vacuously)', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
    { id: 'C', deps: ['A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.hasCycle).toBe(false);
  expect(view.cycleMembers).toEqual([]);
});

test('AT-12: dependencyDagView: a cyclic graph still returns a TOTAL, non-throwing view — nodes and columns are fully present, never abandoned mid-computation (the function must never recurse forever or throw on a cycle)', () => {
  const items: Item[] = [
    { id: 'A', deps: ['B'] },
    { id: 'B', deps: ['A'] },
    { id: 'C', deps: ['A'] }, // hangs off the cycle, not part of it
  ];
  let view: DependencyDagView<Item> | undefined;
  expect(() => {
    view = dependencyDagView(items, idOf, depsOf);
  }).not.toThrow();
  expect(view!.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
  expect(view!.columns.flat().length).toBe(3);
  expect(view!.hasCycle).toBe(true);
});

// ===========================================================================
// Empty input (AT-13)
// ===========================================================================

test('AT-13: dependencyDagView: empty input — isEmpty:true, maxLevel:0, columns:[[]] (this module\'s decision, documented in the task report: a dense "0..maxLevel" array always has an entry — even level 0 with zero nodes — rather than a bare [])', () => {
  const view = dependencyDagView<Item>([], idOf, depsOf);
  expect(view.isEmpty).toBe(true);
  expect(view.maxLevel).toBe(0);
  expect(view.columns).toEqual([[]]);
  expect(view.nodes).toEqual([]);
  expect(view.edges).toEqual([]);
  expect(view.hasCycle).toBe(false);
  expect(view.cycleMembers).toEqual([]);
});

// ===========================================================================
// Node input-order preservation (AT-14)
// ===========================================================================

test('AT-14: dependencyDagView: "nodes" preserve INPUT ORDER — never re-sorted by level or by id, even when the dependency structure would put them in a different topological order', () => {
  const items: Item[] = [
    { id: 'C', deps: ['B'] },
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  expect(view.nodes.map((n) => n.id)).toEqual(['C', 'A', 'B']);
  expect(view.isEmpty).toBe(false);
});

// ===========================================================================
// Generic over T (AT-15) — a THIRD, differently-shaped item type (not
// Item{id,deps}, not RoadmapDraftRow) with entirely different field names,
// proving `dependencyDagView` genuinely works via the idOf/depsOf accessors
// rather than any hardcoded field name.
// ===========================================================================

type WorkItem = { wiId: string; title: string; blockedBy: string[] };
const wiIdOf = (w: WorkItem) => w.wiId;
const wiDepsOf = (w: WorkItem) => w.blockedBy;

test('AT-15: dependencyDagView: generic over T — a WORK-ITEM shape with entirely different field names (wiId/blockedBy, not id/deps or initiativeId/dependsOn) computes correctly, proving reuse beyond roadmap rows (R4-13\'s future project-roadmap tab will pass its own item type)', () => {
  const items: WorkItem[] = [
    { wiId: 'WI-1', title: 'Do the thing', blockedBy: [] },
    { wiId: 'WI-2', title: 'Do the other thing', blockedBy: ['WI-1'] },
  ];
  const view = dependencyDagView(items, wiIdOf, wiDepsOf);
  expect(view.nodes.map((n) => n.id)).toEqual(['WI-1', 'WI-2']);
  expect(view.nodes[1].item).toEqual(items[1]); // the FULL original item is carried, not just id/deps
  expect(view.nodes.map((n) => n.level)).toEqual([0, 1]);
  expect(view.edges).toEqual([{ from: 'WI-1', to: 'WI-2', resolved: true }]);
});
