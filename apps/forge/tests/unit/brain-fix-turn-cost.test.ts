/**
 * Row 199 (bead forge-8vfn.8.5.39, T1 ruling 1973gt) — the KB drain's per-turn
 * cost read-back charges a BOUNDED unpriced turn its bound.
 *
 * `kinds/fix-turn.ts` now runs a brain-fix turn under the drain's remaining
 * ceiling, and a turn that crashes or ends resultless under that cap leaves a
 * row with `priced: false` + `upper_bound_usd` and no `cost_usd`. The read-back
 * returned 0 for both shapes, so the drain's running sum — the figure its
 * COST-CEILING compares — under-counted exactly the turns it could not price.
 * A turn with no bound still reads 0, as before: nothing bounds it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBrainFixTurnCostUsd } from '../../brain-fix-turn.ts';

function withLog(rows: object[], fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'brain-fix-cost-'));
  try {
    const dir = join(root, '_logs', '_brainfix-r1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const start = { event_type: 'start', message: 'brain-fix.start' };

test('a priced end row reads its cost_usd', () => {
  withLog([start, { event_type: 'end', message: 'brain-fix.end (cleared=true)', cost_usd: 0.4 }], (root) =>
    assert.equal(readBrainFixTurnCostUsd(root, 'r1'), 0.4));
});

test('a bounded crash row reads its upper_bound_usd, not 0', () => {
  withLog([start, { event_type: 'error', message: 'brain-fix.crashed', metadata: { priced: false, upper_bound_usd: 0.6 } }], (root) =>
    assert.equal(readBrainFixTurnCostUsd(root, 'r1'), 0.6));
});

test('a bounded resultless end row reads its upper_bound_usd, not 0', () => {
  withLog([start, { event_type: 'end', message: 'brain-fix.end (cleared=false)', metadata: { priced: false, upper_bound_usd: 0.5 } }], (root) =>
    assert.equal(readBrainFixTurnCostUsd(root, 'r1'), 0.5));
});

test('an unbounded crash still reads 0 — no bound is invented', () => {
  withLog([start, { event_type: 'error', message: 'brain-fix.crashed', metadata: { error: 'boom' } }], (root) =>
    assert.equal(readBrainFixTurnCostUsd(root, 'r1'), 0));
});
