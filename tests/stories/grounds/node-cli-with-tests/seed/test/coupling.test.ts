/**
 * Tests for src/coupling.ts — computeCoupling()
 *
 * All tests use node:test and node:assert (no external dependencies).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoupling } from '../src/coupling.ts';
import type { Commit } from '../src/git.ts';

// Helper to build a minimal Commit fixture (only fields coupling uses)
function makeCommit(hash: string, filePaths: string[]): Commit {
  return {
    hash,
    author: 'Test Author',
    date: '2024-01-01',
    parentCount: 1,
    authorEmail: '',
    filesChanged: filePaths.length,
    insertions: 0,
    deletions: 0,
    files: filePaths.map(path => ({ path, insertions: 0, deletions: 0 })),
  };
}

describe('computeCoupling', () => {
  // AC-1: standard five-commit fixture
  it('AC-1: computes coChanges and couplingPct for a five-commit fixture', () => {
    const commits: Commit[] = [
      makeCommit('c1', ['engine.ts', 'router.ts']),       // engine↔router
      makeCommit('c2', ['engine.ts', 'router.ts']),       // engine↔router
      makeCommit('c3', ['engine.ts']),                    // solo
      makeCommit('c4', ['router.ts', 'middleware.ts']),   // router↔middleware
      makeCommit('c5', ['middleware.ts']),                 // solo
    ];

    const result = computeCoupling(commits);

    // engine.ts↔router.ts: coChanges=2, engine appears 3×, router appears 3×
    // couplingPct = 2/3*100 ≈ 66.7
    const er = result.find(r => r.fileA === 'engine.ts' && r.fileB === 'router.ts');
    assert.ok(er, 'engine.ts↔router.ts row should exist');
    assert.equal(er!.coChanges, 2);
    assert.equal(er!.couplingPct, 66.7);

    // router.ts↔middleware.ts: coChanges=1, router 3×, middleware 2×
    // couplingPct = 1/3*100 ≈ 33.3
    const rm = result.find(r => r.fileA === 'middleware.ts' && r.fileB === 'router.ts');
    assert.ok(rm, 'middleware.ts↔router.ts row should exist');
    assert.equal(rm!.coChanges, 1);
    assert.equal(rm!.couplingPct, 33.3);

    // engine.ts↔middleware.ts: should be absent (coChanges=0)
    const em = result.find(r =>
      (r.fileA === 'engine.ts' && r.fileB === 'middleware.ts') ||
      (r.fileA === 'middleware.ts' && r.fileB === 'engine.ts')
    );
    assert.equal(em, undefined, 'engine.ts↔middleware.ts should be absent');
  });

  // AC-2: single-file commits → empty array
  it('AC-2: returns empty array when every commit touches exactly one file', () => {
    const commits: Commit[] = [
      makeCommit('c1', ['a.ts']),
      makeCommit('c2', ['b.ts']),
      makeCommit('c3', ['c.ts']),
    ];

    const result = computeCoupling(commits);
    assert.deepEqual(result, []);
  });

  // AC-3: ordering — all four tie-break levels exercised
  it('AC-3: sorts by coChanges desc, couplingPct desc, fileA asc, fileB asc', () => {
    // Build a fixture that exercises all four sort levels:
    //
    // Pair p↔q:  coChanges=3, fileCount p=3, q=3 → pct=100.0  [level 1 winner]
    // Pair a↔b:  coChanges=2, fileCount a=2, b=2 → pct=100.0  [level 2: same pct as c↔d, level 3: 'a' < 'c']
    // Pair c↔d:  coChanges=2, fileCount c=2, d=2 → pct=100.0  [level 3 loser vs a↔b]
    // Pair x↔y:  coChanges=2, fileCount x=4, y=4 → pct=50.0   [level 2 loser]
    // Pair m↔n1: coChanges=1, fileCount m=1, n1=1 → pct=100.0 [level 1 loser; level 4: 'n1'<'n2']
    // Pair m↔n2: coChanges=1, fileCount m=1, n2=1 → pct=100.0 [level 4 loser]
    //
    // Expected order: p↔q, a↔b, c↔d, x↔y, m↔n1, m↔n2

    const commits: Commit[] = [
      // p↔q appears 3×
      makeCommit('c1', ['p.ts', 'q.ts']),
      makeCommit('c2', ['p.ts', 'q.ts']),
      makeCommit('c3', ['p.ts', 'q.ts']),
      // a↔b appears 2×
      makeCommit('c4', ['a.ts', 'b.ts']),
      makeCommit('c5', ['a.ts', 'b.ts']),
      // c↔d appears 2×
      makeCommit('c6', ['c.ts', 'd.ts']),
      makeCommit('c7', ['c.ts', 'd.ts']),
      // x↔y appears 2× but each file appears 4× (extra solo commits to inflate count)
      makeCommit('c8', ['x.ts', 'y.ts']),
      makeCommit('c9', ['x.ts', 'y.ts']),
      makeCommit('c10', ['x.ts']),
      makeCommit('c11', ['x.ts']),
      makeCommit('c12', ['y.ts']),
      makeCommit('c13', ['y.ts']),
      // m↔n1 and m↔n2 each appear once; m appears once too (so pct=100)
      makeCommit('c14', ['m.ts', 'n1.ts', 'n2.ts']),
    ];

    const result = computeCoupling(commits);

    // Extract just the pair keys in order
    const pairs = result.map(r => `${r.fileA}↔${r.fileB}`);

    const pqIdx = pairs.indexOf('p.ts↔q.ts');
    const abIdx = pairs.indexOf('a.ts↔b.ts');
    const cdIdx = pairs.indexOf('c.ts↔d.ts');
    const xyIdx = pairs.indexOf('x.ts↔y.ts');
    const mn1Idx = pairs.indexOf('m.ts↔n1.ts');
    const mn2Idx = pairs.indexOf('m.ts↔n2.ts');

    // All pairs must be present
    assert.ok(pqIdx !== -1, 'p.ts↔q.ts must be present');
    assert.ok(abIdx !== -1, 'a.ts↔b.ts must be present');
    assert.ok(cdIdx !== -1, 'c.ts↔d.ts must be present');
    assert.ok(xyIdx !== -1, 'x.ts↔y.ts must be present');
    assert.ok(mn1Idx !== -1, 'm.ts↔n1.ts must be present');
    assert.ok(mn2Idx !== -1, 'm.ts↔n2.ts must be present');

    // Level 1: coChanges desc — p↔q (3) before a↔b,c↔d,x↔y (2) before m↔n1,m↔n2 (1)
    assert.ok(pqIdx < abIdx, 'p↔q (coChanges=3) before a↔b (coChanges=2)');
    assert.ok(pqIdx < cdIdx, 'p↔q (coChanges=3) before c↔d (coChanges=2)');
    assert.ok(pqIdx < xyIdx, 'p↔q (coChanges=3) before x↔y (coChanges=2)');
    assert.ok(abIdx < mn1Idx, 'a↔b (coChanges=2) before m↔n1 (coChanges=1)');

    // Level 2: couplingPct desc — a↔b and c↔d (pct=100) before x↔y (pct=50)
    assert.ok(abIdx < xyIdx, 'a↔b (pct=100) before x↔y (pct=50)');
    assert.ok(cdIdx < xyIdx, 'c↔d (pct=100) before x↔y (pct=50)');

    // Level 3: fileA asc — a↔b before c↔d (same coChanges and pct)
    assert.ok(abIdx < cdIdx, 'a↔b (fileA=a.ts) before c↔d (fileA=c.ts)');

    // Level 4: fileB asc — m↔n1 before m↔n2 (same coChanges, pct, fileA)
    assert.ok(mn1Idx < mn2Idx, 'm↔n1 (fileB=n1.ts) before m↔n2 (fileB=n2.ts)');
  });

  // AC-4: pair key normalisation — file order in commit doesn't matter
  it('AC-4: normalises pair key regardless of file order in commits', () => {
    const commits: Commit[] = [
      makeCommit('c1', ['b.ts', 'a.ts']),  // reversed order
      makeCommit('c2', ['a.ts', 'b.ts']),  // normal order
    ];

    const result = computeCoupling(commits);

    // Should produce exactly one row, not two
    assert.equal(result.length, 1);
    assert.equal(result[0].fileA, 'a.ts');
    assert.equal(result[0].fileB, 'b.ts');
    assert.equal(result[0].coChanges, 2);
  });

  // Zero co-change pairs are absent from output (implicit in AC-1 but explicit here)
  it('zero co-change pairs are absent from output', () => {
    const commits: Commit[] = [
      makeCommit('c1', ['a.ts', 'b.ts']),
      makeCommit('c2', ['c.ts']),
    ];
    const result = computeCoupling(commits);
    // Only a↔b should appear, no pairs involving c.ts
    assert.equal(result.length, 1);
    assert.equal(result[0].fileA, 'a.ts');
    assert.equal(result[0].fileB, 'b.ts');
  });

  // Binary files participate normally (files with insertions=0 deletions=0)
  it('binary-like files (insertions=0, deletions=0) participate in pair counts', () => {
    const commits: Commit[] = [
      {
        hash: 'b1',
        author: 'Test Author',
        date: '2024-01-01',
        parentCount: 1,
        authorEmail: '',
        filesChanged: 2,
        insertions: 0,
        deletions: 0,
        files: [
          { path: 'image.png', insertions: 0, deletions: 0 },  // binary-like
          { path: 'src/app.ts', insertions: 10, deletions: 0 },
        ],
      },
      {
        hash: 'b2',
        author: 'Test Author',
        date: '2024-01-02',
        parentCount: 1,
        authorEmail: '',
        filesChanged: 2,
        insertions: 0,
        deletions: 0,
        files: [
          { path: 'image.png', insertions: 0, deletions: 0 },
          { path: 'src/app.ts', insertions: 5, deletions: 2 },
        ],
      },
    ];

    const result = computeCoupling(commits);
    assert.equal(result.length, 1);
    assert.equal(result[0].fileA, 'image.png');
    assert.equal(result[0].fileB, 'src/app.ts');
    assert.equal(result[0].coChanges, 2);
    assert.equal(result[0].couplingPct, 100);
  });

  // Empty commits array → empty result
  it('returns empty array for empty commits input', () => {
    assert.deepEqual(computeCoupling([]), []);
  });
});
