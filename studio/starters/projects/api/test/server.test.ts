import { test } from 'node:test';
import assert from 'node:assert/strict';

import { route } from '../src/server.ts';

// Fast, deterministic unit tests of the pure routing logic — the per-iteration
// quality gate. No socket bound; behaviour is exercised directly.
test('route: GET /health → 200 ok', () => {
  assert.deepEqual(route('GET', '/health'), { status: 200, body: { ok: true } });
});

test('route: unknown path → 404', () => {
  assert.equal(route('GET', '/sentinel-42').status, 404);
});
