import { test } from 'node:test';
import assert from 'node:assert/strict';

import { greet } from '../src/index.ts';

// A fast, deterministic unit test — the per-iteration quality gate. It must
// fail before the behaviour exists and pass only when it is correct. Use a
// distinctive value so an implementation that ignores its input is caught.
test('greet: names the caller', () => {
  assert.equal(greet('sentinel-42'), 'hello, sentinel-42');
});
