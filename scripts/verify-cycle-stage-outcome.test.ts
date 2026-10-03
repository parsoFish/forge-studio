/**
 * bead forge-8vfn.6.10.6, reworked for M7-E row 205 — `classifyCycleEventLog`
 * reads the cycle's own `events.jsonl`, not a spawned `forge serve --once`'s
 * stdout (there is none: `forge studio` supervises serve continuously and
 * claims every eligible manifest itself).
 *
 * G1 run 3, 2026-09-04: a project-manager phase failure wrote a
 * `project-manager`/`error` event AND an `orchestrator`/`cycle`/`error`
 * event, and the caller handed off to develop nine seconds later because
 * nothing read either one. The decision is a pure function of the event
 * log, so it is tested as one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyCycleEventLog } from './verify-cycle-stage-outcome.mjs';

function line(obj) {
  return JSON.stringify(obj);
}

test('a clean cycle (cycle.end, no failure markers) is ok', () => {
  const r = classifyCycleEventLog([
    line({ phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' }),
    line({ phase: 'project-manager', event_type: 'start' }),
    line({ phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'ready-for-review' } }),
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.sawEnd, true);
  assert.equal(r.endStatus, 'ready-for-review');
});

test('THE RUN-3 LINES: a PM error + a cycle error are both reported, verbatim', () => {
  const r = classifyCycleEventLog([
    line({
      phase: 'project-manager',
      event_type: 'error',
      metadata: { result_subtype: 'success', work_item_count: 3 },
    }),
    line({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'project-manager phase failed: set errors: WI-3: creates is required (ADR 037) unless verification_artifact is set',
    }),
  ]);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.some((e) => /creates is required \(ADR 037\)/.test(e)),
    'the caller must be able to print WHY the cycle refused, not just that it did');
  assert.ok(r.errors.some((e) => /subtype=success/.test(e)),
    'the agent-turn-says-success line is evidence and must not be swallowed');
  assert.equal(r.sawEnd, false, 'a thrown cycle error never reaches cycle.end');
});

test('a PM error alone is enough — no cycle.end is needed to call it a failure', () => {
  const r = classifyCycleEventLog([
    line({ phase: 'project-manager', event_type: 'error', metadata: { result_subtype: 'success', work_item_count: 3 } }),
  ]);
  assert.equal(r.errors.length, 1);
});

test('every failing cycle in a batch of lines is named, not just the first', () => {
  const r = classifyCycleEventLog([
    line({ phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: 'boom' }),
    line({ phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'done' } }),
    line({ phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: 'bang' }),
  ]);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.some((e) => /boom/.test(e)));
  assert.ok(r.errors.some((e) => /bang/.test(e)));
});

test('no lines at all is NOT success — sawEnd stays false (§15.92)', () => {
  const r = classifyCycleEventLog([]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.sawEnd, false);
  assert.equal(r.endStatus, null);
});

test('a claim refusal is named with its reason and terminal/non-terminal kind', () => {
  const r = classifyCycleEventLog([
    line({
      phase: 'orchestrator',
      skill: 'scheduler',
      event_type: 'error',
      message: 'claim.refused',
      metadata: { reason: 'project "story-x" is not contract-ready (failing hard clause(s): C4)', terminal: false },
    }),
  ]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /claim refused \(non-terminal\)/);
  assert.match(r.errors[0], /failing hard clause\(s\): C4/);
});

test('a terminal claim refusal is named as terminal', () => {
  const r = classifyCycleEventLog([
    line({
      phase: 'orchestrator',
      skill: 'scheduler',
      event_type: 'error',
      message: 'claim.refused',
      metadata: { reason: 'flow_id names a flow that does not exist', terminal: true },
    }),
  ]);
  assert.match(r.errors[0], /claim refused \(terminal\)/);
});

test('malformed JSON lines are skipped, not thrown on', () => {
  const r = classifyCycleEventLog([
    'not json at all',
    line({ phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'merged' } }),
    '',
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.sawEnd, true);
  assert.equal(r.endStatus, 'merged');
});

test('an unrelated "error" event_type on an unrelated phase is not a decisive failure', () => {
  const r = classifyCycleEventLog([
    line({ phase: 'review-loop', event_type: 'error', message: 'a transient retry, not a cycle failure' }),
  ]);
  assert.deepEqual(r.errors, [], 'only the three named markers (claim.refused, orchestrator/cycle error, project-manager error) are decisive');
});
