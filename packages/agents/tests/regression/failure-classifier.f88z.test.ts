/**
 * forge-f88z — the gate.fail "missing script" / "cannot find module" scan
 * reads project-controlled tool output as a bare substring, the SAME blob-
 * scan class W8-F3 fixed for the rate-limit rule (this file's sibling,
 * `failure-classifier.w8f3.test.ts`) — anchored there to "the error's OWN
 * fields / the runner's own error line", never a substring anywhere in
 * captured output.
 *
 * `gate_stdout_tail`/`gate_stderr_tail` are PROJECT-CONTROLLED: a project's
 * own test suite can print "Cannot find module" or "missing script" in a
 * test NAME or an assertion message that has nothing to do with the gate
 * process's own module resolution — a passing test whose title happens to
 * describe error-handling behaviour, or a snapshot fixture. Terminal-to-
 * terminal (both branches already return 'terminal'), so this buys no extra
 * retries — the harm is a WRONG diagnosis in `reason`, misdirecting operator
 * triage toward "reinstall deps in the worktree" when the gate failed for an
 * unrelated reason entirely.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from '../../failure-classifier.ts';
import type { EventLogEntry } from '@forge/kernel';

/** Mirrors the sibling W8-F3 suite's own fixture builder — see that file's
 *  header for why it is duplicated rather than exported. */
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

function gateFail(tail: string): EventLogEntry[] {
  return [ev({ event_type: 'error', message: 'gate.fail', metadata: { gate_stdout_tail: tail } })];
}

// ---------------------------------------------------------------------------
// RED: a project's OWN test output merely containing the phrase, with no
// error marker of its own, must not be read as the runner's module-
// resolution failure.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: a gate whose stdout tail merely QUOTES "cannot find module" in a passing test name is not misclassified as worktree-missing-deps', () => {
  // A real, plausible project test-runner line: the test itself is about
  // error-handling and PASSED — no npm/node module-resolution error occurred
  // in THIS gate run at all.
  const tail = "  ✓ gracefully handles a \"Cannot find module\" dependency error (14ms)\n  42 passing (0.8s)";
  const c = classifyCycleFailure(gateFail(tail));
  assert.doesNotMatch(
    c.reason,
    /worktree missing deps/i,
    `a passing test's own title must never be read as the gate's own module-resolution failure — got: ${c.reason}`,
  );
});

test('classifyCycleFailure: a gate whose stdout tail merely QUOTES "missing script" in test output is not misclassified as a missing npm script', () => {
  const tail = '  ✓ reports a helpful error when a "missing script" is requested (9ms)\n  17 passing (0.4s)';
  const c = classifyCycleFailure(gateFail(tail));
  assert.doesNotMatch(
    c.reason,
    /missing npm script/i,
    `a passing test's own title must never be read as the gate's own missing-script failure — got: ${c.reason}`,
  );
});

// ---------------------------------------------------------------------------
// Regression locks — the real runner error LINES (npm's own "npm ERR!"/
// "npm error" prefix; Node's own "Error: Cannot find module"; webpack's own
// "Module not found: Error:") must still be detected. These pin the mirror-
// image regression: an over-tightened fix that stops detecting genuine
// worktree/script failures.
// ---------------------------------------------------------------------------

test('classifyCycleFailure: the real npm "missing script" error line is still detected (regression lock)', () => {
  for (const tail of [
    'npm ERR! missing script: build',
    'npm error Missing script: "test:visual:fast"',
    'npm error: missing script: test:visual:fast', // the existing pinned shape (unit/failure-classifier.test.ts)
  ]) {
    const c = classifyCycleFailure(gateFail(tail));
    assert.match(c.reason, /missing npm script/i, `"${tail}" is a real npm error line and must still be caught — got: ${c.reason}`);
  }
});

test('classifyCycleFailure: the real node/webpack "cannot find module" error lines are still detected (regression lock)', () => {
  for (const tail of [
    "Error: Cannot find module '/repo/dist/index.js'",
    "Module not found: Error: Can't resolve './missing' in '/repo/src'",
  ]) {
    const c = classifyCycleFailure(gateFail(tail));
    assert.match(c.reason, /worktree missing deps/i, `"${tail}" is a real module-resolution error and must still be caught — got: ${c.reason}`);
  }
});
