/**
 * Core slugify tests — covers all seven FEAT-1 transformation cases.
 * Each case is a separate named test so individual failures surface clearly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.ts';

test('Hello World: punctuation dropped, spaces become hyphens, lower-cased', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('accents: Latin accents normalised via NFD + combining-mark strip', () => {
  assert.equal(slugify('Héllo Wörld'), 'hello-world');
});

test('numbers: digits are preserved as-is', () => {
  assert.equal(slugify('My 2nd Post'), 'my-2nd-post');
});

test('non-Latin: non-Latin script characters dropped, Latin portion kept', () => {
  assert.equal(slugify('日本語 title'), 'title');
});

test('emoji: emoji dropped, surrounding Latin text kept', () => {
  assert.equal(slugify('🎉 Party time!'), 'party-time');
});

test('consecutive separators: collapsed to single hyphen, leading/trailing trimmed', () => {
  assert.equal(slugify('  --multiple---hyphens--  '), 'multiple-hyphens');
});

test('empty string: returns empty string', () => {
  assert.equal(slugify(''), '');
});
