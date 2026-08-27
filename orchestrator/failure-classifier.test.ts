/**
 * Unit tests for classifyCycleFailure (Fix B: unifier.failed is phase-agnostic).
 *
 * The failure-classifier drops the `phase === 'developer-loop'` guard from the
 * unifier.failed check — the message is unifier-specific and the retag to
 * `phase: 'unifier'` must not break classification.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyCycleFailure, matchesRateLimitSignature } from './failure-classifier.ts';
import { CostCeilingError } from './flow-budgets.ts';
import { decideAutoRetry } from './scheduler-dispatch.ts';
import { getPaths } from './queue.ts';
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

// ---------------------------------------------------------------------------
// N7 (plan 2.9): environment-classified failures carry an explicit
// `environment: true` so the requeue-resume decision (and any other consumer)
// keys on a structured flag rather than sniffing reason text.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: gate timeout → environment:true', () => {
  const c = classifyCycleFailure([
    ev({ event_type: 'error', message: 'gate.timeout', metadata: { gate_timed_out: true } }),
  ]);
  assert.equal(c.kind, 'transient');
  assert.equal(c.environment, true);
});

test('classifyCycleFailure: rate-limit death → environment:true', () => {
  const c = classifyCycleFailure([
    ev({ message: 'ralph.end', metadata: { rate_limited: true } }),
  ]);
  assert.equal(c.kind, 'transient');
  assert.equal(c.environment, true);
});

test('classifyCycleFailure: parallel golangci-lint contention → environment:true', () => {
  const c = classifyCycleFailure([
    ev({
      event_type: 'error',
      message: 'gate.fail',
      metadata: { gate_stderr_tail: 'ERRO parallel golangci-lint is running' },
    }),
  ]);
  assert.equal(c.kind, 'transient');
  assert.equal(c.environment, true);
});

test('classifyCycleFailure: non-environment transient (trivial pass) does NOT carry environment:true', () => {
  const c = classifyCycleFailure([
    ev({ message: 'ralph.end', metadata: { status: 'failed', iterations: 0, stop_reason: 'quality-gates-pass' } }),
  ]);
  assert.equal(c.kind, 'transient');
  assert.notEqual(c.environment, true);
});

test('classifyCycleFailure: terminal failure does NOT carry environment:true', () => {
  const c = classifyCycleFailure([
    ev({ phase: 'unifier', skill: 'developer-unifier', event_type: 'error', message: 'unifier.failed' }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.notEqual(c.environment, true);
});

// ---------------------------------------------------------------------------
// Plan 2.11 (PM turn economy): partial-but-usable decomposition classification.
// Evidence: 2026-07-10-pm-error-max-turns-new-api-exploration.md — a capped PM
// run's re-queue succeeds, so a partial usable graph is transient, while an
// empty decomposition (0 WIs) and a capped+degenerate set stay terminal.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: pm.partial-decomposition usable → transient (re-queue is viable)', () => {
  const c = classifyCycleFailure([
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.partial-decomposition',
      metadata: { result_subtype: 'error_max_turns', work_item_count: 3, valid_count: 3, planned_count: 6, usable: true },
    }),
  ]);
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.match(c.reason, /partial/i);
  assert.notEqual(c.environment, true);
});

test('classifyCycleFailure: partial-usable beats the capped+degenerate terminal rule (truncated tail WI is expected)', () => {
  // A capped incremental run may leave a half-written final WI (per-item
  // errors) alongside usable ones — that must NOT classify as "never
  // converged" terminal.
  const c = classifyCycleFailure([
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.partial-decomposition',
      metadata: { result_subtype: 'error_max_turns', work_item_count: 4, valid_count: 3, planned_count: 6, usable: true },
    }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      metadata: { result_subtype: 'error_max_turns', per_item_error_count: 2, work_item_count: 4 },
    }),
  ]);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /partial/i);
});

test('classifyCycleFailure: pm.partial-decomposition with usable:false falls through to capped+degenerate terminal', () => {
  const c = classifyCycleFailure([
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.partial-decomposition',
      metadata: { result_subtype: 'error_max_turns', work_item_count: 1, valid_count: 0, usable: false },
    }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      metadata: { result_subtype: 'error_max_turns', per_item_error_count: 3, work_item_count: 1 },
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /never converged/i);
});

test('classifyCycleFailure: pm.empty-decomposition unchanged — still terminal', () => {
  const c = classifyCycleFailure([
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.empty-decomposition',
      metadata: { result_subtype: 'error_max_turns' },
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /zero work items/i);
});

// ── R4-10-F1: the successor nodes' delivery-gate failures classify accurately ──

test('classifyCycleFailure: execDemo delivery-gate throw → terminal "demo pipeline failed" (NOT reviewer-Ralph)', () => {
  const events = [
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'delivery gate: demo pipeline failed (author-invalid: demo.json never validated) — the branch is not review-ready, so no PR is opened.',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /demo pipeline failed/i);
  assert.doesNotMatch(c.reason, /reviewer-Ralph/i);
});

test('classifyCycleFailure: execAdversarialReview throw → terminal "adversarial-review pipeline failed" (NOT reviewer-Ralph)', () => {
  const events = [
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'adversarial review pipeline failed (spawn-failed: sdk error) — no findings artifact was produced for the verdict gate.',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /adversarial-review pipeline failed/i);
  assert.doesNotMatch(c.reason, /reviewer-Ralph/i);
});

// ---------------------------------------------------------------------------
// w8-A1 Change 3: a deterministic PM failure (hidden coupling / invalid work
// items) is now TERMINAL, with ZERO auto-retries. The same decomposition
// re-run reproduces the same violation, so the previous
// `T('transient', …)` classification just burned a retry on a guaranteed
// repeat. Was pmHiddenCoupling/pmInvalidWorkItems → transient; now terminal.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: pmHiddenCoupling (non-empty hidden_coupling_violations) → terminal, non-recoverable, non-environment', () => {
  const events = [
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.end',
      metadata: {
        hidden_coupling_violations: [{ a: 'WI-1', b: 'WI-2', sharedFiles: ['x.ts'] }],
        per_item_error_count: 0,
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.equal(c.environment, false);
  assert.ok(typeof c.reason === 'string' && c.reason.length > 0);
});

test('classifyCycleFailure: pmInvalidWorkItems (per_item_error_count > 0) → terminal, non-recoverable, non-environment', () => {
  const events = [
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.end',
      metadata: {
        per_item_error_count: 2,
        hidden_coupling_violations: [],
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.equal(c.environment, false);
  assert.ok(typeof c.reason === 'string' && c.reason.length > 0);
});

// ---------------------------------------------------------------------------
// W8-A2 (ON-7 defect 2a): a CostCeilingError (flow-budgets.ts) has no
// matching signature and falls to the generic "failure could not be
// classified" default, indistinguishable from a real crash. Add a signature
// that names the outcome honestly. Reproduced live 2026-08-22,
// 2026-08-18T12-42-15_INIT-2026-08-14-betterado-gap-registry (all 6 WIs
// complete, cost ceiling fired at the phase boundary, manifest → failed/).
// ---------------------------------------------------------------------------

test('classifyCycleFailure: CostCeilingError message classifies to a cost-ceiling signature, terminal + non-recoverable', () => {
  // Kills a naive implementation that leaves this on the default branch
  // (kind:'terminal', reason:'failure could not be classified — examine
  // events.jsonl manually') — that reason names nothing; this one must.
  const realError = new CostCeilingError(80.8324, 52);
  const events = [
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: realError.message,
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal', 'a retry would just re-spend against an already-crossed ceiling');
  assert.equal(c.recoverable, false, 'recoverable drives auto-retry — must not auto-retry a cost-ceiling stop');
  // Reason must name the spend, the ceiling, and that the stop was resumable
  // at a clean phase boundary — not the generic "could not be classified".
  assert.doesNotMatch(c.reason, /could not be classified/i);
  assert.match(c.reason, /80\.83/, 'reason should name the spend');
  assert.match(c.reason, /52\.00|\$52\b/, 'reason should name the ceiling');
  assert.match(c.reason, /resumable/i, 'reason should say the phase boundary was clean/resumable');
});

test('classifyCycleFailure: negative control — an ordinary pmHiddenCoupling terminal failure does not read as a cost-ceiling stop', () => {
  // Kills an implementation that over-broadly matches (e.g. any terminal
  // failure, or any error event) instead of the specific cost-ceiling
  // signature.
  const events = [
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.end',
      metadata: {
        hidden_coupling_violations: [{ a: 'WI-1', b: 'WI-2', sharedFiles: ['x.ts'] }],
        per_item_error_count: 0,
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.doesNotMatch(c.reason, /cost.ceiling/i);
  assert.match(c.reason, /hidden coupling/i);
});

// ---------------------------------------------------------------------------
// W8-F3 (ON-7 residue) — a DETERMINISTIC failure must never be classified
// transient because a project-supplied string happened to contain a
// rate-limit token.
//
// The defect, reproduced against c0093918: `rateLimited` is a plain-substring
// scan over `message + JSON.stringify(metadata)` of ANY error event, and its
// return is reached BEFORE the whole terminal chain. The PM error event's
// metadata is dominated by PROJECT-CONTROLLED payload — `hidden_coupling_
// violations[].sharedFiles` (real repo file paths), `parse_errors`,
// `set_errors`, gate output tails — so an ordinary filename like
// `internal/provider/rate_limit.go`, or a source line number that merely
// contains `529`, flips a deterministic defect to transient/recoverable and
// buys it the full MAX_AUTO_RETRIES: three byte-identical failures at cost.
//
// The cure is structural, in two halves, and BOTH are load-bearing:
//   1. verdicts that an identical retry provably cannot fix are decided FIRST;
//   2. rate-limit detection reads the error's OWN fields (its message, the
//      SDK error `type`, an HTTP status) — never a stringified metadata blob.
// Half 2 alone is insufficient: the PM's own thrown message names the shared
// file ("…hidden-coupling pair(s): WI-1<->WI-2 share internal/provider/
// rate_limit.go"), so the token reaches an own-field legitimately. Half 1
// alone is insufficient: it leaves every non-hoisted rule (gate.fail,
// dev-loop total failure) reading project payload.
// ---------------------------------------------------------------------------

/** The real PM error event shape from the ON-7 vehicle cycle — only the
 *  shared file path varies between the control and the hit. */
