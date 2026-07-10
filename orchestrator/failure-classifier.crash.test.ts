/**
 * G3 (plan 2.3, crash-no-identical-retry) — unit tests for `classifyCrash`
 * plus the `*.crash-deterministic` terminal signature in classifyCycleFailure.
 *
 * Evidence (brain/cycles/themes/2026-07-03-unifier-process-crash-before-tools.md
 * + 2026-07-04-rate-limit-crash-prereq-failed-cascade.md): when a phase agent
 * process crashes, the F-44 retry re-spawned IDENTICALLY — repeating the crash
 * when the cause is deterministic (context overflow, same crash twice at the
 * same point) and wasting spend. `classifyCrash` decides, BEFORE an identical
 * re-spawn, whether the crash looks environment/transient (retry with backoff,
 * bounded) or deterministic (stop with a terminal classified failure event).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCrash, classifyCycleFailure } from './failure-classifier.ts';
import type { EventLogEntry } from './logging.ts';

// ---------------------------------------------------------------------------
// classifyCrash — environment/transient signatures → retry allowed
// ---------------------------------------------------------------------------

test('classifyCrash: usage-limit crash is transient (time-bounded API pressure)', () => {
  const c = classifyCrash("You've hit your limit · resets 12:10am (Australia/Brisbane)", null);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /pressure|limit/i);
});

test('classifyCrash: 429 / overloaded crashes are transient', () => {
  assert.equal(classifyCrash('API error 429 rate_limit_error', null).kind, 'transient');
  assert.equal(classifyCrash('Overloaded: please retry later', null).kind, 'transient');
});

test('classifyCrash: SIGKILL (OOM pressure) is transient — environment, not code', () => {
  const c = classifyCrash('Claude Code process was killed by SIGKILL', null);
  assert.equal(c.kind, 'transient');
});

test('classifyCrash: network faults are transient', () => {
  assert.equal(classifyCrash('read ECONNRESET', null).kind, 'transient');
  assert.equal(classifyCrash('connect ETIMEDOUT 104.18.2.161:443', null).kind, 'transient');
  assert.equal(classifyCrash('socket hang up', null).kind, 'transient');
});

test('classifyCrash: a transient signature stays transient even when the crash repeats identically (rate-limit repeats verbatim but is time-bounded)', () => {
  const msg = "You've hit your limit · resets 12:10am (Australia/Brisbane)";
  const c = classifyCrash(msg, msg);
  assert.equal(c.kind, 'transient');
});

// ---------------------------------------------------------------------------
// classifyCrash — deterministic signatures → an identical re-spawn is futile
// ---------------------------------------------------------------------------

test('classifyCrash: context-length overflow is deterministic on the FIRST crash — no identical retry at all', () => {
  const c = classifyCrash('prompt is too long: 214341 tokens > 200000 maximum', null);
  assert.equal(c.kind, 'deterministic');
  assert.match(c.reason, /identical/i);
});

test('classifyCrash: the same unrecognised crash twice at the same point is deterministic — no third identical attempt', () => {
  const msg = 'Claude Code process exited with code 1';
  const first = classifyCrash(msg, null);
  assert.equal(first.kind, 'unknown', 'first occurrence of an unrecognised crash allows one bounded retry');
  const second = classifyCrash(msg, msg);
  assert.equal(second.kind, 'deterministic');
  assert.match(second.reason, /identical|repeat/i);
});

test('classifyCrash: a DIFFERENT unrecognised crash after the first is still unknown (not proven deterministic)', () => {
  const c = classifyCrash('Claude Code process exited with code 2', 'Claude Code process exited with code 1');
  assert.equal(c.kind, 'unknown');
});

// ---------------------------------------------------------------------------
// classifyCycleFailure — the gave-up-deterministic event is a classified
// TERMINAL failure (the scheduler must not hot-loop an identical cycle retry).
// ---------------------------------------------------------------------------

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-x',
    started_at: '2026-07-11T00:00:00.000Z',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

test('classifyCycleFailure: dev-loop.crash-deterministic → terminal, identical re-spawn cannot succeed', () => {
  const events = [
    ev({
      event_type: 'error',
      message: 'dev-loop.crash-deterministic',
      metadata: {
        work_item_id: 'WI-1',
        crash_class: 'deterministic',
        crash_reason: 'identical crash repeated at the same point',
        runner_error: { kind: 'agent_threw', message: 'Claude Code process exited with code 1' },
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /deterministic/i);
});

test('classifyCycleFailure: unifier.crash-deterministic → terminal (same rule, unifier path)', () => {
  const events = [
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.crash-deterministic',
      metadata: { work_item_id: 'UWI-1', crash_class: 'deterministic' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /deterministic/i);
});
