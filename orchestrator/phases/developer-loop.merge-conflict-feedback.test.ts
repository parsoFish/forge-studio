/**
 * Conflict-context injection (2026-07-12) — unit coverage for
 * `writeMergeConflictFeedback` and its PRECEDENCE against `writeGateFeedback`,
 * both of which target the SAME `.forge/last-gate-failure.md` seam the dev
 * system prompt already mandates reading first (`phases/dev-binding.ts`).
 *
 * Precedence contract (see `writeGateFeedback`'s doc comment in
 * `developer-loop.ts` for the full rationale — re-review CRITICAL,
 * 2026-07-12): the merge-conflict note is written ONCE, into the requeued
 * attempt's fresh worktree before ralph runs. But the runner's iteration 0
 * is the sharp-gate PRE-CHECK (`failOnHollowIter0Gate`, default ON), not the
 * agent's first turn — on a fresh fork that real gate almost always fails
 * and reports through `writeGateFeedback` BEFORE the agent exists. So:
 *
 * - failing gate at iteration 0 + existing merge-conflict note → PRESERVE
 *   the note, append the gate detail beneath it (conflict context first);
 * - failing gate at iteration ≥ 1 → replace entirely (the agent has had its
 *   mandated first read; freshest live truth wins);
 * - passing gate at any iteration → delete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GATE_FAILURE_FEEDBACK_HEADING,
  MERGE_CONFLICT_FEEDBACK_HEADING,
  writeGateFeedback,
  writeMergeConflictFeedback,
} from './developer-loop.ts';
import type { MergeConflictDetail } from '../wi-merge-back.ts';
import type { GateRunInfo } from '../../loops/ralph/stop-conditions.ts';

function setupWorktree(): { path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-merge-conflict-feedback-'));
  mkdirSync(root, { recursive: true });
  return { path: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const failureFile = (worktreePath: string) => join(worktreePath, '.forge', 'last-gate-failure.md');

const sampleConflict = (): MergeConflictDetail => ({
  conflictingFiles: ['src/csv-writer.ts', 'src/flags.ts'],
  filesTruncated: false,
  wiBranchTipSubject: 'wi: add --csv flag',
  siblingCommits: ['abc1234 wi(WI-1): merge', 'def5678 wi(WI-2): merge'],
  commitsTruncated: false,
});

// Iteration 0 = the sharp-gate PRE-CHECK, before the agent's first turn.
const iter0FailingGateInfo: GateRunInfo = {
  passed: false,
  command: 'npm test',
  exitCode: 1,
  durationMs: 100,
  stdoutTail: 'FAIL: 3 tests failed',
  stderrTail: '',
  iteration: 0,
};

// Iteration ≥ 1 = a live gate check after an actual agent turn.
const iter1FailingGateInfo: GateRunInfo = {
  ...iter0FailingGateInfo,
  stdoutTail: 'FAIL: 2 tests failed',
  iteration: 1,
};

const passingGateInfo: GateRunInfo = {
  passed: true,
  command: 'npm test',
  exitCode: 0,
  durationMs: 100,
  stdoutTail: 'PASS',
  stderrTail: '',
  iteration: 1,
};

test('writeMergeConflictFeedback: writes a distinct heading, the conflicting files, the WI tip, and the sibling commits', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 1, sampleConflict());

    const body = readFileSync(failureFile(path), 'utf8');
    assert.match(body, /^# MERGE CONFLICT \(attempt 1\)/, 'heading must be distinct from the gate-failure heading');
    assert.doesNotMatch(body, /Live quality-gate failure/, 'must never claim to be a gate failure');
    assert.match(body, /src\/csv-writer\.ts/);
    assert.match(body, /src\/flags\.ts/);
    assert.match(body, /wi: add --csv flag/);
    assert.match(body, /abc1234 wi\(WI-1\): merge/);
    assert.match(body, /def5678 wi\(WI-2\): merge/);
  } finally {
    cleanup();
  }
});

test('writeMergeConflictFeedback: a truncated detail says so in the body', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 2, {
      ...sampleConflict(),
      filesTruncated: true,
      commitsTruncated: true,
    });

    const body = readFileSync(failureFile(path), 'utf8');
    assert.match(body, /attempt 2/);
    assert.match(body, /truncated — more files conflicted/);
    assert.match(body, /truncated — more sibling commits/);
  } finally {
    cleanup();
  }
});

test('writeMergeConflictFeedback: an empty conflict (no files/commits captured) still writes a non-empty, honest body', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 1, {
      conflictingFiles: [],
      filesTruncated: false,
      wiBranchTipSubject: '',
      siblingCommits: [],
      commitsTruncated: false,
    });

    const body = readFileSync(failureFile(path), 'utf8');
    assert.match(body, /no specific unmerged paths/);
    assert.match(body, /\(unknown\)/);
  } finally {
    cleanup();
  }
});

test('precedence: an ITERATION-0 gate failure (the sharp-gate pre-check) PRESERVES the merge-conflict note and appends the gate detail beneath it', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 1, sampleConflict());

    // The runner's iter-0 pre-check runs the REAL gate before the agent's
    // first turn; on a fresh requeue fork it almost always fails. A blind
    // rewrite here would delete the conflict note before the agent ever
    // read it — the exact path the injection exists for.
    writeGateFeedback(path, iter0FailingGateInfo);

    const body = readFileSync(failureFile(path), 'utf8');
    assert.ok(
      body.startsWith(`${MERGE_CONFLICT_FEEDBACK_HEADING} (attempt 1)`),
      'conflict context must stay FIRST — it is the higher-signal instruction',
    );
    assert.match(body, /src\/csv-writer\.ts/, 'the conflict detail must survive intact');
    assert.ok(
      body.includes(`${GATE_FAILURE_FEEDBACK_HEADING} (forge, iteration 0)`),
      'the iter-0 gate detail must be appended beneath the note',
    );
    assert.match(body, /FAIL: 3 tests failed/);
    assert.ok(
      body.indexOf(MERGE_CONFLICT_FEEDBACK_HEADING) < body.indexOf(GATE_FAILURE_FEEDBACK_HEADING),
      'ordering: conflict note first, gate detail second',
    );
  } finally {
    cleanup();
  }
});

test('precedence: a repeated iteration-0 gate failure re-appends FRESH gate detail (idempotent — never accumulates copies)', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 1, sampleConflict());
    writeGateFeedback(path, iter0FailingGateInfo);
    writeGateFeedback(path, { ...iter0FailingGateInfo, stdoutTail: 'FAIL: 1 test failed' });

    const body = readFileSync(failureFile(path), 'utf8');
    const gateHeadings = body.split(GATE_FAILURE_FEEDBACK_HEADING).length - 1;
    assert.equal(gateHeadings, 1, 'exactly one appended gate section, not one per write');
    assert.match(body, /FAIL: 1 test failed/, 'the LATEST gate detail wins');
    assert.doesNotMatch(body, /FAIL: 3 tests failed/, 'the stale gate detail is gone');
    assert.ok(body.startsWith(MERGE_CONFLICT_FEEDBACK_HEADING), 'the conflict note still leads');
  } finally {
    cleanup();
  }
});

test('precedence: an iteration-0 gate failure with NO merge-conflict note present writes the plain gate body (no phantom conflict section)', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeGateFeedback(path, iter0FailingGateInfo);

    const body = readFileSync(failureFile(path), 'utf8');
    assert.ok(body.startsWith(GATE_FAILURE_FEEDBACK_HEADING));
    assert.doesNotMatch(body, /MERGE CONFLICT/);
  } finally {
    cleanup();
  }
});

test('precedence: a live gate failure at iteration ≥ 1 written after a merge-conflict note REPLACES the file entirely', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 1, sampleConflict());
    assert.match(readFileSync(failureFile(path), 'utf8'), /MERGE CONFLICT/);

    // By iteration 1 the agent has had its mandated first read of the file;
    // from here the freshest live gate truth fully supersedes.
    writeGateFeedback(path, iter1FailingGateInfo);

    const body = readFileSync(failureFile(path), 'utf8');
    assert.doesNotMatch(body, /MERGE CONFLICT/, 'the live gate result must fully supersede the merge-conflict note');
    assert.match(body, /Live quality-gate failure/);
    assert.match(body, /FAIL: 2 tests failed/);
  } finally {
    cleanup();
  }
});

test('precedence: a passing gate check clears the file even when it currently holds a merge-conflict note — at iteration ≥ 1 AND at iteration 0', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeMergeConflictFeedback(path, 1, sampleConflict());
    assert.ok(existsSync(failureFile(path)));

    writeGateFeedback(path, passingGateInfo);
    assert.equal(existsSync(failureFile(path)), false, 'a passing gate must clear ANY prior content, not just its own prior failure');

    // Iteration 0 too: if even the sharp-gate pre-check passes on a fresh
    // fork, sibling merges already delivered the behavior (the runner
    // classifies it already-complete/gate-too-loose) — the note is moot.
    writeMergeConflictFeedback(path, 1, sampleConflict());
    writeGateFeedback(path, { ...passingGateInfo, iteration: 0 });
    assert.equal(existsSync(failureFile(path)), false, 'an iteration-0 pass must clear the conflict note as well');
  } finally {
    cleanup();
  }
});

test('precedence: writing a merge-conflict note after a stale gate-failure file overwrites it cleanly (defensive — not a real production sequence)', () => {
  const { path, cleanup } = setupWorktree();
  try {
    writeGateFeedback(path, iter1FailingGateInfo);
    assert.match(readFileSync(failureFile(path), 'utf8'), /Live quality-gate failure/);

    writeMergeConflictFeedback(path, 1, sampleConflict());

    const body = readFileSync(failureFile(path), 'utf8');
    assert.doesNotMatch(body, /Live quality-gate failure/);
    assert.match(body, /MERGE CONFLICT/);
  } finally {
    cleanup();
  }
});
