/**
 * queue-state.test.ts — the one read of WHICH `_queue/` directory a manifest
 * sits in, shared by `scripts/lib/serve-wait.mjs` and
 * `scripts/stories/d12-demo-runs-teardown.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { manifestQueueState, QUEUE_STATES } from './queue-state.mjs';

test('QUEUE_STATES lists every getPaths() key, in queue order', () => {
  assert.deepEqual(QUEUE_STATES, ['pending', 'inFlight', 'readyForReview', 'merged', 'done', 'failed']);
});

test('reports absent when the manifest is in none of the queue directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'queue-state-'));
  assert.equal(manifestQueueState(root, 'INIT-x'), 'absent');
});

test('reports the exact state dir a manifest is sitting in', () => {
  const root = mkdtempSync(join(tmpdir(), 'queue-state-'));
  const dir = join(root, '_queue', 'in-flight');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'INIT-y.md'), '---\n---\n');
  assert.equal(manifestQueueState(root, 'INIT-y'), 'inFlight');
});
