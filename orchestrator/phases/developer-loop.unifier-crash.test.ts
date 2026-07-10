/**
 * unifierItemClassify — distinguishes a transient agent-PROCESS crash (retryable
 * inline; persisted as re-runnable `pending` so resume re-drains) from a
 * deterministic gate FAILURE (operator-deferred `failed`). Regression for the
 * gitpulse 2026-06-21 cycle where the unifier SDK process exited 1 at iter-0,
 * was marked `failed`, and resume-from-unifier then no-op'd.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unifierItemClassify } from './developer-loop.ts';

const uwi = { work_item_id: 'UWI-1' } as Parameters<typeof unifierItemClassify>[0];
const loop = (status: 'complete' | 'failed') =>
  ({ status, iterations: 1, cost_usd: 0, duration_ms: 0, stop_reason: status, artifacts: [], filesChanged: [] }) as unknown as Parameters<typeof unifierItemClassify>[1];

test('unifierItemClassify: a completed run is complete + not crashed', () => {
  const o = unifierItemClassify(uwi, loop('complete'), null);
  assert.equal(o.status, 'complete');
  assert.equal(o.crashed, false);
  assert.equal(o.failureClass, null);
});

test('unifierItemClassify: a gate failure (clean return, no runnerError) is failed + NOT crashed', () => {
  const o = unifierItemClassify(uwi, loop('failed'), null);
  assert.equal(o.status, 'failed');
  assert.equal(o.crashed, false, 'a gate failure is operator-deferred, not a transient crash');
  assert.equal(o.failureClass, 'dev-loop-unifier-gate-failed');
});

test('unifierItemClassify: a thrown process crash (runnerError, null loopResult) is crashed', () => {
  const o = unifierItemClassify(uwi, null, 'Claude Code process exited with code 1');
  assert.equal(o.status, 'failed');
  assert.equal(o.crashed, true, 'a process crash is transient → retryable / resume-re-drainable');
  assert.equal(o.failureClass, 'dev-loop-unifier-crashed');
  assert.equal(o.runnerError, 'Claude Code process exited with code 1');
});

test('unifierItemClassify: runnerError dominates even if a stale loopResult is present', () => {
  // A throw after a partial result: runnerError set ⇒ crash, not a gate fail.
  const o = unifierItemClassify(uwi, loop('failed'), 'stream deadline');
  assert.equal(o.crashed, true);
});

test('unifierItemClassify: a loop-cap-exhausted stop is failed + NOT crashed + distinct failure class (G4)', () => {
  const capped = {
    status: 'failed', iterations: 4, cost_usd: 0, duration_ms: 0,
    stop_reason: 'loop-cap-exhausted', artifacts: [], filesChanged: [],
  } as unknown as Parameters<typeof unifierItemClassify>[1];
  const o = unifierItemClassify(uwi, capped, null);
  assert.equal(o.status, 'failed');
  assert.equal(o.crashed, false, 'cap exhaustion is a deterministic gate outcome, not a transient crash');
  assert.equal(o.failureClass, 'dev-loop-unifier-loop-cap-exhausted');
});
