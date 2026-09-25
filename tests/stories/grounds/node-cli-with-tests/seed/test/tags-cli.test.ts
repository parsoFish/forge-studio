/**
 * Unit tests for the `gitpulse tags` CLI subcommand (WI-3).
 * All tests use injected io — no git spawning, no I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../src/cli.ts';
import type { TagEntry, Commit } from '../src/git.ts';

// ============================================================
// Shared fixtures (matches the acceptance fixture / WI specs)
// ============================================================

const V03: TagEntry = { name: 'v0.3', date: '2021-04-03', sha: 'sha-v03' };
const V02: TagEntry = { name: 'v0.2', date: '2021-03-15', sha: 'sha-v02' };
const V01: TagEntry = { name: 'v0.1', date: '2021-03-02', sha: 'sha-v01' };

const TAGS_3: TagEntry[] = [V03, V02, V01]; // newest-first

function makeCommit(author: string, file = 'src/a.ts'): Commit {
  return {
    hash: `hash-${Math.random()}`,
    author,
    date: '2021-01-01',
    parentCount: 1,
    authorEmail: '',
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
    files: [{ path: file, insertions: 1, deletions: 0 }],
  };
}

const ADA   = 'Ada Lovelace';
const GRACE = 'Grace Hopper';

// Per-span commits (2 per span, 2 distinct authors each)
const COMMITS_V03 = [makeCommit(ADA), makeCommit(GRACE)];
const COMMITS_V02 = [makeCommit(ADA), makeCommit(GRACE)];
const COMMITS_V01 = [makeCommit(ADA), makeCommit(GRACE)];

/**
 * Build an io object for the tags subcommand.
 * tagsList: tags returned by readTags (newest-first).
 * commitMap: map from prevSha+':'+currSha → Commit[] returned per span.
 *
 * For convenience if commitMap is a simple Commit[][] array, it maps spans in order.
 */
function makeIo(
  tagsList: TagEntry[],
  commitsByIndex: Commit[][],
) {
  const calls: Array<[string, string]> = []; // track [prevSha, currSha] calls in order
  return {
    readCommits: (): Commit[] => { throw new Error('not used'); },
    readTags: (_repo: string): TagEntry[] => tagsList,
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

// ============================================================
// Text table output (AC-9)
// ============================================================

test('tags: text table contains column headers', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '/repo'], io);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Tag/);
  assert.match(result.stdout, /Date/);
  assert.match(result.stdout, /Commits/);
  assert.match(result.stdout, /Authors/);
  assert.match(result.stdout, /Days since prev/);
});

test('tags: text table has rows for v0.3, v0.2, v0.1 newest-first', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '/repo'], io);
  assert.equal(result.code, 0);
  const lines = result.stdout.split('\n');
  // Find positions of v0.3, v0.2, v0.1 in the output
  const v03Idx = lines.findIndex(l => l.includes('v0.3'));
  const v02Idx = lines.findIndex(l => l.includes('v0.2'));
  const v01Idx = lines.findIndex(l => l.includes('v0.1'));
  assert.ok(v03Idx !== -1, 'v0.3 row missing');
  assert.ok(v02Idx !== -1, 'v0.2 row missing');
  assert.ok(v01Idx !== -1, 'v0.1 row missing');
  // Newest first: v0.3 should appear before v0.2 before v0.1
  assert.ok(v03Idx < v02Idx, 'v0.3 should appear before v0.2');
  assert.ok(v02Idx < v01Idx, 'v0.2 should appear before v0.1');
});

test('tags: v0.1 (oldest) shows em dash (—) in Days column', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '/repo'], io);
  assert.equal(result.code, 0);
  // Find the v0.1 row
  const v01Line = result.stdout.split('\n').find(l => l.includes('v0.1'));
  assert.ok(v01Line !== undefined, 'v0.1 row missing');
  assert.ok(v01Line.includes('—'), `v0.1 row must have em dash for Days column; got: "${v01Line}"`);
});

test('tags: footer line shows median inter-tag gap', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '/repo'], io);
  assert.equal(result.code, 0);
  // Median of [13, 19] = 16
  assert.match(result.stdout, /Median inter-tag gap: 16 days/);
});

// ============================================================
// Zero tags (AC-10)
// ============================================================

test('tags: zero tags → "no tags found" and exit code 0', () => {
  const io = makeIo([], []);
  const result = runCli(['tags', '/repo'], io);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /no tags found/i);
});

// ============================================================
// JSON output (AC-11)
// ============================================================

test('tags --json: output is valid JSON with required keys', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--json', '/repo'], io);
  assert.equal(result.code, 0);
  let parsed: ReturnType<typeof JSON.parse>;
  assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, 'output must be valid JSON');
  assert.ok('tags' in parsed, 'JSON must have "tags" key');
  assert.ok('medianGapDays' in parsed, 'JSON must have "medianGapDays" key');
  assert.ok(Array.isArray(parsed.tags), '"tags" must be an array');
  assert.equal(parsed.tags.length, 3);
});

test('tags --json: medianGapDays is 16 for 3-tag fixture', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--json', '/repo'], io);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.medianGapDays, 16);
});

test('tags --json: v0.1 daysSince is null (not omitted)', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--json', '/repo'], io);
  const parsed = JSON.parse(result.stdout);
  const v01 = parsed.tags.find((t: { name: string }) => t.name === 'v0.1');
  assert.ok(v01 !== undefined, 'v0.1 entry missing in JSON tags array');
  assert.equal(v01.daysSince, null, 'v0.1.daysSince must be null, not omitted');
});

