/**
 * Unit suite for WI-1: parentCount field and removal of --no-merges flag.
 *
 * Fast, deterministic, creds-free, < 1 s. No git spawning.
 * Uses node:test and node:assert/strict (matches project pattern).
 *
 * Quality gate: node --test --experimental-strip-types test/no-merges.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLog, LOG_ARGS } from '../src/git.ts';

// ---------------------------------------------------------------------------
// Valid 40-char hex SHAs for raw log fixtures (sentinel, non-default values)
// ---------------------------------------------------------------------------
const SHA_MERGE  = 'aa1111aa2222bb3333cc4444dd5555ee6666ff77';
const SHA_NORMAL = 'bb2222bb3333cc4444dd5555ee6666ff7777aa11';
const SHA_INIT   = 'cc3333cc4444dd5555ee6666ff7777aa1111bb22';
const PARENT_1   = 'dd4444dd5555ee6666ff7777aa1111bb2222cc33';
const PARENT_2   = 'ee5555ee6666ff7777aa1111bb2222cc3333dd44';

// ---------------------------------------------------------------------------
// AC2: LOG_ARGS must NOT contain '--no-merges'
// ---------------------------------------------------------------------------

test('AC2: LOG_ARGS does not contain --no-merges', () => {
  assert.ok(
    !LOG_ARGS.includes('--no-merges'),
    `Expected LOG_ARGS to not contain '--no-merges', but got: ${JSON.stringify(LOG_ARGS)}`,
  );
});

test('AC2: LOG_ARGS is an array (importable at runtime)', () => {
  assert.ok(Array.isArray(LOG_ARGS), 'LOG_ARGS should be an array');
});

// ---------------------------------------------------------------------------
// AC4: initial commit (empty %P field) → parentCount === 0
// ---------------------------------------------------------------------------

test('AC4: initial commit with empty %P field → parentCount 0', () => {
  // The %P field is empty for the initial commit (no parents).
  const raw = `${SHA_INIT}\tAlice Sentinel\t2024-01-01\t\talice@sentinel.example\n`;
  const commits = parseLog(raw);
  assert.equal(commits.length, 1, 'should parse one commit');
  assert.equal(commits[0].parentCount, 0, 'initial commit must have parentCount 0');
  assert.equal(commits[0].hash, SHA_INIT);
  assert.equal(commits[0].author, 'Alice Sentinel');
  assert.equal(commits[0].date, '2024-01-01');
});

// ---------------------------------------------------------------------------
// AC5: regular commit (one parent SHA) → parentCount === 1
// ---------------------------------------------------------------------------

test('AC5: regular commit with one parent SHA → parentCount 1', () => {
  const raw = [
    `${SHA_NORMAL}\tBob Sentinel\t2024-01-02\t${PARENT_1}\tbob@sentinel.example`,
    '3\t1\tsrc/feature.ts',
    '',
  ].join('\n');
  const commits = parseLog(raw);
  assert.equal(commits.length, 1, 'should parse one commit');
  assert.equal(commits[0].parentCount, 1, 'regular commit must have parentCount 1');
  assert.equal(commits[0].hash, SHA_NORMAL);
  assert.equal(commits[0].author, 'Bob Sentinel');
});

// ---------------------------------------------------------------------------
// AC3: merge commit (two parent SHAs in %P field) → parentCount === 2
// ---------------------------------------------------------------------------

test('AC3: merge commit with two parent SHAs → parentCount 2', () => {
  // %P for a merge commit lists both parent SHAs space-separated.
  const raw = [
    `${SHA_MERGE}\tCarol Sentinel\t2024-01-03\t${PARENT_1} ${PARENT_2}\tcarol@sentinel.example`,
    '5\t2\tsrc/merged.ts',
    '',
  ].join('\n');
  const commits = parseLog(raw);
  assert.equal(commits.length, 1, 'should parse one commit');
  assert.equal(commits[0].parentCount, 2, 'merge commit must have parentCount 2');
  assert.equal(commits[0].hash, SHA_MERGE);
});

// ---------------------------------------------------------------------------
// AC1: Commit type carries parentCount: number field
// ---------------------------------------------------------------------------

test('AC1: Commit record carries parentCount as a number field', () => {
  const raw = `${SHA_INIT}\tDave Sentinel\t2024-01-04\t${PARENT_1}\tdave@sentinel.example\n`;
  const [commit] = parseLog(raw);
  assert.ok(Object.prototype.hasOwnProperty.call(commit, 'parentCount'), 'Commit must have parentCount field');
  assert.equal(typeof commit.parentCount, 'number', 'parentCount must be a number');
});

// ---------------------------------------------------------------------------
// Verify filesChanged / insertions / deletions still parse correctly
// after the four-field header change (regression guard)
// ---------------------------------------------------------------------------

test('numstat fields (filesChanged, insertions, deletions) still parse correctly with 5-field header', () => {
  // One merge commit with numstat lines following the new header format.
  const raw = [
    `${SHA_MERGE}\tEve Sentinel\t2024-02-01\t${PARENT_1} ${PARENT_2}\teve@sentinel.example`,
    '10\t3\tsrc/engine.ts',
    '-\t-\tassets/logo.png',  // binary file — insertions/deletions count as 0
    '5\t0\tsrc/router.ts',
    '',
  ].join('\n');
  const commits = parseLog(raw);
  assert.equal(commits.length, 1, 'should parse one commit');
  const c = commits[0];
  assert.equal(c.parentCount, 2, 'merge commit parentCount should be 2');
  assert.equal(c.filesChanged, 3, 'filesChanged should count all three numstat rows');
  assert.equal(c.insertions, 15, 'insertions: 10 + 0 (binary) + 5');
  assert.equal(c.deletions, 3, 'deletions: 3 + 0 (binary) + 0');
  assert.equal(c.files.length, 3, 'files array should have 3 entries');
  assert.equal(c.files[0].path, 'src/engine.ts');
  assert.equal(c.files[1].path, 'assets/logo.png');
  assert.equal(c.files[1].insertions, 0, 'binary file insertions should be 0');
  assert.equal(c.files[1].deletions, 0, 'binary file deletions should be 0');
  assert.equal(c.files[2].path, 'src/router.ts');
});

// ---------------------------------------------------------------------------
// Mixed sequence: initial commit + regular + merge all in one log output
// ---------------------------------------------------------------------------

test('mixed sequence: initial + regular + merge commits parsed correctly', () => {
  const raw = [
    `${SHA_INIT}\tFrank Sentinel\t2024-01-01\t\tfrank@sentinel.example`,  // initial: no parents
    '2\t0\tREADME.md',
    '',
    `${SHA_NORMAL}\tGrace Sentinel\t2024-01-02\t${PARENT_1}\tgrace@sentinel.example`,  // regular: 1 parent
    '4\t1\tsrc/index.ts',
    '',
    `${SHA_MERGE}\tHank Sentinel\t2024-01-03\t${PARENT_1} ${PARENT_2}\thank@sentinel.example`,  // merge: 2 parents
    '6\t2\tsrc/merge.ts',
    '',
  ].join('\n');
  const commits = parseLog(raw);
  assert.equal(commits.length, 3, 'should parse three commits');
  assert.equal(commits[0].parentCount, 0, 'first commit (initial) has parentCount 0');
  assert.equal(commits[1].parentCount, 1, 'second commit (regular) has parentCount 1');
  assert.equal(commits[2].parentCount, 2, 'third commit (merge) has parentCount 2');
});
