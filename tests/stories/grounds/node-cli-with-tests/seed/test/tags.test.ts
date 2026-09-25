/**
 * Unit tests for src/tags.ts — pure analytics (computeTagSpans, computeMedianGapDays).
 * No I/O, no git spawning. All fixtures are inline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTagSpans, computeMedianGapDays } from '../src/tags.ts';
import type { TagSpan } from '../src/tags.ts';
import type { Commit, TagEntry } from '../src/git.ts';

// ============================================================
// Fixture helpers
// ============================================================

function makeTag(name: string, date: string, sha: string = `sha-${name}`): TagEntry {
  return { name, date, sha };
}

function makeCommit(author: string): Commit {
  return {
    hash: `hash-${author}-${Math.random()}`,
    author,
    date: '2021-01-01',
    parentCount: 1,
    authorEmail: '',
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
    files: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }],
  };
}

// The canonical 3-tag fixture from the WI specs / acceptance fixture:
//   v0.3 (newest, 2021-04-03), v0.2 (2021-03-15), v0.1 (oldest, 2021-03-02)
const TAGS_3: readonly TagEntry[] = [
  makeTag('v0.3', '2021-04-03'),
  makeTag('v0.2', '2021-03-15'),
  makeTag('v0.1', '2021-03-02'),
];

// Per-span commit fixtures (2 commits per span, alternating authors).
const ADA   = 'Ada Lovelace';
const GRACE = 'Grace Hopper';

const COMMITS_V03 = [makeCommit(ADA),   makeCommit(GRACE)]; // span for v0.3
const COMMITS_V02 = [makeCommit(ADA),   makeCommit(GRACE)]; // span for v0.2
const COMMITS_V01 = [makeCommit(ADA),   makeCommit(GRACE)]; // span for v0.1 (from root)

// ============================================================
// computeTagSpans — basic case
// ============================================================

test('computeTagSpans: 3-tag fixture produces correct commitsSince and uniqueAuthors', () => {
  const spans = computeTagSpans(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(spans.length, 3);

  const v03 = spans[0];
  assert.equal(v03.name,          'v0.3');
  assert.equal(v03.date,          '2021-04-03');
  assert.equal(v03.commitsSince,  2);
  assert.equal(v03.uniqueAuthors, 2);

  const v02 = spans[1];
  assert.equal(v02.name,          'v0.2');
  assert.equal(v02.commitsSince,  2);
  assert.equal(v02.uniqueAuthors, 2);

  const v01 = spans[2];
  assert.equal(v01.name,          'v0.1');
  assert.equal(v01.commitsSince,  2);
  assert.equal(v01.uniqueAuthors, 2);
});

// ============================================================
// computeTagSpans — daysSince
// ============================================================

test('computeTagSpans: daysSince for v0.3 = 19 (2021-04-03 - 2021-03-15)', () => {
  const spans = computeTagSpans(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(spans[0].daysSince, 19);
});

test('computeTagSpans: daysSince for v0.2 = 13 (2021-03-15 - 2021-03-02)', () => {
  const spans = computeTagSpans(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(spans[1].daysSince, 13);
});

test('computeTagSpans: daysSince for oldest tag (v0.1) is null', () => {
  const spans = computeTagSpans(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(spans[2].daysSince, null);
});

// ============================================================
// computeTagSpans — sentinel dates from AC-8
// ============================================================

test('computeTagSpans: two tag dates 2021-03-02 and 2021-03-15 → daysSince=13', () => {
  const tags: readonly TagEntry[] = [
    makeTag('v0.2', '2021-03-15'),
    makeTag('v0.1', '2021-03-02'),
  ];
  const spans = computeTagSpans(tags, [[makeCommit(ADA)], [makeCommit(GRACE)]]);
  // v0.2 daysSince = 2021-03-15 - 2021-03-02 = 13
  assert.equal(spans[0].daysSince, 13);
  // v0.1 is oldest → null
  assert.equal(spans[1].daysSince, null);
});

// ============================================================
// computeTagSpans — uniqueAuthors with duplicates
// ============================================================

test('computeTagSpans: uniqueAuthors deduplicates the same author across multiple commits', () => {
  const tags: readonly TagEntry[] = [
    makeTag('v0.1', '2021-01-01'),
  ];
  const commits = [makeCommit(ADA), makeCommit(ADA), makeCommit(ADA)];
  const spans = computeTagSpans(tags, [commits]);
  assert.equal(spans[0].commitsSince,  3); // 3 commits
  assert.equal(spans[0].uniqueAuthors, 1); // but only 1 distinct author
});

// ============================================================
// computeTagSpans — single tag
// ============================================================

test('computeTagSpans: single tag has null daysSince and correct commitsSince', () => {
  const tags: readonly TagEntry[] = [makeTag('v1.0', '2021-06-01')];
  const spans = computeTagSpans(tags, [[makeCommit(ADA)]]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].daysSince, null);
  assert.equal(spans[0].commitsSince, 1);
});

// ============================================================
// computeTagSpans — empty span (no commits)
// ============================================================

test('computeTagSpans: empty span (no commits) → commitsSince=0, uniqueAuthors=0', () => {
  const tags: readonly TagEntry[] = [makeTag('v0.1', '2021-01-01')];
  const spans = computeTagSpans(tags, [[]]);
  assert.equal(spans[0].commitsSince, 0);
  assert.equal(spans[0].uniqueAuthors, 0);
});

// ============================================================
// computeMedianGapDays — AC-2 (5-value list from WI spec)
// ============================================================

test('computeMedianGapDays: [null, 14, 28, 7, 21] → 17.5', () => {
  const spans: readonly TagSpan[] = [
    { name: 'v5', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: null },
    { name: 'v4', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 14  },
    { name: 'v3', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 28  },
    { name: 'v2', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 7   },
    { name: 'v1', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 21  },
  ];
  assert.equal(computeMedianGapDays(spans), 17.5);
});

// ============================================================
// computeMedianGapDays — canonical 3-tag fixture → 16
// ============================================================

test('computeMedianGapDays: 3-tag fixture [13, 19] → median 16', () => {
  const spans = computeTagSpans(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  // gaps are [19, 13] (order: newest first, but sorted for median)
  assert.equal(computeMedianGapDays(spans), 16);
});

// ============================================================
// computeMedianGapDays — fewer than 2 tags → null
// ============================================================

test('computeMedianGapDays: single tag (no gap) → null', () => {
  const spans = computeTagSpans(
    [makeTag('v1.0', '2021-01-01')],
    [[makeCommit(ADA)]],
  );
  assert.equal(computeMedianGapDays(spans), null);
});

test('computeMedianGapDays: empty spans array → null', () => {
  assert.equal(computeMedianGapDays([]), null);
});

// ============================================================
// computeMedianGapDays — odd vs even length
// ============================================================

test('computeMedianGapDays: odd number of gaps [7, 14, 21] → 14', () => {
  const spans: readonly TagSpan[] = [
    { name: 'v4', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 7  },
    { name: 'v3', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 14 },
    { name: 'v2', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: 21 },
    { name: 'v1', date: '2021-01-01', commitsSince: 0, uniqueAuthors: 0, daysSince: null },
  ];
  assert.equal(computeMedianGapDays(spans), 14);
});
