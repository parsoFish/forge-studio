/**
 * beats-page-read.test.ts — `resolveExpectations`'s together-rule, on its own.
 *
 * forge-8vfn.16, PR-B item 5. `resolveExpectations` got the together-rule in
 * `3ae38df5` (`beats.test.ts`'s `liveProjectsIndex` fixture pins the shape
 * against `beatVerdict`, one layer up), but nothing pins the function ITSELF
 * against DOM order — the together-rule's exact-match branch iterates
 * `records` and returns the first that satisfies every shared key, and a
 * reader could regress that into a first-match-wins or highest-index-wins rule
 * without either of `beatVerdict`'s existing fixtures noticing, because both
 * of those pin the FIRST record as the answer.
 *
 * So this beat's shape is the gitweave/mdtoc pair with the WANTED record
 * SECOND: two `[data-card-id]` records, `card-id: gitweave, health: stale`
 * first and `card-id: mdtoc, health: healthy` second, expecting
 * `{ 'card-id': 'mdtoc', health: 'healthy' }` — which only the second record
 * answers. `card-id` and `health` are each carried by two nested records, so
 * both stay under the together-rule (`beats-page-read.mjs`'s "bounded by
 * SOURCE COUNT" rule) rather than being read solo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpectations } from './beats-page-read.mjs';

test('the together-rule resolves the SECOND record when it is the one that matches, not the first', () => {
  const expected = { 'card-id': 'mdtoc', health: 'healthy' };
  const observed = {
    data: {},
    nested: [
      { 'card-id': 'gitweave', health: 'stale' },
      { 'card-id': 'mdtoc', health: 'healthy' },
    ],
  };
  const seen = resolveExpectations(expected, observed);
  assert.deepEqual(
    { 'card-id': seen['card-id'], health: seen.health },
    { 'card-id': 'mdtoc', health: 'healthy' },
  );
});
