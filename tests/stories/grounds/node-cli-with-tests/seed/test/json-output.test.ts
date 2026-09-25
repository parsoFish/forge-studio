/**
 * Unit tests for --json flag and serializeSummary.
 *
 * Quality gate for WI-1 (INIT-2026-06-21-json-output-flag).
 * Covers AC1, AC2, AC3, AC4, AC5.
 *
 * Run:
 *   node --experimental-strip-types --test test/json-output.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { runCli } from '../src/cli.ts';
import { serializeSummary } from '../src/format.ts';
import { summarize } from '../src/stats.ts';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Commit for use in tests. */
const makeCommit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 5,
  deletions: 2,
  files: [],
  ...over,
});

/**
 * Fake io.readCommits — returns a copy of the provided commits array.
 * Throws if instructed (for error-path tests).
 */
const stubIo = (commits: readonly Commit[]) => ({
  readCommits: (_path: string): Commit[] => [...commits],
});

const throwingIo = (message: string) => ({
  readCommits: (_path: string): never => {
    throw new Error(message);
  },
});

/** A sentinel set of commits with 3 distinct authors. */
function threeAuthorCommits(): Commit[] {
  return [
    makeCommit({ author: 'Alice', date: '2023-01-10', insertions: 10, deletions: 2 }),
    makeCommit({ author: 'Alice', date: '2023-02-15', insertions: 5, deletions: 1 }),
    makeCommit({ author: 'Bob',   date: '2023-03-01', insertions: 3, deletions: 0 }),
    makeCommit({ author: 'Carol', date: '2023-04-20', insertions: 1, deletions: 1 }),
  ];
}

/** Expected JSON top-level keys per the initiative spec. */
const EXPECTED_KEYS = [
  'totalCommits',
  'firstDate',
  'lastDate',
  'byAuthor',
  'authorChurn',
  'fileChurn',
  'ownershipEntries',
  'hotspotEntries',
] as const;

// ---------------------------------------------------------------------------
// AC5: serializeSummary — pure unit test
// ---------------------------------------------------------------------------

test('AC5: serializeSummary returns valid JSON with all required top-level keys', () => {
  const commits = threeAuthorCommits();
  const summary = summarize(commits);
  const json = serializeSummary(summary);

  // Must be valid JSON
  const parsed = JSON.parse(json);

  // All required top-level keys must be present
  for (const key of EXPECTED_KEYS) {
    assert.ok(key in parsed, `Missing key: ${key}`);
  }

  // Verify sentinel values
  assert.equal(parsed.totalCommits, 4);
  assert.equal(parsed.firstDate, '2023-01-10');
  assert.equal(parsed.lastDate, '2023-04-20');
  assert.ok(Array.isArray(parsed.byAuthor), 'byAuthor must be an array');
  assert.ok(Array.isArray(parsed.authorChurn), 'authorChurn must be an array');
  assert.ok(Array.isArray(parsed.fileChurn), 'fileChurn must be an array');
  assert.ok(Array.isArray(parsed.ownershipEntries), 'ownershipEntries must be an array');
  assert.ok(Array.isArray(parsed.hotspotEntries), 'hotspotEntries must be an array');
});

test('AC5: serializeSummary output is round-trip stable (JSON.parse → JSON.stringify)', () => {
  const summary = summarize(threeAuthorCommits());
  const json = serializeSummary(summary);
  const reparsed = JSON.parse(json);
  // Re-serialising with the same indent must yield the same string
  assert.equal(json, JSON.stringify(reparsed, null, 2));
});

// ---------------------------------------------------------------------------
// AC1: --json happy path — exit 0, valid JSON, all keys present, stderr empty
// ---------------------------------------------------------------------------

test('AC1: --json exits 0 and stdout is valid JSON', () => {
  const result = runCli(['--json', '/repo'], stubIo(threeAuthorCommits()));
  assert.equal(result.code, 0, 'code must be 0');
  assert.equal(result.stderr, '', 'stderr must be empty');
  // Must be parseable
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed !== null, 'parsed must be non-null');
});

test('AC1: --json stdout JSON carries all required top-level keys', () => {
  const result = runCli(['--json', '/repo'], stubIo(threeAuthorCommits()));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  for (const key of EXPECTED_KEYS) {
    assert.ok(key in parsed, `Missing key in JSON output: ${key}`);
  }
});

test('AC1: --json stdout totalCommits matches fixture', () => {
  const commits = threeAuthorCommits();
  const result = runCli(['--json', '/repo'], stubIo(commits));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.totalCommits, commits.length);
});

test('AC1: --json stdout firstDate and lastDate are sentinel values from fixture', () => {
  const result = runCli(['--json', '/repo'], stubIo(threeAuthorCommits()));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.firstDate, '2023-01-10');
  assert.equal(parsed.lastDate, '2023-04-20');
});

test('AC1: --json does not leak table output to stderr', () => {
  const result = runCli(['--json', '/repo'], stubIo(threeAuthorCommits()));
  assert.equal(result.stderr, '');
});

// ---------------------------------------------------------------------------
// AC2: --json with a throwing reader — exit 1, stdout empty, stderr has message
// ---------------------------------------------------------------------------

