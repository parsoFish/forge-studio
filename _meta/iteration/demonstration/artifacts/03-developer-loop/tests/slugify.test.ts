/**
 * Core slugify test suite — WI-2.
 *
 * Covers all 8 acceptance-criteria cases from FEAT-1:
 *   1. Empty string
 *   2. ASCII title
 *   3. Numbers in title
 *   4. Latin accents (NFD decomposition + combining-mark strip)
 *   5. Emoji-only input
 *   6. Non-Latin script (no transliteration → empty result)
 *   7. Consecutive non-alphanumeric separators
 *   8. Leading/trailing punctuation
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.ts';

test('empty string returns empty string', () => {
  assert.equal(slugify(''), '');
});

test('ASCII title is lowercased and spaces become hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('numbers are preserved in the slug', () => {
  assert.equal(slugify('ES2025 Release'), 'es2025-release');
});

test('Latin accents are stripped via NFD normalisation', () => {
  assert.equal(slugify('Ångström & Résumé'), 'angstrom-resume');
});

test('emoji-only input returns empty string', () => {
  assert.equal(slugify('🚀🎉'), '');
});

test('non-Latin script returns empty string (no transliteration)', () => {
  assert.equal(slugify('日本語タイトル'), '');
});

test('consecutive non-alphanumeric separators are collapsed to a single hyphen', () => {
  assert.equal(slugify('foo---bar  baz'), 'foo-bar-baz');
});

test('leading and trailing punctuation is trimmed', () => {
  assert.equal(slugify('--hello--'), 'hello');
});

// --- Option-specific test cases (WI-5 / FEAT-3) ---

test('separator option overrides the default hyphen', () => {
  assert.equal(slugify('Hello World', { separator: '_' }), 'hello_world');
});

test('maxLength truncates the slug and leaves no trailing separator', () => {
  assert.equal(slugify('Hello Beautiful World', { maxLength: 11 }), 'hello-beaut');
});

test('maxLength trims trailing separator after truncation', () => {
  assert.equal(slugify('Hello World', { maxLength: 6 }), 'hello');
});

test('separator and maxLength options can be combined', () => {
  assert.equal(slugify('Hello World', { separator: '_', maxLength: 9 }), 'hello_wor');
});

test('empty options object uses defaults', () => {
  assert.equal(slugify('Hello World', {}), 'hello-world');
});

test('non-positive maxLength is ignored and full slug is returned', () => {
  assert.equal(slugify('Hello World', { maxLength: 0 }), 'hello-world');
});
