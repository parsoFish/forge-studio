/**
 * Unit suite for src/hotspot.ts — computeHotspots().
 *
 * Fast, deterministic, creds-free, < 1 s. No git spawning: all fixtures are
 * hand-built Commit[] arrays.
 *
 * Quality gate: node --import tsx --test test/hotspot.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { computeHotspots } from '../src/hotspot.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal Commit touching the given files on the given date. */
function makeCommit(
  date: string,
  files: Array<{ path: string; insertions?: number; deletions?: number }>,
  overrides: Partial<Omit<Commit, 'files' | 'date'>> = {},
): Commit {
  const fileEntries = files.map((f) => ({
    path: f.path,
    insertions: f.insertions ?? 1,
    deletions: f.deletions ?? 0,
  }));
  const ins = fileEntries.reduce((s, f) => s + f.insertions, 0);
  const del = fileEntries.reduce((s, f) => s + f.deletions, 0);
  return {
    hash: 'deadbeef',
    author: 'Alice',
    date,
    parentCount: 1,
    authorEmail: '',
    filesChanged: fileEntries.length,
    insertions: ins,
    deletions: del,
    files: fileEntries,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC1: Score ordering — recently changed file ranks higher than stale file
// with the same commit count
// ---------------------------------------------------------------------------

test('AC1: hot.ts (recent lastDate) ranks higher than cold.ts (stale lastDate) with same commit count', () => {
  const referenceDate = '2024-01-10';
  // hot.ts: lastDate = 1 day before referenceDate → daysSince = 1
  const hotDate = '2024-01-09';
  // cold.ts: lastDate = 365 days before referenceDate → daysSince = 365
  const coldDate = '2023-01-10';

  // Build 10 commits for each file.
  const commits: Commit[] = [];
  for (let i = 0; i < 10; i++) {
    commits.push(makeCommit(hotDate, [{ path: 'src/hot.ts' }], { hash: `hot${i}` }));
    commits.push(makeCommit(coldDate, [{ path: 'src/cold.ts' }], { hash: `cold${i}` }));
  }

  const result = computeHotspots(commits, referenceDate);

  assert.equal(result.length, 2);
  const hot = result.find((e) => e.file === 'src/hot.ts');
  const cold = result.find((e) => e.file === 'src/cold.ts');

  assert.ok(hot !== undefined, 'src/hot.ts should be in results');
  assert.ok(cold !== undefined, 'src/cold.ts should be in results');
  assert.ok(hot!.score > cold!.score, `hot score (${hot!.score}) should exceed cold score (${cold!.score})`);
  assert.equal(result[0].file, 'src/hot.ts', 'hot.ts should appear first (highest score)');
});

// ---------------------------------------------------------------------------
// AC2: Tie-breaking — identical scores → ascending file path
// ---------------------------------------------------------------------------

test('AC2: ties in score are broken by file path ascending', () => {
  const referenceDate = '2024-06-01';
  // Two files, same commit count, same lastDate → identical score.
  const date = '2024-05-01';

  const commits: Commit[] = [
    makeCommit(date, [{ path: 'src/zebra.ts' }], { hash: 'z1' }),
    makeCommit(date, [{ path: 'src/alpha.ts' }], { hash: 'a1' }),
  ];

  const result = computeHotspots(commits, referenceDate);

  assert.equal(result.length, 2);
  assert.ok(
    Math.abs(result[0].score - result[1].score) < 1e-10,
    'scores should be equal for tie-break test',
  );
  assert.equal(result[0].file, 'src/alpha.ts', 'alphabetically first path should appear first on tie');
  assert.equal(result[1].file, 'src/zebra.ts');
});

// ---------------------------------------------------------------------------
// AC3: Empty input → empty array, no error
// ---------------------------------------------------------------------------

test('AC3: empty Commit[] returns empty array without throwing', () => {
  const result = computeHotspots([], '2024-01-01');
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// AC4: Single commit → one HotspotEntry with score > 0 and commits: 1
// ---------------------------------------------------------------------------

test('AC4: single commit for a file returns one entry with score > 0 and commits: 1', () => {
  const referenceDate = '2024-06-01';
  const commits: Commit[] = [
    makeCommit('2024-05-15', [{ path: 'src/feature.ts' }]),
  ];

  const result = computeHotspots(commits, referenceDate);

  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'src/feature.ts');
  assert.equal(result[0].commits, 1);
  assert.ok(result[0].score > 0, `score should be > 0, got ${result[0].score}`);
});

// ---------------------------------------------------------------------------
// AC5: Negative daysSince (referenceDate < lastDate) → clamp to 0, no crash
// ---------------------------------------------------------------------------

test('AC5: referenceDate before lastDate clamps daysSince to 0, no crash, score > 0', () => {
  // lastDate is in the future relative to referenceDate.
  const lastDate = '2024-12-31';
  const referenceDate = '2024-01-01'; // earlier than lastDate → daysSince would be negative

  const commits: Commit[] = [
    makeCommit(lastDate, [{ path: 'src/future.ts' }]),
  ];

  let result: ReturnType<typeof computeHotspots>;
  assert.doesNotThrow(() => {
    result = computeHotspots(commits, referenceDate);
  });

  // With daysSince clamped to 0: score = 1 / (0 + 1) = 1
  assert.equal(result!.length, 1);
  assert.ok(result![0].score > 0, `score should be > 0 when clamped, got ${result![0].score}`);
  assert.equal(result![0].score, 1, 'clamped daysSince=0 → score = commits / 1 = 1');
});

// ---------------------------------------------------------------------------
// Additional: lastDate stored correctly on returned entry
// ---------------------------------------------------------------------------

test('returned HotspotEntry.lastDate reflects the most recent commit date', () => {
  const referenceDate = '2024-06-01';
  const commits: Commit[] = [
    makeCommit('2024-01-01', [{ path: 'src/a.ts' }], { hash: 'c1' }),
    makeCommit('2024-05-20', [{ path: 'src/a.ts' }], { hash: 'c2' }),
    makeCommit('2024-03-10', [{ path: 'src/a.ts' }], { hash: 'c3' }),
  ];

  const result = computeHotspots(commits, referenceDate);

  assert.equal(result.length, 1);
  assert.equal(result[0].lastDate, '2024-05-20', 'lastDate should be the most recent commit date');
  assert.equal(result[0].commits, 3);
});

// ---------------------------------------------------------------------------
// Additional: multiple files — correct ordering with different commit counts
// and dates
// ---------------------------------------------------------------------------

test('files with more commits score higher when lastDate is equal', () => {
  const referenceDate = '2024-06-01';
  const date = '2024-05-01';

  const commits: Commit[] = [
    makeCommit(date, [{ path: 'src/busy.ts' }], { hash: 'b1' }),
    makeCommit(date, [{ path: 'src/busy.ts' }], { hash: 'b2' }),
    makeCommit(date, [{ path: 'src/busy.ts' }], { hash: 'b3' }),
    makeCommit(date, [{ path: 'src/quiet.ts' }], { hash: 'q1' }),
  ];

  const result = computeHotspots(commits, referenceDate);

  assert.equal(result.length, 2);
  assert.equal(result[0].file, 'src/busy.ts', 'higher commit count → higher score → appears first');
  assert.equal(result[0].commits, 3);
  assert.equal(result[1].file, 'src/quiet.ts');
  assert.equal(result[1].commits, 1);
  assert.ok(result[0].score > result[1].score);
});