test('tags --json: v0.3 has expected fields', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--json', '/repo'], io);
  const parsed = JSON.parse(result.stdout);
  const v03 = parsed.tags.find((t: { name: string }) => t.name === 'v0.3');
  assert.ok(v03, 'v0.3 missing from tags array');
  assert.equal(v03.commitsSince,  2);
  assert.equal(v03.uniqueAuthors, 2);
  assert.equal(v03.daysSince,     19);
});

// ============================================================
// CSV output (AC-12)
// ============================================================

test('tags --csv: header row is correct', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--csv', '/repo'], io);
  assert.equal(result.code, 0);
  const lines = result.stdout.split('\n');
  assert.equal(lines[0], 'Tag,Date,Commits Since Prev,Unique Authors,Days Since Prev');
});

test('tags --csv: has 3 data rows (newest-first)', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--csv', '/repo'], io);
  const lines = result.stdout.split('\n');
  // lines[0] = header, lines[1..3] = data rows, last = median row
  assert.equal(lines[1].startsWith('v0.3'), true, 'first data row should be v0.3');
  assert.equal(lines[2].startsWith('v0.2'), true, 'second data row should be v0.2');
  assert.equal(lines[3].startsWith('v0.1'), true, 'third data row should be v0.1');
});

test('tags --csv: v0.1 Days Since Prev cell is empty (not "null")', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--csv', '/repo'], io);
  const lines = result.stdout.split('\n');
  const v01Row = lines.find(l => l.startsWith('v0.1'));
  assert.ok(v01Row !== undefined, 'v0.1 row missing');
  // The row should end with a comma and nothing after (empty cell)
  assert.ok(v01Row.endsWith(','), `v0.1 row Days Since Prev must be empty; got: "${v01Row}"`);
  assert.ok(!v01Row.includes('null'), 'Days Since Prev must NOT be the string "null"');
});

test('tags --csv: trailing Median Gap Days row is present', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--csv', '/repo'], io);
  const lines = result.stdout.split('\n');
  const medianRow = lines.find(l => l.startsWith('Median Gap Days,'));
  assert.ok(medianRow !== undefined, 'Median Gap Days row missing');
  assert.equal(medianRow, 'Median Gap Days,16');
});

// ============================================================
// --since / --until filter (AC-13)
// ============================================================

test('tags --since --until: only v0.2 (in-window) appears when window=2021-05-01..2021-12-31', () => {
  // Fixture: v0.3=2022-01-01, v0.2=2021-06-01, v0.1=2021-01-01
  const tagsFiltered: TagEntry[] = [
    { name: 'v0.3', date: '2022-01-01', sha: 'sha-v03' },
    { name: 'v0.2', date: '2021-06-01', sha: 'sha-v02' },
    { name: 'v0.1', date: '2021-01-01', sha: 'sha-v01' },
  ];
  const io = makeIo(tagsFiltered, [
    [makeCommit(ADA)],  // v0.2 (only tag in window)
  ]);
  const result = runCli(['tags', '--since', '2021-05-01', '--until', '2021-12-31', '/repo'], io);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /v0\.2/);
  assert.doesNotMatch(result.stdout, /v0\.3/);
  assert.doesNotMatch(result.stdout, /v0\.1/);
});

// ============================================================
// --exclude interaction (AC-14)
// ============================================================

test('tags --exclude: command accepts --exclude without error and exits 0', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  const result = runCli(['tags', '--exclude', 'dist', '/repo'], io);
  assert.equal(result.code, 0, `Expected exit 0 but got ${result.code}; stderr: ${result.stderr}`);
});

test('tags --exclude dist: commits touching only excluded paths are not counted', () => {
  // For the v0.3 span: one commit touches src/ (kept), one touches dist/ only (excluded)
  const keptCommit = makeCommit(ADA, 'src/a.ts');
  const excludedCommit: Commit = {
    hash: 'hash-excluded',
    author: ADA,
    date: '2021-01-01',
    parentCount: 1,
    authorEmail: '',
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
    files: [{ path: 'dist/bundle.js', insertions: 1, deletions: 0 }],
  };
  // io.readCommitsBetweenTags should receive excludePaths=['dist'] and return only keptCommit
  const ioExclude = {
    readCommits: (): Commit[] => { throw new Error('not used'); },
    readTags: (_repo: string): TagEntry[] => [V03, V01],
    readCommitsBetweenTags: (
      _repo: string,
      _prevSha: string,
      _currSha: string,
      excludePaths?: readonly string[],
    ): Commit[] => {
      // Simulate the exclude filtering: only return commits whose files are not excluded
      if (excludePaths && excludePaths.includes('dist')) {
        return [keptCommit]; // excluded commit filtered out
      }
      return [keptCommit, excludedCommit];
    },
  };

  const result = runCli(['tags', '--exclude', 'dist', '/repo'], ioExclude);
  assert.equal(result.code, 0);
  // v0.3 commitsSince should be 1 (only the kept commit)
  assert.match(result.stdout, /v0\.3/);
});

// ============================================================
// Exit code 0 for all standard output modes
// ============================================================

test('tags: exit code is 0 for text output', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(runCli(['tags', '/repo'], io).code, 0);
});

test('tags: exit code is 0 for --json output', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(runCli(['tags', '--json', '/repo'], io).code, 0);
});

test('tags: exit code is 0 for --csv output', () => {
  const io = makeIo(TAGS_3, [COMMITS_V03, COMMITS_V02, COMMITS_V01]);
  assert.equal(runCli(['tags', '--csv', '/repo'], io).code, 0);
});
