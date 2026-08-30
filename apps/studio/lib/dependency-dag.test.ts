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
 *
 * ---------------------------------------------------------------------------
 * AMENDMENT (adversarial review, 2026-08-06), AT-16..AT-19 — two findings
 * ratified in scope:
 *
 *  - Amendment 1 (AT-16/17): `topoLevels` (dep-layout.ts, see its own new
 *    test file dep-layout.test.ts) is unbounded recursion and throws
 *    `RangeError` on a deep chain/cycle — since `dependencyDagView` calls it
 *    BEFORE its own cycle detection ever runs, the crash pre-empts this
 *    module's stated "total, never throws" contract for exactly the graph
 *    shape it exists to catch. AT-16/17 mirror dep-layout.test.ts's two
 *    deep-graph cases through the real, shared entry point.
 *
 *    OBSERVATION (flagged per the task brief, not improvised on): this
 *    module's OWN cycle detector (`detectCycles`, a recursive Tarjan SCC
 *    pass) independently blows the stack on a deep ACYCLIC chain too, verified
 *    by probing it in isolation at n=10,000 (n=2,500 survives, n=10,000
 *    throws) — a strictly separate unbounded-recursion bug from `topoLevels`.
 *    The review scoped "the coming fix" to converting `topoLevels`'
 *    recursion to a worklist; that fix ALONE will not turn AT-16 green,
 *    because `detectCycles` would then be the next thing to throw on the
 *    same input. Reported here rather than silently worked around.
 *
 *  - Amendment 2 (AT-18/19): `DependencyDagNode<T>` gains `deps: string[]` —
 *    declared-order, de-duplicated union of every dep id — the ONE value
 *    both this DAG and SessionArtifactPane.tsx's roadmap-draft table must
 *    read, so a duplicate-declaring manifest can never show `INIT-A, INIT-A`
 *    in the table while the DAG renders one edge. AT-19 specifically proves
 *    `deps` cannot be implemented as `[...resolvedDeps, ...unresolvedDeps]`.
 * ---------------------------------------------------------------------------
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

// ===========================================================================
// Amendment round (2026-08-06) — adversarial-review findings ratified as
// IN SCOPE, pinned here before the fix lands.
//
// Amendment 1 (AT-16, AT-17) — dependencyDagView calls `topoLevels`
// (dep-layout.ts) FIRST, before cycle detection ever runs — so
// topoLevels' unbounded recursion (dep-layout.test.ts's AT-9/AT-10) crashes
// the WHOLE view before the cycle detector — the module's OWN stated "total,
// never throws" contract (this file's module header) — ever gets a chance to
// run for exactly the graph shape it exists to catch. Mirrors dep-layout.
// test.ts's two deep-graph cases through the real, shared `dependencyDagView`
// entry point. RED against current head (independently reproduced via the
// real import before writing these ATs — see this session's report).
//
// Amendment 2 (AT-18, AT-19) — `DependencyDagNode<T>` gains `deps: string[]`,
// the declared-order, de-duplicated union of resolvedDeps+unresolvedDeps —
// the ONE value both this DAG and a table rendered beside it (Session
// ArtifactPane.tsx's roadmap-draft table) must read, so the two can never
// disagree (today: the table renders `row.dependsOn` verbatim/undeduped
// while the DAG already dedupes internally — confirmed by reading both
// files). RED against current head: `DependencyDagNode<T>` carries no `deps`
// field at all yet.
// ===========================================================================

function buildReversedChain(n: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ id: `N${i}`, deps: i < n - 1 ? [`N${i + 1}`] : [] });
  return items;
}

function buildRingCycle(n: number): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ id: `N${i}`, deps: [`N${(i + 1) % n}`] });
  return items;
}

test('AT-16: dependencyDagView: a 10,000-node reversed-order chain does NOT throw (kills: topoLevels\' unbounded recursion pre-empting this module\'s "total, never throws" contract) and produces the CORRECT levels through the full view — maxLevel:9999, hasCycle:false', () => {
  const items = buildReversedChain(10_000);
  let view: DependencyDagView<Item> | undefined;
  const t0 = performance.now();
  expect(() => {
    view = dependencyDagView(items, idOf, depsOf);
  }).not.toThrow();
  const elapsedMs = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`AT-16 wall-clock: ${elapsedMs.toFixed(1)}ms for n=10000`);
  expect(view!.nodes.length).toBe(10_000);
  expect(view!.maxLevel).toBe(9_999);
  expect(view!.hasCycle).toBe(false);
  expect(elapsedMs).toBeLessThan(2000);
});

test('AT-17: dependencyDagView: a 10,000-node ring cycle does NOT throw and hasCycle is CORRECTLY true, with every node in cycleMembers — this is the finding\'s actual sting: the crash pre-empts the cycle detector for exactly the shape it exists to catch', () => {
  const items = buildRingCycle(10_000);
  let view: DependencyDagView<Item> | undefined;
  const t0 = performance.now();
  expect(() => {
    view = dependencyDagView(items, idOf, depsOf);
  }).not.toThrow();
  const elapsedMs = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`AT-17 wall-clock: ${elapsedMs.toFixed(1)}ms for n=10000`);
  expect(view!.nodes.length).toBe(10_000);
  expect(view!.hasCycle).toBe(true);
  expect(view!.cycleMembers.length).toBe(10_000); // a single full ring is one SCC of size n
  expect(elapsedMs).toBeLessThan(2000);
});

test('AT-18: dependencyDagView: DependencyDagNode gains "deps" — the DECLARED-ORDER, DE-DUPLICATED union of every dep id (resolved or not) — kills an implementation that omits the field entirely (today), fails to dedupe, or re-sorts', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    // B declares A twice and an unresolved id once, in this order.
    { id: 'B', deps: ['A', 'GHOST', 'A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  const nodeB = view.nodes.find((n) => n.id === 'B')!;
  expect((nodeB as unknown as { deps: string[] }).deps).toEqual(['A', 'GHOST']);
});

test('AT-19: dependencyDagView: "deps" is NOT [...resolvedDeps, ...unresolvedDeps] — kills the tempting-but-wrong naive-concatenation implementation, which always puts every resolved id before every unresolved one regardless of declared order', () => {
  // Declared order: an UNRESOLVED id first, then a RESOLVED id, then BOTH
  // repeated (duplicates of each). True declared-order-deduped result is
  // ['GHOST', 'A'] (GHOST declared first). A naive `[...resolvedDeps,
  // ...unresolvedDeps]` would instead produce resolvedDeps=['A'] +
  // unresolvedDeps=['GHOST'] = ['A', 'GHOST'] — the WRONG, reversed order —
  // because that concatenation can never place an unresolved id before a
  // resolved one, no matter what was actually declared first.
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['GHOST', 'A', 'GHOST', 'A'] },
  ];
  const view = dependencyDagView(items, idOf, depsOf);
  const nodeB = view.nodes.find((n) => n.id === 'B')!;
  expect((nodeB as unknown as { deps: string[] }).deps).toEqual(['GHOST', 'A']);
  // Sanity: resolvedDeps/unresolvedDeps themselves are unaffected by this change.
  expect(nodeB.resolvedDeps).toEqual(['A']);
  expect(nodeB.unresolvedDeps).toEqual(['GHOST']);
});
