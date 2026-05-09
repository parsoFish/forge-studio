import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStages } from '../src/runner.ts';

test('runStages accepts an empty PR list', async () => {
  await assert.doesNotReject(runStages({ prNumbers: [], retryLimit: 3 }));
});

test('runStages accepts a non-empty PR list', async () => {
  await assert.doesNotReject(runStages({ prNumbers: [1, 2, 3], retryLimit: 3 }));
});
