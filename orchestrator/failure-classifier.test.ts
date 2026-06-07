/**
 * Unit tests for classifyCycleFailure (Fix B: unifier.failed is phase-agnostic).
 *
 * The failure-classifier drops the `phase === 'developer-loop'` guard from the
 * unifier.failed check — the message is unifier-specific and the retag to
 * `phase: 'unifier'` must not break classification.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from './failure-classifier.ts';
import type { EventLogEntry } from './logging.ts';

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-x',
    started_at: '2026-06-07T00:00:00.000Z',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

test('classifyCycleFailure: unifier.failed with phase:unifier → terminal "unifier did not pass"', () => {
  const events = [
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.failed',
      metadata: { status: 'failed', failure_class: 'dev-loop-unifier-gate-failed' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /unifier did not pass/i);
});

test('classifyCycleFailure: unifier.failed still classified regardless of phase value', () => {
  // Robustness: even if a legacy log carries phase:'developer-loop', the
  // message-keyed check still fires (the phase guard was intentionally removed).
  const events = [
    ev({
      phase: 'developer-loop',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.failed',
      metadata: { status: 'failed' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /unifier did not pass/i);
});

test('classifyCycleFailure: dev-loop.baseline-red still classified (phase guard on that rule unchanged)', () => {
  const events = [
    ev({
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'dev-loop.baseline-red',
      metadata: { command: ['npm', 'test'], exit_code: 1, stdout_tail: '', stderr_tail: 'FAIL' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /baseline already red/i);
});
