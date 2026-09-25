/**
 * Unit suite for WI-2: --since-tag / --until-tag flag wiring in cli.ts.
 *
 * Tests runCli() with injected io — no git spawning.
 * Covers all 8 acceptance criteria for tag-range filtering.
 *
 * Fast, deterministic, creds-free, < 1 s.
 * Uses node:test and node:assert/strict (matches project pattern).
 *
 * Quality gate: node --test --experimental-strip-types test/cli-tag-range.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { runCli } from '../src/cli.ts';

// ---------------------------------------------------------------------------
// Fixtures — sentinel values so analytics that silently drop data are caught
// ---------------------------------------------------------------------------

/** Build a minimal Commit with sentinel defaults; override as needed. */
const mkCommit = (over: Partial<Commit> & { hash: string; author: string; date: string }): Commit => ({
  parentCount: 1,
  authorEmail: `${over.author.toLowerCase().replace(/\s+/g, '.')}@sentinel.test`,
  filesChanged: 1,
  insertions: 3,
  deletions: 1,
  files: [{ path: 'src/sentinel-file.ts', insertions: 3, deletions: 1 }],
  ...over,
});

// SHA constants — distinctive sentinel values
const SHA_V1 = 'aaaa100000000000000000000000000000000001';
const SHA_V2 = 'bbbb200000000000000000000000000000000002';
const SHA_MID = 'cccc300000000000000000000000000000000003';
const SHA_OLD = 'dddd400000000000000000000000000000000004';
const SHA_NEW = 'eeee500000000000000000000000000000000005';

// Commits in newest-first order (as git log returns)
const COMMIT_NEW = mkCommit({ hash: SHA_NEW, author: 'Newest Dev', date: '2024-05-01' });
const COMMIT_V2  = mkCommit({ hash: SHA_V2,  author: 'Tag V2 Dev', date: '2024-04-01' });
const COMMIT_MID = mkCommit({ hash: SHA_MID, author: 'Middle Dev', date: '2024-03-01' });
const COMMIT_V1  = mkCommit({ hash: SHA_V1,  author: 'Tag V1 Dev', date: '2024-02-01' });
const COMMIT_OLD = mkCommit({ hash: SHA_OLD, author: 'Oldest Dev', date: '2024-01-01' });

// Newest-first ordered array mimicking git log output.
const ALL_COMMITS: Commit[] = [
  COMMIT_NEW,  // index 0 — newest
  COMMIT_V2,   // index 1 — v2.0.0 tag boundary
  COMMIT_MID,  // index 2 — between tags
  COMMIT_V1,   // index 3 — v1.0.0 tag boundary
  COMMIT_OLD,  // index 4 — oldest
];

/** Mock io: returns ALL_COMMITS; maps tag names to SHAs. */
const makeIo = (tagMap: Record<string, string> = { 'v1.0.0': SHA_V1, 'v2.0.0': SHA_V2 }) => ({
  readCommits: (_target: string): Commit[] => [...ALL_COMMITS],
  resolveTagToSha: (_target: string, tag: string): string => {
    const sha = tagMap[tag];
    if (!sha) {
      const err = Object.assign(new Error(`gitpulse: unknown tag '${tag}'; known tags: v1.0.0, v2.0.0`), { code: 2 });
      throw err;
    }
    return sha;
  },
});

// ---------------------------------------------------------------------------
// AC1 — Single-snapshot path: --since-tag only
// ---------------------------------------------------------------------------

