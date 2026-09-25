/**
 * Unit tests for src/author-filter.ts — filterAuthorCommits()
 * and for src/git.ts — parseLog() authorEmail field.
 *
 * All tests are pure (no git spawning); fixtures carry non-default sentinel
 * email values so silent drops are caught immediately.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { parseLog } from '../src/git.ts';
import { filterAuthorCommits } from '../src/author-filter.ts';
import type { AuthorFilterResult } from '../src/author-filter.ts';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

const makeCommit = (
  over: Partial<Commit> & { author: string; authorEmail: string },
): Commit => ({
  hash: 'aaaaaaa1234567890abcdef1234567890abcdef1',
  date: '2024-01-01',
  parentCount: 1,
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  files: [],
  ...over,
});

const ADA = makeCommit({ author: 'Ada Lovelace', authorEmail: 'ada@lovelace.example' });
const ADA_TAGGED = makeCommit({
  author: 'Ada Lovelace',
  authorEmail: 'ada+work@example.com',
  hash: 'bbbbbbb1234567890abcdef1234567890abcdef1',
});
const GRACE = makeCommit({
  author: 'Grace Hopper',
  authorEmail: 'grace@hopper.example',
  hash: 'ccccccc1234567890abcdef1234567890abcdef1',
});
const GRACE_IO = makeCommit({
  author: 'Grace Hopper',
  authorEmail: 'grace@hopper.io',
  hash: 'ddddddd1234567890abcdef1234567890abcdef1',
});

// ---------------------------------------------------------------------------
// AC1: parseLog() populates authorEmail from parts[4]
// ---------------------------------------------------------------------------

test('AC1: parseLog populates authorEmail from the 5th tab-separated field', () => {
  const SHA = 'aaaaaaa1234567890abcdef1234567890abcdef1';
  const PARENT = 'bbbbbbb1234567890abcdef1234567890abcdef1';
  const raw = [
    `${SHA}\tAda Lovelace\t2024-01-01\t${PARENT}\tada@lovelace.example`,
    '5\t2\tsrc/engine.ts',
  ].join('\n');

  const commits = parseLog(raw);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].authorEmail, 'ada@lovelace.example');
  assert.equal(commits[0].author, 'Ada Lovelace');
});

test('AC1: parseLog populates authorEmail for multiple commits', () => {
  const SHA_A = 'aaaaaaa1234567890abcdef1234567890abcdef1';
  const SHA_B = 'bbbbbbb1234567890abcdef1234567890abcdef1';
  const PARENT = 'ccccccc1234567890abcdef1234567890abcdef1';
  const raw = [
    `${SHA_A}\tAda Lovelace\t2024-01-02\t${PARENT}\tada@lovelace.example`,
    '3\t1\tsrc/a.ts',
    '',
    `${SHA_B}\tGrace Hopper\t2024-01-01\t${PARENT}\tgrace@hopper.example`,
    '1\t0\tsrc/b.ts',
  ].join('\n');

  const commits = parseLog(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].authorEmail, 'ada@lovelace.example');
  assert.equal(commits[1].authorEmail, 'grace@hopper.example');
});

test('AC1: parseLog trims whitespace from authorEmail', () => {
  const SHA = 'aaaaaaa1234567890abcdef1234567890abcdef1';
  const PARENT = 'bbbbbbb1234567890abcdef1234567890abcdef1';
  const raw = `${SHA}\tAda Lovelace\t2024-01-01\t${PARENT}\t  ada@lovelace.example  `;

  const commits = parseLog(raw);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].authorEmail, 'ada@lovelace.example');
});

// ---------------------------------------------------------------------------
// AC2: email with + tag is matched
// ---------------------------------------------------------------------------

test('AC2: filterAuthorCommits includes a commit with a + tag in email', () => {
  const result: AuthorFilterResult = filterAuthorCommits([ADA_TAGGED], ['ada+work@example.com']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0], ADA_TAGGED);
  assert.equal(result.excludedCount, 0);
});

test('AC2: filterAuthorCommits matches + tag email with wildcard pattern', () => {
  const result = filterAuthorCommits([ADA_TAGGED], ['ada+*']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.excludedCount, 0);
});

// ---------------------------------------------------------------------------
// AC3: ['Ada*'] matches Ada, excludes Grace
// ---------------------------------------------------------------------------

test('AC3: pattern [Ada*] includes Ada and excludes Grace', () => {
  const commits = [ADA, GRACE];
  const result = filterAuthorCommits(commits, ['Ada*']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0], ADA);
  assert.equal(result.excludedCount, 1);
});

test('AC3: Grace contributes to excludedCount', () => {
  const commits = [ADA, ADA_TAGGED, GRACE];
  const result = filterAuthorCommits(commits, ['Ada*']);
  assert.equal(result.filtered.length, 2);
  assert.equal(result.excludedCount, 1);
});

// ---------------------------------------------------------------------------
// AC4: case-insensitive match on email
// ---------------------------------------------------------------------------

test('AC4: uppercase pattern GRACE@* matches lowercase email grace@hopper.io', () => {
  const result = filterAuthorCommits([GRACE_IO], ['GRACE@*']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0], GRACE_IO);
  assert.equal(result.excludedCount, 0);
});

test('AC4: case-insensitive name match', () => {
  const result = filterAuthorCommits([ADA], ['ada lovelace']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.excludedCount, 0);
});

// ---------------------------------------------------------------------------
// AC5: two patterns — union / OR semantics
// ---------------------------------------------------------------------------

test('AC5: two patterns [ada*, grace*] match all commits from both authors', () => {
  const commits = [ADA, GRACE];
  const result = filterAuthorCommits(commits, ['ada*', 'grace*']);
  assert.equal(result.filtered.length, 2);
  assert.equal(result.excludedCount, 0);
});

test('AC5: OR semantics — a commit matching either pattern is included once', () => {
  const commits = [ADA, ADA_TAGGED, GRACE, GRACE_IO];
  const result = filterAuthorCommits(commits, ['ada*', 'grace*']);
  assert.equal(result.filtered.length, 4);
  assert.equal(result.excludedCount, 0);
});

// ---------------------------------------------------------------------------
// AC6: ['*'] matches all
// ---------------------------------------------------------------------------

test("AC6: pattern ['*'] matches every commit", () => {
  const commits = [ADA, GRACE, ADA_TAGGED, GRACE_IO];
  const result = filterAuthorCommits(commits, ['*']);
  assert.equal(result.filtered.length, 4);
  assert.deepEqual(result.filtered, commits);
  assert.equal(result.excludedCount, 0);
});

test("AC6: pattern ['*'] on empty input", () => {
  const result = filterAuthorCommits([], ['*']);
  assert.equal(result.filtered.length, 0);
  assert.equal(result.excludedCount, 0);
});

// ---------------------------------------------------------------------------
// AC7: empty string pattern matches nothing
// ---------------------------------------------------------------------------

test("AC7: pattern [''] (empty string) matches no commits", () => {
  const commits = [ADA, GRACE];
  const result = filterAuthorCommits(commits, ['']);
  assert.equal(result.filtered.length, 0);
  assert.equal(result.excludedCount, 2);
});

test("AC7: empty string pattern on single commit", () => {
  const result = filterAuthorCommits([ADA], ['']);
  assert.equal(result.filtered.length, 0);
  assert.equal(result.excludedCount, 1);
});

// ---------------------------------------------------------------------------
// AC8: non-matching pattern — filtered is empty, excludedCount = input length
// ---------------------------------------------------------------------------

test("AC8: pattern ['nobody*'] matches no commits", () => {
  const commits = [ADA, GRACE, ADA_TAGGED];
  const result = filterAuthorCommits(commits, ['nobody*']);
  assert.equal(result.filtered.length, 0);
  assert.equal(result.excludedCount, 3);
});

test('AC8: non-matching pattern — excludedCount equals input length', () => {
  const commits = [ADA, GRACE];
  const result = filterAuthorCommits(commits, ['zzz*']);
  assert.equal(result.filtered.length, 0);
  assert.equal(result.excludedCount, commits.length);
});

// ---------------------------------------------------------------------------
// Additional edge-case coverage (per WI spec)
// ---------------------------------------------------------------------------

test('empty patterns list returns all commits (pass-through)', () => {
  const commits = [ADA, GRACE];
  const result = filterAuthorCommits(commits, []);
  assert.deepEqual(result.filtered, commits);
  assert.equal(result.excludedCount, 0);
});

test('email suffix domain glob', () => {
  const result = filterAuthorCommits([ADA, GRACE], ['*@lovelace.example']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0], ADA);
  assert.equal(result.excludedCount, 1);
});

test('name match via exact prefix glob', () => {
  const result = filterAuthorCommits([ADA, GRACE], ['Grace*']);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0], GRACE);
  assert.equal(result.excludedCount, 1);
});

test('filterAuthorCommits does not mutate input array', () => {
  const commits = [ADA, GRACE];
  const copy = [...commits];
  filterAuthorCommits(commits, ['Ada*']);
  assert.equal(commits.length, copy.length);
  assert.equal(commits[0], copy[0]);
  assert.equal(commits[1], copy[1]);
});
