/**
 * Unit tests for src/tag-range.ts — pure functions, no git spawning.
 *
 * Covers:
 *   - filterCommitsByTagRange (AC3)
 *   - resolveEffectiveBounds (AC4)
 *
 * resolveTagToSha (AC1/AC2) is an I/O function tested via integration in WI-3.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterCommitsByTagRange,
  resolveEffectiveBounds,
} from '../src/tag-range.ts';
import type { TagRangeOptions, AppliedBound } from '../src/tag-range.ts';
import type { Commit } from '../src/git.ts';

// ============================================================
// Fixture helpers
// ============================================================

function makeCommit(id: string, date = '2024-01-01'): Commit {
  return {
    hash: `sha-${id}`,
    author: `Author ${id}`,
    date,
    parentCount: 1,
    authorEmail: `${id}@example.com`,
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
    files: [{ path: `src/${id}.ts`, insertions: 1, deletions: 0 }],
  };
}

// The canonical AC3 sequence: [A, B(=v1.0.0), C, D, E(=v2.0.0), F]
// git log is newest-first, so index 0 = F (newest), last = A (oldest).
const F = makeCommit('F', '2024-06-01');
const E = makeCommit('E', '2024-05-01'); // = v2.0.0
const D = makeCommit('D', '2024-04-01');
const C = makeCommit('C', '2024-03-01');
const B = makeCommit('B', '2024-02-01'); // = v1.0.0
const A = makeCommit('A', '2024-01-01');

// Newest-first array (as git log returns).
const COMMITS_FULL: readonly Commit[] = [F, E, D, C, B, A];

// ============================================================
// filterCommitsByTagRange — AC3
// ============================================================

// AC3: sinceTagSha=B.sha (exclusive), untilTagSha=E.sha (inclusive) → [C, D, E]
test('filterCommitsByTagRange: sinceTagSha exclusive, untilTagSha inclusive → [C, D, E]', () => {
  const result = filterCommitsByTagRange(COMMITS_FULL, {
    sinceTagSha: B.hash,
    untilTagSha: E.hash,
  });
  assert.deepEqual(
    result.map((c) => c.hash),
    [E.hash, D.hash, C.hash],
    'Expected [E, D, C] (newest-first within the window)',
  );
  // B is excluded (since-tag exclusive)
  assert.ok(!result.some((c) => c.hash === B.hash), 'B must be excluded');
  // F is excluded (after until-tag)
  assert.ok(!result.some((c) => c.hash === F.hash), 'F must be excluded');
  // A is excluded (before since-tag)
  assert.ok(!result.some((c) => c.hash === A.hash), 'A must be excluded');
});

test('filterCommitsByTagRange: only sinceTagSha → commits newer than B (exclusive of B)', () => {
  const result = filterCommitsByTagRange(COMMITS_FULL, { sinceTagSha: B.hash });
  // Commits newer than B (exclusive): F, E, D, C
  assert.deepEqual(
    result.map((c) => c.hash),
    [F.hash, E.hash, D.hash, C.hash],
  );
});

test('filterCommitsByTagRange: only untilTagSha → commits from E (inclusive) to oldest', () => {
  const result = filterCommitsByTagRange(COMMITS_FULL, { untilTagSha: E.hash });
  // E is the inclusive newer bound; with no sinceTagSha, include E and all commits older.
  // Newest-first: [E, D, C, B, A]
  assert.deepEqual(
    result.map((c) => c.hash),
    [E.hash, D.hash, C.hash, B.hash, A.hash],
  );
});

test('filterCommitsByTagRange: no bounds → all commits', () => {
  const result = filterCommitsByTagRange(COMMITS_FULL, {});
  assert.deepEqual(
    result.map((c) => c.hash),
    COMMITS_FULL.map((c) => c.hash),
  );
});

test('filterCommitsByTagRange: inverted range (sinceTagSha newer than untilTagSha) → empty', () => {
  // sinceTagSha = E (index 1, newer), untilTagSha = B (index 4, older)
  // E appears before B in the array → inverted → empty
  const result = filterCommitsByTagRange(COMMITS_FULL, {
    sinceTagSha: E.hash,
    untilTagSha: B.hash,
  });
  assert.equal(result.length, 0);
});

test('filterCommitsByTagRange: sinceTagSha = untilTagSha → empty (since is exclusive)', () => {
  // Since is exclusive of B; until is inclusive of B → window is empty
  const result = filterCommitsByTagRange(COMMITS_FULL, {
    sinceTagSha: B.hash,
    untilTagSha: B.hash,
  });
  assert.equal(result.length, 0);
});

test('filterCommitsByTagRange: sinceTagSha not in commits → no lower bound applied', () => {
  const result = filterCommitsByTagRange(COMMITS_FULL, {
    sinceTagSha: 'sha-nonexistent',
    untilTagSha: E.hash,
  });
  // Since not found → no older-end clip (sliceEnd = commits.length).
  // Until=E (inclusive newer bound) → sliceStart = index of E = 1.
  // Result: [E, D, C, B, A]
  assert.deepEqual(
    result.map((c) => c.hash),
    [E.hash, D.hash, C.hash, B.hash, A.hash],
  );
});

test('filterCommitsByTagRange: untilTagSha not in commits → empty array', () => {
  const result = filterCommitsByTagRange(COMMITS_FULL, {
    sinceTagSha: B.hash,
    untilTagSha: 'sha-nonexistent',
  });
  assert.equal(result.length, 0);
});

test('filterCommitsByTagRange: empty commits array → empty result', () => {
  const result = filterCommitsByTagRange([], { sinceTagSha: B.hash, untilTagSha: E.hash });
  assert.equal(result.length, 0);
});

// ============================================================
// resolveEffectiveBounds — AC4
// ============================================================

// AC4: --since-tag v1.0.0 (commit date 2024-02-15) + --since 2024-03-01 (narrower date)
// → only commits after 2024-03-01 are returned; annotation names date as narrower.
test('resolveEffectiveBounds: since-date narrower than since-tag → date wins with annotation', () => {
  const result: AppliedBound = resolveEffectiveBounds({
    sinceDate: '2024-03-01',
    untilDate: null,
    sinceTag: 'v1.0.0',
    untilTag: null,
    sinceTagSha: 'sha-tag-v1',
    untilTagSha: null,
    sinceTagCommitDate: '2024-02-15',
    untilTagCommitDate: null,
  });
  assert.equal(result.since, '2024-03-01', 'effective since must be the narrower date');
  assert.equal(result.sinceTagSha, null, 'tag SHA should be dropped when date wins');
  assert.ok(
    result.sinceAnnotation !== null &&
    result.sinceAnnotation.includes('2024-03-01') &&
    result.sinceAnnotation.includes('v1.0.0'),
    `annotation must mention both the date and the tag name, got: ${result.sinceAnnotation}`,
  );
  assert.ok(
    result.sinceAnnotation.includes('narrower'),
    `annotation must say which bound was narrower, got: ${result.sinceAnnotation}`,
  );
});

test('resolveEffectiveBounds: since-tag narrower than since-date → tag wins with annotation', () => {
  const result = resolveEffectiveBounds({
    sinceDate: '2024-01-01',
    untilDate: null,
    sinceTag: 'v1.0.0',
    untilTag: null,
    sinceTagSha: 'sha-tag-v1',
    untilTagSha: null,
    sinceTagCommitDate: '2024-02-15',
    untilTagCommitDate: null,
  });
  assert.equal(result.since, '2024-02-15', 'effective since = tag commit date when tag is narrower');
  assert.equal(result.sinceTagSha, 'sha-tag-v1', 'tag SHA must be set when tag wins');
  assert.ok(
    result.sinceAnnotation !== null &&
    result.sinceAnnotation.includes('2024-02-15') &&
    result.sinceAnnotation.includes('v1.0.0'),
    `annotation must mention both, got: ${result.sinceAnnotation}`,
  );
});

test('resolveEffectiveBounds: only since-date given, no since-tag → no annotation', () => {
  const result = resolveEffectiveBounds({
    sinceDate: '2024-03-01',
    untilDate: null,
    sinceTag: null,
    untilTag: null,
    sinceTagSha: null,
    untilTagSha: null,
    sinceTagCommitDate: null,
    untilTagCommitDate: null,
  });
  assert.equal(result.since, '2024-03-01');
  assert.equal(result.sinceTagSha, null);
  assert.equal(result.sinceAnnotation, null);
});

test('resolveEffectiveBounds: only since-tag given → effective since = tag commit date', () => {
  const result = resolveEffectiveBounds({
    sinceDate: null,
    untilDate: null,
    sinceTag: 'v1.0.0',
    untilTag: null,
    sinceTagSha: 'sha-tag-v1',
    untilTagSha: null,
    sinceTagCommitDate: '2024-02-15',
    untilTagCommitDate: null,
  });
  assert.equal(result.since, '2024-02-15');
  assert.equal(result.sinceTagSha, 'sha-tag-v1');
  assert.equal(result.sinceAnnotation, null);
});

test('resolveEffectiveBounds: neither since bound given → since null', () => {
  const result = resolveEffectiveBounds({
    sinceDate: null,
    untilDate: null,
    sinceTag: null,
    untilTag: null,
    sinceTagSha: null,
    untilTagSha: null,
    sinceTagCommitDate: null,
    untilTagCommitDate: null,
  });
  assert.equal(result.since, null);
  assert.equal(result.sinceTagSha, null);
  assert.equal(result.sinceAnnotation, null);
  assert.equal(result.until, null);
  assert.equal(result.untilTagSha, null);
  assert.equal(result.untilAnnotation, null);
});

test('resolveEffectiveBounds: until-date narrower than until-tag → date wins', () => {
  const result = resolveEffectiveBounds({
    sinceDate: null,
    untilDate: '2024-05-01',
    sinceTag: null,
    untilTag: 'v2.0.0',
    sinceTagSha: null,
    untilTagSha: 'sha-tag-v2',
    sinceTagCommitDate: null,
    untilTagCommitDate: '2024-06-01',
  });
  assert.equal(result.until, '2024-05-01', 'earlier date is narrower for until');
  assert.equal(result.untilTagSha, null, 'tag SHA dropped when date wins');
  assert.ok(
    result.untilAnnotation !== null && result.untilAnnotation.includes('narrower'),
    `annotation must say narrower, got: ${result.untilAnnotation}`,
  );
});

test('resolveEffectiveBounds: until-tag narrower than until-date → tag wins', () => {
  const result = resolveEffectiveBounds({
    sinceDate: null,
    untilDate: '2024-07-01',
    sinceTag: null,
    untilTag: 'v2.0.0',
    sinceTagSha: null,
    untilTagSha: 'sha-tag-v2',
    sinceTagCommitDate: null,
    untilTagCommitDate: '2024-06-01',
  });
  assert.equal(result.until, '2024-06-01', 'tag commit date wins when tag is earlier');
  assert.equal(result.untilTagSha, 'sha-tag-v2');
});

// Equal dates: date wins as tie-break for since (date >= tagDate → date wins).
test('resolveEffectiveBounds: since-date equals since-tag commit date → date wins (tie-break)', () => {
  const result = resolveEffectiveBounds({
    sinceDate: '2024-02-15',
    untilDate: null,
    sinceTag: 'v1.0.0',
    untilTag: null,
    sinceTagSha: 'sha-tag-v1',
    untilTagSha: null,
    sinceTagCommitDate: '2024-02-15',
    untilTagCommitDate: null,
  });
  // date >= tagDate → date wins; sinceTagSha = null
  assert.equal(result.since, '2024-02-15');
  assert.equal(result.sinceTagSha, null);
  assert.ok(result.sinceAnnotation !== null);
});
