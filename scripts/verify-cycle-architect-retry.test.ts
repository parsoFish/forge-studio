/**
 * bead: architect-stall-retry — `verify-cycle.mjs`'s `driveArchitect` threw
 * and ended a funded run on a `StreamDeadlineError`
 * (`packages/agents/stream-deadline.ts`) even though that error's own message
 * says "transient; routes to auto-retry" — the retry it promises was never
 * taken on this path.
 *
 * `shouldRetryArchitect` is the pure decision `driveArchitect` calls before
 * starting a fresh architect session: retry ONCE, and only for a
 * stream-deadline stall, reusing `classifyCrash`'s existing
 * `'stream-deadline'` signature (packages/agents/failure-classifier.ts)
 * rather than a second hand-rolled pattern in the harness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isArchitectStall, shouldRetryArchitect } from './lib/architect-retry.mjs';

const STREAM_DEADLINE_MESSAGE =
  "architect session FAILED: stream-deadline: SDK stream 'architect-structured' produced no message for 360s — " +
  'aborted as a likely usage-limit / network stall (transient; routes to auto-retry).';

test('(a) a stall on attempt 1 retries', () => {
  assert.equal(shouldRetryArchitect(STREAM_DEADLINE_MESSAGE, 1), true);
});

test('(b) a stall on attempt 2 does not retry — bounded to exactly one retry', () => {
  assert.equal(shouldRetryArchitect(STREAM_DEADLINE_MESSAGE, 2), false);
});

test('(c) a non-stall failure never retries, on attempt 1 or 2', () => {
  const nonStall = 'architect session FAILED: no manifest ports were injected';
  assert.equal(shouldRetryArchitect(nonStall, 1), false);
  assert.equal(shouldRetryArchitect(nonStall, 2), false);
});

test('(c continued) other classifyCrash transient signatures (rate-limit, SIGKILL) stay UN-retried here — scoped to stream-deadline only', () => {
  assert.equal(shouldRetryArchitect('architect session FAILED: rate_limit_error hit', 1), false);
  assert.equal(shouldRetryArchitect('architect session FAILED: process killed, signal 9', 1), false);
});

test('edge: a null/undefined/empty failure message never retries', () => {
  assert.equal(shouldRetryArchitect(null, 1), false);
  assert.equal(shouldRetryArchitect(undefined, 1), false);
  assert.equal(shouldRetryArchitect('', 1), false);
});

test('isArchitectStall names exactly the stream-deadline signature — the call site uses it to pick the terminal message on a second stall', () => {
  assert.equal(isArchitectStall(STREAM_DEADLINE_MESSAGE), true);
  assert.equal(isArchitectStall('architect session FAILED: no manifest ports were injected'), false);
});
