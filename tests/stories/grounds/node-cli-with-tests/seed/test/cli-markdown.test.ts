/**
 * CLI tests for the --markdown flag (WI-2).
 *
 * All tests use injected io — no git spawning, no I/O.
 *
 * Acceptance criteria covered:
 *   AC1: single-snapshot --markdown → GFM table (first char |; second line delimiter row)
 *   AC2: --compare --markdown → GFM table
 *   AC3: tags --markdown → GFM table
 *   AC4: coupling --markdown → GFM table
 *   AC5: --markdown --json conflict → non-zero exit, stderr names both flags, stdout empty
 *   AC6: --markdown --csv conflict → non-zero exit, stderr names both flags, stdout empty
 *   AC7: --csv --markdown conflict (order reversed) → same as AC6
 *   AC8: --help with --markdown → USAGE includes '--markdown'
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../src/cli.ts';
import type { Commit } from '../src/git.ts';
import type { TagEntry } from '../src/git.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Commit for use in tests. */
function makeCommit(over: Partial<Commit> & { author: string; date: string }): Commit {
  return {
    hash: 'deadbeef',
    parentCount: 1,
    authorEmail: '',
    filesChanged: 1,
    insertions: 10,
    deletions: 2,
    files: [{ path: 'src/foo.ts', insertions: 10, deletions: 2 }],
    ...over,
  };
}

const ADA   = 'Ada Lovelace';
const GRACE = 'Grace Hopper';

const HEAD_COMMITS: Commit[] = [
  makeCommit({ author: ADA,   date: '2024-03-01', insertions: 15, deletions: 3 }),
  makeCommit({ author: GRACE, date: '2024-02-15', insertions: 8,  deletions: 1 }),
];
const BASE_COMMITS: Commit[] = [
  makeCommit({ author: ADA, date: '2024-01-10', insertions: 5, deletions: 1 }),
];

/** Fake io that serves HEAD_COMMITS for readCommits and BASE_COMMITS for readCommitsAtRef. */
function makeIo(opts?: { refIsValid?: boolean; headCommits?: Commit[]; baseCommits?: Commit[] }) {
  const {
    refIsValid = true,
    headCommits = HEAD_COMMITS,
    baseCommits = BASE_COMMITS,
  } = opts ?? {};
  return {
    readCommits: (_path: string): Commit[] => [...headCommits],
    validateRef: (_path: string, ref: string): string => {
      if (!refIsValid) throw new Error(`gitpulse: unknown ref '${ref}'`);
      return 'abc1234def5678abc1234def5678abc1234def5678';
    },
    readCommitsAtRef: (_path: string, _ref: string): Commit[] => [...baseCommits],
    readTags: (_path: string): TagEntry[] => [],
    readCommitsBetweenTags: (): Commit[] => [],
  };
}

// Tags test fixtures
const V03: TagEntry = { name: 'v0.3', date: '2021-04-03', sha: 'sha-v03' };
const V02: TagEntry = { name: 'v0.2', date: '2021-03-15', sha: 'sha-v02' };
const V01: TagEntry = { name: 'v0.1', date: '2021-03-02', sha: 'sha-v01' };
const TAGS_3: TagEntry[] = [V03, V02, V01];

const TAG_COMMITS: Commit[] = [
  makeCommit({ author: ADA,   date: '2021-04-01' }),
  makeCommit({ author: GRACE, date: '2021-03-20' }),
];

function makeTagsIo(tags: TagEntry[], commitsByIndex: Commit[][]) {
  const calls: Array<[string, string]> = [];
  return {
    readCommits: (): Commit[] => [...HEAD_COMMITS],
    readTags: (_repo: string): TagEntry[] => tags,
    readCommitsBetweenTags: (
      _repo: string,
      prevSha: string,
      currSha: string,
      _excludePaths?: readonly string[],
    ): Commit[] => {
      const idx = calls.length;
      calls.push([prevSha, currSha]);
      return commitsByIndex[idx] ?? [];
    },
  };
}

