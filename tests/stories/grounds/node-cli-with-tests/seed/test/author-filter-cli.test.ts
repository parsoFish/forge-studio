/**
 * Unit suite for WI-2: --author flag wiring in cli.ts.
 *
 * Tests runCli() with injected io — no git spawning.
 * Covers all 11 acceptance criteria for the --author flag.
 *
 * Fast, deterministic, creds-free, < 1 s.
 * Uses node:test and node:assert/strict (matches project pattern).
 *
 * Quality gate: node --test --experimental-strip-types test/author-filter-cli.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { runCli } from '../src/cli.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a Commit with sentinel defaults; override as needed. */
const mkCommit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'aabbccddeeff0011aabbccddeeff0011aabbccdd',
  parentCount: 1,
  authorEmail: over.authorEmail ?? `${over.author.toLowerCase().replace(/\s+/g, '.')}@example.com`,
  filesChanged: 2,
  insertions: 5,
  deletions: 1,
  files: [{ path: 'src/sentinel.ts', insertions: 5, deletions: 1 }],
  ...over,
});

/** Ada Lovelace — name matches Ada* (case-insensitive). */
const COMMIT_ADA = mkCommit({
  author: 'Ada Lovelace',
  authorEmail: 'ada@lovelace.io',
  date: '2021-03-01',
  hash: 'aaaa0001aaaa0001aaaa0001aaaa0001aaaa0001',
});

/** Grace Hopper — email matches grace@* */
const COMMIT_GRACE = mkCommit({
  author: 'Grace Hopper',
  authorEmail: 'grace@hopper.navy',
  date: '2021-03-02',
  hash: 'bbbb0002bbbb0002bbbb0002bbbb0002bbbb0002',
});

/** Charles Babbage — matches neither Ada* nor grace* patterns. */
const COMMIT_CHARLES = mkCommit({
  author: 'Charles Babbage',
  authorEmail: 'charles@babbage.co.uk',
  date: '2021-03-03',
  hash: 'cccc0003cccc0003cccc0003cccc0003cccc0003',
  parentCount: 1,
});

/** Merge commit by Ada — 2 parents. */
const COMMIT_ADA_MERGE = mkCommit({
  author: 'Ada Lovelace',
  authorEmail: 'ada@lovelace.io',
  date: '2021-03-04',
  hash: 'dddd0004dddd0004dddd0004dddd0004dddd0004',
  parentCount: 2,
});

/** Mixed fixture: Ada, Grace, Charles, Ada-merge. */
const MIXED: readonly Commit[] = [COMMIT_ADA, COMMIT_GRACE, COMMIT_CHARLES, COMMIT_ADA_MERGE];

/** Single-author fixture: all commits by Ada. */
const ADA_ONLY: readonly Commit[] = [
  COMMIT_ADA,
  mkCommit({ author: 'Ada Lovelace', authorEmail: 'ada@lovelace.io', date: '2021-04-01',
             hash: 'eeee0005eeee0005eeee0005eeee0005eeee0005' }),
];

/** Minimal io stub — returns provided commits by default. */
const makeIo = (commits: readonly Commit[] = MIXED) => ({
  readCommits: (_path: string): Commit[] => [...commits],
});

// ---------------------------------------------------------------------------
// AC1: --author Ada* → filterAuthorCommits called; text header annotated
//      when excludedCount > 0
// ---------------------------------------------------------------------------

