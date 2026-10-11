/**
 * Bead forge-mfv5.1.36 — ONE natural work-item-id order (`compareWorkItemIds`)
 * and the plan's leaf work items (`leafWorkItemIds`). Lexical order put `WI-10`
 * and `WI-13` before `WI-2`, so a kickoff-added `WI-13` ran second in gitweave
 * I2, before the engine it tests existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORK_ITEM_ID_PATTERN, compareWorkItemIds, leafWorkItemIds } from '../../index.ts';

test('natural order: the number as a number, then the split suffix', () => {
  const shuffled = ['WI-10', 'WI-3b', 'WI-4', 'WI-3', 'WI-3a', 'WI-2', 'WI-1', 'WI-13'];
  assert.deepEqual([...shuffled].sort(compareWorkItemIds), ['WI-1', 'WI-2', 'WI-3', 'WI-3a', 'WI-3b', 'WI-4', 'WI-10', 'WI-13']);
  assert.ok(compareWorkItemIds('WI-3', 'WI-3a') < 0);
  assert.ok(compareWorkItemIds('WI-3a', 'WI-3b') < 0);
  assert.ok(compareWorkItemIds('WI-3b', 'WI-4') < 0);
  assert.ok(compareWorkItemIds('WI-4', 'WI-10') < 0);
  assert.equal(compareWorkItemIds('WI-7', 'WI-7'), 0);
});

test('the I2 set sorts WI-1, WI-2, WI-3a … WI-9b, WI-10 … WI-14', () => {
  const lexical = ['WI-1', 'WI-10', 'WI-11', 'WI-12', 'WI-13', 'WI-14', 'WI-2', 'WI-3a', 'WI-3b', 'WI-4', 'WI-5a', 'WI-5b', 'WI-6', 'WI-7', 'WI-8', 'WI-9a', 'WI-9b'];
  assert.deepEqual([...lexical].sort(compareWorkItemIds), [
    'WI-1', 'WI-2', 'WI-3a', 'WI-3b', 'WI-4', 'WI-5a', 'WI-5b', 'WI-6', 'WI-7', 'WI-8', 'WI-9a', 'WI-9b', 'WI-10', 'WI-11', 'WI-12', 'WI-13', 'WI-14',
  ]);
});

test('dev items before unifier items; numbers beyond float precision compare exactly; zero-padding ties break lexically', () => {
  assert.deepEqual(['UWI-1', 'WI-2', 'UWI-10', 'WI-1'].sort(compareWorkItemIds), ['WI-1', 'WI-2', 'UWI-1', 'UWI-10']);
  assert.ok(compareWorkItemIds('WI-90071992547409930', 'WI-90071992547409931') < 0);
  assert.ok(compareWorkItemIds('WI-05', 'WI-5') < 0, 'same number: deterministic lexical tie-break');
  assert.ok(compareWorkItemIds('WI-5', 'WI-05') > 0);
});

test('a non-matching id sorts after every matching one, then lexically; never throws', () => {
  const ids = ['zeta', 'WI-2', 'WI-4A', 'alpha', 'WI-10', '', 'wi-1'];
  assert.deepEqual([...ids].sort(compareWorkItemIds), ['WI-2', 'WI-10', '', 'WI-4A', 'alpha', 'wi-1', 'zeta']);
  assert.equal(compareWorkItemIds('alpha', 'alpha'), 0);
  const notStrings = [undefined, null, 7] as unknown as string[];
  assert.doesNotThrow(() => [...notStrings, 'WI-1'].sort(compareWorkItemIds));
  assert.equal([...notStrings, 'WI-1'].sort(compareWorkItemIds)[0], 'WI-1');
});

test('the comparator recognises exactly the ids WORK_ITEM_ID_PATTERN admits', () => {
  const probe = ['WI-1', 'WI-4a', 'UWI-2', 'WI-4ab', 'WI-4A', 'WI-4-a', 'wi-4', 'WI-', 'XWI-1', 'WI-1 '];
  for (const id of probe) {
    const matched = compareWorkItemIds(id, '') < 0; // '' is unmatched and lexically first: only a matched id sorts before it
    assert.equal(matched, WORK_ITEM_ID_PATTERN.test(id), id);
  }
});

test('large set: 10k shuffled ids sort naturally and stay deterministic', () => {
  const ids = Array.from({ length: 10_000 }, (_, i) => `WI-${i + 1}`);
  const shuffled = [...ids].sort((a, b) => (a.length * 7919 + a.charCodeAt(a.length - 1)) - (b.length * 7919 + b.charCodeAt(b.length - 1)));
  assert.deepEqual([...shuffled].sort(compareWorkItemIds), ids);
});

test('leafWorkItemIds: items no other item depends on, in natural order', () => {
  const items = [
    { id: 'WI-1', dependsOn: [] }, { id: 'WI-2', dependsOn: ['WI-1'] }, { id: 'WI-10', dependsOn: ['WI-1'] },
    { id: 'WI-3a', dependsOn: [] }, { id: 'WI-3b', dependsOn: ['WI-3a', 'WI-404'] },
  ];
  assert.deepEqual(leafWorkItemIds(items), ['WI-2', 'WI-3b', 'WI-10']);
  assert.deepEqual(leafWorkItemIds([]), []);
  assert.deepEqual(leafWorkItemIds([{ id: 'WI-1', dependsOn: [] }]), ['WI-1'], 'a lone item is its own leaf');
});
