/**
 * Unit tests for matchGlob (src/glob.ts).
 *
 * Run directly: node --test --experimental-strip-types test/glob.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchGlob } from '../src/glob.ts';

test('AC1: dist/** matches dist/bundle.js', () => {
  assert.equal(matchGlob('dist/**', 'dist/bundle.js'), true);
});

test('AC2: *.lock matches package-lock.json', () => {
  assert.equal(matchGlob('*.lock', 'package-lock.json'), true);
});

test('AC3: *.lock does NOT match src/foo.ts', () => {
  assert.equal(matchGlob('*.lock', 'src/foo.ts'), false);
});

test('AC4a: src/* matches src/cli.ts', () => {
  assert.equal(matchGlob('src/*', 'src/cli.ts'), true);
});

test('AC4b: src/* does NOT match src/deep/file.ts', () => {
  assert.equal(matchGlob('src/*', 'src/deep/file.ts'), false);
});

test('AC5a: vendor.lock matches vendor.lock (exact)', () => {
  assert.equal(matchGlob('vendor.lock', 'vendor.lock'), true);
});

test('AC5b: vendor.lock does NOT match other.lock', () => {
  assert.equal(matchGlob('vendor.lock', 'other.lock'), false);
});

test('AC6: ** matches any/depth/path.ts', () => {
  assert.equal(matchGlob('**', 'any/depth/path.ts'), true);
});
