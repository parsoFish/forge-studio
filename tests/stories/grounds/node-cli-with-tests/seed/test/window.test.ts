/**
 * window.test.ts — date-window flag tests for `--since` / `--until` (WI-3).
 *
 * Tests the argv-boundary filtering added to runCli(). No git spawning —
 * uses a stubReader backed by WINDOW_FIXTURE, mirroring the pattern in
 * test/unit.test.ts.
 *
 * Gate: node --import tsx --test test/window.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { runCli } from '../src/cli.ts';

// ---------------------------------------------------------------------------
// Fixture — 7 commits spanning 2021-03-01 to 2021-03-07 on distinct dates.
// ---------------------------------------------------------------------------

const commit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  files: [],
  ...over,
});

/** Commits with distinct dates 2021-03-01 through 2021-03-07. */
const WINDOW_FIXTURE: readonly Commit[] = [
  commit({ author: 'Alice', date: '2021-03-01' }),
  commit({ author: 'Bob', date: '2021-03-02' }),
  commit({ author: 'Carol', date: '2021-03-03' }),
  commit({ author: 'Dave', date: '2021-03-04' }),
  commit({ author: 'Eve', date: '2021-03-05' }),
  commit({ author: 'Frank', date: '2021-03-06' }),
  commit({ author: 'Grace', date: '2021-03-07' }),
];

/** Build a stub reader that always returns the given commits. */
const stubReader = (commits: readonly Commit[]) =>
  (() => [...commits]) as unknown as typeof import('../src/git.ts').readCommits;

/** Extract the totalCommits count from rendered stdout. */
function totalCommitsFromOutput(stdout: string): number {
  const m = stdout.match(/(\d+) commits/);
  if (!m) throw new Error(`Could not parse commit count from: ${stdout}`);
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// AC1 — --since filters out commits before the given date (inclusive)
// ---------------------------------------------------------------------------

test('--since 2021-03-03 excludes commits before 2021-03-03', () => {
  const r = runCli(['--since', '2021-03-03'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  // Commits on 2021-03-03 through 2021-03-07 = 5 commits.
  assert.equal(totalCommitsFromOutput(r.stdout), 5);
});

test('--since 2021-03-03 includes the commit ON that date (inclusive lower bound)', () => {
  // Date 2021-03-03 itself must be included.
  const r = runCli(['--since', '2021-03-03'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0);
  // 7 total — 2 excluded (03-01, 03-02) = 5
  assert.equal(totalCommitsFromOutput(r.stdout), 5);
});

test('--since equal to the earliest commit date includes that commit', () => {
  const r = runCli(['--since', '2021-03-01'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0);
  assert.equal(totalCommitsFromOutput(r.stdout), 7); // all included
});

// ---------------------------------------------------------------------------
// AC2 — --until filters out commits after the given date (inclusive)
// ---------------------------------------------------------------------------

test('--until 2021-03-04 excludes commits after 2021-03-04', () => {
  const r = runCli(['--until', '2021-03-04'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  // Commits on 2021-03-01 through 2021-03-04 = 4 commits.
  assert.equal(totalCommitsFromOutput(r.stdout), 4);
});

test('--until includes the commit ON that date (inclusive upper bound)', () => {
  const r = runCli(['--until', '2021-03-07'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0);
  assert.equal(totalCommitsFromOutput(r.stdout), 7); // all included
});

// ---------------------------------------------------------------------------
// AC3 — combined --since and --until gives the intersection window
// ---------------------------------------------------------------------------

test('--since 2021-03-02 --until 2021-03-05 returns only the 4-day window', () => {
  const r = runCli(
    ['--since', '2021-03-02', '--until', '2021-03-05'],
    { readCommits: stubReader(WINDOW_FIXTURE) },
  );
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  // Commits on 03-02, 03-03, 03-04, 03-05 = 4 commits.
  assert.equal(totalCommitsFromOutput(r.stdout), 4);
});

test('--since and --until equal to same date returns exactly 1 commit', () => {
  const r = runCli(
    ['--since', '2021-03-04', '--until', '2021-03-04'],
    { readCommits: stubReader(WINDOW_FIXTURE) },
  );
  assert.equal(r.code, 0);
  assert.equal(totalCommitsFromOutput(r.stdout), 1);
});

// ---------------------------------------------------------------------------
// AC4 — invalid date format → exit 2 + stderr message
// ---------------------------------------------------------------------------

test('--since not-a-date exits with code 2', () => {
  const r = runCli(['--since', 'not-a-date'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.match(r.stderr, /invalid date/i);
});

test('--since 2021/03/03 (wrong separator) exits with code 2', () => {
  const r = runCli(['--since', '2021/03/03'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /invalid date/i);
});

test('--until banana exits with code 2', () => {
  const r = runCli(['--until', 'banana'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /invalid date/i);
});

// ---------------------------------------------------------------------------
// AC5 — since > until → exit 2 + stderr message about invalid window
// ---------------------------------------------------------------------------

test('--since 2021-03-10 --until 2021-03-01 (reversed) exits with code 2', () => {
  const r = runCli(
    ['--since', '2021-03-10', '--until', '2021-03-01'],
    { readCommits: stubReader(WINDOW_FIXTURE) },
  );
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.match(r.stderr, /invalid.*window|after.*until|since.*after/i);
});

// ---------------------------------------------------------------------------
// AC6 — no flags → all commits included (unchanged existing behaviour)
// ---------------------------------------------------------------------------

test('no --since / --until flags includes all commits', () => {
  const r = runCli([], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0);
  assert.equal(totalCommitsFromOutput(r.stdout), 7);
});

test('repo path with no date flags still works', () => {
  const r = runCli(['/some/repo'], { readCommits: stubReader(WINDOW_FIXTURE) });
  assert.equal(r.code, 0);
  assert.equal(totalCommitsFromOutput(r.stdout), 7);
});
