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

// G5 (2026-07-10 refinement, brain/cycles/themes/2026-07-04-rate-limit-crash-
// prereq-failed-cascade.md): a cycle's event log accumulates across scheduler
// resumes (ADR 019 resume-preserves-work) — a superseded earlier attempt's
// events stay in the SAME log file the next attempt appends to. Scanning the
// FULL history let a stale signal from an already-resolved earlier attempt
// win the fixed terminal-then-transient priority chain and mask the CURRENT
// attempt's real (and different) failure. Fix: window classification to
// events since the last phase `start` event — every phase entry point emits
// exactly one, so it cleanly marks "the current attempt" without a new
// data-model concept.

test('classifyCycleFailure: windows to events since the last phase start — a stale terminal signal from an earlier resumed attempt does not mask the current attempt\'s different (transient) failure', () => {
  const events = [
    // Attempt 1 (superseded by resume): dev-loop hit a broken-gate terminal.
    ev({ event_type: 'start', message: 'ralph.start' }),
    ev({
      event_type: 'error',
      message: 'gate.fail',
      metadata: { gate_stderr_tail: 'npm error: missing script: test:visual:fast' },
    }),
    // Attempt 2 (the resumed, current attempt): a genuinely different,
    // transient failure — rate-limited, nothing to do with the old gate.
    ev({ event_type: 'start', message: 'ralph.start' }),
    ev({ event_type: 'error', message: 'rate_limit_error: You have exceeded your rate limit' }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.match(c.reason, /rate-limited/i);
});

test('classifyCycleFailure: windows to events since the last phase start — a stale rate-limit from an earlier resumed attempt does not get misapplied to the current attempt\'s unrelated, unrecognised failure', () => {
  const events = [
    // Attempt 1 (superseded by resume): transient rate-limit, already retried past.
    ev({ event_type: 'start', message: 'ralph.start' }),
    ev({ event_type: 'error', message: 'rate_limit_error: You have exceeded your rate limit' }),
    // Attempt 2 (the resumed, current attempt): an unrelated failure with no
    // matching signature at all — must fall through to the safe "could not
    // be classified" terminal default, NOT inherit the stale rate-limit flag.
    ev({ event_type: 'start', message: 'ralph.start' }),
    ev({ event_type: 'error', message: 'catastrophic-unrelated-crash: totally unclassified' }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /could not be classified/i);
});

test('classifyCycleFailure: no phase-start event in the log ⇒ falls back to scanning the full history (legacy/minimal logs keep working)', () => {
  // No `event_type: 'start'` present at all — the windowing has nothing to
  // anchor on, so it must not silently drop everything; it scans the whole
  // (short) array exactly as before.
  const events = [
    ev({
      event_type: 'error',
      message: 'gate.fail',
      metadata: { gate_stderr_tail: 'npm error: missing script: test:visual:fast' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /missing npm script/i);
});

// ---------------------------------------------------------------------------
// N10 (2026-07 betterado friction): a gate killed by its TIMEOUT is an
// ENVIRONMENT failure — transient, auto-retryable — never "the code was
// wrong" (work-failure) and never "fix the gate" (broken-gate terminal).
// ---------------------------------------------------------------------------

test('classifyCycleFailure: gate.timeout → transient environment failure, not work-failure', () => {
  const events = [
    ev({
      event_type: 'error',
      message: 'gate.timeout',
      metadata: { gate_timed_out: true, failure_kind: 'environment', gate_exit_code: -6 },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.match(c.reason, /timed out/i);
  assert.match(c.reason, /environment/i);
});

test('classifyCycleFailure: unifier.gate.timeout beats the unifier.failed terminal (the timeout CAUSED the failure)', () => {
  const events = [
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.gate.timeout',
      metadata: { gate_timed_out: true, failure_kind: 'environment' },
    }),
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.failed',
      metadata: { status: 'failed', failure_class: 'dev-loop-unifier-gate-timeout' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /timed out/i);
});

test('classifyCycleFailure: gate.errored (broken gate, NOT timeout) stays terminal', () => {
  const events = [
    ev({
      event_type: 'error',
      message: 'gate.errored',
      metadata: { gate_errored: true, gate_exit_code: -4 },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /BROKEN GATE/);
});
