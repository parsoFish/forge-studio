/**
 * Row 157 (bead forge-8vfn.8.1.45, ruling 1873), part (c) CLASSIFY — a PM-phase
 * acceptance-gate violation that survived its one bounded revise turn must
 * classify as a deterministic, named PM-phase failure that is resumable from
 * the plan (project-manager) node — `resumeFrom: 'plan'` — instead of falling
 * through to "failure could not be classified".
 *
 * Kept in its OWN file, mirroring `failure-classifier.operator-stop.test.ts`'s
 * own rationale (`unit/failure-classifier.test.ts` has no baseline headroom).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import { PM_ACCEPTANCE_GATE_UNRESOLVED_PREFIX } from '@forge/contracts';
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

/** The real shape (row 157's evidence): a project-manager error event
 *  carrying `acceptance_gate_violation`, a `pm.rejected-set-quarantined`
 *  error, then the orchestrator's wrapped "project-manager phase failed: …"
 *  error — which is where the writer's prefix actually lands (project-manager.ts
 *  prefixes the summary BEFORE it is wrapped by the thrown Error's message). */
function realWorldEvents(): EventLogEntry[] {
  return [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'error',
      metadata: { acceptance_gate_violation: 'no acceptance work item: this project requires …' },
    }),
    ev({
      event_id: 'e2',
      event_type: 'error',
      message: 'pm.rejected-set-quarantined',
      metadata: { work_items_moved: 2, moved_to: '.forge/work-items-rejected-2026-09-27T20-34-30' },
    }),
    ev({
      event_id: 'e3',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message:
        'project-manager phase failed: ' +
        `${PM_ACCEPTANCE_GATE_UNRESOLVED_PREFIX} no acceptance work item: this ` +
        'project requires ≥1 WI whose quality_gate_cmd targets "acceptancetests" — ' +
        'the rejected set was moved to .forge/work-items-rejected-2026-09-27T20-34-30 ' +
        'and is not claimable',
    }),
  ];
}

test(
  'classifyCycleFailure: PM acceptance-gate-unresolved → terminal, non-recoverable, ' +
    'resumeFrom plan',
  () => {
    const c = classifyCycleFailure(realWorldEvents());
    assert.equal(c.kind, 'terminal', 'a fresh PM pass re-derives the identical requirement — no auto-retry');
    assert.equal(c.recoverable, false);
    assert.equal(c.environment, false, 'this is a decomposition defect, not API pressure');
    assert.equal(c.resumeFrom, 'plan', 'resumable — but at the plan node, not an unattended retry');
    assert.doesNotMatch(c.reason, /could not be classified/);
  },
);

test('classifyCycleFailure: an UNPREFIXED "no acceptance work item" message does not set resumeFrom', () => {
  // Regression lock: the classifier keys on the shared PREFIX, never a bare
  // substring scan of prose that a project's own test/log output could carry.
  const events = [
    ev({ event_type: 'start' }),
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'project-manager phase failed: no acceptance work item: this project requires …',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.notEqual(c.resumeFrom, 'plan');
});
