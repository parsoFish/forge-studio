/**
 * Unit tests for classifyCycleFailure (Fix B: unifier.failed is phase-agnostic).
 *
 * The failure-classifier drops the `phase === 'developer-loop'` guard from the
 * unifier.failed check — the message is unifier-specific and the retag to
 * `phase: 'unifier'` must not break classification.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure, matchesRateLimitSignature } from './failure-classifier.ts';
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

// G4 (plan item 2.2): the unifier fix-loop cap event is a TERMINAL signal —
// the agent demonstrably cannot clear this gate autonomously; auto-retry
// would re-enter the same loop.
test('classifyCycleFailure: uwi.loop-cap-exhausted → terminal', () => {
  const events = [
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'uwi.loop-cap-exhausted',
      metadata: { failure_class: 'dev-loop-unifier-loop-cap-exhausted', check_id: 'complete_delivery', consecutive_failures: 4, failure_cap: 4 },
    }),
    ev({ phase: 'unifier', skill: 'developer-unifier', event_type: 'error', message: 'unifier.failed', metadata: { status: 'failed' } }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /fix-loop cap/i);
});

test('classifyCycleFailure: N10 timeout priority beats the loop-cap signal (environment stays transient)', () => {
  // A cap exhausted BY gate timeouts is still an environment failure — the
  // timeout is the cause; retry under normal load is the correct move. The
  // cap's job (bounding the in-session burn) is already done.
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
      message: 'uwi.loop-cap-exhausted',
      metadata: { failure_class: 'dev-loop-unifier-loop-cap-exhausted', check_id: 'gate-timeout' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
});

// ---------------------------------------------------------------------------
// Item 2.4 / G10 — TRANSIENT-LINT: "parallel golangci-lint is running" is a
// shared-cache/lock contention race on the host (a concurrent forge worktree
// or a prior cycle's lint run still holds golangci-lint's file lock), NOT a
// lint failure in the code. Error text is verbatim from
// brain/cycles/themes/2026-07-03-parallel-golangci-lint-ci-gate-failure.md +
// 2026-07-09-parallel-golangci-lint-transient-ci-gate-fail.md.
// ---------------------------------------------------------------------------

const PARALLEL_LINT_TAIL =
  'Error: parallel golangci-lint is running\n' +
  'The command is terminated due to an error: parallel golangci-lint is running';

test('classifyCycleFailure: cycle.ci-gate red with "parallel golangci-lint is running" → transient environment (07-09 theme: was unclassified terminal)', () => {
  const events = [
    ev({ event_type: 'start', message: 'ralph.start' }),
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'cycle.ci-gate',
      metadata: {
        ok: false,
        ran_fixer: false,
        ci_gate: ['make', 'test'],
        output_tail: PARALLEL_LINT_TAIL,
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.match(c.reason, /golangci-lint/i);
  assert.match(c.reason, /environment|contention/i);
});

test('classifyCycleFailure: gate.fail with the parallel-lint text in gate_stderr_tail → transient, not a work failure', () => {
  const events = [
    ev({
      event_type: 'error',
      message: 'gate.fail',
      metadata: {
        gate_passed: false,
        gate_exit_code: 3,
        gate_stderr_tail: PARALLEL_LINT_TAIL,
        gate_stdout_tail: '',
        iteration: 2,
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /golangci-lint/i);
});

test('classifyCycleFailure: parallel-lint contention beats the unifier.failed terminal (the lock race CAUSED the gate red)', () => {
  const events = [
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.gate.initiative-failed',
      metadata: {
        failure_class: 'dev-loop-unifier-gate-failed',
        command: ['make', 'ci'],
        gate_stderr_tail: PARALLEL_LINT_TAIL,
      },
    }),
    ev({
      phase: 'unifier',
      skill: 'developer-unifier',
      event_type: 'error',
      message: 'unifier.failed',
      metadata: { status: 'failed', failure_class: 'dev-loop-unifier-gate-failed' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /golangci-lint/i);
});

test('classifyCycleFailure: a GENUINE golangci-lint failure (issues found) does not match the contention signature', () => {
  const events = [
    ev({
      event_type: 'error',
      message: 'gate.fail',
      metadata: {
        gate_passed: false,
        gate_exit_code: 1,
        gate_stderr_tail: 'azuredevops/foo.go:12:2: ineffectual assignment (ineffassign)\ngolangci-lint run failed with 3 issues',
        iteration: 4,
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
});

test('classifyCycleFailure: a PASSING cycle.ci-gate log event mentioning the string does not flip an unrelated terminal to transient', () => {
  const events = [
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'log',
      message: 'cycle.ci-gate',
      metadata: { ok: true, ran_fixer: false, output_tail: PARALLEL_LINT_TAIL },
    }),
    ev({
      phase: 'unifier',
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

// ---------------------------------------------------------------------------
// Item 2.4 / N9 — rate-limit death during ANY phase is an ENVIRONMENT failure.
// Evidence (brain/cycles/themes/2026-07-04-rate-limit-crash-prereq-failed-
// cascade.md): the CLI's limit message surfaces in *reasoning/log* events
// ("You've hit your limit · resets 12:10am (Australia/Brisbane)") while the
// crash itself is a generic exit-code-1 agent_threw — so the old error-events-
// only scan missed it and the terminal chain (agent_threw / dev-loop total
// failure) won.
// ---------------------------------------------------------------------------

const HIT_YOUR_LIMIT = "You've hit your limit · resets 12:10am (Australia/Brisbane)";

test('classifyCycleFailure: N9 theme fixture — rate-limit reasoning + iter-0 crash + total failure → transient environment, not terminal', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({ event_type: 'log', message: 'ralph.start', metadata: { work_item_id: 'WI-1' } }),
    ev({
      event_type: 'log',
      message: HIT_YOUR_LIMIT,
      metadata: { kind: 'reasoning', work_item_id: 'WI-1' },
    }),
    ev({
      event_type: 'end',
      message: 'ralph.end',
      metadata: {
        work_item_id: 'WI-1',
        status: 'failed',
        iterations: 0,
        stop_reason: 'crashed',
        runner_error: { kind: 'agent_threw', message: 'Claude Code process exited with code 1' },
      },
    }),
    ev({ event_type: 'log', message: 'ralph.skipped', metadata: { work_item_id: 'WI-2', reason: 'prerequisite-failed' } }),
    ev({ event_type: 'log', message: 'ralph.skipped', metadata: { work_item_id: 'WI-3', reason: 'prerequisite-failed' } }),
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'developer-loop: 0/3 work items completed — total failure',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.match(c.reason, /rate.?limit/i);
  assert.match(c.reason, /environment/i);
});

test('classifyCycleFailure: rate-limit beats agent_threw when both fire (the limit CAUSED the throw)', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'error',
      message: 'agent_threw: rate_limit_error 429 too many requests',
      metadata: { kind: 'agent_threw' },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /rate.?limit/i);
});

test('classifyCycleFailure: structured rate_limited flag on a ralph.end event → transient environment', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'end',
      message: 'ralph.end',
      metadata: {
        work_item_id: 'WI-1',
        status: 'failed',
        stop_reason: 'crashed',
        rate_limited: true,
        failure_kind: 'environment',
      },
    }),
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'developer-loop: 0/2 work items completed — total failure',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /rate.?limit/i);
});

test('classifyCycleFailure: windowing still isolates attempts — a stale rate-limit reasoning event before a later phase start does not leak into the current attempt', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({ event_type: 'log', message: HIT_YOUR_LIMIT, metadata: { kind: 'reasoning' } }),
    // resumed attempt: unrelated, unrecognised failure
    ev({ event_type: 'start' }),
    ev({ event_type: 'error', message: 'catastrophic-unrelated-crash: totally unclassified' }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /could not be classified/i);
});

test('matchesRateLimitSignature: matches real limit strings, not reasoning ABOUT rate limits', () => {
  assert.equal(matchesRateLimitSignature(HIT_YOUR_LIMIT), true);
  assert.equal(matchesRateLimitSignature('Claude AI usage limit reached|resets 3am'), true);
  assert.equal(matchesRateLimitSignature('rate_limit_error: Number of requests has exceeded your per-minute rate limit'), true);
  assert.equal(matchesRateLimitSignature('API Error: 529 overloaded_error'), true);
  // An agent WRITING rate-limit handling code must not trip the signature.
  assert.equal(matchesRateLimitSignature('implement retry-with-backoff for 429 rate limiting in the ADO client'), false);
  assert.equal(matchesRateLimitSignature('add a rate limit test for httpRetry'), false);
});
