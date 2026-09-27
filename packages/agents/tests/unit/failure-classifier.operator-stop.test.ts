/**
 * M7 row 150 (bead forge-8vfn.8.1.39, rulings 1771 + 1774) — `OperatorStopError`
 * (operator-stop.ts) classifies the same way `CostCeilingError` already does
 * (`unit/failure-classifier.test.ts`'s own W8-A2 test, mirrored here): the
 * flow's own halt firing, never a defect in the work, never auto-retried.
 *
 * Kept in its OWN file rather than added to `unit/failure-classifier.test.ts`
 * (755 lines, no baseline entry — a new test here would risk crossing the
 * 800-line cap with nothing recording the exemption; a new file, never a
 * bigger one).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import { OperatorStopError } from '@forge/flows';
import type { EventLogEntry } from '@forge/kernel';

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-x',
    started_at: '2026-09-27T00:00:00.000Z',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

test(
  'classifyCycleFailure: OperatorStopError message classifies terminal + non-recoverable + ' +
    'non-environment',
  () => {
  const realError = new OperatorStopError();
  const events = [
    ev({
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'error',
      message: realError.message,
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal', 'auto-retry would immediately undo the operator\'s own stop');
  assert.equal(
    c.recoverable,
    false,
    'recoverable drives auto-retry — must never auto-retry an operator stop',
  );
  assert.equal(
    c.environment,
    false,
    'this is the operator, not API pressure — must not be read as environment-recoverable',
  );
  assert.equal(
    c.cleanBoundaryHalt,
    true,
    'round 3: the structured field readPriorFailureSignal keys on, not reason-text sniffing',
  );
  assert.doesNotMatch(c.reason, /could not be classified/i);
  assert.match(c.reason, /operator/i, 'reason must name the operator, not a generic crash');
});

test('classifyCycleFailure: negative control — an ordinary crash does not read as an operator stop', () => {
  const events = [
    ev({
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'agent process crashed: exit code 1',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.doesNotMatch(c.reason, /operator-stop/i);
  assert.equal(c.cleanBoundaryHalt, false, 'an ordinary crash is not the flow\'s own halt firing');
});

test(
  'classifyCycleFailure: a cost-ceiling stop and an operator stop are distinguishable — ' +
    'cost-ceiling wins when (hypothetically) both signatures appear',
  () => {
  // Mutually exclusive in practice (only one boundary check ever throws), but
  // pins the DECLARED precedence rather than assuming it.
  const costCeilingMessage =
    'cost-ceiling: flow spent $10.00 which meets or exceeds the $5.00 ceiling — ' +
    'stopping at a clean phase boundary (resumable).';
  const events = [
    ev({
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'error',
      message: costCeilingMessage,
    }),
    ev({
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'error',
      message: new OperatorStopError().message,
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.match(c.reason, /cost ceiling reached/i);
  assert.equal(c.cleanBoundaryHalt, true, 'either signature sets the same structured flag');
});
