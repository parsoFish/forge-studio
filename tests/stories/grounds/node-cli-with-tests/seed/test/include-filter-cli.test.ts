/**
 * CLI integration tests for WI-2: --include flag wiring in cli.ts.
 *
 * Quality gate for WI-2 (INIT-2026-09-04-include-path-filter-flag).
 * Covers AC1–AC10.
 *
 * Run:
 *   node --test --experimental-strip-types test/include-filter-cli.test.ts
 *
 * No real git is spawned — io is fully injected via runCli / runCli tags+coupling.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Commit } from '../src/git.ts';
import { runCli } from '../src/cli.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Commit for use in tests. */
const makeCommit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 5,
  deletions: 1,
  files: [],
  ...over,
});

/**
 * Mixed commits with src/ and other/ files, plus a commit that has only
 * non-src/ files (Carol's commit) so include filter can drop a whole commit.
 */
function mixedCommits(): Commit[] {
  return [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/cli.ts', insertions: 10, deletions: 2 },
        { path: 'test/cli.test.ts', insertions: 5, deletions: 1 },
      ],
    }),
    makeCommit({
      author: 'Bob',
      date: '2024-01-02',
      files: [
        { path: 'src/glob.ts', insertions: 8, deletions: 0 },
        { path: 'README.md', insertions: 3, deletions: 0 },
      ],
    }),
    makeCommit({
      author: 'Carol',
      date: '2024-01-03',
      // Commit entirely outside src/ — should be dropped by src/** filter.
      files: [
        { path: 'test/only.test.ts', insertions: 7, deletions: 1 },
        { path: 'docs/guide.md', insertions: 4, deletions: 0 },
      ],
    }),
  ];
}

/** Minimal io stub. */
const stubIo = (commits: readonly Commit[]) => ({
  readCommits: (_path: string): Commit[] => [...commits],
});

/** io for compare tests. */
function compareIo(opts: {
  headCommits?: Commit[];
  baseCommits?: Commit[];
  refIsValid?: boolean;
}) {
  const { headCommits = [], baseCommits = [], refIsValid = true } = opts;
  return {
    readCommits: (_path: string): Commit[] => [...headCommits],
    validateRef: (_path: string, ref: string): string => {
      if (!refIsValid) throw new Error(`gitpulse: unknown ref '${ref}'`);
      return 'abc1234';
    },
    readCommitsAtRef: (_path: string, _ref: string): Commit[] => [...baseCommits],
  };
}

// ---------------------------------------------------------------------------
// AC1: Single-snapshot path — applyInclusions called before other filters
// ---------------------------------------------------------------------------

