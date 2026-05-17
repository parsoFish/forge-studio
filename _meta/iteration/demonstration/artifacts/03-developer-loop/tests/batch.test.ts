/**
 * Batch helper tests — covers all FEAT-2 acceptance criteria (WI-3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyMany } from '../src/batch.ts';
import { uniqueSlug } from '../src/batch.ts';

// slugifyMany tests

test('AC1: slugifyMany preserves order and slugifies each element', () => {
  assert.deepEqual(slugifyMany(['Hello World', 'Foo Bar']), ['hello-world', 'foo-bar']);
});

test('AC2: slugifyMany returns empty array for empty input', () => {
  assert.deepEqual(slugifyMany([]), []);
});

// uniqueSlug tests

test('AC3: uniqueSlug returns base slug when taken is empty', () => {
  assert.equal(uniqueSlug('foo', []), 'foo');
});

test('AC4: uniqueSlug returns foo-2 when foo is taken', () => {
  assert.equal(uniqueSlug('foo', ['foo']), 'foo-2');
});

test('AC5: uniqueSlug returns foo-4 when foo, foo-2, foo-3 are all taken', () => {
  assert.equal(uniqueSlug('foo', ['foo', 'foo-2', 'foo-3']), 'foo-4');
});

test('AC6: uniqueSlug returns base slug when base is free despite higher suffixes being taken', () => {
  assert.equal(uniqueSlug('foo', ['foo-2']), 'foo');
});