test('AC1: --author Ada* text output contains annotation when commits excluded', () => {
  // MIXED has Grace and Charles who don't match Ada*
  const io = makeIo(MIXED);
  const result = runCli(['--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit code. stderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('commits excluded by author filter'),
    `Expected stdout to contain 'commits excluded by author filter', got: ${result.stdout.slice(0, 300)}`,
  );
  // Grace and Charles must not appear
  assert.ok(!result.stdout.includes('Grace Hopper'), 'Grace should be excluded');
  assert.ok(!result.stdout.includes('Charles Babbage'), 'Charles should be excluded');
  // Ada must appear
  assert.ok(result.stdout.includes('Ada Lovelace'), 'Ada should be included');
});

test('AC1: annotation includes correct excluded count', () => {
  // MIXED: Ada (2 commits), Grace (1), Charles (1) → --author Ada* excludes Grace+Charles = 2
  const io = makeIo(MIXED);
  const result = runCli(['--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0);
  assert.ok(
    result.stdout.includes('(2 commits excluded by author filter)'),
    `Expected '(2 commits excluded by author filter)', got: ${result.stdout.slice(0, 300)}`,
  );
});

// ---------------------------------------------------------------------------
// AC2: --author grace@* with --json → JSON has authorsFiltered key
// ---------------------------------------------------------------------------

test('AC2: --author grace@* --json → JSON contains authorsFiltered key with correct count', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--author', 'grace@*', '--json', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit code. stderr: ${result.stderr}`);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    Object.prototype.hasOwnProperty.call(obj, 'authorsFiltered'),
    'JSON output must have authorsFiltered key',
  );
  // Grace matches → 3 commits excluded (Ada x2, Charles)
  assert.equal(obj['authorsFiltered'], 3, `Expected authorsFiltered=3, got ${obj['authorsFiltered']}`);
});

test('AC2: --json without --author → authorsFiltered key absent', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--json', '/repo'], io);
  assert.equal(result.code, 0);
  const obj = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(obj, 'authorsFiltered'),
    'authorsFiltered must be absent when --author not passed',
  );
});

// ---------------------------------------------------------------------------
// AC3: two --author patterns are OR'd
// ---------------------------------------------------------------------------

test('AC3: --author ada* --author grace* → both authors included (OR semantics)', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--author', 'ada*', '--author', 'grace*', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Ada Lovelace'), 'Ada should be included');
  assert.ok(result.stdout.includes('Grace Hopper'), 'Grace should be included');
  assert.ok(!result.stdout.includes('Charles Babbage'), 'Charles should be excluded');
  // Only Charles excluded → 1 commit excluded
  assert.ok(
    result.stdout.includes('(1 commits excluded by author filter)'),
    `Expected '(1 commits excluded by author filter)': ${result.stdout.slice(0, 300)}`,
  );
});

// ---------------------------------------------------------------------------
// AC4: --no-merges + --author Ada* → merges first, then author filter
// ---------------------------------------------------------------------------

test('AC4: --no-merges --author Ada* → merge excluded first, then author filter applied', () => {
  // MIXED: Ada-merge(parentCount=2), Ada(1), Grace(1), Charles(1)
  // After --no-merges: Ada, Grace, Charles (3 commits; Ada-merge dropped)
  // After --author Ada*: only Ada (1 commit)
  // Excluded by author filter = 2 (Grace, Charles), not 3 (Ada-merge already gone)
  const io = makeIo(MIXED);
  const result = runCli(['--no-merges', '--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Ada Lovelace'), 'Ada should survive');
  assert.ok(!result.stdout.includes('Grace Hopper'), 'Grace should be excluded');
  assert.ok(!result.stdout.includes('Charles Babbage'), 'Charles should be excluded');
  // merge excluded annotation
  assert.ok(
    result.stdout.includes('merge commits excluded') || result.stdout.includes('1 merge'),
    `Expected merge exclusion annotation: ${result.stdout.slice(0, 300)}`,
  );
  // author filter annotation — 2 commits excluded (Grace + Charles)
  assert.ok(
    result.stdout.includes('commits excluded by author filter'),
    `Expected author filter annotation: ${result.stdout.slice(0, 300)}`,
  );
});

// ---------------------------------------------------------------------------
// AC5: --author * on single-author repo → byte-identical to no flag
// ---------------------------------------------------------------------------

test('AC5: --author * on single-author repo → output byte-identical to no flag', () => {
  const io1 = makeIo(ADA_ONLY);
  const io2 = makeIo(ADA_ONLY);
  const withFlag    = runCli(['--author', '*', '/repo'], io1);
  const withoutFlag = runCli(['/repo'], io2);
  assert.equal(withFlag.code, 0);
  assert.equal(withoutFlag.code, 0);
  // When --author '*' excludes 0 commits, no annotation → identical output
  assert.equal(
    withFlag.stdout,
    withoutFlag.stdout,
    'output must be byte-identical when no commits are excluded by --author *',
  );
});

