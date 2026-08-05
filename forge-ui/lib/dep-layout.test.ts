/**
 * Tests for forge-ui/lib/dep-layout.ts's `topoLevels` (adversarial-review
 * amendment on R4-15, 2026-08-06) — this function has FOUR real consumers
 * (`monitor-layout.ts`, `app/projects/[id]/page.tsx` twice, and the new
 * `dependency-dag.ts`) and, until this file, ZERO tests anywhere in the
 * repo (confirmed: no `dep-layout.test.ts` existed before this round, and
 * no other test file imports `topoLevels`).
 *
 * `topoLevels` had ZERO tests before this round despite four consumers. The
 * ATs below fall into THREE distinct categories, corrected here (adversarial
 * review round 2, 2026-08-06) after an earlier draft of this header lumped
 * AT-1..AT-8 together as one undifferentiated "characterization" bucket —
 * that blanket claim only half held, and this campaign treats an overstated
 * comment as seriously as an overstated implementation claim:
 *
 * 1. ACCEPTANCE (AT-1, AT-2, AT-3, AT-4, AT-8): spec-determined, unambiguous
 *    values that ANY correct implementation of the documented rule ("level 0
 *    = no resolvable deps; level n = 1 + max(level of resolvable deps)") must
 *    produce — a linear chain, a diamond, multiple independent roots, an
 *    orphan (unresolvable) dep never raising a level, and empty input's
 *    empty `levelById`/`byLevel` with `maxLevel:0`. These are not
 *    implementation-specific accidents; a from-scratch reimplementation with
 *    no knowledge of this one would still have to produce these exact
 *    numbers to be correct. Undersold by an earlier draft's blanket
 *    "characterization pins" label — they are acceptance tests.
 *
 * 2. CHARACTERIZATION (AT-5, AT-6): the EXACT level numbers a dependency
 *    CYCLE folds to (2-node: B=1,A=2; 3-node: C=1,B=2,A=3) are genuinely an
 *    ACCIDENT of THIS implementation's traversal order (which member's
 *    back-edge fires first, `items`' iteration order) — the documented rule
 *    above says nothing about what a cycle "should" produce, so a
 *    differently-ordered but equally correct (never throws, folds a
 *    back-edge to 0, total) worklist could legitimately produce DIFFERENT
 *    numbers, e.g. both members at level 0. Pinned anyway because three real
 *    consumers currently render THESE specific numbers and the review's fix
 *    must reproduce them byte-identically — but that is a "don't silently
 *    change what ships today" reason, not a "the spec demands this" reason.
 *    This is the one pair of ATs the "characterization" label genuinely fits.
 *
 * 3. ACCEPTANCE against a now-corrected doc, NOT a rewrite regression guard
 *    (AT-7): `byLevel`'s bucket-insertion order (ITEMS-scan order, not
 *    ascending level number) is now accurately documented on
 *    `TopoLevelResult.byLevel` itself (dep-layout.ts, corrected by the fix
 *    round) — AT-7 pins that corrected, now-unambiguous doc claim, so it is
 *    acceptance-grade. Its purpose is NOT "survive the recursion→worklist
 *    rewrite", though an earlier draft of this header implied that: the
 *    bucket-building loop AT-7 exercises (`topoLevels`'s final
 *    `for (const it of items) { ... byLevel.set(...) }` pass) is BYTE-
 *    IDENTICAL before and after that rewrite — only `computeLevelsFrom` (the
 *    level-computation itself) changed — so this loop was never at risk from
 *    it. AT-7 exists because the behaviour had zero coverage before this
 *    round, not because the rewrite threatened it.
 *
 * 4. DEFECT PIN (AT-9, AT-10): `topoLevels` was UNBOUNDED recursion — a
 *    ~2500+-node reversed-order chain or cycle threw `RangeError: Maximum
 *    call stack size exceeded` (independently reproduced while writing this
 *    file: plain Node throws at n=2500 for both shapes, confirmed via the
 *    REAL `topoLevels` import at n=10000 too — see this session's report for
 *    the raw numbers). AT-9/AT-10 were genuinely RED when written: a
 *    10,000-node chain/cycle, well within what a real roadmap or WI graph
 *    could reach over a project's lifetime, crashed the render path.
 *
 * All fixture values below were VERIFIED by running the real, current
 * `topoLevels` (not hand-derived/guessed) — see this session's report for
 * the raw probe output.
 */
import { test, expect } from 'vitest';
import { topoLevels } from './dep-layout.ts';

type Item = { id: string; deps: string[] };
const idOf = (i: Item) => i.id;
const depsOf = (i: Item) => i.deps;

// ===========================================================================
// Basic shapes — chain, diamond, multiple roots (AT-1..AT-3)
// ===========================================================================