function pmDeterministicFailure(sharedFile: string): EventLogEntry[] {
  return [
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      event_id: 'EV_pm_err',
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message:
        `project-manager phase failed: 1 per-item validation errors; ` +
        `1 hidden-coupling pair(s): WI-1<->WI-2 share ${sharedFile}`,
      metadata: {
        per_item_error_count: 1,
        hidden_coupling_violations: [{ a: 'WI-1', b: 'WI-2', sharedFiles: [sharedFile] }],
      },
    }),
  ];
}

test('classifyCycleFailure: W8-F3 — a deterministic PM coupling failure on a shared file named rate_limit.go stays TERMINAL', () => {
  // RED at c0093918: `rateLimited` matched "rate_limit" inside
  // metadata.hidden_coupling_violations[0].sharedFiles and returned
  // transient/recoverable, granting 2 auto-retries of a defect that
  // re-runs identically.
  const c = classifyCycleFailure(pmDeterministicFailure('internal/provider/rate_limit.go'));
  assert.equal(c.kind, 'terminal', 'the same decomposition re-runs the same overlap — a retry is pure waste');
  assert.equal(c.recoverable, false, 'recoverable is what decideAutoRetry reads to grant an unattended retry');
  assert.equal(c.environment, false, 'a decomposition defect is not an environment failure');
  assert.match(c.reason, /hidden coupling/i, 'the reason must name the real defect, not "rate-limited"');
  assert.doesNotMatch(c.reason, /rate.?limit/i);
});

