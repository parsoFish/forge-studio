/**
 * bead forge-8vfn.6.10.6 — the harness handed off to develop while stage 1 had
 * already failed.
 *
 * G1 run 3, 2026-09-04: the serve pass printed
 *   `INIT-… · PM FAILED · $0.66 · subtype=success · WIs=3`
 *   `INIT-… · cycle ERROR: project-manager phase failed: set errors: WI-3: …`
 * and nine seconds later `verify-cycle.mjs` POSTed `/api/develop/start` anyway,
 * because `runServeStage` returned nothing and the caller had nothing to check.
 * The initiative then merged to a real project on a rejected work-item set.
 *
 * The decision is a pure function of the serve output, so it is tested as one —
 * the same shape as `ci-terminal.sh classify`, and for the same reason: a
 * predicate that can only be exercised by a live $7 run is a predicate nobody
 * exercises (§15.163).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyServeStageOutcome } from './verify-cycle-stage-outcome.mjs';

test('a clean serve pass is ok', () => {
  const r = classifyServeStageOutcome([
    '[serve] claimed: INIT-2026-09-04-x (gitpulse)',
    '[15:38:26] INIT-2026-09-04-x · PM OK · $0.66 · WIs=3',
    '[serve] INIT-2026-09-04-x · cycle done',
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('THE RUN-3 LINE: a cycle ERROR is not ok, and the reason is carried out verbatim', () => {
  const r = classifyServeStageOutcome([
    '[15:38:26] INIT-2026-09-04-include-path-filter-flag · PM FAILED · $0.66 · 2m51s · subtype=success · WIs=3',
    '[15:38:26] INIT-2026-09-04-include-path-filter-flag · cycle ERROR: project-manager phase failed: set errors: WI-3: creates is required (ADR 037) unless verification_artifact is set',
  ]);
  assert.equal(r.ok, false, 'this is the exact line the harness ignored on 2026-09-04');
  // Two distinct failure lines, and both are reported: the phase verdict and the
  // cycle's terminal error are separate facts, and collapsing them would hide the
  // `subtype=success` line that makes bead 8vfn.6.1 visible in the first place.
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.some((e) => /creates is required \(ADR 037\)/.test(e)),
    'the caller must be able to print WHY it refused to hand off, not just that it did');
  assert.ok(r.errors.some((e) => /subtype=success/.test(e)),
    'the agent-turn-says-success line is evidence and must not be swallowed');
});

test('a PM FAILED line alone is enough — subtype=success on the same line must not rescue it', () => {
  const r = classifyServeStageOutcome([
    '[15:38:26] INIT-x · PM FAILED · $0.66 · 2m51s · subtype=success · WIs=3',
  ]);
  assert.equal(r.ok, false,
    'the agent turn reporting success while the phase failed is bead 8vfn.6.1 — the harness must read the phase');
});

test('every failing initiative is named, not just the first (a batch hand-off must not proceed on the survivors)', () => {
  const r = classifyServeStageOutcome([
    '[t] INIT-a · cycle ERROR: boom',
    '[t] INIT-b · cycle done',
    '[t] INIT-c · cycle ERROR: bang',
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});

test('an empty pass is NOT ok — no output is not the same as success (§15.92)', () => {
  const r = classifyServeStageOutcome([]);
  assert.equal(r.ok, false, 'a serve stage that printed nothing has not demonstrated a claim');
  assert.match(r.errors[0], /no .*outcome|nothing/i);
});

test('the word "error" in ordinary prose does not fail the stage', () => {
  const r = classifyServeStageOutcome([
    '[serve] INIT-x · dev-loop: retrying after a transient error in the gate command',
    '[serve] INIT-x · cycle done',
  ]);
  assert.equal(r.ok, true, 'the marker is `· cycle ERROR:`, not the substring "error"');
});