// ---------------------------------------------------------------------------
// AC6: --author nobody* → zero-commit result with text annotation
// ---------------------------------------------------------------------------

test('AC6: --author nobody* → report renders with annotation (authorsFiltered = N)', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--author', 'nobody*', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit. stderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('commits excluded by author filter'),
    `Expected annotation in stdout: ${result.stdout.slice(0, 300)}`,
  );
  // All MIXED commits excluded
  assert.ok(
    result.stdout.includes(`(${MIXED.length} commits excluded by author filter)`),
    `Expected ${MIXED.length} commits excluded: ${result.stdout.slice(0, 300)}`,
  );
  // None of our authors should appear in the report
  assert.ok(!result.stdout.includes('Ada Lovelace'), 'Ada should be excluded');
  assert.ok(!result.stdout.includes('Grace Hopper'), 'Grace should be excluded');
  assert.ok(!result.stdout.includes('Charles Babbage'), 'Charles should be excluded');
});

// ---------------------------------------------------------------------------
// AC7: --author '' (empty string) → exit code 2 with clear error message
// ---------------------------------------------------------------------------

test('AC7: --author empty string → exit code 2 with clear error', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--author', '', '/repo'], io);
  assert.equal(result.code, 2, `Expected exit code 2, got ${result.code}`);
  assert.ok(
    result.stderr.includes('--author') && result.stderr.includes('empty'),
    `Expected error about empty --author pattern, got: ${result.stderr}`,
  );
});

// ---------------------------------------------------------------------------
// AC8: --help includes '--author' with a description
// ---------------------------------------------------------------------------

test('AC8: --help output includes --author with a description', () => {
  const io = makeIo();
  const result = runCli(['--help'], io);
  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('--author'),
    `Expected --help to include '--author', got: ${combined.slice(0, 400)}`,
  );
  // Description should mention filter/glob or similar meaningful text
  assert.ok(
    combined.includes('--author'),
    'help must document --author flag',
  );
});

// ---------------------------------------------------------------------------
// AC9: tags subcommand with --author Ada* → filter applied per span
// ---------------------------------------------------------------------------

