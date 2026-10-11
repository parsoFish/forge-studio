/**
 * Bead forge-mfv5.1.36 — the dev loop's execution order and the work-item
 * file order are NATURAL (`compareWorkItemIds`), over the live gitweave I2 set
 * at the Kickoff gate. Lexical order ran the kickoff-added roots WI-11/WI-13/
 * WI-14 straight after WI-1, before the engine they test existed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readWorkItemsFromDir, topologicalOrder, type WorkItem } from '../../work-item.ts';
import { I2_PLAN_LEAVES, plantI2Kickoff } from '../test-fixtures/kickoff-deps-i2.ts';

const NATURAL = ['WI-1', 'WI-2', 'WI-3a', 'WI-3b', 'WI-4', 'WI-5a', 'WI-5b', 'WI-6', 'WI-7', 'WI-8', 'WI-9a', 'WI-9b', 'WI-10', 'WI-11', 'WI-12', 'WI-13', 'WI-14'];

function readI2(): WorkItem[] {
  const root = mkdtempSync(join(tmpdir(), 'forge-wi-natural-'));
  try {
    const { wiDir } = plantI2Kickoff(root);
    const { items, parseErrors } = readWorkItemsFromDir(wiDir);
    assert.deepEqual(parseErrors, {});
    return items;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const ids = (items: readonly WorkItem[]) => items.map((w) => w.work_item_id);

test('readWorkItemsFromDir returns the I2 set in natural id order', () => {
  assert.deepEqual(ids(readI2()), NATURAL);
});

test('topologicalOrder over I2 as it stood (WI-13/14 depends_on []): ready roots tie-break naturally, WI-13 no longer second', () => {
  const items = readI2();
  assert.deepEqual(items.find((w) => w.work_item_id === 'WI-13')?.depends_on, [], 'the live defect: a kickoff WI with no dependencies');
  const order = ids(topologicalOrder(items));
  assert.deepEqual(order, NATURAL, 'Kahn with natural tie-break: WI-1, WI-2, WI-3a … the roots WI-11/13/14 are not pulled forward');
  assert.ok(order.indexOf('WI-13') > order.indexOf('WI-8'), 'the reset-before-apply test runs after the CLI (WI-8)');
});

test('topologicalOrder over I2 with the fixed dependencies: WI-13/14 come after every one of their prerequisites', () => {
  const items = readI2().map((w) => (w.work_item_id === 'WI-13' || w.work_item_id === 'WI-14' ? { ...w, depends_on: [...I2_PLAN_LEAVES] } : w));
  const order = ids(topologicalOrder(items));
  for (const added of ['WI-13', 'WI-14']) {
    for (const dep of I2_PLAN_LEAVES) assert.ok(order.indexOf(added) > order.indexOf(dep), `${added} after ${dep}`);
  }
  for (const w of items) for (const dep of w.depends_on) assert.ok(order.indexOf(w.work_item_id) > order.indexOf(dep), `${w.work_item_id} after ${dep}`);
});

test('topologicalOrder still refuses a cycle by name', () => {
  const items = readI2().map((w) => (w.work_item_id === 'WI-1' ? { ...w, depends_on: ['WI-13'] } : w.work_item_id === 'WI-13' ? { ...w, depends_on: ['WI-12'] } : w));
  assert.throws(() => topologicalOrder(items), /cannot topo-sort: dependency cycle .*WI-13/);
});
