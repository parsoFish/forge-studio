/**
 * Tests for `src/compare.ts` — pure delta model.
 *
 * Run: node --import tsx --test test/compare.test.ts
 *
 * All stubs are inlined — no git spawning, no I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDelta } from '../src/compare.ts';
import type { CompareResult } from '../src/compare.ts';
import type { Summary } from '../src/stats.ts';

// ---------------------------------------------------------------------------
// Minimal Summary stubs — only the fields computeDelta uses.
// ---------------------------------------------------------------------------

/** Build a minimal Summary with the given headline + author churn data. */
function makeSummary(opts: {
  totalCommits: number;
  authorChurn: Array<{
    author: string;
    commits: number;
    insertions: number;
    deletions: number;
  }>;
}): Summary {
  return {
    totalCommits: opts.totalCommits,
    byAuthor: opts.authorChurn.map(a => ({ author: a.author, commits: a.commits })),
    authorChurn: opts.authorChurn,
    fileChurn: [],
    firstDate: null,
    lastDate: null,
    ownershipEntries: [],
    hotspotEntries: [],
  };
}

// ---------------------------------------------------------------------------
// AC1: Headline totals and delta computation
// ---------------------------------------------------------------------------

test('AC1: computeDelta returns correct headline totals and signed deltas', () => {
  // head: 5 commits, linesAdded=10, linesRemoved=2
  // We encode linesAdded/Removed via authorChurn insertions+deletions.
  const head = makeSummary({
    totalCommits: 5,
    authorChurn: [
      { author: 'Dev A', commits: 3, insertions: 7, deletions: 1 },
      { author: 'Dev B', commits: 2, insertions: 3, deletions: 1 },
    ],
    // total insertions = 10, total deletions = 2  ✓
  });

  // base: 3 commits, linesAdded=4, linesRemoved=1
  const base = makeSummary({
    totalCommits: 3,
    authorChurn: [
      { author: 'Dev A', commits: 2, insertions: 3, deletions: 1 },
      { author: 'Dev B', commits: 1, insertions: 1, deletions: 0 },
    ],
    // total insertions = 4, total deletions = 1  ✓
  });

  const result: CompareResult = computeDelta(base, head, 'v0.1');

  assert.equal(result.ref, 'v0.1', 'ref must be passed through verbatim');

  assert.equal(result.head.commits,      5,  'head.commits');
  assert.equal(result.head.linesAdded,   10, 'head.linesAdded');
  assert.equal(result.head.linesRemoved, 2,  'head.linesRemoved');

  assert.equal(result.base.commits,      3,  'base.commits');
  assert.equal(result.base.linesAdded,   4,  'base.linesAdded');
  assert.equal(result.base.linesRemoved, 1,  'base.linesRemoved');

  assert.equal(result.delta.commits,      2, 'delta.commits = 5-3');
  assert.equal(result.delta.linesAdded,   6, 'delta.linesAdded = 10-4');
  assert.equal(result.delta.linesRemoved, 1, 'delta.linesRemoved = 2-1');
});

// ---------------------------------------------------------------------------
// AC2: authorDeltas — sorted descending by |deltaCommits|
// ---------------------------------------------------------------------------

test('AC2: authorDeltas contains per-author entries sorted descending by |deltaCommits|', () => {
  // head: Ada with 4 commits, Grace with 2 commits
  const head = makeSummary({
    totalCommits: 6,
    authorChurn: [
      { author: 'Ada Lovelace',  commits: 4, insertions: 20, deletions: 5 },
      { author: 'Grace Hopper',  commits: 2, insertions: 8,  deletions: 2 },
    ],
  });

  // base: Ada with 1 commit, no Grace
  const base = makeSummary({
    totalCommits: 1,
    authorChurn: [
      { author: 'Ada Lovelace',  commits: 1, insertions: 3, deletions: 1 },
    ],
  });

  const result = computeDelta(base, head, 'v1.0');

  // Both authors must be present
  const adaEntry  = result.authorDeltas.find(e => e.author === 'Ada Lovelace');
  const graceEntry = result.authorDeltas.find(e => e.author === 'Grace Hopper');
  assert.ok(adaEntry,   'Ada Lovelace must appear in authorDeltas');
  assert.ok(graceEntry, 'Grace Hopper must appear in authorDeltas');

  // Ada: base=1, head=4, delta=3
  assert.equal(adaEntry!.baseCommits,  1, 'Ada.baseCommits');
  assert.equal(adaEntry!.headCommits,  4, 'Ada.headCommits');
  assert.equal(adaEntry!.deltaCommits, 3, 'Ada.deltaCommits');

  // Grace: base=0 (not in base), head=2, delta=2
  assert.equal(graceEntry!.baseCommits,  0, 'Grace.baseCommits = 0 (absent from base)');
  assert.equal(graceEntry!.headCommits,  2, 'Grace.headCommits');
  assert.equal(graceEntry!.deltaCommits, 2, 'Grace.deltaCommits');

  // Sort order: Ada |delta|=3 > Grace |delta|=2 → Ada comes first
  assert.equal(result.authorDeltas[0]!.author, 'Ada Lovelace',
    'First entry should be Ada (|deltaCommits|=3)');
  assert.equal(result.authorDeltas[1]!.author, 'Grace Hopper',
    'Second entry should be Grace (|deltaCommits|=2)');
});

