/**
 * Unit tests for parseTagsOutput and the excludePaths filtering logic in
 * readCommitsBetweenTags. These tests are PURE — no live git spawning.
 *
 * Gate command: node --test --experimental-strip-types test/tags-git.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTagsOutput, parseLog } from '../src/git.ts';
import type { TagEntry, Commit } from '../src/git.ts';

// ---------------------------------------------------------------------------
// parseTagsOutput (AC1, AC4)
// ---------------------------------------------------------------------------

// Simulated output from:
//   git tag -l --sort=-creatordate
//     --format=%(refname:short)\t%(creatordate:short)\t%(*objectname)\t%(objectname)
//
// For annotated tags: *objectname holds the dereferenced commit SHA (non-empty).
// For lightweight tags: *objectname is empty; objectname is the commit SHA.

// Valid 40-char lowercase hex SHAs
const ANNOTATED_SHA    = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LIGHTWEIGHT_SHA  = '1111111111111111111111111111111111111111';
const ANNOTATED_SHA2   = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TAG_OBJ_SHA_V12  = 'cccccccccccccccccccccccccccccccccccccccc';
const TAG_OBJ_SHA_V10  = 'dddddddddddddddddddddddddddddddddddddddd';

// Raw tag output with two annotated and one lightweight tag, newest-first
const RAW_TAGS_MIXED = [
  // annotated v1.2 — *objectname is the commit SHA, objectname is the tag object
  `v1.2\t2024-06-15\t${ANNOTATED_SHA}\t${TAG_OBJ_SHA_V12}`,
  // lightweight v1.1 — *objectname is empty, objectname is the commit SHA
  `v1.1\t2024-03-10\t\t${LIGHTWEIGHT_SHA}`,
  // annotated v1.0
  `v1.0\t2024-01-01\t${ANNOTATED_SHA2}\t${TAG_OBJ_SHA_V10}`,
].join('\n');

test('parseTagsOutput: annotated tag uses dereferenced commit SHA', () => {
  const tags = parseTagsOutput(RAW_TAGS_MIXED);
  const v12 = tags.find((t) => t.name === 'v1.2');
  assert.ok(v12, 'v1.2 tag must be present');
  assert.equal(v12.sha, ANNOTATED_SHA, 'annotated tag must use dereferenced (*objectname) SHA');
});

test('parseTagsOutput: lightweight tag uses objectname SHA', () => {
  const tags = parseTagsOutput(RAW_TAGS_MIXED);
  const v11 = tags.find((t) => t.name === 'v1.1');
  assert.ok(v11, 'v1.1 tag must be present');
  assert.equal(v11.sha, LIGHTWEIGHT_SHA, 'lightweight tag must use objectname SHA');
});

test('parseTagsOutput: returns correct date for each tag', () => {
  const tags = parseTagsOutput(RAW_TAGS_MIXED);
  const v12 = tags.find((t) => t.name === 'v1.2');
  const v11 = tags.find((t) => t.name === 'v1.1');
  const v10 = tags.find((t) => t.name === 'v1.0');
  assert.equal(v12?.date, '2024-06-15');
  assert.equal(v11?.date, '2024-03-10');
  assert.equal(v10?.date, '2024-01-01');
});

test('parseTagsOutput: preserves newest-first order from git output', () => {
  const tags = parseTagsOutput(RAW_TAGS_MIXED);
  assert.equal(tags.length, 3);
  assert.equal(tags[0].name, 'v1.2');
  assert.equal(tags[1].name, 'v1.1');
  assert.equal(tags[2].name, 'v1.0');
});

test('parseTagsOutput: returns correct TagEntry shape', () => {
  const tags = parseTagsOutput(RAW_TAGS_MIXED);
  for (const tag of tags) {
    assert.ok(typeof tag.name === 'string' && tag.name.length > 0, 'name must be non-empty string');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(tag.date), `date "${tag.date}" must be YYYY-MM-DD`);
    assert.ok(typeof tag.sha === 'string' && tag.sha.length > 0, 'sha must be non-empty string');
  }
});

// AC4: empty input → empty array, no throw
test('parseTagsOutput: returns empty array for empty git output (no tags)', () => {
  assert.deepEqual(parseTagsOutput(''), []);
  assert.deepEqual(parseTagsOutput('\n\n'), []);
});

test('parseTagsOutput: skips malformed lines without throwing', () => {
  // First line has only 2 tab-separated fields (< 4), so it's skipped.
  const raw = `v1.0\t2024-01-01\n` + `v1.1\t2024-03-10\t\t${LIGHTWEIGHT_SHA}`;
  const tags = parseTagsOutput(raw);
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, 'v1.1');
});

// ---------------------------------------------------------------------------
// excludePaths filtering logic (AC2, AC3)
// Tested via parseLog (pure) + the same filter logic used by readCommitsBetweenTags.
// We extract the filter into a thin helper here so we can test it without git I/O.
// ---------------------------------------------------------------------------

/**
 * Pure replica of the excludePaths filter used in readCommitsBetweenTags —
 * keeps commits that have ≥1 file NOT under an excluded prefix.
 * Commits with no files are always kept.
 */
