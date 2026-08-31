/**
 * cascade-v4 #2: the known-green baseline check at dev-loop start. Runs the
 * project-level gate once before any WI work and fails fast (distinct
 * terminal classification) if the baseline is already red.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertGreenBaseline } from './developer-loop.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import type { CycleInput } from '../cycle-context.ts';
import { classifyCycleFailure } from '../failure-classifier.ts';

function setup(qualityGateCmd?: string[]): {
  input: CycleInput;
  logger: ReturnType<typeof createLogger>;
  events: () => EventLogEntry[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-baseline-'));
  const worktree = join(dir, 'wt');
  mkdirSync(worktree, { recursive: true });
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-baseline', logsDir);
  const input: CycleInput = {
    initiativeId: 'INIT-2026-06-01-baseline',
    manifestPath: join(dir, 'm.md'),
    projectRepoPath: worktree, // no .forge/project.json ⇒ falls back to input.qualityGateCmd
    worktreePath: worktree,
    qualityGateCmd,
  };
  return {
    input,
    logger,
    events: () =>
      readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('assertGreenBaseline: a green gate passes and emits dev-loop.baseline-green', () => {
  const h = setup(['sh', '-c', 'echo "# pass 3"; exit 0']);
  try {
    assert.doesNotThrow(() => assertGreenBaseline(h.input, h.logger, 'evt-test'));
    assert.ok(h.events().some((e) => e.message === 'dev-loop.baseline-green'));
  } finally {
    h.cleanup();
  }
});

test('assertGreenBaseline: a red gate throws + emits dev-loop.baseline-red with stderr', () => {
  const h = setup(['sh', '-c', 'echo "FAIL: pre-existing breakage" >&2; exit 1']);
  try {
    assert.throws(() => assertGreenBaseline(h.input, h.logger, 'evt-test'), /baseline already red/);
    const red = h.events().find((e) => e.message === 'dev-loop.baseline-red');
    assert.ok(red, 'expected dev-loop.baseline-red event');
    assert.equal(red.event_type, 'error');
    assert.match((red.metadata as { stderr_tail: string }).stderr_tail, /pre-existing breakage/);
    // Classifier surfaces it as a distinct terminal mode.
    const c = classifyCycleFailure(h.events());
    assert.equal(c.kind, 'terminal');
    assert.equal(c.recoverable, false);
    assert.match(c.reason, /baseline already red/i);
  } finally {
    h.cleanup();
  }
});

// re-review #1/#5: a gate that could not RUN is a BROKEN GATE terminal —
// distinct from a test/code failure, so the operator fixes the gate and the
// reflector is not mis-trained.
test('classifyCycleFailure: a per-WI gate.errored event ⇒ terminal "broken gate"', () => {
  const events = [
    { message: 'gate.errored', event_type: 'error', phase: 'developer-loop',
      metadata: { gate_errored: true, reject_reason: 'gate-errored', gate_exit_code: -4, gate_command: 'pytest -q' } },
  ] as unknown as EventLogEntry[];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.equal(c.recoverable, false);
  assert.match(c.reason, /BROKEN GATE|could NOT RUN/);
});

test('classifyCycleFailure: a unifier.gate.errored event ⇒ same broken-gate terminal (not a delivery fail)', () => {
  const events = [
    { message: 'unifier.gate.errored', event_type: 'error', phase: 'developer-loop',
      metadata: { failure_class: 'dev-loop-unifier-gate-errored', gate_errored: true } },
  ] as unknown as EventLogEntry[];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.match(c.reason, /BROKEN GATE|could NOT RUN/);
});

test('assertGreenBaseline: no project-level gate ⇒ skipped (not a failure)', () => {
  const h = setup(undefined);
  try {
    assert.doesNotThrow(() => assertGreenBaseline(h.input, h.logger, 'evt-test'));
    assert.ok(h.events().some((e) => e.message === 'dev-loop.baseline-skipped'));
  } finally {
    h.cleanup();
  }
});