test('AT-1: topoLevels: a linear chain (A no deps; B depends on A; C depends on B) yields levels 0/1/2, maxLevel:2', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
    { id: 'C', deps: ['B'] },
  ];
  const r = topoLevels(items, idOf, depsOf);
  expect(r.levelById.get('A')).toBe(0);
  expect(r.levelById.get('B')).toBe(1);
  expect(r.levelById.get('C')).toBe(2);
  expect(r.maxLevel).toBe(2);
});

test('AT-2: topoLevels: a diamond (A root; B and C both depend on A; D depends on B and C) yields A=0, B=1, C=1, D=2 — byLevel[1] holds [B,C] in INPUT order', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: ['A'] },
    { id: 'C', deps: ['A'] },
    { id: 'D', deps: ['B', 'C'] },
  ];
  const r = topoLevels(items, idOf, depsOf);
  expect(r.levelById.get('A')).toBe(0);
  expect(r.levelById.get('B')).toBe(1);
  expect(r.levelById.get('C')).toBe(1);
  expect(r.levelById.get('D')).toBe(2);
  expect(r.maxLevel).toBe(2);
  expect((r.byLevel.get(1) ?? []).map((i) => i.id)).toEqual(['B', 'C']);
});

test('AT-3: topoLevels: multiple independent roots (A and B both level 0; C depends only on A) — B never contaminates C\'s level, byLevel[0] holds both roots in input order', () => {
  const items: Item[] = [
    { id: 'A', deps: [] },
    { id: 'B', deps: [] },
    { id: 'C', deps: ['A'] },
  ];
  const r = topoLevels(items, idOf, depsOf);
  expect(r.levelById.get('A')).toBe(0);
  expect(r.levelById.get('B')).toBe(0);
  expect(r.levelById.get('C')).toBe(1);
  expect(r.maxLevel).toBe(1);
  expect((r.byLevel.get(0) ?? []).map((i) => i.id)).toEqual(['A', 'B']);
  expect((r.byLevel.get(1) ?? []).map((i) => i.id)).toEqual(['C']);
});

// ===========================================================================
// Orphan dep — skipped for LEVELLING, never raises the level (:57-58) (AT-4)
// ===========================================================================

test('AT-4: topoLevels: a dep id that resolves to no known item is skipped for levelling — it never raises the node\'s level, whether alone or alongside a real dep', () => {
  const orphanOnly: Item[] = [{ id: 'X', deps: ['GHOST-not-in-set'] }];
  const rOnly = topoLevels(orphanOnly, idOf, depsOf);
  expect(rOnly.levelById.get('X')).toBe(0);
  expect(rOnly.maxLevel).toBe(0);

  // Compound: Y depends on BOTH an orphan and a real level-0 item — the
  // orphan must not "protect" Y at level 0, nor push it past what the real
  // dep alone would produce.
  const compound: Item[] = [
    { id: 'A', deps: [] },
    { id: 'Y', deps: ['GHOST-not-in-set', 'A'] },
  ];
  const rCompound = topoLevels(compound, idOf, depsOf);
  expect(rCompound.levelById.get('A')).toBe(0);
  expect(rCompound.levelById.get('Y')).toBe(1);
  expect(rCompound.maxLevel).toBe(1);
});

// ===========================================================================
// Cycle back-edge folding — EXACT levels, byte-identical (:50) (AT-5, AT-6)
// ===========================================================================

test('AT-5: topoLevels: a 2-node mutual cycle (A depends on B, B depends on A) folds the back-edge to level 0 internally and RETURNS rather than recursing forever — the two members do NOT both land at level 0; the EXACT levels produced today (verified via the real function, not derived) are B=1, A=2', () => {
  // Iteration starts at A (input order): A -> B -> A (back-edge, stack has A,
  // returns 0 uncached) -> B computed as 1+0=1 -> A computed as 1+1=2.
  // Pinned VERBATIM so a worklist rewrite that "cleans this up" to a more
  // intuitive-looking {A:0,B:0} (equally plausible-looking, but a DIFFERENT
  // real value the 3 live consumers would render differently) is caught.
  const items: Item[] = [
    { id: 'A', deps: ['B'] },
    { id: 'B', deps: ['A'] },
  ];
  let r: ReturnType<typeof topoLevels<Item>> | undefined;
  expect(() => {
    r = topoLevels(items, idOf, depsOf);
  }).not.toThrow();
  expect(r!.levelById.get('B')).toBe(1);
  expect(r!.levelById.get('A')).toBe(2);
  expect(r!.maxLevel).toBe(2);
});

