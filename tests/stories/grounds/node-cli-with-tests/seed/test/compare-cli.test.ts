/**
 * Unit tests for --compare flag wiring in runCli.
 *
 * Quality gate for WI-3. Asserts all four acceptance criteria:
 *   AC1: --compare <valid-ref> → exit 0, stdout contains 'delta since v0.1'
 *   AC2: --compare <nonexistent-ref> → exit 2, stderr contains the ref name
 *   AC3: --compare <valid-ref> --json → exit 0, stdout is valid JSON with 'delta' key
 *   AC4: no --compare flag → existing single-snapshot output path is unchanged
 *
 * Uses node:test + node:assert/strict. Run:
 *   node --import tsx --test test/compare-cli.test.ts
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

/** Sentinel fixtures — distinctive, non-default values. */
const ADA_HEAD = commit({ author: 'Ada Lovelace', date: '2024-03-01', insertions: 15, deletions: 3 });
const GRACE_HEAD = commit({ author: 'Grace Hopper', date: '2024-02-15', insertions: 8, deletions: 1 });
const ADA_BASE = commit({ author: 'Ada Lovelace', date: '2024-01-10', insertions: 5, deletions: 1 });

const HEAD_COMMITS: Commit[] = [ADA_HEAD, GRACE_HEAD, ADA_BASE];
const BASE_COMMITS: Commit[] = [ADA_BASE];

/**
 * Build a fake io object with injected readCommits, validateRef and readCommitsAtRef.
 * `refIsValid` controls whether validateRef throws or returns a sentinel SHA.
 */
function fakeIo(opts: {
  headCommits?: Commit[];
  baseCommits?: Commit[];
  refIsValid?: boolean;
}) {
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
// AC1: --compare <valid ref> → exit 0, stdout contains 'delta since <ref>'
// ---------------------------------------------------------------------------

test('AC1: --compare v0.1 (valid ref) → exit code 0', () => {
  const result = runCli(['/some/repo', '--compare', 'v0.1'], fakeIo({ refIsValid: true }));
  assert.equal(result.code, 0, `expected exit 0 but got ${result.code}; stderr: ${result.stderr}`);
});

test('AC1: --compare v0.1 (valid ref) → stdout contains "delta since v0.1"', () => {
  const result = runCli(['/some/repo', '--compare', 'v0.1'], fakeIo({ refIsValid: true }));
  assert.ok(
    result.stdout.includes('delta since v0.1'),
    `stdout does not contain 'delta since v0.1': ${result.stdout}`,
  );
});

test('AC1: --compare v0.1 → stderr is empty on success', () => {
  const result = runCli(['/some/repo', '--compare', 'v0.1'], fakeIo({ refIsValid: true }));
  assert.equal(result.stderr, '');
});

test('AC1: --compare v0.1 → stdout contains "delta since" (generic sentinel)', () => {
  const result = runCli(['/some/repo', '--compare', 'v0.1'], fakeIo({ refIsValid: true }));
  assert.match(result.stdout, /delta since/);
});

// ---------------------------------------------------------------------------
// AC2: --compare <nonexistent-ref> → exit 2, stderr contains the ref name
// ---------------------------------------------------------------------------

test('AC2: --compare nonexistent-ref (invalid ref) → exit code 2', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'nonexistent-ref'],
    fakeIo({ refIsValid: false }),
  );
  assert.equal(result.code, 2, `expected exit 2 but got ${result.code}; stderr: ${result.stderr}`);
});

test('AC2: --compare nonexistent-ref → stderr contains the ref name', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'nonexistent-ref'],
    fakeIo({ refIsValid: false }),
  );
  assert.ok(
    result.stderr.includes('nonexistent-ref'),
    `stderr does not contain 'nonexistent-ref': ${result.stderr}`,
  );
});

test('AC2: --compare nonexistent-ref → stdout is empty', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'nonexistent-ref'],
    fakeIo({ refIsValid: false }),
  );
  assert.equal(result.stdout, '');
});

test('AC2: --compare bad-sha-xyz (another unknown ref) → exit code 2', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'bad-sha-xyz'],
    fakeIo({ refIsValid: false }),
  );
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes('bad-sha-xyz'));
});

// ---------------------------------------------------------------------------
// AC3: --compare v0.1 --json → exit 0, stdout is valid JSON with 'delta' key
// ---------------------------------------------------------------------------

test('AC3: --compare v0.1 --json → exit code 0', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'v0.1', '--json'],
    fakeIo({ refIsValid: true }),
  );
  assert.equal(result.code, 0, `expected exit 0 but got ${result.code}; stderr: ${result.stderr}`);
});

test('AC3: --compare v0.1 --json → stdout is valid JSON', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'v0.1', '--json'],
    fakeIo({ refIsValid: true }),
  );
  let parsed: unknown;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(result.stdout);
  }, `stdout is not valid JSON: ${result.stdout}`);
  assert.ok(parsed !== null && typeof parsed === 'object');
});

test('AC3: --compare v0.1 --json → parsed JSON contains "delta" key', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'v0.1', '--json'],
    fakeIo({ refIsValid: true }),
  );
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok('delta' in parsed, `JSON output missing 'delta' key; keys: ${Object.keys(parsed).join(', ')}`);
});

test('AC3: --compare v0.1 --json → parsed JSON delta has commits key', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'v0.1', '--json'],
    fakeIo({ refIsValid: true }),
  );
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const delta = parsed['delta'] as Record<string, unknown>;
  assert.ok(
    typeof delta === 'object' && delta !== null && 'commits' in delta,
    `delta.commits missing; delta: ${JSON.stringify(delta)}`,
  );
});

test('AC3: --compare v0.1 --json → parsed JSON contains "ref" key matching the ref', () => {
  const result = runCli(
    ['/some/repo', '--compare', 'v0.1', '--json'],
    fakeIo({ refIsValid: true }),
  );
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(parsed['ref'], 'v0.1');
});

// ---------------------------------------------------------------------------
// AC4: no --compare flag → existing single-snapshot path is unchanged
// ---------------------------------------------------------------------------

test('AC4: without --compare → exit code 0', () => {
  const result = runCli(['/some/repo'], fakeIo({}));
  assert.equal(result.code, 0);
});

test('AC4: without --compare → stdout contains "gitpulse —"', () => {
  const result = runCli(['/some/repo'], fakeIo({}));
  assert.match(result.stdout, /gitpulse —/);
});

test('AC4: without --compare → stdout does NOT contain "delta since"', () => {
  const result = runCli(['/some/repo'], fakeIo({}));
  assert.ok(
    !result.stdout.includes('delta since'),
    `single-snapshot output should not contain 'delta since': ${result.stdout}`,
  );
});

test('AC4: without --compare --json → stdout is valid JSON without delta key', () => {
  const result = runCli(['/some/repo', '--json'], fakeIo({}));
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  // Single-snapshot JSON has 'totalCommits', not 'delta'
  assert.ok('totalCommits' in parsed, `expected totalCommits key; keys: ${Object.keys(parsed).join(', ')}`);
  assert.ok(!('delta' in parsed), `single-snapshot JSON should not have delta key`);
});

test('AC4: --since 2020-01-01 without --compare → single-snapshot path, exit 0', () => {
  const result = runCli(['/some/repo', '--since', '2020-01-01'], fakeIo({}));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /gitpulse —/);
});

test('AC4: --compare missing value → exit 2 with "--compare requires" in stderr', () => {
  const result = runCli(['/some/repo', '--compare'], fakeIo({}));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--compare requires/);
});
