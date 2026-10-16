/**
 * forge-mfv5.1.47 (row 3) — a develop resume whose lost `.forge/work-items`
 * could not be restored classifies as a named, terminal needs-operator
 * failure carrying the refusal's own reason — never "could not be classified"
 * (the measured I3b outcome after "developer-loop: no work items found").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import type { EventLogEntry } from '@forge/kernel';

const REASON = 'work items not restorable: no work-items-snapshot with work items at _logs/c/work-items-snapshot and no send-back record';

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-2026-10-16-x',
    started_at: '2026-10-16T09:36:43.000Z',
    phase: 'developer-loop',
    skill: 'developer-loop',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

test('classifyCycleFailure: work-items.restore-refused → terminal, not environment, the refusal named', () => {
  const c = classifyCycleFailure([
    ev({ event_type: 'start', message: 'developer-loop.start' }),
    ev({ event_id: 'e2', event_type: 'error', message: 'work-items.restore-refused', metadata: { reason: REASON } }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.environment, false);
  assert.doesNotMatch(c.reason, /could not be classified/);
  assert.ok(c.reason.includes(REASON), 'the classification carries the refusal verbatim');
});
