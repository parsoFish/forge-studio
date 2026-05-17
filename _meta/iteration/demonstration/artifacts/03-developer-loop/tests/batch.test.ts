/**
 * Batch helpers test suite — WI-3 / FEAT-2.
 *
 * Covers all 6 acceptance-criteria cases:
 *   1. slugifyMany preserves order and maps slugify over the array
 *   2. uniqueSlug returns slug unchanged when not in taken
 *   3. uniqueSlug returns slug-2 when slug is taken
 *   4. uniqueSlug returns slug-3 when slug and slug-2 are taken
 *   5. uniqueSlug returns slug-5 when slug through slug-4 are taken
 *   6. uniqueSlug returns slug unchanged when slug is not in taken list
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyMany, uniqueSlug } from '../src/batch.ts';

// --- slugifyMany ---

test('slugifyMany maps slugify over input array preserving order', () => {
  assert.deepEqual(
    slugifyMany(['Hello World', 'ES2025', '']),
    ['hello-world', 'es2025', ''],
  );
});

// --- uniqueSlug ---

test('uniqueSlug returns slug unchanged when taken list is empty', () => {
  assert.equal(uniqueSlug('foo', []), 'foo');
});

test('uniqueSlug returns foo-2 using the smallest integer suffix starting at 2', () => {
  assert.equal(uniqueSlug('foo', ['foo']), 'foo-2');
});

test('uniqueSlug returns foo-3 skipping already-taken suffixed variants', () => {
  assert.equal(uniqueSlug('foo', ['foo', 'foo-2']), 'foo-3');
});

test('uniqueSlug returns foo-5 when foo through foo-4 are taken', () => {
  assert.equal(uniqueSlug('foo', ['foo', 'foo-2', 'foo-3', 'foo-4']), 'foo-5');
});

test('uniqueSlug returns bar unchanged when bar is not in taken list', () => {
  assert.equal(uniqueSlug('bar', ['foo', 'baz']), 'bar');
});
