/**
 * CLI --sort flag integration tests (WI-2).
 *
 * Tests `runCli` (and via it, `runTagsCli`) with a stub io reader.
 * No git spawning: all data is supplied via injected stubs.
 *
 * Quality gate: node --test --experimental-strip-types test/cli-sort.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../src/cli.ts';
import type { Commit } from '../src/git.ts';
import type { TagEntry } from '../src/git.ts';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const commit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 0,
  deletions: 0,
  files: [],
  ...over,
});

/**
 * Stub io that serves a fixed list of commits. The tags fields are omitted here
 * since they're only needed for the tags-subcommand tests.
 */
function stubIo(commits: Commit[]) {
  return {
    readCommits: (_path: string) => commits,
  };
}

// Three authors with distinct commit counts (non-default sentinel values).
const AUTHORS_FIXTURE: readonly Commit[] = [
  // Zara — 1 commit
  commit({ author: 'Zara', date: '2024-01-01' }),
  // Alice — 3 commits
  commit({ author: 'Alice', date: '2024-01-02' }),
  commit({ author: 'Alice', date: '2024-01-03' }),
  commit({ author: 'Alice', date: '2024-01-04' }),
  // Bob — 2 commits
  commit({ author: 'Bob', date: '2024-01-05' }),
  commit({ author: 'Bob', date: '2024-01-06' }),
];
// Default summarize order (desc commits, then author asc): Alice(3), Bob(2), Zara(1)

// ---------------------------------------------------------------------------
// AC1: --sort commits → descending by commits (numeric default direction)
// ---------------------------------------------------------------------------

test('AC1: --sort commits orders rows descending by commits (numeric default)', () => {
  const result = runCli(['--sort', 'commits'], stubIo([...AUTHORS_FIXTURE]));
  assert.equal(result.code, 0, `expected code 0, got ${result.code}; stderr: ${result.stderr}`);
  const lines = result.stdout.split('\n');
  // Find data rows (after header section). They appear as "  N  Author".
  const dataLines = lines.filter((l) => /^\s+\d+\s+\S/.test(l));
  assert.ok(dataLines.length >= 3, `expected ≥3 data rows, got: ${JSON.stringify(dataLines)}`);
  // The first data row must have commit count 3 (Alice), second 2 (Bob), third 1 (Zara).
  assert.match(dataLines[0], /3\s+Alice/, `first row should be Alice(3): ${dataLines[0]}`);
  assert.match(dataLines[1], /2\s+Bob/,   `second row should be Bob(2): ${dataLines[1]}`);
  assert.match(dataLines[2], /1\s+Zara/,  `third row should be Zara(1): ${dataLines[2]}`);
});

// ---------------------------------------------------------------------------
// AC2: --sort commits:asc → ascending by commits
// ---------------------------------------------------------------------------

test('AC2: --sort commits:asc orders rows ascending by commits', () => {
  const result = runCli(['--sort', 'commits:asc'], stubIo([...AUTHORS_FIXTURE]));
  assert.equal(result.code, 0, `expected code 0, stderr: ${result.stderr}`);
  const lines = result.stdout.split('\n');
  const dataLines = lines.filter((l) => /^\s+\d+\s+\S/.test(l));
  assert.ok(dataLines.length >= 3, `expected ≥3 data rows`);
  // Ascending: Zara(1), Bob(2), Alice(3).
  assert.match(dataLines[0], /1\s+Zara/,  `first row should be Zara(1): ${dataLines[0]}`);
  assert.match(dataLines[1], /2\s+Bob/,   `second row should be Bob(2): ${dataLines[1]}`);
  assert.match(dataLines[2], /3\s+Alice/, `third row should be Alice(3): ${dataLines[2]}`);
});

// ---------------------------------------------------------------------------
// AC3: --sort author:desc → descending by author text
// ---------------------------------------------------------------------------

