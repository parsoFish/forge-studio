/**
 * Phase 4/2 (honest dev-loop delivery events) — brain/cycles/themes/2026-07-
 * 11-dev-loop-delivered-event-fires-for-failed-wi.md.
 *
 * Before this change `developer-loop.ts` emitted `dev-loop.delivered`
 * unconditionally after every WI, including failed ones (files_changed: 0
 * but an event name implying success). `wiDeliveryEvent` is the pure
 * decision extracted from that per-WI emission: `dev-loop.delivered` is
 * SUCCESS-ONLY; any other outcome carries the SAME diff-stat fields on
 * `dev-loop.discarded` instead, and both variants carry an explicit
 * `outcome` field so a consumer never has to infer success from the
 * message name alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wiDeliveryEvent } from './developer-loop.ts';

const DELTA_ZERO = { files: 0, insertions: 0, deletions: 0, commits: 0 };
const DELTA_REAL = { files: 4, insertions: 182, deletions: 2, commits: 1 };

test('wiDeliveryEvent: a complete WI emits dev-loop.delivered with outcome=complete', () => {
  const { message, metadata } = wiDeliveryEvent('complete', 'WI-1', DELTA_REAL);
  assert.equal(message, 'dev-loop.delivered');
  assert.deepEqual(metadata, {
    work_item_id: 'WI-1',
    files_changed: 4,
    insertions: 182,
    deletions: 2,
    commits: 1,
    outcome: 'complete',
  });
});

test('wiDeliveryEvent: a failed WI NEVER emits dev-loop.delivered', () => {
  const { message } = wiDeliveryEvent('failed', 'WI-2', DELTA_ZERO);
  assert.notEqual(message, 'dev-loop.delivered');
});

test('wiDeliveryEvent: a failed WI emits dev-loop.discarded instead', () => {
  const { message } = wiDeliveryEvent('failed', 'WI-2', DELTA_ZERO);
  assert.equal(message, 'dev-loop.discarded');
});

test('wiDeliveryEvent: discarded carries the SAME diff-stat metadata fields as delivered, plus outcome=failed', () => {
  // A failed WI can still have partial diff (wrote some code before the
  // gate failed) — the discarded event must not silently drop that data.
  const { message, metadata } = wiDeliveryEvent('failed', 'WI-3', DELTA_REAL);
  assert.equal(message, 'dev-loop.discarded');
  assert.deepEqual(metadata, {
    work_item_id: 'WI-3',
    files_changed: 4,
    insertions: 182,
    deletions: 2,
    commits: 1,
    outcome: 'failed',
  });
});

test('wiDeliveryEvent: a failed WI with zero diff still emits discarded (not delivered) with honest zeros', () => {
  const { message, metadata } = wiDeliveryEvent('failed', 'WI-4', DELTA_ZERO);
  assert.equal(message, 'dev-loop.discarded');
  assert.equal(metadata.files_changed, 0);
  assert.equal(metadata.insertions, 0);
  assert.equal(metadata.deletions, 0);
  assert.equal(metadata.commits, 0);
  assert.equal(metadata.outcome, 'failed');
});

test('wiDeliveryEvent: any non-complete status routes to discarded, not just failed', () => {
  for (const status of ['failed', 'pending', 'in-progress'] as const) {
    const { message } = wiDeliveryEvent(status, 'WI-5', DELTA_ZERO);
    assert.equal(message, 'dev-loop.discarded', `status=${status} must not read as delivered`);
  }
});
