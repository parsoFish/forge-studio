/**
 * CLI `gitpulse coupling` subcommand tests (WI-3).
 *
 * All tests use injected io — no git spawning, no I/O.
 * Tests the `runCli` dispatch path to `runCouplingCli`.
 *
 * Quality gate: node --test --experimental-strip-types test/cli-coupling.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../src/cli.ts';
import type { Commit } from '../src/git.ts';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeCommit(
  files: Array<{ path: string }>,
  date = '2024-01-01',
  hash = 'abc123',
): Commit {
  return {
    hash,
    author: 'Test Author',
    date,
    parentCount: 1,
    authorEmail: '',
    filesChanged: files.length,
    insertions: 1,
    deletions: 0,
    files: files.map((f) => ({ path: f.path, insertions: 1, deletions: 0 })),
  };
}

/**
 * Stub io for coupling tests: only readCommits is needed.
 */
function stubIo(commits: Commit[]) {
  return {
    readCommits: (_path: string) => commits,
  };
}

// A fixture with two files that always co-change (100% coupling).
const COUPLED_COMMITS: Commit[] = [
  makeCommit([{ path: 'src/a.ts' }, { path: 'src/b.ts' }], '2024-01-01', 'h1'),
  makeCommit([{ path: 'src/a.ts' }, { path: 'src/b.ts' }], '2024-01-02', 'h2'),
  makeCommit([{ path: 'src/a.ts' }, { path: 'src/b.ts' }], '2024-01-03', 'h3'),
];

// A fixture for stats summary (single-file commits — no coupling).
const STATS_COMMITS: Commit[] = [
  makeCommit([{ path: 'src/x.ts' }], '2024-01-01', 'x1'),
  makeCommit([{ path: 'src/x.ts' }], '2024-01-02', 'x2'),
];

// ---------------------------------------------------------------------------
// AC1: coupling subcommand dispatches correctly, --top limits output
// ---------------------------------------------------------------------------

test('AC1: coupling dispatches — readCommits is called and output is coupling table', () => {
  let calledWith: string | null = null;
  const io = {
    readCommits: (path: string) => {
      calledWith = path;
      return COUPLED_COMMITS;
    },
  };

  const result = runCli(['coupling', '/some/repo', '--top', '5'], io);

  assert.equal(result.code, 0, `exit 0; stderr: ${result.stderr}`);
  // readCommits was called with the repo path.
  assert.equal(calledWith, '/some/repo', 'readCommits should be called with repo path');
  // Output contains coupling table headers.
  assert.match(result.stdout, /fileA/, 'stdout should contain coupling table header');
  assert.match(result.stdout, /fileB/, 'stdout should contain coupling table header');
  assert.match(result.stdout, /co-changes/, 'stdout should contain co-changes column');
});

test('AC1: --top 1 limits coupling table to 1 row', () => {
  // Three pairs: a-b, a-c, b-c all co-change twice
  const multiPairCommits: Commit[] = [
    makeCommit([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }], '2024-01-01', 'h1'),
    makeCommit([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }], '2024-01-02', 'h2'),
  ];
  const io = stubIo(multiPairCommits);
  const result = runCli(['coupling', '/repo', '--top', '1'], io);
  assert.equal(result.code, 0);
  // There should be exactly 1 data row (only one pair shown).
  // Count lines that match the data row pattern (contain .ts paths).
  const dataLines = result.stdout.split('\n').filter((l) => l.includes('.ts'));
  assert.equal(dataLines.length, 1, `expected 1 data row with --top 1, got: ${JSON.stringify(dataLines)}`);
});

// ---------------------------------------------------------------------------
// AC2: --json flag outputs valid JSON with { rows, excluded }
// ---------------------------------------------------------------------------