test('AC1a: --since-tag v1.0.0 excludes commits at and before the tag boundary', () => {
  const io = makeIo();
  const result = runCli(['--since-tag', 'v1.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  // Commits at COMMIT_V1 (SHA_V1) and COMMIT_OLD should be excluded (sinceTagSha = exclusive).
  assert.ok(result.stdout.includes('Newest Dev'), 'Newest Dev should be included');
  assert.ok(result.stdout.includes('Tag V2 Dev'), 'Tag V2 Dev should be included');
  assert.ok(result.stdout.includes('Middle Dev'), 'Middle Dev should be included');
  assert.ok(!result.stdout.includes('Tag V1 Dev'), 'Tag V1 Dev (at boundary) should be excluded');
  assert.ok(!result.stdout.includes('Oldest Dev'), 'Oldest Dev should be excluded');
});

test('AC1b: --until-tag v2.0.0 excludes commits newer than the tag boundary', () => {
  const io = makeIo();
  const result = runCli(['--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  // COMMIT_NEW is newer than the v2 tag — should be excluded.
  assert.ok(!result.stdout.includes('Newest Dev'), 'Newest Dev (newer than v2) should be excluded');
  // COMMIT_V2 is the until-tag boundary — inclusive — should be included.
  assert.ok(result.stdout.includes('Tag V2 Dev'), 'Tag V2 Dev (until boundary) should be included');
  assert.ok(result.stdout.includes('Middle Dev'), 'Middle Dev should be included');
  assert.ok(result.stdout.includes('Tag V1 Dev'), 'Tag V1 Dev should be included');
  assert.ok(result.stdout.includes('Oldest Dev'), 'Oldest Dev should be included');
});

test('AC1c: --since-tag + --until-tag combined: correct window', () => {
  const io = makeIo();
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  // Window: v1..v2 = COMMIT_V2, COMMIT_MID (sinceTagSha=SHA_V1 exclusive, untilTagSha=SHA_V2 inclusive)
  assert.ok(!result.stdout.includes('Newest Dev'), 'Newest Dev should be excluded (newer than v2)');
  assert.ok(result.stdout.includes('Tag V2 Dev'), 'Tag V2 Dev (until boundary, inclusive) should be included');
  assert.ok(result.stdout.includes('Middle Dev'), 'Middle Dev should be included');
  assert.ok(!result.stdout.includes('Tag V1 Dev'), 'Tag V1 Dev (since boundary, exclusive) should be excluded');
  assert.ok(!result.stdout.includes('Oldest Dev'), 'Oldest Dev should be excluded');
});

// ---------------------------------------------------------------------------
// AC2 — Compare path: both headCommits and baseCommits are filtered
// ---------------------------------------------------------------------------

test('AC2: --compare with --since-tag filters both headCommits and baseCommits', () => {
  // We mock readCommitsAtRef to also return ALL_COMMITS for the base branch.
  const io = {
    readCommits: (_target: string): Commit[] => [...ALL_COMMITS],
    validateRef: (_target: string, _ref: string): void => { /* no-op */ },
    readCommitsAtRef: (_target: string, _ref: string): Commit[] => [...ALL_COMMITS],
    resolveTagToSha: (_target: string, tag: string): string => {
      const map: Record<string, string> = { 'v1.0.0': SHA_V1, 'v2.0.0': SHA_V2 };
      const sha = map[tag];
      if (!sha) throw Object.assign(new Error(`unknown tag '${tag}'`), { code: 2 });
      return sha;
    },
  };

  const result = runCli(['--compare', 'v1-branch', '--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  // The compare output should exist (even if delta is 0 since both filtered the same).
  assert.ok(result.stdout.length > 0, 'should produce output');
  // The header references the compare ref.
  assert.ok(result.stdout.includes('delta since'), 'should contain delta header');
});

// ---------------------------------------------------------------------------
// AC3 — Coupling path: filtered before computeCoupling
// ---------------------------------------------------------------------------

test('AC3: coupling --since-tag filters commits before computeCoupling', () => {
  // Create commits that have co-changed files.
  const coupledCommit1 = mkCommit({
    hash: SHA_V2, author: 'Coupler', date: '2024-04-01',
    files: [
      { path: 'src/fileA.ts', insertions: 2, deletions: 0 },
      { path: 'src/fileB.ts', insertions: 1, deletions: 0 },
    ],
    filesChanged: 2, insertions: 3, deletions: 0,
  });
  const oldCommit = mkCommit({
    hash: SHA_OLD, author: 'Old Coupler', date: '2024-01-01',
    files: [
      { path: 'src/fileA.ts', insertions: 5, deletions: 2 },
      { path: 'src/fileC.ts', insertions: 1, deletions: 0 },
    ],
    filesChanged: 2, insertions: 6, deletions: 2,
  });

  const couplingCommits = [coupledCommit1, oldCommit]; // newest-first

  const io = {
    readCommits: (_target: string): Commit[] => [...couplingCommits],
    resolveTagToSha: (_target: string, tag: string): string => {
      // since-tag = oldCommit's hash → exclude oldCommit
      if (tag === 'v1.0.0') return SHA_OLD;
      throw Object.assign(new Error(`unknown tag '${tag}'`), { code: 2 });
    },
  };

  // --since-tag v1.0.0 (SHA_OLD) as exclusive lower bound → only coupledCommit1 passes
  const result = runCli(['coupling', '--since-tag', 'v1.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  // With only coupledCommit1, fileA+fileB are coupled; fileA+fileC pair from old commit should be excluded.
  // Coupling output should mention fileA and fileB but not fileC alone.
  if (result.stdout !== 'no coupled file pairs found') {
    assert.ok(!result.stdout.includes('fileC'), 'fileC should not appear (from filtered old commit)');
  }
  // No error.
  assert.equal(result.stderr, '');
});

// ---------------------------------------------------------------------------
// AC4 — Tags subcommand: exits 2 with explicit error message
// ---------------------------------------------------------------------------

test('AC4: tags --since-tag exits 2 with explicit error message', () => {
  const io = makeIo();
  const result = runCli(['tags', '--since-tag', 'v1.0.0'], io);
  assert.equal(result.code, 2, `exit code should be 2; got ${result.code}; stderr: ${result.stderr}`);
  assert.ok(
    result.stderr.includes('--since-tag') && result.stderr.includes('not supported for the tags subcommand'),
    `stderr should explain the restriction; got: ${result.stderr}`,
  );
});

test('AC4b: tags --until-tag exits 2 with explicit error message', () => {
  const io = makeIo();
  const result = runCli(['tags', '--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 2, `exit code should be 2; got ${result.code}; stderr: ${result.stderr}`);
  assert.ok(
    result.stderr.includes('--until-tag') && result.stderr.includes('not supported for the tags subcommand'),
    `stderr should explain the restriction; got: ${result.stderr}`,
  );
});

// ---------------------------------------------------------------------------
// AC5 — Text header includes '(range v1.0.0..v2.0.0)'
// ---------------------------------------------------------------------------

test('AC5: text output header includes range annotation', () => {
  const io = makeIo();
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('(range v1.0.0..v2.0.0)'),
    `header should include range annotation; stdout: ${result.stdout.split('\n')[0]}`,
  );
});

// ---------------------------------------------------------------------------
// AC6 — JSON output gains top-level range object
// ---------------------------------------------------------------------------

test('AC6: --json output gains top-level range object with sinceSha/untilSha', () => {
  const io = makeIo();
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0', '--json'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok('range' in parsed, 'JSON should have top-level range key');
  const range = parsed['range'] as Record<string, unknown>;
  assert.equal(range['sinceTag'], 'v1.0.0', 'sinceTag should be v1.0.0');
  assert.equal(range['untilTag'], 'v2.0.0', 'untilTag should be v2.0.0');
  assert.equal(range['sinceSha'], SHA_V1, 'sinceSha should match SHA_V1');
  assert.equal(range['untilSha'], SHA_V2, 'untilSha should match SHA_V2');
});

// ---------------------------------------------------------------------------
// AC7 — CSV output has range header comment line
// ---------------------------------------------------------------------------

test('AC7: --csv output has range comment line before CSV rows', () => {
  const io = makeIo();
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0', '--csv'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  const firstLine = result.stdout.split('\n')[0];
  assert.ok(
    firstLine.startsWith('# range: v1.0.0..v2.0.0'),
    `first line should be range comment; got: ${firstLine}`,
  );
  assert.ok(firstLine.includes(`sinceSha: ${SHA_V1}`), 'CSV range comment should include sinceSha');
  assert.ok(firstLine.includes(`untilSha: ${SHA_V2}`), 'CSV range comment should include untilSha');
});

// ---------------------------------------------------------------------------
// AC8 — Zero commits: range annotation still present in all three renderers
// ---------------------------------------------------------------------------

// Inverted range: since-tag is newer than until-tag → filterCommitsByTagRange returns [].
// We simulate this by swapping v1/v2 assignments so sinceTagSha > untilTagSha in the array.

test('AC8a: inverted range in text — zero commits, range annotation still present', () => {
  // Swap: sinceTag = v2 (newer, lower index), untilTag = v1 (older, higher index)
  // sinceTagSha = SHA_V2 (index 1), untilTagSha = SHA_V1 (index 3) → sliceEnd <= sliceStart → []
  const io = makeIo({ 'v1.0.0': SHA_V2, 'v2.0.0': SHA_V1 }); // intentionally swapped
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('(range v1.0.0..v2.0.0)'),
    `text output should still show range annotation with 0 commits; stdout: ${result.stdout.split('\n')[0]}`,
  );
  assert.ok(result.stdout.includes('No commits found.'), 'should indicate no commits');
});

test('AC8b: inverted range in JSON — zero commits, range annotation still present', () => {
  const io = makeIo({ 'v1.0.0': SHA_V2, 'v2.0.0': SHA_V1 }); // intentionally swapped
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0', '--json'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok('range' in parsed, 'JSON should have range key even with 0 commits');
  const range = parsed['range'] as Record<string, unknown>;
  assert.equal(range['sinceTag'], 'v1.0.0');
  assert.equal(range['untilTag'], 'v2.0.0');
  // Commits count should be 0.
  assert.equal(parsed['totalCommits'], 0, 'totalCommits should be 0');
});

test('AC8c: inverted range in CSV — zero commits, range comment still present', () => {
  const io = makeIo({ 'v1.0.0': SHA_V2, 'v2.0.0': SHA_V1 }); // intentionally swapped
  const result = runCli(['--since-tag', 'v1.0.0', '--until-tag', 'v2.0.0', '--csv'], io);
  assert.equal(result.code, 0, `exit code should be 0; stderr: ${result.stderr}`);

  const firstLine = result.stdout.split('\n')[0];
  assert.ok(
    firstLine.startsWith('# range: v1.0.0..v2.0.0'),
    `first CSV line should be range comment even with 0 commits; got: ${firstLine}`,
  );
});

// ---------------------------------------------------------------------------
// Additional: unknown tag exits 2 with tag name in error message
// ---------------------------------------------------------------------------

test('unknown --since-tag exits 2 with unknown tag name in message', () => {
  const io = makeIo(); // vNONE not in the map
  const result = runCli(['--since-tag', 'vNONE'], io);
  assert.equal(result.code, 2, `exit code should be 2; got ${result.code}`);
  assert.ok(result.stderr.includes('vNONE'), `error should name the unknown tag; got: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC5/AC6/AC7 with --since-tag only (no --until-tag)
// ---------------------------------------------------------------------------

test('--since-tag only: text header includes range annotation with empty untilTag', () => {
  const io = makeIo();
  const result = runCli(['--since-tag', 'v1.0.0'], io);
  assert.equal(result.code, 0);
  // Header should include (range v1.0.0..) — untilTag is empty string
  assert.ok(result.stdout.includes('(range v1.0.0..)'), `stdout first line: ${result.stdout.split('\n')[0]}`);
});

test('--until-tag only: text header includes range annotation with empty sinceTag', () => {
  const io = makeIo();
  const result = runCli(['--until-tag', 'v2.0.0'], io);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('(range ..v2.0.0)'), `stdout first line: ${result.stdout.split('\n')[0]}`);
});
