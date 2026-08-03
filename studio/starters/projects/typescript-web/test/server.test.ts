import { test } from 'node:test';
import assert from 'node:assert/strict';

import { page } from '../src/server.ts';

// Fast, deterministic unit tests of the pure page-rendering logic — the
// per-iteration quality gate. No socket bound; behaviour is exercised directly.
test('page: GET / → 200 html with a heading', () => {
  const result = page('GET', '/');
  assert.equal(result.status, 200);
  assert.match(result.body, /<h1>It works<\/h1>/);
});

test('page: unknown path → 404', () => {
  assert.equal(page('GET', '/sentinel-42').status, 404);
});

test('page: non-GET method on a known path → 404', () => {
  assert.equal(page('POST', '/').status, 404);
});