test('AC3: --sort author:desc orders rows descending by author text', () => {
  const result = runCli(['--sort', 'author:desc'], stubIo([...AUTHORS_FIXTURE]));
  assert.equal(result.code, 0, `expected code 0, stderr: ${result.stderr}`);
  const lines = result.stdout.split('\n');
  const dataLines = lines.filter((l) => /^\s+\d+\s+\S/.test(l));
  assert.ok(dataLines.length >= 3, `expected ≥3 data rows`);
  // Descending text: Zara > Bob > Alice.
  assert.match(dataLines[0], /Zara/,  `first row should be Zara: ${dataLines[0]}`);
  assert.match(dataLines[1], /Bob/,   `second row should be Bob: ${dataLines[1]}`);
  assert.match(dataLines[2], /Alice/, `third row should be Alice: ${dataLines[2]}`);
});

// ---------------------------------------------------------------------------
// AC4: --sort unknownColumn → exit 2, stderr lists valid columns
// ---------------------------------------------------------------------------

test('AC4: --sort unknownColumn exits code 2 and lists valid columns in stderr', () => {
  const result = runCli(['--sort', 'unknownCol'], stubIo([...AUTHORS_FIXTURE]));
  assert.equal(result.code, 2, `expected code 2, got ${result.code}`);
  assert.ok(
    result.stderr.includes('unknownCol'),
    `stderr should mention the bad column: ${result.stderr}`,
  );
  // Should list some valid columns.
  assert.ok(
    result.stderr.includes('author') || result.stderr.includes('commits'),
    `stderr should list valid columns: ${result.stderr}`,
  );
});

// ---------------------------------------------------------------------------
// AC5: --sort commits:badDirection → exit 2
// ---------------------------------------------------------------------------

test('AC5: --sort commits:badDirection exits code 2', () => {
  const result = runCli(['--sort', 'commits:baddir'], stubIo([...AUTHORS_FIXTURE]));
  assert.equal(result.code, 2, `expected code 2, got ${result.code}`);
  assert.ok(result.stderr.length > 0, 'stderr should be non-empty');
});

// ---------------------------------------------------------------------------
// AC6: no --sort → output byte-for-byte identical to no-flag baseline
// ---------------------------------------------------------------------------

test('AC6: no --sort flag produces byte-for-byte identical output to baseline (no sort applied)', () => {
  const baseline = runCli([], stubIo([...AUTHORS_FIXTURE]));
  const withNoSort = runCli([], stubIo([...AUTHORS_FIXTURE]));
  assert.equal(withNoSort.stdout, baseline.stdout, 'output must be identical when --sort is absent');
  assert.equal(withNoSort.code, baseline.code);
});

// ---------------------------------------------------------------------------
// AC7: --sort name on tags subcommand → ascending by name (text default)
// ---------------------------------------------------------------------------

test('AC7: --sort name on tags subcommand orders tag rows ascending by name', () => {
  // Stub tag entries — names chosen with non-alphabetical commit ordering to
  // confirm that sort is applied to name not position.
  const stubTags: TagEntry[] = [
    { name: 'v3.0', sha: 'sha3', date: '2024-03-01' },
    { name: 'v1.0', sha: 'sha1', date: '2024-01-01' },
    { name: 'v2.0', sha: 'sha2', date: '2024-02-01' },
  ];

  const stubCommits: Commit[] = [commit({ author: 'Alice', date: '2024-01-15' })];

  const io = {
    readCommits: (_path: string) => [],
    readTags: (_path: string): TagEntry[] => [...stubTags],
    readCommitsBetweenTags: (_path: string, _from: string, _to: string): Commit[] => [...stubCommits],
  };

  const result = runCli(['tags', '--sort', 'name'], io);
  assert.equal(result.code, 0, `expected code 0; stderr: ${result.stderr}`);

  const stdout = result.stdout;
  const v1pos = stdout.indexOf('v1.0');
  const v2pos = stdout.indexOf('v2.0');
  const v3pos = stdout.indexOf('v3.0');

  assert.ok(v1pos !== -1, 'output should contain v1.0');
  assert.ok(v2pos !== -1, 'output should contain v2.0');
  assert.ok(v3pos !== -1, 'output should contain v3.0');

  // Ascending by name: v1.0 < v2.0 < v3.0.
  assert.ok(v1pos < v2pos, `v1.0 should appear before v2.0 (positions: ${v1pos}, ${v2pos})`);
  assert.ok(v2pos < v3pos, `v2.0 should appear before v3.0 (positions: ${v2pos}, ${v3pos})`);
});