// Coupling test fixtures: two commits that both touch src/a.ts and src/b.ts → coupling pair
const COUPLING_COMMITS: Commit[] = [
  {
    hash: 'c1',
    author: ADA,
    date: '2024-03-01',
    parentCount: 1,
    authorEmail: '',
    filesChanged: 2,
    insertions: 5,
    deletions: 1,
    files: [
      { path: 'src/a.ts', insertions: 3, deletions: 0 },
      { path: 'src/b.ts', insertions: 2, deletions: 1 },
    ],
  },
  {
    hash: 'c2',
    author: GRACE,
    date: '2024-03-02',
    parentCount: 1,
    authorEmail: '',
    filesChanged: 2,
    insertions: 4,
    deletions: 2,
    files: [
      { path: 'src/a.ts', insertions: 2, deletions: 1 },
      { path: 'src/b.ts', insertions: 2, deletions: 1 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the first GFM table in stdout and assert structure:
 * - There is at least one line starting with '|'
 * - The line immediately following it is a GFM delimiter row /^\|[ :-]+\|/
 *
 * This handles renderers that output header text before the first table.
 */
function assertGfmTable(stdout: string, label: string): void {
  const lines = stdout.split('\n');
  // Find the first line that starts with '|' (table header row)
  const firstTableLineIdx = lines.findIndex((l) => l.startsWith('|'));
  assert.ok(
    firstTableLineIdx !== -1,
    `${label}: no GFM table line found in stdout. Got: ${JSON.stringify(stdout.slice(0, 100))}`,
  );
  assert.equal(
    lines[firstTableLineIdx][0],
    '|',
    `${label}: first table line should start with '|'`,
  );
  const delimiterLine = lines[firstTableLineIdx + 1] ?? '';
  assert.match(
    delimiterLine,
    /^\|[ :-]+\|/,
    `${label}: line after header should be GFM delimiter row, got: ${JSON.stringify(delimiterLine)}`,
  );
}

/**
 * Get the first character of the first GFM table line in stdout.
 * Returns '|' if a table line is present.
 */
function firstTableChar(stdout: string): string {
  const line = stdout.split('\n').find((l) => l.startsWith('|'));
  return line ? line[0] : '';
}

// ---------------------------------------------------------------------------
// AC1: single-snapshot --markdown → GFM table
// ---------------------------------------------------------------------------

test('AC1: single-snapshot --markdown → exit code 0', () => {
  const result = runCli(['/repo', '--markdown'], makeIo());
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
});

test('AC1: single-snapshot --markdown → first table line starts with |', () => {
  const result = runCli(['/repo', '--markdown'], makeIo());
  assert.equal(firstTableChar(result.stdout), '|', `stdout: ${result.stdout.slice(0, 100)}`);
});

test('AC1: single-snapshot --markdown → second line is GFM delimiter row', () => {
  const result = runCli(['/repo', '--markdown'], makeIo());
  assertGfmTable(result.stdout, 'AC1');
});

test('AC1: single-snapshot --markdown → stderr is empty', () => {
  const result = runCli(['/repo', '--markdown'], makeIo());
  assert.equal(result.stderr, '', `unexpected stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC2: --compare --markdown → GFM table with delta
// ---------------------------------------------------------------------------

test('AC2: --compare --markdown → exit code 0', () => {
  const result = runCli(['/repo', '--compare', 'v0.1', '--markdown'], makeIo());
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
});

test('AC2: --compare --markdown → first table line starts with |', () => {
  const result = runCli(['/repo', '--compare', 'v0.1', '--markdown'], makeIo());
  assert.equal(firstTableChar(result.stdout), '|', `stdout: ${result.stdout.slice(0, 100)}`);
});

test('AC2: --compare --markdown → second line is GFM delimiter row', () => {
  const result = runCli(['/repo', '--compare', 'v0.1', '--markdown'], makeIo());
  assertGfmTable(result.stdout, 'AC2');
});

test('AC2: --compare --markdown → stderr is empty', () => {
  const result = runCli(['/repo', '--compare', 'v0.1', '--markdown'], makeIo());
  assert.equal(result.stderr, '', `unexpected stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC3: tags --markdown → GFM table
// ---------------------------------------------------------------------------

test('AC3: tags --markdown → exit code 0', () => {
  const io = makeTagsIo(TAGS_3, [TAG_COMMITS, TAG_COMMITS, TAG_COMMITS]);
  const result = runCli(['tags', '/repo', '--markdown'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
});

test('AC3: tags --markdown → first table line starts with |', () => {
  const io = makeTagsIo(TAGS_3, [TAG_COMMITS, TAG_COMMITS, TAG_COMMITS]);
  const result = runCli(['tags', '/repo', '--markdown'], io);
  assert.equal(firstTableChar(result.stdout), '|', `stdout: ${result.stdout.slice(0, 100)}`);
});

test('AC3: tags --markdown → second line is GFM delimiter row', () => {
  const io = makeTagsIo(TAGS_3, [TAG_COMMITS, TAG_COMMITS, TAG_COMMITS]);
  const result = runCli(['tags', '/repo', '--markdown'], io);
  assertGfmTable(result.stdout, 'AC3');
});

test('AC3: tags --markdown → stderr is empty', () => {
  const io = makeTagsIo(TAGS_3, [TAG_COMMITS, TAG_COMMITS, TAG_COMMITS]);
  const result = runCli(['tags', '/repo', '--markdown'], io);
  assert.equal(result.stderr, '', `unexpected stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC4: coupling --markdown → GFM table
// ---------------------------------------------------------------------------

test('AC4: coupling --markdown → exit code 0', () => {
  const io = { readCommits: (): Commit[] => [...COUPLING_COMMITS] };
  const result = runCli(['coupling', '/repo', '--markdown'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
});

test('AC4: coupling --markdown → first table line starts with |', () => {
  const io = { readCommits: (): Commit[] => [...COUPLING_COMMITS] };
  const result = runCli(['coupling', '/repo', '--markdown'], io);
  assert.equal(firstTableChar(result.stdout), '|', `stdout: ${result.stdout.slice(0, 100)}`);
});

test('AC4: coupling --markdown → second line is GFM delimiter row', () => {
  const io = { readCommits: (): Commit[] => [...COUPLING_COMMITS] };
  const result = runCli(['coupling', '/repo', '--markdown'], io);
  assertGfmTable(result.stdout, 'AC4');
});

test('AC4: coupling --markdown → stderr is empty', () => {
  const io = { readCommits: (): Commit[] => [...COUPLING_COMMITS] };
  const result = runCli(['coupling', '/repo', '--markdown'], io);
  assert.equal(result.stderr, '', `unexpected stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC5: --markdown and --json conflict
// ---------------------------------------------------------------------------

test('AC5: --markdown --json → non-zero exit code', () => {
  const result = runCli(['/repo', '--markdown', '--json'], makeIo());
  assert.notEqual(result.code, 0, 'expected non-zero exit code');
});

test('AC5: --markdown --json → stdout is empty', () => {
  const result = runCli(['/repo', '--markdown', '--json'], makeIo());
  assert.equal(result.stdout, '', `stdout should be empty, got: ${result.stdout}`);
});

test('AC5: --markdown --json → stderr mentions --markdown', () => {
  const result = runCli(['/repo', '--markdown', '--json'], makeIo());
  assert.match(result.stderr, /markdown/i, `stderr: ${result.stderr}`);
});

test('AC5: --markdown --json → stderr mentions --json', () => {
  const result = runCli(['/repo', '--markdown', '--json'], makeIo());
  assert.match(result.stderr, /json/i, `stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC6: --markdown and --csv conflict
// ---------------------------------------------------------------------------

test('AC6: --markdown --csv → non-zero exit code', () => {
  const result = runCli(['/repo', '--markdown', '--csv'], makeIo());
  assert.notEqual(result.code, 0, 'expected non-zero exit code');
});

test('AC6: --markdown --csv → stdout is empty', () => {
  const result = runCli(['/repo', '--markdown', '--csv'], makeIo());
  assert.equal(result.stdout, '', `stdout should be empty, got: ${result.stdout}`);
});

test('AC6: --markdown --csv → stderr mentions --markdown', () => {
  const result = runCli(['/repo', '--markdown', '--csv'], makeIo());
  assert.match(result.stderr, /markdown/i, `stderr: ${result.stderr}`);
});

test('AC6: --markdown --csv → stderr mentions --csv', () => {
  const result = runCli(['/repo', '--markdown', '--csv'], makeIo());
  assert.match(result.stderr, /csv/i, `stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC7: --csv --markdown (order reversed) — same conflict
// ---------------------------------------------------------------------------

test('AC7: --csv --markdown (order reversed) → non-zero exit code', () => {
  const result = runCli(['/repo', '--csv', '--markdown'], makeIo());
  assert.notEqual(result.code, 0, 'expected non-zero exit code');
});

test('AC7: --csv --markdown (order reversed) → stdout is empty', () => {
  const result = runCli(['/repo', '--csv', '--markdown'], makeIo());
  assert.equal(result.stdout, '', `stdout should be empty, got: ${result.stdout}`);
});

test('AC7: --csv --markdown (order reversed) → stderr mentions markdown', () => {
  const result = runCli(['/repo', '--csv', '--markdown'], makeIo());
  assert.match(result.stderr, /markdown/i, `stderr: ${result.stderr}`);
});

test('AC7: --csv --markdown (order reversed) → stderr mentions csv', () => {
  const result = runCli(['/repo', '--csv', '--markdown'], makeIo());
  assert.match(result.stderr, /csv/i, `stderr: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// AC8: --help with --markdown → USAGE includes --markdown in Options section
// ---------------------------------------------------------------------------

test('AC8: --help --markdown → exit code 0', () => {
  const result = runCli(['--help', '--markdown'], makeIo());
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
});

test('AC8: --help --markdown → USAGE mentions --markdown', () => {
  // The implementation returns USAGE to stderr (that is how gitpulse --help works)
  const result = runCli(['--help', '--markdown'], makeIo());
  const usageText = result.stderr + result.stdout;
  assert.match(usageText, /--markdown/, `USAGE does not mention --markdown; got: ${usageText.slice(0, 200)}`);
});
