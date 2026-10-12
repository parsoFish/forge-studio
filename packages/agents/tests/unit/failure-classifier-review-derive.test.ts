/**
 * forge-nk1y.39 — an adversarial review that could not DERIVE its git evidence
 * is an environment failure: the orchestrator's own git read failed (gitweave
 * I3a round 3: "spawnSync git ENOBUFS"), nothing about the work was judged. It
 * was classified terminal, which parked a long-lived initiative behind a review
 * that could never run again. Every other review failure stays terminal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EventLogEntry } from '@forge/kernel';

import { classifyCycleFailure } from '../../failure-classifier.ts';

function cycleError(message: string): EventLogEntry {
  return {
    event_id: 'e1',
    cycle_id: 'CY-x',
    initiative_id: 'INIT-x',
    started_at: '2026-10-12T11:40:44.831Z',
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'error',
    input_refs: [],
    output_refs: [],
    message,
  } as EventLogEntry;
}

/** Verbatim from the I3a round-3 cycle log (`cycle` error event, 2026-10-12T11:40:44Z). */
const I3A_ROUND_3 =
  'adversarial review pipeline failed (derive-failed: git derivation error for chunk unattributed: spawnSync git ENOBUFS) — no findings artifact was produced for the verdict gate. Triage before re-running.';

test('forge-nk1y.39: a review derive failure (I3a round 3, verbatim) → transient, environment, recoverable, named', () => {
  const c = classifyCycleFailure([cycleError(I3A_ROUND_3)]);
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.equal(c.environment, true);
  assert.match(c.reason, /could not derive its git evidence/);
  assert.deepEqual(c.evidence_event_ids, ['e1']);
});

test('forge-nk1y.39 control: every other review failure stays terminal', () => {
  for (const reason of ['spawn-failed: sdk error', 'author-invalid: x', 'scope-violation: y', 'budget-exhausted: WI-2 is too large']) {
    const c = classifyCycleFailure([cycleError(`adversarial review pipeline failed (${reason}) — no findings artifact was produced for the verdict gate.`)]);
    assert.equal(c.kind, 'terminal', reason);
    assert.equal(c.environment, false, reason);
  }
});
