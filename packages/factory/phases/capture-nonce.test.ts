/**
 * bead forge-8vfn.17, defect 3 of 3 — the G1 gate failure of 2026-09-04.
 *
 * The demo agent compared the nonce it injected with the one stamped into
 * demo.json and, on ANY difference, returned "the evidence was not produced by
 * this capture (stale, replayed, or hand-written)". A MISSING stamp took that
 * branch too — so when the capture crashed and (defect 2) exited 0 without
 * stamping, the run was accused of forging evidence it had simply never
 * produced. The operator reading that verdict is looking for a tampering
 * incident that does not exist, while the real cause — an ENOENT in the capture
 * — was dropped on the success branch.
 *
 * "Did not happen" and "happened wrong" are different facts and the agent can
 * tell them apart: absence is `null`, tampering is a different string. It may
 * only make the accusation when it can actually distinguish the two.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { judgeCaptureNonce } from './capture-nonce.ts';

test('a matching stamp is the pass', () => {
  assert.deepEqual(judgeCaptureNonce('n-1', 'n-1'), { ok: true });
});

test('a DIFFERENT stamp is the only case that may claim the evidence was not produced by this capture', () => {
  const v = judgeCaptureNonce('n-1', 'n-2');
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, 'nonce-mismatch');
  assert.match(v.ok === false ? v.detail : '', /stale, replayed, or hand-written/);
});

test('a MISSING stamp is "the capture did not complete", never an accusation', () => {
  const v = judgeCaptureNonce('n-1', null);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, 'capture-not-stamped',
    'a missing stamp must not share a reason code with tampering — the operator triages them differently');
  const detail = v.ok === false ? v.detail : '';
  assert.doesNotMatch(detail, /stale|replayed|hand-written|forg/i,
    'accusing a run of forgery when the evidence merely never existed sends the operator hunting a tampering incident');
  assert.match(detail, /did not|no .*nonce|not stamped/i, 'the detail must say what actually happened');
});

test('the two failures are distinguishable by reason code alone (a caller must not have to parse prose)', () => {
  const missing = judgeCaptureNonce('n-1', null);
  const mismatch = judgeCaptureNonce('n-1', 'n-2');
  assert.notEqual(missing.ok === false && missing.reason, mismatch.ok === false && mismatch.reason);
});

test('an empty-string stamp counts as MISSING, not as a mismatch (a truncated write is not tampering)', () => {
  const v = judgeCaptureNonce('n-1', '');
  assert.equal(v.ok === false && v.reason, 'capture-not-stamped');
});