test('AC2: --json outputs valid JSON matching { rows: [...], excluded: N }', () => {
  const result = runCli(['coupling', '/repo', '--json'], stubIo(COUPLED_COMMITS));
  assert.equal(result.code, 0, `exit 0; stderr: ${result.stderr}`);

  let parsed: unknown;
  assert.doesNotThrow(
    () => { parsed = JSON.parse(result.stdout); },
    'stdout should be valid JSON',
  );

  const obj = parsed as Record<string, unknown>;
  assert.ok(Array.isArray(obj['rows']), 'JSON should have a rows array');
  assert.equal(typeof obj['excluded'], 'number', 'JSON should have excluded count as number');

  // Rows should contain coupling data.
  const rows = obj['rows'] as Array<Record<string, unknown>>;
  assert.ok(rows.length > 0, 'rows should be non-empty for coupled commits');
  const row = rows[0];
  assert.ok('fileA' in row, 'row should have fileA');
  assert.ok('fileB' in row, 'row should have fileB');
  assert.ok('coChanges' in row, 'row should have coChanges');
  assert.ok('couplingPct' in row, 'row should have couplingPct');
  assert.equal(typeof row['couplingPct'], 'number', 'couplingPct should be a number (float)');
});

// ---------------------------------------------------------------------------
// AC3: --csv flag outputs CSV with correct header row
// ---------------------------------------------------------------------------

test('AC3: --csv outputs CSV starting with fileA,fileB,coChanges,couplingPct header', () => {
  const result = runCli(['coupling', '/repo', '--csv'], stubIo(COUPLED_COMMITS));
  assert.equal(result.code, 0, `exit 0; stderr: ${result.stderr}`);
  assert.ok(
    result.stdout.startsWith('fileA,fileB,coChanges,couplingPct'),
    `stdout should start with CSV header; got: ${result.stdout.slice(0, 80)}`,
  );
});

// ---------------------------------------------------------------------------
// AC4: --exclude and --since are applied correctly
// ---------------------------------------------------------------------------

test('AC4: --exclude filters files BEFORE computeCoupling — excluded file never in pairs', () => {
  // Commits where test files always co-change with src files.
  // Use flat paths (no subdirectory) so that *.test.ts glob matches correctly.
  const commits: Commit[] = [
    makeCommit(
      [{ path: 'a.ts' }, { path: 'a.test.ts' }, { path: 'b.ts' }],
      '2024-01-01', 'h1',
    ),
    makeCommit(
      [{ path: 'a.ts' }, { path: 'a.test.ts' }, { path: 'b.ts' }],
      '2024-01-02', 'h2',
    ),
  ];

  const result = runCli(
    ['coupling', '/repo', '--exclude', '*.test.ts'],
    stubIo(commits),
  );
  assert.equal(result.code, 0, `exit 0; stderr: ${result.stderr}`);
  // The excluded file should not appear in any pair row.
  assert.ok(
    !result.stdout.includes('a.test.ts'),
    `excluded file should not appear in output; stdout: ${result.stdout}`,
  );
});

test('AC4: --since forwards to readCommits filtering — later commits excluded', () => {
  // Mix of commits before and after the since date.
  const commits: Commit[] = [
    // Before: only a.ts touches (no pair)
    makeCommit([{ path: 'src/a.ts' }], '2023-12-31', 'old'),
    // After 2024-01-01: a.ts and b.ts co-change
    makeCommit([{ path: 'src/a.ts' }, { path: 'src/b.ts' }], '2024-01-01', 'h1'),
    makeCommit([{ path: 'src/a.ts' }, { path: 'src/b.ts' }], '2024-01-02', 'h2'),
  ];

  // Without --since: both pair and non-pair commits are used.
  const resultAll = runCli(['coupling', '/repo'], stubIo(commits));
  assert.equal(resultAll.code, 0);
  assert.match(resultAll.stdout, /src\/a\.ts/, 'should see pairs without --since');

  // With --since=2024-01-01: old commit filtered out, but result should still have pairs.
  const resultSince = runCli(['coupling', '/repo', '--since', '2024-01-01'], stubIo(commits));
  assert.equal(resultSince.code, 0, `exit 0; stderr: ${resultSince.stderr}`);
  assert.match(resultSince.stdout, /src\/a\.ts/, 'pairs should still exist after --since filter');
});