test('classifyCycleFailure: W8-F3 — differential control: the identical failure on an ordinary path is terminal too', () => {
  // The control proves the assertion above is about the FILENAME and nothing
  // else — the two events differ in exactly one string.
  const c = classifyCycleFailure(pmDeterministicFailure('internal/provider/registry.go'));
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /hidden coupling/i);
});

test('classifyCycleFailure: W8-F3 — a doc path numbered 429 does not flip a deterministic PM failure', () => {
  const c = classifyCycleFailure(pmDeterministicFailure('docs/adr/429-quota.md'));
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /hidden coupling/i);
});

test('classifyCycleFailure: W8-F3 — schema-invalid WIs on a rate_limit path stay terminal (per-item leg)', () => {
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'project-manager phase failed: 2 per-item validation errors',
      metadata: {
        per_item_error_count: 2,
        parse_errors: ['WI-2: depends_on references internal/rate_limit/registry.go which is not a work item'],
      },
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /schema-invalid/i);
});

test('decideAutoRetry: W8-F3 end-to-end — the REAL classifier verdict grants ZERO retries for a rate-limit-token deterministic PM failure', () => {
  // Exit row 1 names classifyCycleFailure AND decideAutoRetry, so this pin
  // runs the real classifier and feeds its real output into the real retry
  // decision through a real on-disk log + manifest. (The pre-existing
  // decideAutoRetry tests hand-write the classification event, which cannot
  // catch a misclassification — a test that stubs the gate is not a gate
  // test.)
  const dir = mkdtempSync(join(tmpdir(), 'forge-f3-retry-'));
  try {
    const paths = getPaths(join(dir, '_queue'));
    mkdirSync(paths.inFlight, { recursive: true });
    const id = 'INIT-2026-08-14-betterado-gap-registry';
    writeFileSync(
      join(paths.inFlight, `${id}.md`),
      `---\ninitiative_id: ${id}\nproject: betterado\nproject_repo_path: projects/betterado\ncreated_at: 2026-08-14T00:00:00Z\niteration_budget: 1\ncost_budget_usd: 12\nphase: in-flight\n---\n\n# ${id}\n`,
    );
    const cls = classifyCycleFailure(pmDeterministicFailure('internal/provider/rate_limit.go'));
    const logPath = join(dir, 'events.jsonl');
    // Exactly the event `cycle.ts:emitFailureClassification` writes.
    writeFileSync(
      logPath,
      JSON.stringify({
        event_id: 'EV_fc', cycle_id: 'c', initiative_id: id, started_at: '2026-08-22T18:49:47.923Z',
        phase: 'orchestrator', skill: 'cycle', event_type: 'log', input_refs: [], output_refs: [],
        message: 'failure_classification',
        metadata: {
          cycle_id: 'c', failure_mode: cls.kind, failure_kind: cls.kind,
          recoverable: cls.recoverable, environment: cls.environment,
          reason: cls.reason, evidence_event_ids: cls.evidence_event_ids,
        },
      }) + '\n',
    );
    const decision = decideAutoRetry(`${id}.md`, paths, logPath);
    assert.equal(decision.retry, false, 'a deterministic decomposition defect must land in failed/ on the FIRST failure');
    if (!decision.retry) assert.match(decision.reason, /terminal/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W8-F3 — the blob scan's real-world precision is ZERO.
//
// Surveying all 354 archived cycle logs under `_logs/`: no error event has
// ever carried a rate-limit token in its own `message`. Five carried one in
// metadata — every one a false positive (a `529` inside a golangci-lint
// source line number, a `529` inside a git SHA). The fixture below is one of
// them, verbatim.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: W8-F3 — a real archived golangci-lint gate failure is NOT a rate limit ("…:1529:36" is a line number)', () => {
  // Provenance: _logs/2026-06-01T13-18-09_INIT-2026-06-01-ci-green,
  // events EV_mpv8y2zq_kew0uozj (gate.fail, iteration 4) and
  // EV_mpv902r2_hy3c9rbc (the orchestrator's total-failure error).
  // Replayed through c0093918 this whole cycle classifies
  // `transient / environment:true / "agent rate-limited"`. The
  // classification actually recorded on disk in June 2026 was
  // `terminal / "dev-loop completed 0/N work items"` — so the blob scan is a
  // live REGRESSION against a real, already-diagnosed cycle.
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'developer-loop' }),
    ev({
      event_id: 'EV_mpv8y2zq_kew0uozj',
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'gate.fail',
      metadata: {
        work_item_id: 'WI-1',
        gate_passed: false,
        gate_exit_code: 1,
        gate_command: 'golangci-lint run -v ./azuredevops/...',
        gate_stdout_tail:
          'azuredevops/internal/service/release/resource_release_definition.go:1529:36: ' +
          'SA1019: opts.EnableAccessToken is deprecated: Use DeploymentInput.EnableAccessToken instead. (staticcheck)',
        gate_stderr_tail: 'level=info msg="golangci-lint has version 1.64.8 built with go1.24.1"',
        iteration: 4,
      },
    }),
    ev({
      event_id: 'EV_mpv902r2_hy3c9rbc',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'developer-loop: 0/1 work items completed — total failure',
    }),
  ]);
  assert.equal(c.kind, 'terminal', 'a genuine lint failure is a work failure, not API pressure');
  assert.equal(c.environment, false, 'environment:true would send this to requeue-resume as a stalled cycle');
  assert.doesNotMatch(c.reason, /rate.?limit/i);
  assert.match(c.reason, /0\/N work items|total failure|dev-loop completed/i);
});