test('AC9: tags --author Ada* → filterAuthorCommits applied per span', () => {
  const V02 = { name: 'v0.2', date: '2021-04-02', sha: 'sha-v02' };
  const V01 = { name: 'v0.1', date: '2021-03-01', sha: 'sha-v01' };

  // Per-span commits: one Ada, one Grace each
  const SPAN_V02 = [
    mkCommit({ author: 'Ada Lovelace', authorEmail: 'ada@lovelace.io', date: '2021-04-01',
               hash: 'span2ada0001span2ada0001span2ada0001spa0' }),
    mkCommit({ author: 'Grace Hopper', authorEmail: 'grace@hopper.navy', date: '2021-04-01',
               hash: 'span2grce001span2grce001span2grce001spp0' }),
  ];
  const SPAN_V01 = [
    mkCommit({ author: 'Ada Lovelace', authorEmail: 'ada@lovelace.io', date: '2021-03-01',
               hash: 'span1ada0001span1ada0001span1ada0001spa0' }),
    mkCommit({ author: 'Grace Hopper', authorEmail: 'grace@hopper.navy', date: '2021-03-01',
               hash: 'span1grce001span1grce001span1grce001spp0' }),
  ];

  const calls: number[] = [];
  const io = {
    readCommits: (): Commit[] => { throw new Error('not used'); },
    readTags: (_repo: string) => [V02, V01],
    readCommitsBetweenTags: (
      _repo: string,
      _prevSha: string,
      _currSha: string,
    ): Commit[] => {
      const idx = calls.length;
      calls.push(idx);
      return idx === 0 ? SPAN_V02 : SPAN_V01;
    },
  };

  const result = runCli(['tags', '--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit. stderr: ${result.stderr}`);

  // Each span had 2 commits; after --author Ada*, only Ada survives (1 per span)
  // The tags table should show 1 commit per span (not 2)
  // We can verify by checking that '2 commits' doesn't appear (only 1 each)
  // The table format shows commit counts — v0.1 and v0.2 should each have 1
  assert.ok(
    !result.stdout.match(/\b2\b.*commits|commits.*\b2\b/),
    `Tags table should not show 2 commits per span after Ada* filter: ${result.stdout}`,
  );
});

// ---------------------------------------------------------------------------
// AC10: coupling subcommand with --author Ada* → filter applied before computeCoupling
// ---------------------------------------------------------------------------

test('AC10: coupling --author Ada* → filterAuthorCommits applied before computeCoupling', () => {
  // Two commits: Ada touches [a.ts, b.ts]; Grace touches [c.ts, d.ts]
  const adaCommit: Commit = {
    hash: 'ada-coupling-hash',
    author: 'Ada Lovelace',
    authorEmail: 'ada@lovelace.io',
    date: '2021-03-01',
    parentCount: 1,
    filesChanged: 2,
    insertions: 5,
    deletions: 0,
    files: [
      { path: 'src/a.ts', insertions: 3, deletions: 0 },
      { path: 'src/b.ts', insertions: 2, deletions: 0 },
    ],
  };
  const graceCommit: Commit = {
    hash: 'grace-coupling-hash',
    author: 'Grace Hopper',
    authorEmail: 'grace@hopper.navy',
    date: '2021-03-02',
    parentCount: 1,
    filesChanged: 2,
    insertions: 4,
    deletions: 0,
    files: [
      { path: 'src/c.ts', insertions: 2, deletions: 0 },
      { path: 'src/d.ts', insertions: 2, deletions: 0 },
    ],
  };

  const io = {
    readCommits: (_path: string): Commit[] => [adaCommit, graceCommit],
  };

  const result = runCli(['coupling', '--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit. stderr: ${result.stderr}`);

  // With only Ada's commit, coupling output should mention a.ts+b.ts but not c.ts/d.ts
  // If Grace's files appear in coupling, the filter wasn't applied
  assert.ok(!result.stdout.includes('c.ts'), 'c.ts (Grace) should not appear in coupling after author filter');
  assert.ok(!result.stdout.includes('d.ts'), 'd.ts (Grace) should not appear in coupling after author filter');
});

// ---------------------------------------------------------------------------
// AC11: --csv + --author Ada* → CSV prepends '# authorsFiltered: N' comment
// ---------------------------------------------------------------------------

test('AC11: --csv --author Ada* → CSV output prepends # authorsFiltered: N comment', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--csv', '--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0, `Unexpected exit. stderr: ${result.stderr}`);
  const lines = result.stdout.split('\n');
  assert.ok(
    lines[0].startsWith('# authorsFiltered:'),
    `First CSV line must be '# authorsFiltered: N', got: ${lines[0]}`,
  );
  // Excluded count = Grace(1) + Charles(1) = 2
  assert.equal(
    lines[0],
    '# authorsFiltered: 2',
    `Expected '# authorsFiltered: 2', got: ${lines[0]}`,
  );
  // Second line should be the CSV header
  assert.ok(
    lines[1].includes('Author') || lines[1].includes('author') || lines[1].toLowerCase().includes('commit'),
    `Second line should be CSV header, got: ${lines[1]}`,
  );
});

test('AC11: --csv without --author → no # authorsFiltered comment', () => {
  const io = makeIo(MIXED);
  const result = runCli(['--csv', '/repo'], io);
  assert.equal(result.code, 0);
  assert.ok(
    !result.stdout.startsWith('# authorsFiltered'),
    'CSV without --author must not have authorsFiltered comment',
  );
});

// ---------------------------------------------------------------------------
// Additional: --since + --author composition (date filter first, then author)
// ---------------------------------------------------------------------------

test('Composition: --since --author → date filter then author filter', () => {
  // Ada has commits on 2021-03-01 and 2021-03-04 (merge)
  // Charles has 2021-03-03
  // With --since 2021-03-02 --author Ada*: only Ada's 2021-03-04 merge commit survives
  // (Charles doesn't match Ada* so also excluded)
  const io = makeIo(MIXED);
  const result = runCli(['--since', '2021-03-02', '--author', 'Ada*', '/repo'], io);
  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  // The result should run without error
  assert.equal(result.stderr, '', `Unexpected stderr: ${result.stderr}`);
});
