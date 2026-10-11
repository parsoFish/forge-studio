/**
 * D-49 (forge-mfv5.1.34) — PM set-validation errors that survived the bounded
 * repair turns classify as a deterministic, named PM-phase failure resumable
 * from the plan node (repair mode), and a repair turn's needs-replan
 * declaration classifies terminal with NO resume point.
 *
 * The shape is gitweave I2's (2026-10-11): the project-manager error event
 * carried BOTH `set_errors` (a D-18 bound) and an acceptance-gate violation.
 * Before D-49, `set_errors` matched pmInvalidWorkItems first — terminal with no
 * resume point — so Requeue re-ran the PM blind. Kept in its OWN file
 * (`unit/failure-classifier.test.ts` has no baseline headroom).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import { PM_REPAIR_NEEDS_REPLAN_PREFIX, PM_SET_VALIDATION_UNREPAIRED_PREFIX } from '@forge/contracts';
import type { EventLogEntry } from '@forge/kernel';

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-2026-09-27-coupling-sort-flag',
    started_at: '2026-09-27T20:34:22.000Z',
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

const D18 = 'WI-3: creates lists 7 path(s), exceeding the D-18 sizing bound of 5 — split into smaller work items';

/** The I2 shape: the PM error event with `set_errors`, the quarantine, then the
 *  orchestrator's wrapped "project-manager phase failed: …" carrying the prefix. */
function i2Events(summary: string): EventLogEntry[] {
  return [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'error',
      metadata: { set_errors: [D18], per_item_error_count: 0, hidden_coupling_violations: [], acceptance_gate_violation: 'acceptance criteria not exercised by any work item\'s quality_gate_cmd: AC5', repair_turns: 2, repair_stop: 'exhausted' },
    }),
    ev({ event_id: 'e2', event_type: 'error', message: 'pm.rejected-set-quarantined', metadata: { work_items_moved: 15 } }),
    ev({ event_id: 'e3', phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: `project-manager phase failed: ${summary}` }),
  ];
}

test('D-49: unrepaired set validation → terminal, non-recoverable, resumeFrom plan — even with set_errors present', () => {
  const c = classifyCycleFailure(i2Events(`${PM_SET_VALIDATION_UNREPAIRED_PREFIX} after 2 repair turn(s): ${D18}`));
  assert.equal(c.kind, 'terminal', 'the repair turns already ran — no auto-retry');
  assert.equal(c.recoverable, false);
  assert.equal(c.environment, false, 'a decomposition defect, not API pressure');
  assert.equal(c.resumeFrom, 'plan', 'Requeue resumes at the plan node in repair mode');
  assert.doesNotMatch(c.reason, /could not be classified/);
});

test('D-49: a needs-replan declaration → terminal with NO resume point (never an auto re-plan)', () => {
  const c = classifyCycleFailure(i2Events(`${PM_REPAIR_NEEDS_REPLAN_PREFIX} AC6 needs secrets the plan never provisions — errors: ${D18}`));
  assert.equal(c.kind, 'terminal');
  assert.equal(c.resumeFrom, undefined);
  assert.match(c.reason, /architect/);
});

test('the same set_errors WITHOUT the prefix keeps today\'s pmInvalidWorkItems classification (no resume point)', () => {
  const c = classifyCycleFailure(i2Events(`set errors: ${D18}`));
  assert.equal(c.kind, 'terminal');
  assert.notEqual(c.resumeFrom, 'plan');
});
