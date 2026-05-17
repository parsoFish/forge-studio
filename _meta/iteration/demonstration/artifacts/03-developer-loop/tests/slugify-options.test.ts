/**
 * Options tests — covers all seven FEAT-3 acceptance criteria (WI-6).
 * Each case is a separate named test so individual failures surface clearly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.ts';

test('separator underscore: spaces replaced by underscore', () => {
  assert.equal(slugify('Hello World', { separator: '_' }), 'hello_world');
});

test('empty separator: words concatenated without separator', () => {
  assert.equal(slugify('Hello World', { separator: '' }), 'helloworld');
});

test('maxLength truncation: result truncated to maxLength characters', () => {
  assert.equal(slugify('Hello World', { maxLength: 5 }), 'hello');
});

test('maxLength with trailing separator trim: trailing separator removed after truncation', () => {
  assert.equal(slugify('Hello World', { maxLength: 6 }), 'hello');
});

test('separator and maxLength composed: underscore separator with maxLength applied', () => {
  assert.equal(slugify('Hello World', { separator: '_', maxLength: 8 }), 'hello_wo');
});

test('empty options object: behaves like default (hyphen separator)', () => {
  assert.equal(slugify('Hello, World!', {}), 'hello-world');
});

test('empty input with maxLength: returns empty string', () => {
  assert.equal(slugify('', { maxLength: 10 }), '');
});