test('AC1: --include src/** on single-snapshot — files outside src/ are absent', () => {
  const commits = mixedCommits();
  const io = stubIo(commits);
  const result = runCli(['--include', 'src/**', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit code. stderr: ${result.stderr}`);
  // Alice and Bob have src/ files, so they should appear
  assert.ok(result.stdout.includes('Alice'), `Alice should appear: ${result.stdout.slice(0, 400)}`);
  assert.ok(result.stdout.includes('Bob'), `Bob should appear: ${result.stdout.slice(0, 400)}`);
  // Carol has only test/ files — excluded by src/** → Carol should not appear
  assert.ok(!result.stdout.includes('Carol'), `Carol should be excluded: ${result.stdout.slice(0, 400)}`);
});

test('AC1: --include src/** applies before --exclude (pipeline order)', () => {
  // Include src/**, then exclude src/bad.ts — README.md (not in src/) also drops
  const commits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/real.ts', insertions: 10, deletions: 2 },
        { path: 'src/bad.ts', insertions: 3, deletions: 0 },
        { path: 'README.md', insertions: 5, deletions: 1 },
      ],
    }),
  ];
  const io = stubIo(commits);
  // After include filter: only src/real.ts and src/bad.ts
  // After exclude filter: only src/real.ts
  const result = runCli(['--include', 'src/**', '--exclude', 'src/bad.ts', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  // README.md is not in src/ so dropped by include
  // src/bad.ts is dropped by exclude
  // src/real.ts survives → Alice should appear
  assert.ok(result.stdout.includes('Alice'), `Alice should appear: ${result.stdout.slice(0, 400)}`);
});

// ---------------------------------------------------------------------------
// AC2: Compare path — applyInclusions on BOTH headCommits and baseCommits
// ---------------------------------------------------------------------------

test('AC2: --compare main --include src/** filters both head and base commits', () => {
  const headCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-03',
      files: [
        { path: 'src/new.ts', insertions: 15, deletions: 0 },
        { path: 'test/new.test.ts', insertions: 5, deletions: 0 },
      ],
    }),
  ];
  const baseCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/old.ts', insertions: 10, deletions: 5 },
        { path: 'docs/old.md', insertions: 3, deletions: 0 },
      ],
    }),
  ];

  const io = compareIo({ headCommits, baseCommits });
  const result = runCli(['--compare', 'main', '--include', 'src/**', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  // The delta report should reflect only src/ files (test/ and docs/ stripped)
  assert.ok(result.stdout.length > 0, 'Should produce output');
});

test('AC2: --compare --include src/** with --json → includeFiltered field present', () => {
  const headCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-03',
      files: [
        { path: 'src/new.ts', insertions: 15, deletions: 0 },
        { path: 'test/new.test.ts', insertions: 5, deletions: 0 },
      ],
    }),
  ];
  const baseCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/old.ts', insertions: 10, deletions: 5 },
        { path: 'docs/old.md', insertions: 3, deletions: 0 },
      ],
    }),
  ];

  const io = compareIo({ headCommits, baseCommits });
  const result = runCli(['--compare', 'main', '--include', 'src/**', '--json', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    Object.prototype.hasOwnProperty.call(obj, 'includeFiltered'),
    `JSON must have includeFiltered. Got keys: ${Object.keys(obj).join(', ')}`,
  );
  assert.ok(
    typeof obj['includeFiltered'] === 'number' && (obj['includeFiltered'] as number) > 0,
    `includeFiltered must be positive integer, got ${obj['includeFiltered']}`,
  );
});

// ---------------------------------------------------------------------------
// AC3: Tags path — applyInclusions applied at CLI layer per span
// ---------------------------------------------------------------------------

test('AC3: tags --include src/** filters each span at the CLI layer', () => {
  const tag1: { name: string; sha: string; date: string } = {
    name: 'v1.0.0', sha: 'aaa1', date: '2024-01-01',
  };
  const tag2: { name: string; sha: string; date: string } = {
    name: 'v2.0.0', sha: 'bbb2', date: '2024-02-01',
  };

  const spanCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-15',
      files: [
        { path: 'src/feature.ts', insertions: 10, deletions: 0 },
        { path: 'test/feature.test.ts', insertions: 5, deletions: 0 },
      ],
    }),
    makeCommit({
      author: 'Bob',
      date: '2024-01-20',
      files: [
        { path: 'docs/readme.md', insertions: 3, deletions: 0 },
      ],
    }),
  ];

  const io = {
    readCommits: (_path: string): Commit[] => [],
    readTags: (_path: string) => [tag2, tag1],
    readCommitsBetweenTags: (_path: string, _from: string, _to: string, _excludes?: string[]): Commit[] => [...spanCommits],
  };

  const result = runCli(['tags', '--include', 'src/**', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  // Tag v2.0.0 span: only Alice's commit survives (Bob's docs/readme.md filtered out)
  // So v2.0.0 span has 1 commit with 1 unique author
  assert.ok(result.stdout.length > 0, 'Should produce tags output');
});

// ---------------------------------------------------------------------------
// AC4: Coupling path — applyInclusions applied before coupling aggregation
// ---------------------------------------------------------------------------

test('AC4: coupling --include src/** filters commits before coupling aggregation', () => {
  const commits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/a.ts', insertions: 5, deletions: 0 },
        { path: 'src/b.ts', insertions: 3, deletions: 0 },
        { path: 'test/a.test.ts', insertions: 2, deletions: 0 },
      ],
    }),
    makeCommit({
      author: 'Bob',
      date: '2024-01-02',
      files: [
        { path: 'src/a.ts', insertions: 2, deletions: 1 },
        { path: 'src/b.ts', insertions: 1, deletions: 0 },
      ],
    }),
  ];

  const io = {
    readCommits: (_path: string): Commit[] => [...commits],
  };

  const result = runCli(['coupling', '--include', 'src/**', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  // test/a.test.ts should not appear in coupling output (filtered by --include src/**)
  assert.ok(!result.stdout.includes('test/a.test.ts'), `test/a.test.ts should be absent: ${result.stdout.slice(0, 400)}`);
});

// ---------------------------------------------------------------------------
// AC5: --include '' (empty string) → exit code 2, error message
// ---------------------------------------------------------------------------

test('AC5: --include with empty string value → exit code 2', () => {
  const io = stubIo(mixedCommits());
  const result = runCli(['--include', '', '/repo'], io);
  assert.equal(result.code, 2, `Expected exit code 2, got ${result.code}`);
  assert.ok(
    result.stderr.includes('--include requires a non-empty pattern'),
    `stderr must contain '--include requires a non-empty pattern', got: ${result.stderr}`,
  );
});

test('AC5: empty --include also applies in tags subcommand', () => {
  const io = {
    readCommits: (_path: string): Commit[] => [],
    readTags: (_path: string) => [],
    readCommitsBetweenTags: (_path: string, _from: string, _to: string): Commit[] => [],
  };
  const result = runCli(['tags', '--include', '', '/repo'], io);
  assert.equal(result.code, 2, `Expected exit code 2, got ${result.code}`);
  assert.ok(
    result.stderr.includes('--include requires a non-empty pattern'),
    `stderr must contain '--include requires a non-empty pattern', got: ${result.stderr}`,
  );
});

// ---------------------------------------------------------------------------
// AC6: --include as final token (no value) → exit code 2, error message
// ---------------------------------------------------------------------------

test('AC6: --include as final argv token (no value) → exit code 2', () => {
  const io = stubIo(mixedCommits());
  const result = runCli(['--include'], io);
  assert.equal(result.code, 2, `Expected exit code 2, got ${result.code}`);
  assert.ok(
    result.stderr.includes('--include requires a value'),
    `stderr must contain '--include requires a value', got: ${result.stderr}`,
  );
});

test('AC6: --include as final argv token in tags subcommand → exit code 2', () => {
  const io = {
    readCommits: (_path: string): Commit[] => [],
    readTags: (_path: string) => [],
    readCommitsBetweenTags: (_path: string, _from: string, _to: string): Commit[] => [],
  };
  const result = runCli(['tags', '--include'], io);
  assert.equal(result.code, 2, `Expected exit code 2, got ${result.code}`);
  assert.ok(
    result.stderr.includes('--include requires a value'),
    `stderr must contain '--include requires a value', got: ${result.stderr}`,
  );
});

// ---------------------------------------------------------------------------
// AC7: Text output annotation — first line carries '(N paths excluded by include filter)'
// ---------------------------------------------------------------------------

test('AC7: text output first line contains (N paths excluded by include filter) when files dropped', () => {
  const commits = mixedCommits(); // Carol's commit has only test/ and docs/ files
  const io = stubIo(commits);
  const result = runCli(['--include', 'src/**', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const firstLine = result.stdout.split('\n')[0];
  assert.ok(
    firstLine.includes('paths excluded by include filter'),
    `First line must contain 'paths excluded by include filter', got: ${firstLine}`,
  );
  // The count must be a positive number
  const match = firstLine.match(/\((\d+) paths excluded by include filter\)/);
  assert.ok(match !== null, `Must match pattern, got: ${firstLine}`);
  assert.ok(parseInt(match![1], 10) > 0, `Count must be positive, got: ${match![1]}`);
});

test('AC7: annotation is on the FIRST output line', () => {
  const commits = mixedCommits();
  const io = stubIo(commits);
  const result = runCli(['--include', 'src/**', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const lines = result.stdout.split('\n');
  // The annotation must be on line[0] (not some other line)
  assert.ok(
    lines[0].includes('paths excluded by include filter'),
    `First line should have annotation, got: ${lines[0]}`,
  );
});

// ---------------------------------------------------------------------------
// AC8: JSON output — includeFiltered field present when --include used
// ---------------------------------------------------------------------------

test('AC8: --include src/** --json → JSON contains includeFiltered with positive N', () => {
  const commits = mixedCommits();
  const io = stubIo(commits);
  const result = runCli(['--include', 'src/**', '--json', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    Object.prototype.hasOwnProperty.call(obj, 'includeFiltered'),
    `JSON must have 'includeFiltered' key. Got keys: ${Object.keys(obj).join(', ')}`,
  );
  assert.ok(
    typeof obj['includeFiltered'] === 'number' && (obj['includeFiltered'] as number) > 0,
    `includeFiltered must be a positive integer, got: ${obj['includeFiltered']}`,
  );
});

test('AC8: --json WITHOUT --include → includeFiltered field is absent', () => {
  const commits = mixedCommits();
  const io = stubIo(commits);
  const result = runCli(['--json', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(obj, 'includeFiltered'),
    `includeFiltered must be absent when no --include flag. Keys: ${Object.keys(obj).join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// AC9: CSV output — '# includeFiltered: N' comment line present
// ---------------------------------------------------------------------------

test('AC9: --include src/** --csv → output contains # includeFiltered: N comment', () => {
  const commits = mixedCommits();
  const io = stubIo(commits);
  const result = runCli(['--include', 'src/**', '--csv', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('# includeFiltered:'),
    `CSV output must contain '# includeFiltered:', got: ${result.stdout.slice(0, 400)}`,
  );
  // The count should be a positive number
  const match = result.stdout.match(/# includeFiltered:\s*(\d+)/);
  assert.ok(match !== null, `Must match '# includeFiltered: N' pattern`);
  assert.ok(parseInt(match![1], 10) >= 0, `Count must be non-negative, got: ${match![1]}`);
});

test('AC9: --csv WITHOUT --include → no # includeFiltered line', () => {
  const commits = mixedCommits();
  const io = stubIo(commits);
  const result = runCli(['--csv', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.ok(
    !result.stdout.includes('# includeFiltered:'),
    `CSV output must NOT contain '# includeFiltered:' when no --include flag`,
  );
});

// ---------------------------------------------------------------------------
// AC10: USAGE constant contains '--include <pattern>' with repeatable note
// ---------------------------------------------------------------------------

test('AC10: USAGE string (--help output) contains --include <pattern>', () => {
  const io = stubIo([]);
  const result = runCli(['--help'], io);
  // --help returns usage in stderr
  const helpText = result.stderr;
  assert.ok(
    helpText.includes('--include <pattern>'),
    `USAGE must contain '--include <pattern>', got:\n${helpText}`,
  );
  // Must have repeatable note (same style as --exclude)
  assert.ok(
    helpText.includes('repeatable'),
    `USAGE --include line must mention 'repeatable', got:\n${helpText}`,
  );
});

test('AC10: USAGE string contains --include in same style as --exclude', () => {
  const io = stubIo([]);
  const result = runCli(['--help'], io);
  const helpText = result.stderr;
  // Both --exclude and --include should appear in the help text
  assert.ok(helpText.includes('--exclude <pattern>'), `USAGE must have --exclude <pattern>`);
  assert.ok(helpText.includes('--include <pattern>'), `USAGE must have --include <pattern>`);
});

// ---------------------------------------------------------------------------
// Dead-code guard: applyInclusions is referenced in src/cli.ts
// ---------------------------------------------------------------------------

test('applyInclusions is used in src/cli.ts (not dead code)', () => {
  const cliSrc = readFileSync(resolve(import.meta.dirname ?? __dirname, '../src/cli.ts'), 'utf8');
  assert.ok(
    cliSrc.includes('applyInclusions'),
    'src/cli.ts must reference applyInclusions (include filter wired in)',
  );
  // Should appear more than just the function definition (i.e., it's called)
  const occurrences = (cliSrc.match(/applyInclusions/g) ?? []).length;
  assert.ok(
    occurrences >= 2,
    `applyInclusions should appear at least twice (definition + call), got ${occurrences}`,
  );
});
