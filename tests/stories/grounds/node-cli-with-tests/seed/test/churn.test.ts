/**
 * Unit suite for src/churn.ts — computeChurn().
 *
 * Fast, deterministic, creds-free, < 1 s. No git spawning: all fixtures are
 * hand-built Commit[] arrays.
 *
 * Quality gate: node --import tsx --test test/churn.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { computeChurn } from '../src/churn.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal Commit with the given per-file entries. */
function makeCommit(
  files: Array<{ path: string; insertions: number; deletions: number }>,
  overrides: Partial<Omit<Commit, 'files'>> = {},
): Commit {
  const ins = files.reduce((s, f) => s + f.insertions, 0);
  const del = files.reduce((s, f) => s + f.deletions, 0);
  return {
    hash: 'deadbeef',
    author: 'Alice',
    date: '2021-03-01',
    parentCount: 1,
    authorEmail: '',
    filesChanged: files.length,
    insertions: ins,
    deletions: del,
    files,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC4: empty input → empty array
// ---------------------------------------------------------------------------

test('AC4: empty Commit[] returns empty array without throwing', () => {
  const result = computeChurn([]);
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// Basic sort: descending by total lines changed
// ---------------------------------------------------------------------------

test('sorts by total lines changed descending', () => {
  const commits = [
    makeCommit([{ path: 'src/small.ts', insertions: 1, deletions: 0 }]),
    makeCommit([{ path: 'src/big.ts', insertions: 50, deletions: 20 }]),
    makeCommit([{ path: 'src/medium.ts', insertions: 10, deletions: 5 }]),
  ];
  const result = computeChurn(commits);
  assert.equal(result[0].file, 'src/big.ts');
  assert.equal(result[1].file, 'src/medium.ts');
  assert.equal(result[2].file, 'src/small.ts');
});

// ---------------------------------------------------------------------------
// AC1: tie-break by lexically ascending file path
// ---------------------------------------------------------------------------

test('AC1: ties in total lines changed break by lexically ascending file path', () => {
  // Both files have exactly insertions=5 + deletions=0 = 5 total lines.
  const commits = [
    makeCommit([{ path: 'src/zebra.ts', insertions: 5, deletions: 0 }]),
    makeCommit([{ path: 'src/alpha.ts', insertions: 3, deletions: 2 }]),
  ];
  const result = computeChurn(commits);
  assert.equal(result.length, 2);
  assert.equal(result[0].file, 'src/alpha.ts', 'lexically smaller path should sort first');
  assert.equal(result[1].file, 'src/zebra.ts');
});

// ---------------------------------------------------------------------------
// AC2: binary files (insertions=0 deletions=0 in CommitFile)
// ---------------------------------------------------------------------------

test('AC2: binary file appears with insertions=0, deletions=0, commits=1', () => {
  // Binary numstat (`-`) is already normalised to 0 by parseLog.
  // We simulate that by providing insertions=0, deletions=0.
  const commits = [
    makeCommit([{ path: 'assets/logo.png', insertions: 0, deletions: 0 }]),
  ];
  const result = computeChurn(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'assets/logo.png');
  assert.equal(result[0].insertions, 0);
  assert.equal(result[0].deletions, 0);
  assert.equal(result[0].commits, 1);
});

test('AC2: binary file alongside text files — binary appears but at the bottom', () => {
  const commits = [
    makeCommit([
      { path: 'src/main.ts', insertions: 10, deletions: 2 },
      { path: 'assets/logo.png', insertions: 0, deletions: 0 },
    ]),
  ];
  const result = computeChurn(commits);
  assert.equal(result.length, 2);
  assert.equal(result[0].file, 'src/main.ts');
  assert.equal(result[1].file, 'assets/logo.png');
  assert.equal(result[1].commits, 1);
  assert.equal(result[1].insertions, 0);
  assert.equal(result[1].deletions, 0);
});

// ---------------------------------------------------------------------------
// AC3: renamed files — path is already normalised by parseLog
// ---------------------------------------------------------------------------

test('AC3: renamed file is counted under the new path', () => {
  // parseLog normalises `src/{old.ts => new.ts}` → `src/new.ts`.
  // We simulate that: the CommitFile already carries the resolved new path.
  const commits = [
    makeCommit([{ path: 'src/new.ts', insertions: 8, deletions: 3 }]),
  ];
  const result = computeChurn(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'src/new.ts');
  assert.equal(result[0].insertions, 8);
  assert.equal(result[0].deletions, 3);
  assert.equal(result[0].commits, 1);
});

test('AC3: renamed file across two commits aggregates under the new path', () => {
  // A file renamed in commit 1, then modified again in commit 2 (already at new path).
  const commits = [
    makeCommit([{ path: 'src/new.ts', insertions: 8, deletions: 3 }]),
    makeCommit([{ path: 'src/new.ts', insertions: 2, deletions: 1 }]),
  ];
  const result = computeChurn(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'src/new.ts');
  assert.equal(result[0].insertions, 10);
  assert.equal(result[0].deletions, 4);
  assert.equal(result[0].commits, 2);
});

// ---------------------------------------------------------------------------
// Aggregation across commits
// ---------------------------------------------------------------------------

test('aggregates insertions, deletions, and commits across multiple commits', () => {
  const commits = [
    makeCommit([{ path: 'src/a.ts', insertions: 10, deletions: 2 }]),
    makeCommit([{ path: 'src/a.ts', insertions: 5, deletions: 1 }]),
    makeCommit([{ path: 'src/b.ts', insertions: 3, deletions: 0 }]),
  ];
  const result = computeChurn(commits);
  const a = result.find((r) => r.file === 'src/a.ts');
  const b = result.find((r) => r.file === 'src/b.ts');
  assert.ok(a, 'src/a.ts should be in results');
  assert.equal(a!.insertions, 15);
  assert.equal(a!.deletions, 3);
  assert.equal(a!.commits, 2);
  assert.ok(b, 'src/b.ts should be in results');
  assert.equal(b!.insertions, 3);
  assert.equal(b!.deletions, 0);
  assert.equal(b!.commits, 1);
});

// ---------------------------------------------------------------------------
// Immutability: input is not mutated
// ---------------------------------------------------------------------------

test('does not mutate the input array', () => {
  const commits = [
    makeCommit([{ path: 'src/a.ts', insertions: 5, deletions: 0 }]),
    makeCommit([{ path: 'src/b.ts', insertions: 10, deletions: 3 }]),
  ];
  const original = commits.map((c) => ({ ...c }));
  computeChurn(commits);
  assert.equal(commits.length, original.length);
  assert.equal(commits[0].hash, original[0].hash);
  assert.equal(commits[1].hash, original[1].hash);
});
