import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapConcurrent } from './concurrent.ts';

test('mapConcurrent: preserves order and processes all items', async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await mapConcurrent(items, 2, async (n) => n * n);
  assert.deepEqual(results, [1, 4, 9, 16, 25]);
});

test('mapConcurrent: respects concurrency cap', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await mapConcurrent([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async () => {
    inFlight += 1;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
  });
  assert.ok(maxInFlight <= 3, `maxInFlight=${maxInFlight} exceeded cap=3`);
  assert.ok(maxInFlight >= 2, `maxInFlight=${maxInFlight} suggests serial execution`);
});

test('mapConcurrent: empty input returns empty array', async () => {
  const results = await mapConcurrent<number, number>([], 4, async (n) => n);
  assert.deepEqual(results, []);
});

test('mapConcurrent: rejects on concurrency < 1', async () => {
  await assert.rejects(() => mapConcurrent([1], 0, async (x) => x), /concurrency must be >= 1/);
});

test('mapConcurrent: throws if any worker throws', async () => {
  await assert.rejects(
    () =>
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    /boom/,
  );
});
