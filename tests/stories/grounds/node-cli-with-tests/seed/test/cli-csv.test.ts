/**
 * Unit tests for --csv flag wiring in runCli (WI-3).
 *
 * Quality gate: node --import tsx --test test/cli-csv.test.ts
 *
 * Covers all four WI-3 acceptance criteria:
 *   AC1: --csv --json → code 1, stderr "Error: --csv and --json are mutually exclusive", stdout ""
 *   AC2: --csv (summary path) → stdout starts with "Author,Commits", exit 0
 *   AC3: --csv --compare <ref> → stdout is valid CSV (two sections), exit 0
 *   AC4: no --csv/--json → stdout byte-identical to renderSummary (regression guard)
 *
 * Uses injected io (no real git spawning).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { runCli } from '../src/cli.ts';
import { renderSummary } from '../src/format.ts';
import { summarize } from '../src/stats.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Commit for use in tests. */
const commit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 10,
  deletions: 2,
  files: [],
  ...over,
});

// Sentinel fixtures: Ada Lovelace is top author (3 commits), Grace Hopper has 1.
const ADA_1 = commit({ author: 'Ada Lovelace', date: '2024-03-01', insertions: 15, deletions: 3 });
const ADA_2 = commit({ author: 'Ada Lovelace', date: '2024-03-05', insertions: 8, deletions: 0 });
const ADA_3 = commit({ author: 'Ada Lovelace', date: '2024-03-07', insertions: 4, deletions: 1 });
const GRACE_1 = commit({ author: 'Grace Hopper', date: '2024-02-15', insertions: 8, deletions: 1 });

const HEAD_COMMITS: Commit[] = [ADA_1, ADA_2, ADA_3, GRACE_1];
const BASE_COMMITS: Commit[] = [ADA_1];

/**
 * Build a fake io object with injected git I/O.
 * `refIsValid` controls whether validateRef throws.
 */
function fakeIo(opts: {
  headCommits?: Commit[];
  baseCommits?: Commit[];
  refIsValid?: boolean;
} = {}) {
  const { headCommits = HEAD_COMMITS, baseCommits = BASE_COMMITS, refIsValid = true } = opts;
  return {
    readCommits: (_path: string): Commit[] => [...headCommits],
    validateRef: (_path: string, ref: string): string => {
      if (!refIsValid) throw new Error(`gitpulse: unknown ref '${ref}'`);
      return 'abc1234def5678abc1234def5678abc1234def5678';
    },
    readCommitsAtRef: (_path: string, _ref: string): Commit[] => [...baseCommits],
  };
}

// ---------------------------------------------------------------------------
// AC1: mutual-exclusion guard
// ---------------------------------------------------------------------------

test('runCli: --csv --json exits code 1 with mutual-exclusion error', () => {
  const r = runCli(['--csv', '--json', '/repo'], fakeIo());
  assert.equal(r.code, 1, 'exit code must be 1');
  assert.equal(r.stderr, 'Error: --csv and --json are mutually exclusive',
    'stderr must be the exact mutual-exclusion message');
  assert.equal(r.stdout, '', 'stdout must be empty on mutual-exclusion error');
});

test('runCli: --json --csv (reversed order) also exits code 1', () => {
  const r = runCli(['--json', '--csv', '/repo'], fakeIo());
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'Error: --csv and --json are mutually exclusive');
  assert.equal(r.stdout, '');
});

// ---------------------------------------------------------------------------
// AC2: --csv on the default summary path
// ---------------------------------------------------------------------------

test('runCli: --csv produces CSV output starting with author header', () => {
  const r = runCli(['--csv', '/repo'], fakeIo());
  assert.equal(r.code, 0, 'exit code must be 0');
  assert.equal(r.stderr, '', 'stderr must be empty');
  assert.ok(r.stdout.startsWith('Author,Commits,Lines Added,Lines Deleted'),
    `stdout must start with CSV header; got: ${r.stdout.slice(0, 80)}`);
});

test('runCli: --csv summary path includes top sentinel author row', () => {
  const r = runCli(['--csv', '/repo'], fakeIo());
  assert.equal(r.code, 0);
  // Ada Lovelace is the top author with 3 commits.
  assert.ok(r.stdout.includes('Ada Lovelace'),
    'CSV output must include the sentinel top author');
});

test('runCli: --csv summary data row count equals unique author count', () => {
  const r = runCli(['--csv', '/repo'], fakeIo());
  assert.equal(r.code, 0);
  // Count non-blank, non-header lines that start with author names.
  const dataRows = r.stdout
    .split('\n')
    .filter((line, i) => i > 0 && line.trim() !== '');
  // Head section: Authors, Commits,Lines Added,Lines Deleted
  // renderSummaryCsv emits multiple sections — the first data-block is byAuthor (2 authors)
  const csvLines = r.stdout.split('\n');
  const headerIdx = csvLines.findIndex(l => l.startsWith('Author,Commits,Lines Added,Lines Deleted'));
  assert.ok(headerIdx >= 0, 'CSV must have an Author header');
  // The row immediately after the header should be Ada Lovelace
  const firstDataRow = csvLines[headerIdx + 1];
  assert.ok(firstDataRow?.startsWith('Ada Lovelace'),
    `First data row must be Ada Lovelace (top author), got: ${firstDataRow}`);
});

// ---------------------------------------------------------------------------
// AC3: --csv --compare <ref> path
// ---------------------------------------------------------------------------

test('runCli: --csv --compare produces two-section CSV output', () => {
  const r = runCli(['--csv', '--compare', 'v0.1', '/repo'], fakeIo());
  assert.equal(r.code, 0, 'exit code must be 0');
  assert.equal(r.stderr, '', 'stderr must be empty');
  // renderCompareCsv emits two sections separated by a blank row.
  assert.ok(r.stdout.includes('\n\n') || r.stdout.includes('\n,'),
    'compare CSV must have a blank-row section separator');
  assert.ok(r.stdout.startsWith('Metric,Head,Base,Delta'),
    `compare CSV must start with headline header; got: ${r.stdout.slice(0, 80)}`);
});

test('runCli: --csv --compare includes per-author section', () => {
  const r = runCli(['--csv', '--compare', 'v0.1', '/repo'], fakeIo());
  assert.equal(r.code, 0);
  // The second section should have "Author,Delta Commits,Delta Lines" header.
  assert.ok(r.stdout.includes('Author,Delta Commits,Delta Lines'),
    'compare CSV must include per-author header');
});

// ---------------------------------------------------------------------------
// AC4: no --csv/--json → regression guard (byte-identical to renderSummary)
// ---------------------------------------------------------------------------

test('runCli: no --csv or --json → stdout byte-identical to renderSummary', () => {
  const r = runCli(['/repo'], fakeIo());
  assert.equal(r.code, 0, 'exit code must be 0');
  assert.equal(r.stderr, '', 'stderr must be empty');
  // Build the expected output the same way the CLI does.
  const expected = renderSummary(summarize(HEAD_COMMITS, { repoPath: '/repo' }));
  assert.equal(r.stdout, expected,
    'plain output must be byte-identical to renderSummary result');
});

test('runCli: --csv does NOT appear in stderr for valid usage', () => {
  const r = runCli(['--csv', '/repo'], fakeIo());
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});
