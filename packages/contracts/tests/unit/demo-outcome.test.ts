/**
 * forge-nk1y.43 — an all-`unchanged` (or all-`unknown`) capture is a NAMED demo
 * outcome, never a silent pass. Fixture: gitweave I3a's committed demo.json
 * (copied, media fields dropped). Its six planned checkpoints all came back
 * `unchanged`; the five appended `Plan-…` entries are stale capture media from
 * an earlier plan (fixed in `captureCheckpoints`), so the planned set is what a
 * clean capture of I3a would have recorded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { demoOutcomeHeadline, demoOutcomeOf } from '../../demo-outcome.ts';

type Cp = { label: string; delta?: string; form?: string };
const I3A = JSON.parse(readFileSync(join(import.meta.dirname, '../../../stations/tests/test-fixtures/gitweave-i3a/demo.json'), 'utf8')) as { checkpoints: Cp[] };
const planned = I3A.checkpoints.filter((c) => c.form !== undefined);

test('I3a: six planned checkpoints, all unchanged → no-change, 6/6 identical', () => {
  assert.equal(planned.length, 6);
  const o = demoOutcomeOf(planned);
  assert.deepEqual(o, { kind: 'no-change', compared: 6, changed: 0, unchanged: 6, unknown: 0 });
  assert.equal(demoOutcomeHeadline(o!), 'Demo captured no behaviour change — 6/6 checkpoints identical');
});

test('one changed checkpoint makes the demo changed, with its count', () => {
  const o = demoOutcomeOf([...planned.slice(0, 5), { label: 'x', delta: 'changed', form: 'cli-before-after' }]);
  assert.equal(o!.kind, 'changed');
  assert.equal(demoOutcomeHeadline(o!), '1 of 6 checkpoints changed behaviour');
});

test('unknown is named separately — never folded into "identical"', () => {
  const o = demoOutcomeOf([{ label: 'a', delta: 'unchanged' }, { label: 'b', delta: 'unknown' }]);
  assert.deepEqual(o, { kind: 'no-change', compared: 2, changed: 0, unchanged: 1, unknown: 1 });
  assert.equal(demoOutcomeHeadline(o!), 'Demo captured no behaviour change — 1/2 checkpoints identical, 1 could not be compared');
});

test('all unknown → unknown, not no-change', () => {
  const o = demoOutcomeOf([{ label: 'a', delta: 'unknown' }, { label: 'b', delta: 'unknown' }]);
  assert.equal(o!.kind, 'unknown');
  assert.equal(demoOutcomeHeadline(o!), 'Demo compared no checkpoint — 2/2 could not be compared');
});

test('test-evidence checkpoints are not before/after evidence and are not counted', () => {
  const o = demoOutcomeOf([{ label: 'g', form: 'test-evidence', delta: 'unknown' }, { label: 'a', delta: 'changed' }]);
  assert.deepEqual(o, { kind: 'changed', compared: 1, changed: 1, unchanged: 0, unknown: 0 });
});

test('no compared checkpoint (capture never ran) → null, not a verdict', () => {
  assert.equal(demoOutcomeOf([{ label: 'a' }, { label: 'g', form: 'test-evidence' }]), null);
  assert.equal(demoOutcomeOf([]), null);
});
