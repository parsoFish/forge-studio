/**
 * Unit suite for WI-2: --no-merges flag wiring in cli.ts.
 *
 * Tests filterMergeCommits (pure function) and runCli() with injected io —
 * no git spawning.
 *
 * Fast, deterministic, creds-free, < 1 s.
 * Uses node:test and node:assert/strict (matches project pattern).
 *
 * Quality gate: node --test --experimental-strip-types test/no-merges-cli.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { runCli, filterMergeCommits } from '../src/cli.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a Commit with sentinel defaults; override as needed. */
const mkCommit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'aabbccddeeff0011aabbccddeeff0011aabbccdd',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 2,
  insertions: 5,
  deletions: 1,
  files: [{ path: 'src/sentinel.ts', insertions: 5, deletions: 1 }],
  ...over,
});

/** Initial commit (no parents). */
const COMMIT_INIT = mkCommit({ author: 'Alice Sentinel', date: '2021-03-01', parentCount: 0 });
/** Regular commit (1 parent). */
const COMMIT_REG  = mkCommit({ author: 'Bob Sentinel',   date: '2021-03-02', parentCount: 1 });
/** Merge commit (2 parents). */
const COMMIT_MERGE = mkCommit({ author: 'Carol Sentinel', date: '2021-03-03', parentCount: 2,
                                 hash: 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00' });

/** A mixed array with one of each parentCount: 0, 1, 2. */
const MIXED: readonly Commit[] = [COMMIT_INIT, COMMIT_REG, COMMIT_MERGE];

/** A merge-free array (all parentCount <= 1). */
const NO_MERGES: readonly Commit[] = [COMMIT_INIT, COMMIT_REG];

/** Minimal io stub — returns MIXED by default. */
const makeIo = (commits: readonly Commit[] = MIXED) => ({
  readCommits: (_path: string): Commit[] => [...commits],
});

// ---------------------------------------------------------------------------
// AC1 — filterMergeCommits pure function
// ---------------------------------------------------------------------------

test('AC1: filterMergeCommits — mix of parentCount 0, 1, 2 → only 0 and 1 survive', () => {
  const { filtered, excludedCount } = filterMergeCommits([...MIXED]);
  assert.equal(filtered.length, 2, 'should keep parentCount 0 and 1 commits');
  assert.equal(excludedCount, 1, 'should exclude 1 merge commit');
  assert.ok(filtered.every((c) => c.parentCount <= 1), 'all surviving commits have parentCount <= 1');
  assert.ok(!filtered.some((c) => c.parentCount > 1), 'no merge commits survive');
});

test('AC1: filterMergeCommits — excludedCount equals number with parentCount > 1', () => {
  const commits = [COMMIT_INIT, COMMIT_MERGE, COMMIT_MERGE, COMMIT_REG];
  const { excludedCount } = filterMergeCommits(commits);
  assert.equal(excludedCount, 2, 'two merge commits should be excluded');
});

test('AC1: filterMergeCommits — merge-free input: excludedCount === 0, length unchanged', () => {
  const { filtered, excludedCount } = filterMergeCommits([...NO_MERGES]);
  assert.equal(excludedCount, 0, 'merge-free array has no exclusions');
  assert.equal(filtered.length, NO_MERGES.length, 'output length matches input');
});

// ---------------------------------------------------------------------------
// AC2 — text output contains '(N merge commits excluded)' when N > 0
// ---------------------------------------------------------------------------

test('AC2: runCli --no-merges text output contains merge excluded annotation', () => {
  const io = makeIo(MIXED); // 1 merge commit
  const result = runCli(['--no-merges', '/repo'], io);
  assert.equal(result.code, 0);
  assert.ok(
    result.stdout.includes('(1 merge commits excluded)'),
    `Expected stdout to contain '(1 merge commits excluded)', got: ${result.stdout.slice(0, 200)}`,
  );
});

test('AC2: filter runs before summarize — merge author excluded from stats', () => {
  // Carol Sentinel only appears in COMMIT_MERGE (parentCount 2).
  // With --no-merges, Carol must not appear in the output.
  const io = makeIo(MIXED);
  const result = runCli(['--no-merges', '/repo'], io);
  assert.equal(result.code, 0);
  assert.ok(
    !result.stdout.includes('Carol Sentinel'),
    'Merge commit author (Carol Sentinel) should be excluded from output',
  );
});

// ---------------------------------------------------------------------------
// AC3 — --help output contains '--no-merges'
// ---------------------------------------------------------------------------

test('AC3: --help output contains --no-merges', () => {
  const io = makeIo();
  const result = runCli(['--help'], io);
  // --help returns code 0; text is in stderr (usage printed to stderr).
  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('--no-merges'),
    `Expected help output to contain '--no-merges', got: ${combined.slice(0, 300)}`,
  );
});

// ---------------------------------------------------------------------------
// AC4 — JSON output: mergesExcluded field present when --no-merges and N > 0;
//        absent when --no-merges is not passed.
// ---------------------------------------------------------------------------

test('AC4: --no-merges --json → JSON has mergesExcluded: 1', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--no-merges', '--json', '/repo'], io);
  assert.equal(result.code, 0);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(obj['mergesExcluded'], 1, 'mergesExcluded should be 1');
});

test('AC4: --json (no --no-merges) → JSON does NOT have mergesExcluded', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--json', '/repo'], io);
  assert.equal(result.code, 0);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(obj, 'mergesExcluded'),
    'mergesExcluded must be absent when --no-merges is not passed',
  );
});

test('AC4: --no-merges --json on merge-free repo → mergesExcluded absent (N=0)', () => {
  const io = makeIo(NO_MERGES);
  const result = runCli(['--no-merges', '--json', '/repo'], io);
  assert.equal(result.code, 0);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(obj, 'mergesExcluded'),
    'mergesExcluded must be absent when N=0 (no merges to exclude)',
  );
});

// ---------------------------------------------------------------------------
// AC5 — byte-identical output when no merge commits present
// ---------------------------------------------------------------------------

test('AC5: byte-identical text output with/without --no-merges when no merges present', () => {
  const io1 = makeIo(NO_MERGES);
  const io2 = makeIo(NO_MERGES);
  const withFlag    = runCli(['--no-merges', '/repo'], io1);
  const withoutFlag = runCli(['/repo'], io2);
  assert.equal(withFlag.code, 0);
  assert.equal(withoutFlag.code, 0);
  assert.equal(
    withFlag.stdout,
    withoutFlag.stdout,
    'output must be byte-identical when no merge commits exist',
  );
});

// ---------------------------------------------------------------------------
// AC6 — flags compose correctly
// ---------------------------------------------------------------------------

test('AC6: --no-merges composes with --since, --exclude, --sort → exit code 0', () => {
  const io = makeIo(MIXED);
  const result = runCli(
    ['--no-merges', '--since', '2021-03-01', '--exclude', 'dist/**', '--sort', 'commits:asc', '/repo'],
    io,
  );
  assert.equal(result.code, 0, `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`);
  // Output must be valid (non-empty or at least no error).
  assert.equal(result.stderr, '', `Unexpected stderr: ${result.stderr}`);
});

test('AC6: --no-merges --json --since --exclude compose correctly', () => {
  const io = makeIo(MIXED);
  const result = runCli(
    ['--no-merges', '--json', '--since', '2021-03-01', '--exclude', 'dist/**', '/repo'],
    io,
  );
  assert.equal(result.code, 0);
  // Must produce valid JSON.
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(typeof obj === 'object' && obj !== null, 'output must be valid JSON object');
});