// ---------------------------------------------------------------------------
// AC5: legacy positional form (no subcommand) invokes stats behaviour unchanged
// ---------------------------------------------------------------------------

test('AC5: legacy argv [<repo>] (no subcommand) invokes stats summary, not coupling', () => {
  // Use commits with known author to identify stats output.
  const commits: Commit[] = [
    {
      hash: 'legacy1',
      author: 'LegacyAuthor',
      date: '2024-01-01',
      parentCount: 1,
      authorEmail: '',
      filesChanged: 1,
      insertions: 5,
      deletions: 2,
      files: [{ path: 'src/main.ts', insertions: 5, deletions: 2 }],
    },
  ];
  const io = stubIo(commits);
  // Legacy form: first arg is the repo path (not a subcommand keyword).
  const result = runCli(['/some/repo'], io);
  assert.equal(result.code, 0, `exit 0; stderr: ${result.stderr}`);
  // Stats summary should contain the author name, not coupling headers.
  assert.match(result.stdout, /LegacyAuthor/, 'stats summary should show author');
  assert.ok(
    !result.stdout.includes('fileA') && !result.stdout.includes('couplingPct'),
    `legacy form should NOT show coupling table; stdout: ${result.stdout.slice(0, 200)}`,
  );
});

test('AC5: legacy form still returns exit 0 and valid summary', () => {
  const result = runCli(['/any/path'], stubIo(STATS_COMMITS));
  assert.equal(result.code, 0, `legacy form exit 0; stderr: ${result.stderr}`);
  assert.ok(result.stdout.length > 0, 'legacy form should produce output');
});

// ---------------------------------------------------------------------------
// AC6: zero-pair repo prints 'no coupled file pairs found', exit 0
// ---------------------------------------------------------------------------

test('AC6: zero-pair repo outputs exactly "no coupled file pairs found", exit 0', () => {
  // Each commit touches only one file — no pairs can form.
  const noPairCommits: Commit[] = [
    makeCommit([{ path: 'src/solo.ts' }], '2024-01-01', 'solo1'),
    makeCommit([{ path: 'src/other.ts' }], '2024-01-02', 'solo2'),
  ];
  const result = runCli(['coupling', '/repo'], stubIo(noPairCommits));
  assert.equal(result.code, 0, `exit 0; stderr: ${result.stderr}`);
  assert.match(
    result.stdout,
    /no coupled file pairs found/,
    `stdout should contain "no coupled file pairs found"; got: ${result.stdout}`,
  );
});

test('AC6: zero-pair repo with --json still exits 0 with empty rows', () => {
  const noPairCommits: Commit[] = [
    makeCommit([{ path: 'solo.ts' }], '2024-01-01', 's1'),
  ];
  const result = runCli(['coupling', '/repo', '--json'], stubIo(noPairCommits));
  assert.equal(result.code, 0, `exit 0 for --json with zero pairs`);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const rows = parsed['rows'] as unknown[];
  assert.equal(rows.length, 0, 'JSON rows should be empty for zero-pair repo');
});

test('AC6: zero-pair repo with --csv still exits 0 with just header', () => {
  const noPairCommits: Commit[] = [
    makeCommit([{ path: 'solo.ts' }], '2024-01-01', 's1'),
  ];
  const result = runCli(['coupling', '/repo', '--csv'], stubIo(noPairCommits));
  assert.equal(result.code, 0, `exit 0 for --csv with zero pairs`);
  // Should still have the header row.
  assert.ok(
    result.stdout.startsWith('fileA,fileB,coChanges,couplingPct'),
    `CSV should still have header; got: ${result.stdout}`,
  );
});