test('AT-6: topoLevels: a 3-node cycle (A depends on B, B depends on C, C depends on A) — the EXACT levels produced today are C=1, B=2, A=3, maxLevel=3', () => {
  const items: Item[] = [
    { id: 'A', deps: ['B'] },
    { id: 'B', deps: ['C'] },
    { id: 'C', deps: ['A'] },
  ];
  let r: ReturnType<typeof topoLevels<Item>> | undefined;
  expect(() => {
    r = topoLevels(items, idOf, depsOf);
  }).not.toThrow();
  expect(r!.levelById.get('C')).toBe(1);
  expect(r!.levelById.get('B')).toBe(2);
  expect(r!.levelById.get('A')).toBe(3);
  expect(r!.maxLevel).toBe(3);
});

// ===========================================================================
// byLevel bucket ordering + maxLevel — insertion order is INPUT-scan order,
// NOT numerically ascending, matching TopoLevelResult.byLevel's own
// (corrected) doc comment (AT-7, acceptance-grade against that doc — NOT a
// guard against the recursion→worklist rewrite, which never touched this
// bucket-building loop); empty input (AT-8, acceptance — spec-determined)
// ===========================================================================

test('AT-7: topoLevels: byLevel\'s bucket-insertion order follows the ITEMS scan order, not ascending level number — a scrambled input (C first, depends on B, depends on A) yields byLevel key order [2,1,0], the REVERSE of ascending, and maxLevel is the true max across ALL items regardless of input position', () => {
  const items: Item[] = [
    { id: 'C', deps: ['B'] },
    { id: 'B', deps: ['A'] },
    { id: 'A', deps: [] },
  ];
  const r = topoLevels(items, idOf, depsOf);
  expect([...r.byLevel.keys()]).toEqual([2, 1, 0]); // NOT [0,1,2] — pins the real (surprising) insertion order
  expect((r.byLevel.get(2) ?? []).map((i) => i.id)).toEqual(['C']);
  expect((r.byLevel.get(1) ?? []).map((i) => i.id)).toEqual(['B']);
  expect((r.byLevel.get(0) ?? []).map((i) => i.id)).toEqual(['A']);
  expect(r.maxLevel).toBe(2); // true max, not "level of the last input item" (A, level 0)
});

test('AT-8: topoLevels: empty input yields an EMPTY levelById and EMPTY byLevel (size 0, not a level-0 bucket of []) and maxLevel:0', () => {
  const r = topoLevels<Item>([], idOf, depsOf);
  expect(r.levelById.size).toBe(0);
  expect(r.byLevel.size).toBe(0);
  expect(r.maxLevel).toBe(0);
});

// ===========================================================================
// THE DEFECT — unbounded recursion crashed on a deep graph (AT-9, AT-10).
// Were RED when written: both threw `RangeError: Maximum call stack size
// exceeded` against the pre-fix, purely-recursive `topoLevels` (independently
// reproduced before writing these ATs). Now green post-fix (worklist
// rewrite) — kept as acceptance tests against the crash going forward. Each
// completes well under a couple of seconds — wall-clock is logged, not just
// pass/fail, per the review's instruction (a hang is its own defect,
// distinct from a crash).
// ===========================================================================

test('AT-9: topoLevels: a 10,000-node chain declared in REVERSE order (item i depends on item i+1, so recursion must walk the FULL depth before any level is cached) does NOT throw, and produces the CORRECT levels — maxLevel:9999, level(item[0]):9999, level(item[9999]):0', () => {
  const n = 10_000;
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ id: `N${i}`, deps: i < n - 1 ? [`N${i + 1}`] : [] });

  let r: ReturnType<typeof topoLevels<Item>> | undefined;
  const t0 = performance.now();
  expect(() => {
    r = topoLevels(items, idOf, depsOf);
  }).not.toThrow();
  const elapsedMs = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`AT-9 wall-clock: ${elapsedMs.toFixed(1)}ms for n=${n}`);

  expect(r!.levelById.size).toBe(n);
  expect(r!.levelById.get('N0')).toBe(n - 1);
  expect(r!.levelById.get(`N${n - 1}`)).toBe(0);
  expect(r!.maxLevel).toBe(n - 1);
  expect(elapsedMs).toBeLessThan(2000);
});

test('AT-10: topoLevels: a 10,000-node cycle (item i depends on item (i+1)%n, a full ring) does NOT throw, and returns a well-formed, TOTAL result — every item gets a level, byLevel\'s buckets sum to n', () => {
  const n = 10_000;
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ id: `N${i}`, deps: [`N${(i + 1) % n}`] });

  let r: ReturnType<typeof topoLevels<Item>> | undefined;
  const t0 = performance.now();
  expect(() => {
    r = topoLevels(items, idOf, depsOf);
  }).not.toThrow();
  const elapsedMs = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`AT-10 wall-clock: ${elapsedMs.toFixed(1)}ms for n=${n}`);

  expect(r!.levelById.size).toBe(n);
  let bucketTotal = 0;
  for (const bucket of r!.byLevel.values()) bucketTotal += bucket.length;
  expect(bucketTotal).toBe(n);
  expect(elapsedMs).toBeLessThan(2000);
});