test('AC2: --json with throwing reader exits 1', () => {
  const result = runCli(['--json', '/repo'], throwingIo('not a git repository'));
  assert.equal(result.code, 1);
});

test('AC2: --json with throwing reader has empty stdout', () => {
  const result = runCli(['--json', '/repo'], throwingIo('not a git repository'));
  assert.equal(result.stdout, '');
});

test('AC2: --json with throwing reader carries the error message in stderr', () => {
  const result = runCli(['--json', '/repo'], throwingIo('not a git repository'));
  assert.match(result.stderr, /not a git repository/);
});

test('AC2: --json error behaviour matches non-json error behaviour', () => {
  const withJson    = runCli(['--json', '/repo'], throwingIo('boom'));
  const withoutJson = runCli(['/repo'],           throwingIo('boom'));
  assert.equal(withJson.code,   withoutJson.code);
  assert.equal(withJson.stdout, withoutJson.stdout);
  assert.equal(withJson.stderr, withoutJson.stderr);
});

// ---------------------------------------------------------------------------
// AC3: --json --frobnicate — exit 2, stderr /unknown option/, stdout empty
// ---------------------------------------------------------------------------

test('AC3: --json --frobnicate exits 2', () => {
  const result = runCli(['--json', '--frobnicate'], stubIo([]));
  assert.equal(result.code, 2);
});

test('AC3: --json --frobnicate stderr matches /unknown option/', () => {
  const result = runCli(['--json', '--frobnicate'], stubIo([]));
  assert.match(result.stderr, /unknown option/);
});

test('AC3: --json --frobnicate stdout is empty', () => {
  const result = runCli(['--json', '--frobnicate'], stubIo([]));
  assert.equal(result.stdout, '');
});

// Also test the reversed order: --frobnicate before --json
test('AC3: --frobnicate --json also exits 2 with /unknown option/', () => {
  const result = runCli(['--frobnicate', '--json'], stubIo([]));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option/);
  assert.equal(result.stdout, '');
});

// ---------------------------------------------------------------------------
// AC4: --json --top 2 with 3-author fixture — arrays capped at 2
// ---------------------------------------------------------------------------

test('AC4: --json --top 2 byAuthor has exactly 2 entries', () => {
  const result = runCli(['--json', '--top', '2', '/repo'], stubIo(threeAuthorCommits()));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.byAuthor.length, 2, 'byAuthor must have exactly 2 entries');
});

test('AC4: --json --top 2 authorChurn has exactly 2 entries', () => {
  const result = runCli(['--json', '--top', '2', '/repo'], stubIo(threeAuthorCommits()));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.authorChurn.length, 2, 'authorChurn must have exactly 2 entries');
});

test('AC4: --json --top 2 fileChurn has at most 2 entries', () => {
  const result = runCli(['--json', '--top', '2', '/repo'], stubIo(threeAuthorCommits()));
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.fileChurn.length <= 2, `fileChurn must have at most 2 entries, got ${parsed.fileChurn.length}`);
});

test('AC4: --json --top 2 hotspotEntries has at most 2 entries', () => {
  const result = runCli(['--json', '--top', '2', '/repo'], stubIo(threeAuthorCommits()));
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.hotspotEntries.length <= 2, `hotspotEntries must have at most 2 entries, got ${parsed.hotspotEntries.length}`);
});

test('AC4: --json --top 2 ownershipEntries has at most 2 entries', () => {
  const result = runCli(['--json', '--top', '2', '/repo'], stubIo(threeAuthorCommits()));
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.ownershipEntries.length <= 2, `ownershipEntries must have at most 2 entries, got ${parsed.ownershipEntries.length}`);
});

test('AC4: --json --top 2 with file-bearing commits caps fileChurn to 2', () => {
  // Use commits that include file paths so fileChurn is non-empty.
  const commits: Commit[] = [
    makeCommit({ author: 'Alice', date: '2023-01-01', files: [{ path: 'a.ts', insertions: 5, deletions: 0 }] }),
    makeCommit({ author: 'Alice', date: '2023-01-02', files: [{ path: 'b.ts', insertions: 3, deletions: 1 }] }),
    makeCommit({ author: 'Bob',   date: '2023-01-03', files: [{ path: 'c.ts', insertions: 2, deletions: 2 }] }),
    makeCommit({ author: 'Carol', date: '2023-01-04', files: [{ path: 'd.ts', insertions: 1, deletions: 0 }] }),
  ];
  const result = runCli(['--json', '--top', '2', '/repo'], stubIo(commits));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.fileChurn.length <= 2, `fileChurn must be capped at 2, got ${parsed.fileChurn.length}`);
  assert.ok(parsed.hotspotEntries.length <= 2, `hotspotEntries must be capped at 2, got ${parsed.hotspotEntries.length}`);
});

// ---------------------------------------------------------------------------
// Regression: plain (non-json) output is unaffected
// ---------------------------------------------------------------------------

test('without --json flag, stdout is still a human-readable table', () => {
  const result = runCli(['/repo'], stubIo(threeAuthorCommits()));
  assert.equal(result.code, 0);
  // Plain-text output starts with "gitpulse —"
  assert.match(result.stdout, /^gitpulse —/);
  // Must not be valid JSON
  assert.throws(() => JSON.parse(result.stdout), 'plain output should not be valid JSON');
});