// ---------------------------------------------------------------------------
// AC3: author only in base → headCommits=0, deltaCommits = -baseCommits
// ---------------------------------------------------------------------------

test('AC3: author present only in base appears with headCommits=0 and negative deltaCommits', () => {
  // head: only Dev X
  const head = makeSummary({
    totalCommits: 3,
    authorChurn: [
      { author: 'Dev X', commits: 3, insertions: 10, deletions: 2 },
    ],
  });

  // base: Dev X AND 'Legacy Dev' (base-only author with 5 commits)
  const base = makeSummary({
    totalCommits: 8,
    authorChurn: [
      { author: 'Dev X',       commits: 3, insertions: 4, deletions: 1 },
      { author: 'Legacy Dev',  commits: 5, insertions: 6, deletions: 3 },
    ],
  });

  const result = computeDelta(base, head, 'main');

  const legacyEntry = result.authorDeltas.find(e => e.author === 'Legacy Dev');
  assert.ok(legacyEntry, 'Legacy Dev must appear in authorDeltas even though absent from head');

  assert.equal(legacyEntry!.headCommits,  0,  'Legacy Dev headCommits = 0');
  assert.equal(legacyEntry!.baseCommits,  5,  'Legacy Dev baseCommits = 5');
  assert.equal(legacyEntry!.deltaCommits, -5, 'Legacy Dev deltaCommits = 0 - 5 = -5');
});

// ---------------------------------------------------------------------------
// Extra: deltaChurn is computed correctly from per-author churn
// ---------------------------------------------------------------------------

test('deltaChurn is correctly computed from per-author insertions + deletions', () => {
  // head: author with ins=8, del=4 → churn=12
  const head = makeSummary({
    totalCommits: 2,
    authorChurn: [
      { author: 'Carol', commits: 2, insertions: 8, deletions: 4 },
    ],
  });

  // base: same author with ins=3, del=2 → churn=5
  const base = makeSummary({
    totalCommits: 1,
    authorChurn: [
      { author: 'Carol', commits: 1, insertions: 3, deletions: 2 },
    ],
  });

  const result = computeDelta(base, head, 'v2.0');
  const carol = result.authorDeltas.find(e => e.author === 'Carol');
  assert.ok(carol);

  assert.equal(carol!.baseChurn,  5,  'baseChurn = 3+2 = 5');
  assert.equal(carol!.headChurn,  12, 'headChurn = 8+4 = 12');
  assert.equal(carol!.deltaChurn, 7,  'deltaChurn = 12-5 = 7');
});

// ---------------------------------------------------------------------------
// Extra: tie-break on |deltaChurn| when |deltaCommits| are equal
// ---------------------------------------------------------------------------

test('sort tie-break on |deltaChurn| when |deltaCommits| are equal', () => {
  // Two authors both with deltaCommits=1; Author B has larger |deltaChurn|.
  const head = makeSummary({
    totalCommits: 2,
    authorChurn: [
      { author: 'Alpha', commits: 2, insertions: 5,  deletions: 0 },
      { author: 'Beta',  commits: 2, insertions: 20, deletions: 0 },
    ],
  });

  const base = makeSummary({
    totalCommits: 2,
    authorChurn: [
      { author: 'Alpha', commits: 1, insertions: 4,  deletions: 0 },
      { author: 'Beta',  commits: 1, insertions: 1,  deletions: 0 },
    ],
  });

  const result = computeDelta(base, head, 'v3.0');
  // Alpha: deltaCommits=1, headChurn=5, baseChurn=4 → deltaChurn=1
  // Beta:  deltaCommits=1, headChurn=20, baseChurn=1 → deltaChurn=19
  // Beta should come first (larger |deltaChurn|).
  assert.equal(result.authorDeltas[0]!.author, 'Beta',  'Beta has larger deltaChurn → first');
  assert.equal(result.authorDeltas[1]!.author, 'Alpha', 'Alpha → second');
});