function applyExcludePaths(commits: Commit[], excludePaths: readonly string[]): Commit[] {
  if (excludePaths.length === 0) return commits;
  return commits.filter((commit) => {
    if (commit.files.length === 0) return true;
    return commit.files.some(
      (f) => !excludePaths.some((p) => f.path === p || f.path.startsWith(p + '/')),
    );
  });
}

// Valid 40-char hex SHAs for log fixtures
const SHA_ALICE = 'abc1234def5678901234567890123456789abcde';
const SHA_BOB   = 'beef0000cafe1234dead5678beef0000cafe1234';
const SHA_CAROL = 'cafe5678dead1234beef0000cafe5678dead1234';
const SHA_DAVE  = 'dead1234cafe5678beef0000dead1234cafe5678';
const SHA_EVE   = 'f00d1234cafe5678dead0000f00d1234cafe5678';
const SHA_FRANK = 'babe1234feed5678dead0000babe1234feed5678';
const SHA_GRACE = 'face1234cafe5678dead0000face1234cafe5678';
// A generic parent SHA used in fixtures where parentCount isn't the focus.
const PARENT_X  = 'aaaa0000bbbb1111cccc2222dddd3333eeee4444';

// Raw git log --numstat output simulating two commits between two tags.
// Commit Alice touches src/index.ts (kept)
// Commit Bob touches only dist/bundle.js (excluded when excludePaths=['dist'])
const RAW_LOG_TWO_COMMITS = [
  `${SHA_ALICE}\tAlice Dev\t2024-06-10\t${PARENT_X}\talice@dev.example`,
  '3\t1\tsrc/index.ts',
  '',
  `${SHA_BOB}\tBob Dev\t2024-06-09\t${PARENT_X}\tbob@dev.example`,
  '10\t0\tdist/bundle.js',
  '',
].join('\n');

test('AC2: readCommitsBetweenTags (no excludePaths) returns all parsed commits', () => {
  const commits = parseLog(RAW_LOG_TWO_COMMITS);
  const result = applyExcludePaths(commits, []);
  assert.equal(result.length, 2);
  assert.equal(result[0].hash, SHA_ALICE);
  assert.equal(result[1].hash, SHA_BOB);
});

test('AC2: commits include correct author and date', () => {
  const commits = parseLog(RAW_LOG_TWO_COMMITS);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].author, 'Alice Dev');
  assert.equal(commits[0].date, '2024-06-10');
  assert.equal(commits[1].author, 'Bob Dev');
  assert.equal(commits[1].date, '2024-06-09');
});

test('AC3: excludePaths omits commits whose only files are under excluded prefix', () => {
  const commits = parseLog(RAW_LOG_TWO_COMMITS);
  const result = applyExcludePaths(commits, ['dist']);
  // Bob's commit (only dist/bundle.js) should be dropped
  assert.equal(result.length, 1);
  assert.equal(result[0].hash, SHA_ALICE);
});

test('AC3: excludePaths keeps commits that also touch non-excluded files', () => {
  // Carol's commit touches both src/ and dist/ — should be KEPT
  // Dave's commit touches only dist/ — should be DROPPED
  const RAW_MIXED = [
    `${SHA_CAROL}\tCarol Dev\t2024-06-11\t${PARENT_X}\tcarol@dev.example`,
    '5\t2\tsrc/helpers.ts',
    '3\t1\tdist/bundle.js',
    '',
    `${SHA_DAVE}\tDave Dev\t2024-06-08\t${PARENT_X}\tdave@dev.example`,
    '2\t0\tdist/output.js',
    '',
  ].join('\n');
  const commits = parseLog(RAW_MIXED);
  assert.equal(commits.length, 2, 'fixture should parse 2 commits');
  const result = applyExcludePaths(commits, ['dist']);
  assert.equal(result.length, 1);
  assert.equal(result[0].hash, SHA_CAROL);
});

test('AC3: excludePaths handles nested paths correctly', () => {
  // Eve's commit touches dist/subdir/deep/file.js — excluded (under 'dist/')
  // Frank's commit touches distfile.js — NOT excluded (doesn't start with 'dist/')
  const RAW_NESTED = [
    `${SHA_EVE}\tEve Dev\t2024-06-12\t${PARENT_X}\teve@dev.example`,
    '1\t0\tdist/subdir/deep/file.js',
    '',
    `${SHA_FRANK}\tFrank Dev\t2024-06-11\t${PARENT_X}\tfrank@dev.example`,
    '1\t0\tdistfile.js',
    '',
  ].join('\n');
  const commits = parseLog(RAW_NESTED);
  assert.equal(commits.length, 2, 'fixture should parse 2 commits');
  const result = applyExcludePaths(commits, ['dist']);
  assert.equal(result.length, 1);
  assert.equal(result[0].hash, SHA_FRANK);
});

test('AC3: commit with no files is always kept (no false exclusion)', () => {
  // An empty commit (no numstat lines) should pass through regardless of excludePaths.
  // parseLog skips blank lines but needs at least one header to produce a commit.
  const RAW_EMPTY_COMMIT = `${SHA_GRACE}\tGrace Dev\t2024-06-13\t\tgrace@dev.example\n`;
  const commits = parseLog(RAW_EMPTY_COMMIT);
  assert.equal(commits.length, 1, 'fixture should parse 1 commit');
  const result = applyExcludePaths(commits, ['dist', 'src']);
  assert.equal(result.length, 1);
});
