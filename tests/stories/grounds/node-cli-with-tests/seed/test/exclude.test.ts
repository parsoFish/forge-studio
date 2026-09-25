/**
 * Unit tests for --exclude flag wiring in runCli.
 *
 * Quality gate for WI-2 (INIT-2026-07-11-exclude-path-filter).
 * Covers AC1–AC7.
 *
 * Run:
 *   node --test --experimental-strip-types test/exclude.test.ts
 *
 * No real git is spawned — io is fully injected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
 * Fake io.readCommits — returns a copy of the provided commits array.
 */
const stubIo = (commits: readonly Commit[]) => ({
  readCommits: (_path: string): Commit[] => [...commits],
});

/**
 * Fake io for --compare tests.
 */
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

/**
 * Sentinel commit fixtures containing:
 *   - dist/bundle.js  (excluded by 'dist/**')
 *   - package-lock.json (excluded by '*.lock')
 *   - src/real.ts (never excluded)
 */
function mixedCommits(): Commit[] {
  return [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'dist/bundle.js', insertions: 100, deletions: 0 },
        { path: 'src/real.ts', insertions: 10, deletions: 2 },
      ],
    }),
    makeCommit({
      author: 'Bob',
      date: '2024-01-02',
      files: [
        { path: 'package-lock.json', insertions: 50, deletions: 10 },
        { path: 'src/real.ts', insertions: 3, deletions: 1 },
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// AC1: text report excludes matched paths and annotates header
// ---------------------------------------------------------------------------

test('AC1: --exclude dist/** removes dist/bundle.js from text output', () => {
  const result = runCli(['--exclude', 'dist/**', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 0, `exit code: ${result.code}; stderr: ${result.stderr}`);
  assert.ok(
    !result.stdout.includes('dist/bundle.js'),
    `dist/bundle.js should not appear in output:\n${result.stdout}`,
  );
});

test('AC1: --exclude dist/** --exclude *.lock removes package-lock.json from text output', () => {
  const result = runCli(
    ['--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0);
  assert.ok(
    !result.stdout.includes('package-lock.json'),
    `package-lock.json should not appear in output:\n${result.stdout}`,
  );
  assert.ok(
    !result.stdout.includes('dist/bundle.js'),
    `dist/bundle.js should not appear in output:\n${result.stdout}`,
  );
});

test('AC1: header includes (N paths excluded) with N > 0 when paths are excluded', () => {
  const result = runCli(
    ['--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0);
  const firstLine = result.stdout.split('\n')[0];
  assert.match(firstLine, /\(\d+ paths excluded\)/, `first line: ${firstLine}`);
  // N > 0 (2 distinct paths excluded: dist/bundle.js and package-lock.json)
  const match = firstLine.match(/\((\d+) paths excluded\)/);
  assert.ok(match !== null, 'annotation not found');
  assert.ok(Number(match![1]) > 0, `excluded count must be > 0, got ${match![1]}`);
});

test('AC1: src/real.ts still appears in text output after exclusion', () => {
  const result = runCli(
    ['--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0);
  assert.ok(
    result.stdout.includes('src/real.ts'),
    `src/real.ts should still appear in output:\n${result.stdout}`,
  );
});

// ---------------------------------------------------------------------------
// AC2: JSON output contains 'excluded' count and omits excluded paths
// ---------------------------------------------------------------------------

test('AC2: --json --exclude dist/** excludes dist/bundle.js from fileChurn', () => {
  const result = runCli(
    ['--json', '--exclude', 'dist/**', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const fileChurn = parsed['fileChurn'] as Array<{ file: string }>;
  assert.ok(Array.isArray(fileChurn), 'fileChurn must be an array');
  const files = fileChurn.map((e) => e.file);
  assert.ok(!files.includes('dist/bundle.js'), `dist/bundle.js should not be in fileChurn: ${JSON.stringify(files)}`);
});

test('AC2: --json --exclude dist/** --exclude *.lock excludes both paths from fileChurn', () => {
  const result = runCli(
    ['--json', '--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const fileChurn = parsed['fileChurn'] as Array<{ file: string }>;
  const files = fileChurn.map((e) => e.file);
  assert.ok(!files.includes('dist/bundle.js'), 'dist/bundle.js must not be in fileChurn');
  assert.ok(!files.includes('package-lock.json'), 'package-lock.json must not be in fileChurn');
});

test('AC2: --json --exclude produces top-level excluded field with value > 0', () => {
  const result = runCli(
    ['--json', '--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok('excluded' in parsed, `JSON must contain 'excluded' field; keys: ${Object.keys(parsed).join(', ')}`);
  assert.equal(typeof parsed['excluded'], 'number', 'excluded must be a number');
  assert.ok((parsed['excluded'] as number) > 0, `excluded count must be > 0, got ${parsed['excluded']}`);
});

test('AC2: --json --exclude excluded count matches distinct excluded paths', () => {
  const result = runCli(
    ['--json', '--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  // dist/bundle.js + package-lock.json = 2 distinct paths
  assert.equal(parsed['excluded'], 2, `expected excluded=2, got ${parsed['excluded']}`);
});

test('AC2: --json --exclude src/real.ts appears in fileChurn (non-excluded paths retained)', () => {
  const result = runCli(
    ['--json', '--exclude', 'dist/**', '--exclude', '*.lock', '/repo'],
    stubIo(mixedCommits()),
  );
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const fileChurn = parsed['fileChurn'] as Array<{ file: string }>;
  const files = fileChurn.map((e) => e.file);
  assert.ok(files.includes('src/real.ts'), `src/real.ts must appear in fileChurn; got: ${JSON.stringify(files)}`);
});

// ---------------------------------------------------------------------------
// AC3: no --exclude flag → output identical to current release
// ---------------------------------------------------------------------------

test('AC3: no --exclude → header does NOT contain "(N paths excluded)"', () => {
  const result = runCli(['/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 0);
  assert.ok(
    !result.stdout.includes('paths excluded'),
    `header should not contain 'paths excluded':\n${result.stdout.split('\n')[0]}`,
  );
});

test('AC3: no --exclude → JSON output does NOT contain excluded field', () => {
  const result = runCli(['--json', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(!('excluded' in parsed), `JSON must NOT have 'excluded' field without --exclude; keys: ${Object.keys(parsed).join(', ')}`);
});

test('AC3: no --exclude → all paths appear in fileChurn', () => {
  const result = runCli(['--json', '/repo'], stubIo(mixedCommits()));
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const fileChurn = parsed['fileChurn'] as Array<{ file: string }>;
  const files = fileChurn.map((e) => e.file);
  assert.ok(files.includes('dist/bundle.js'), 'dist/bundle.js must appear without --exclude');
  assert.ok(files.includes('package-lock.json'), 'package-lock.json must appear without --exclude');
  assert.ok(files.includes('src/real.ts'), 'src/real.ts must appear without --exclude');
});

// ---------------------------------------------------------------------------
// AC4: --exclude matches nothing → all files present, annotation shows (0 paths excluded)
// ---------------------------------------------------------------------------

test('AC4: --exclude nonexistent/** matches nothing → all files in text output', () => {
  const result = runCli(['--exclude', 'nonexistent/**', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('dist/bundle.js'), 'dist/bundle.js must appear');
  assert.ok(result.stdout.includes('package-lock.json'), 'package-lock.json must appear');
  assert.ok(result.stdout.includes('src/real.ts'), 'src/real.ts must appear');
});

test('AC4: --exclude nonexistent/** → header shows (0 paths excluded)', () => {
  const result = runCli(['--exclude', 'nonexistent/**', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 0);
  const firstLine = result.stdout.split('\n')[0];
  assert.match(firstLine, /\(0 paths excluded\)/, `first line: ${firstLine}`);
});

test('AC4: --json --exclude nonexistent/** → excluded field is 0', () => {
  const result = runCli(['--json', '--exclude', 'nonexistent/**', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok('excluded' in parsed, 'excluded field must be present');
  assert.equal(parsed['excluded'], 0, `expected excluded=0, got ${parsed['excluded']}`);
});

// ---------------------------------------------------------------------------
// AC5: --exclude '' (empty string) → exit 2, error on stderr, no output
// ---------------------------------------------------------------------------

test('AC5: --exclude "" (empty pattern) → exits non-zero (code 2)', () => {
  const result = runCli(['--exclude', '', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.code, 2, `expected exit code 2, got ${result.code}`);
});

test('AC5: --exclude "" → stderr contains clear error message', () => {
  const result = runCli(['--exclude', '', '/repo'], stubIo(mixedCommits()));
  assert.match(result.stderr, /--exclude pattern cannot be empty/);
});

test('AC5: --exclude "" → stdout is empty', () => {
  const result = runCli(['--exclude', '', '/repo'], stubIo(mixedCommits()));
  assert.equal(result.stdout, '', `stdout must be empty on error; got: ${result.stdout}`);
});

// ---------------------------------------------------------------------------
// AC6: --compare <ref> --exclude dist/** → compare delta excludes dist/ files
// ---------------------------------------------------------------------------

test('AC6: --compare v0.1 --exclude dist/** → dist/bundle.js absent from compare output', () => {
  const headCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-03-01',
      files: [
        { path: 'dist/bundle.js', insertions: 200, deletions: 0 },
        { path: 'src/app.ts', insertions: 20, deletions: 5 },
      ],
    }),
  ];
  const baseCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'dist/bundle.js', insertions: 100, deletions: 0 },
        { path: 'src/app.ts', insertions: 10, deletions: 2 },
      ],
    }),
  ];
  const result = runCli(
    ['/repo', '--compare', 'v0.1', '--exclude', 'dist/**'],
    compareIo({ headCommits, baseCommits }),
  );
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.ok(
    !result.stdout.includes('dist/bundle.js'),
    `dist/bundle.js should not appear in compare output:\n${result.stdout}`,
  );
});

test('AC6: --compare v0.1 --exclude dist/** → text header annotated with paths excluded', () => {
  const headCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-03-01',
      files: [{ path: 'dist/bundle.js', insertions: 100, deletions: 0 }],
    }),
  ];
  const baseCommits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [{ path: 'dist/bundle.js', insertions: 50, deletions: 0 }],
    }),
  ];
  const result = runCli(
    ['/repo', '--compare', 'v0.1', '--exclude', 'dist/**'],
    compareIo({ headCommits, baseCommits }),
  );
  assert.equal(result.code, 0);
  const firstLine = result.stdout.split('\n')[0];
  assert.match(firstLine, /\(\d+ paths excluded\)/, `first line: ${firstLine}`);
});

// ---------------------------------------------------------------------------
// Additional edge: --exclude flag parsing errors
// ---------------------------------------------------------------------------

test('--exclude with missing value exits 2', () => {
  const result = runCli(['--exclude'], stubIo([]));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--exclude requires/);
});

test('multiple --exclude patterns both applied', () => {
  const result = runCli(
    ['--exclude', 'dist/**', '--exclude', '*.lock', '--exclude', 'nonexistent/**', '/repo'],
    stubIo(mixedCommits()),
  );
  assert.equal(result.code, 0);
  const firstLine = result.stdout.split('\n')[0];
  const match = firstLine.match(/\((\d+) paths excluded\)/);
  assert.ok(match !== null, `annotation not found in: ${firstLine}`);
  // dist/bundle.js + package-lock.json = 2 (nonexistent/** matches nothing)
  assert.equal(Number(match![1]), 2, `expected 2 excluded paths, got ${match![1]}`);
});
