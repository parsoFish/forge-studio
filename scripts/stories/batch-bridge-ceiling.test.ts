/**
 * batch-bridge-ceiling.test.ts — the ONE bridge a batch boots carries the SUM
 * of the batch's costed story ceilings (bead forge-8vfn.30.7).
 *
 * The bridge cap is cumulative across every session it serves, so a cap equal
 * to the strictest single story halts a multi-story batch before the last
 * story finishes. Per-story bounds are enforced per beat by `runStory`; the
 * bridge is only the backstop and must not be tighter than the batch total.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { batchBridgeCeiling } from './spend.mjs';

type Story = { id: string; ground: { realSpawn: boolean; budget_usd: number } };
const costed = (id: string, usd: number): Story => ({ id, ground: { realSpawn: true, budget_usd: usd } });
const costless = (id: string): Story => ({ id, ground: { realSpawn: false, budget_usd: 0 } });

const fullSuite = (): Story[] => [
  ...Array.from({ length: 8 }, (_, i) => costed(`S${i + 1}`, 25)),
  costed('S10', 44),
  costless('S11'),
  costless('S12'),
];

test('(a) a full-suite batch (eight $25 + one $44) carries 244, not the strictest 25', () => {
  const v = batchBridgeCeiling(fullSuite(), undefined);
  assert.equal(v.usd, 244);
});

test('(b) a batch of only costless stories has no ceiling', () => {
  const v = batchBridgeCeiling([costless('S11'), costless('S12')], undefined);
  assert.equal(v.usd, null);
  assert.match(v.reason, /nothing in this batch spends/);
});

test('(c) a funded ceiling caps each story before the sum', () => {
  const v = batchBridgeCeiling(fullSuite(), 30);
  assert.equal(v.usd, 8 * 25 + 30);
});

test('(d) a single costed story carries exactly its own effective ceiling', () => {
  assert.equal(batchBridgeCeiling([costed('S3', 25)], undefined).usd, 25);
  assert.equal(batchBridgeCeiling([costed('S3', 25), costless('S11')], 10).usd, 10);
});

test('(e) the reason names each costed story id and its figure', () => {
  const v = batchBridgeCeiling([costed('S1', 25), costed('S10', 44), costless('S11')], undefined);
  assert.match(v.reason, /sum of 2 costed stories/);
  assert.match(v.reason, /S1 \$25\.00 \+ S10 \$44\.00/);
  assert.doesNotMatch(v.reason, /S11/);
});

test('a costed story with no finite ceiling is dropped from the figure and named in the reason', () => {
  const bad = { id: 'SX', ground: { realSpawn: true, budget_usd: NaN } };
  const v = batchBridgeCeiling([costed('S1', 25), bad], undefined);
  assert.equal(v.usd, 25);
  assert.match(v.reason, /SX/);
  assert.match(v.reason, /no finite ceiling/);
});

test('the verdict is frozen', () => {
  assert.equal(Object.isFrozen(batchBridgeCeiling([costed('S1', 25)], undefined)), true);
});
