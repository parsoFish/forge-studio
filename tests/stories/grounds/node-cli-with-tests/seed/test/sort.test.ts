/**
 * Unit suite for src/sort.ts — sortRecords() and COLUMNS registry.
 *
 * Fast, deterministic, creds-free, < 1 s. No git spawning.
 *
 * Quality gate: node --test --experimental-strip-types test/sort.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sortRecords, COLUMNS } from '../src/sort.ts';

// ---------------------------------------------------------------------------
// AC1 — Numeric descending (10 before 2, not lexicographic '9' > '10')
// ---------------------------------------------------------------------------

test('AC1: numeric descending sort orders by number not string (10 before 2)', () => {
  const records = [
    { file: 'a.ts', commits: 2 },
    { file: 'b.ts', commits: 10 },
    { file: 'c.ts', commits: 9 },
  ];
  const result = sortRecords(records, 'commits', 'desc');
  assert.deepStrictEqual(
    result.map((r) => r.commits),
    [10, 9, 2],
  );
});

// ---------------------------------------------------------------------------
// AC2 — Stable sort: equal-valued records preserve input order
// ---------------------------------------------------------------------------

test('AC2: stable sort preserves original relative order for equal values', () => {
  const records = [
    { file: 'a.ts', commits: 5, id: 1 },
    { file: 'b.ts', commits: 5, id: 2 },
    { file: 'c.ts', commits: 5, id: 3 },
  ];
  const result = sortRecords(records, 'commits', 'desc');
  assert.deepStrictEqual(
    result.map((r) => r.id),
    [1, 2, 3],
  );
});

test('AC2: stable sort preserves original relative order in ascending direction', () => {
  const records = [
    { name: 'x', score: 3, id: 1 },
    { name: 'y', score: 3, id: 2 },
    { name: 'z', score: 3, id: 3 },
  ];
  const result = sortRecords(records, 'score', 'asc');
  assert.deepStrictEqual(
    result.map((r) => r.id),
    [1, 2, 3],
  );
});

// ---------------------------------------------------------------------------
// AC3 — Numeric ascending sort [3, 1, 2] → [1, 2, 3]
// ---------------------------------------------------------------------------

test('AC3: numeric ascending sort returns [1, 2, 3] from [3, 1, 2]', () => {
  const records = [
    { file: 'a.ts', insertions: 3 },
    { file: 'b.ts', insertions: 1 },
    { file: 'c.ts', insertions: 2 },
  ];
  const result = sortRecords(records, 'insertions', 'asc');
  assert.deepStrictEqual(
    result.map((r) => r.insertions),
    [1, 2, 3],
  );
});

// ---------------------------------------------------------------------------
// AC4 — Text ascending sort uses direct < / > (not localeCompare)
// ---------------------------------------------------------------------------

test('AC4: text ascending sort returns [alpha, beta, gamma]', () => {
  const records = [
    { file: 'beta' },
    { file: 'alpha' },
    { file: 'gamma' },
  ];
  const result = sortRecords(records, 'file', 'asc');
  assert.deepStrictEqual(
    result.map((r) => r.file),
    ['alpha', 'beta', 'gamma'],
  );
});

test('AC4: text descending sort returns [gamma, beta, alpha]', () => {
  const records = [
    { file: 'beta' },
    { file: 'alpha' },
    { file: 'gamma' },
  ];
  const result = sortRecords(records, 'file', 'desc');
  assert.deepStrictEqual(
    result.map((r) => r.file),
    ['gamma', 'beta', 'alpha'],
  );
});

// ---------------------------------------------------------------------------
// Edge cases — empty array and unknown column
// ---------------------------------------------------------------------------

test('empty array returns empty array', () => {
  const result = sortRecords([], 'commits', 'desc');
  assert.deepStrictEqual(result, []);
});

test('unknown column returns records in original order', () => {
  const records = [
    { file: 'a.ts', commits: 5 },
    { file: 'b.ts', commits: 3 },
  ];
  // 'nonexistent' column — values are undefined (treated as text)
  // undefined < undefined → cmp stays 0 → stable index order
  const result = sortRecords(records, 'nonexistent', 'desc');
  assert.deepStrictEqual(
    result.map((r) => r.file),
    ['a.ts', 'b.ts'],
  );
});

test('does not mutate the input array', () => {
  const records = [
    { file: 'a.ts', commits: 2 },
    { file: 'b.ts', commits: 10 },
  ];
  const original = records.map((r) => ({ ...r }));
  sortRecords(records, 'commits', 'desc');
  assert.deepStrictEqual(records, original);
});

// ---------------------------------------------------------------------------
// AC5–AC10 — COLUMNS registry
// ---------------------------------------------------------------------------

test('AC5: COLUMNS[churn] has correct column set', () => {
  const cols = COLUMNS['churn'];
  assert.ok(cols.has('file'), 'has file');
  assert.ok(cols.has('insertions'), 'has insertions');
  assert.ok(cols.has('deletions'), 'has deletions');
  assert.ok(cols.has('commits'), 'has commits');
  assert.strictEqual(cols.size, 4);
});

test('AC6: COLUMNS[ownership] has correct column set', () => {
  const cols = COLUMNS['ownership'];
  assert.ok(cols.has('file'), 'has file');
  assert.ok(cols.has('owner'), 'has owner');
  assert.ok(cols.has('ownerLines'), 'has ownerLines');
  assert.ok(cols.has('busFactor'), 'has busFactor');
  assert.strictEqual(cols.size, 4);
});

test('AC7: COLUMNS[hotspots] has correct column set', () => {
  const cols = COLUMNS['hotspots'];
  assert.ok(cols.has('file'), 'has file');
  assert.ok(cols.has('score'), 'has score');
  assert.ok(cols.has('commits'), 'has commits');
  assert.ok(cols.has('lastDate'), 'has lastDate');
  assert.strictEqual(cols.size, 4);
});

test('AC8: COLUMNS[authors] has correct column set', () => {
  const cols = COLUMNS['authors'];
  assert.ok(cols.has('author'), 'has author');
  assert.ok(cols.has('commits'), 'has commits');
  assert.ok(cols.has('insertions'), 'has insertions');
  assert.ok(cols.has('deletions'), 'has deletions');
  assert.strictEqual(cols.size, 4);
});

test('AC9: COLUMNS[compare] has correct column set', () => {
  const cols = COLUMNS['compare'];
  assert.ok(cols.has('author'), 'has author');
  assert.ok(cols.has('baseCommits'), 'has baseCommits');
  assert.ok(cols.has('headCommits'), 'has headCommits');
  assert.ok(cols.has('deltaCommits'), 'has deltaCommits');
  assert.ok(cols.has('baseChurn'), 'has baseChurn');
  assert.ok(cols.has('headChurn'), 'has headChurn');
  assert.ok(cols.has('deltaChurn'), 'has deltaChurn');
  assert.strictEqual(cols.size, 7);
});

test('AC10: COLUMNS[tags] has correct column set', () => {
  const cols = COLUMNS['tags'];
  assert.ok(cols.has('name'), 'has name');
  assert.ok(cols.has('date'), 'has date');
  assert.ok(cols.has('commitsSince'), 'has commitsSince');
  assert.ok(cols.has('uniqueAuthors'), 'has uniqueAuthors');
  assert.ok(cols.has('daysSince'), 'has daysSince');
  assert.strictEqual(cols.size, 5);
});