// ---------------------------------------------------------------------------
// W8-F3 — pm.partial-decomposition must not shield a HIDDEN-COUPLING
// violation.
//
// The carve-out at `pmPartialUsable` is deliberate and pinned
// ("partial-usable beats the capped+degenerate terminal rule", above): a
// capped incremental run legitimately leaves a TRUNCATED TAIL work item, and
// a cap is stochastic, so a fresh pass is a legitimate retry. A hidden-
// coupling violation is a different animal: it is an overlap between work
// items the PM actually WROTE, computed deterministically from them. Capping
// cannot cause it and a fresh pass cannot be expected to avoid it. So
// partial-usable keeps shielding per-item errors and stops shielding
// coupling.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: W8-F3 — partial-usable does NOT shield a hidden-coupling violation', () => {
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'project-manager', skill: 'project-manager' }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'pm.partial-decomposition',
      metadata: { result_subtype: 'error_max_turns', work_item_count: 4, valid_count: 3, planned_count: 6, usable: true },
    }),
    ev({
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      message: 'project-manager phase failed: 5 hidden-coupling pair(s)',
      metadata: {
        result_subtype: 'error_max_turns',
        per_item_error_count: 4,
        hidden_coupling_violations: [{ a: 'WI-4a', b: 'WI-4b', sharedFiles: ['docs/gap-registry.md'] }],
      },
    }),
  ]);
  assert.equal(c.kind, 'terminal', 'the overlap is between WIs the PM wrote — a fresh pass re-derives it');
  assert.equal(c.recoverable, false);
  assert.doesNotMatch(c.reason, /partial/i);
});

// ---------------------------------------------------------------------------
// W8-F3 / WI-4 — the cost-ceiling stop.
//
// The C4 critic's premise ("the rule at :200 did not fire on the real event")
// is a CHRONOLOGY artifact, not a defect: `git log -S "startsWith('cost-
// ceiling:')"` puts the rule in 16288047 (2026-08-23 14:40); the run failed
// 2026-08-22 18:49. The rule did not exist yet. Replaying the real file
// through this tree already yields the right verdict — pinned below so the
// claim stops being re-litigated from the log alone.
//
// The LIVE residue is different and real: the cost-ceiling capture at :200
// runs early, but its RETURN sits below `rateLimited`. Its own doc comment
// claims "matching it here means the branch never depends on the blob-based
// rate-limit/agent_threw checks happening to miss it" — which was false.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: W8-F3 — a cost-ceiling stop outranks a rate-limit error in the same window', () => {
  // RED at c0093918. A flow that burned through its ceiling has very often
  // been retrying against API pressure on the way there, so the two signals
  // co-occur naturally. Auto-retrying re-spends against an ALREADY-CROSSED
  // ceiling: guaranteed repeat, zero new work, at cost.
  const c = classifyCycleFailure([
    ev({ event_type: 'start', phase: 'developer-loop' }),
    ev({
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'agent step failed: rate_limit_error (429) from upstream',
    }),
    ev({
      event_id: 'EV_mt4qg6tm_52d98gro',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message:
        'cost-ceiling: flow spent $80.8324 which meets or exceeds the $52.00 ceiling — ' +
        'stopping at a clean phase boundary (resumable).',
    }),
  ]);
  assert.equal(c.kind, 'terminal', 'a retry re-spends against a ceiling it already crossed');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /cost ceiling/i, 'the operator must be told the run stopped for a NAMEABLE reason');
  assert.match(c.reason, /80\.83/);
});

test('classifyCycleFailure: W8-F3 — replay of the REAL cost-ceiling cycle tail classifies terminal with the real evidence id', () => {
  // The three real tail events of
  // _logs/2026-08-18T12-42-15_INIT-2026-08-14-betterado-gap-registry
  // (1601 dev-loop end 6/6 complete, 1602 flow.cost-ceiling-stop, 1603 the
  // orchestrator error), verbatim. Green at c0093918 — recorded as a
  // regression pin, not as a red-first repro; see the chronology note above.
  const c = classifyCycleFailure([
    ev({
      event_id: 'EV_mt4qg6tm_hfybv5zl',
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'end',
      metadata: { work_item_count: 6, complete: 6, failed: 0, resumed: false },
    }),
    ev({
      event_id: 'EV_mt4qg6tm_3ce4g2ff',
      phase: 'orchestrator',
      skill: 'flow-budgets',
      event_type: 'log',
      message: 'flow.cost-ceiling-stop',
      metadata: { spentUsd: 80.83237065, ceilingUsd: 52, pct: 155.4, stoppedBeforeNode: 'demo' },
    }),
    ev({
      event_id: 'EV_mt4qg6tm_52d98gro',
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message:
        'cost-ceiling: flow spent $80.8324 which meets or exceeds the $52.00 ceiling — ' +
        'stopping at a clean phase boundary (resumable).',
    }),
  ]);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.doesNotMatch(c.reason, /could not be classified/i);
  assert.match(c.reason, /80\.83/);
  assert.deepEqual(c.evidence_event_ids, ['EV_mt4qg6tm_52d98gro'], 'the operator must be pointed at the real event');
});
