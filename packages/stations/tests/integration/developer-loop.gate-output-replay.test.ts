/**
 * forge-nk1y.35 — replay of gitweave I2's WI-6 dev loop (copied from the
 * cycle's events.jsonl: two runs, 8 `gate.fail`, the agent calling the gate
 * failure "stale" five times while the gate's own stdout said
 * `KeyError: ('team', 'ghost-team')` every time). The fixture is
 * `../test-fixtures/gitweave-i2-wi6/dev-loop-replay.jsonl`.
 *
 * Drives the PRODUCTION tracker (`createGateFeedbackTracker`) against a real
 * git worktree, committing once per agent turn so every gate run has its own
 * HEAD, and asserts what the next iteration's brief
 * (`.forge/last-gate-failure.md`) carries:
 *  - the gate's OWN stdout/stderr, verbatim, labelled with command, exit code
 *    and the HEAD the gate ran at — and a line saying a local re-run is never proof;
 *  - on a repeat failure, the previous gate output beside the current one,
 *    with `dev-loop.gate-output-repeated`;
 *  - a "stale" claim answered by a failing gate run at the current HEAD is
 *    refused by name (`dev-loop.stale-claim-refused`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeQualityGateFromCmd, runRalphLoop as runRalph, type AgentInvocation, type GateRunInfo } from '@forge/agents';
import {
  createGateFeedbackTracker,
  GATE_FAILURE_FEEDBACK_HEADING,
  HEAD_UNKNOWN,
  type GateFeedbackEvent,
} from '../../phases/gate-feedback.ts';

type ReplayRow =
  | { run: number; kind: 'iteration'; iteration: number; last_assistant_text: string }
  | {
      run: number;
      kind: 'gate';
      message: string;
      iteration: number;
      gate_command: string;
      gate_exit_code: number;
      gate_passed: boolean;
      gate_stdout_tail: string;
      gate_stderr_tail: string;
    };

const FIXTURE = join(import.meta.dirname, '..', 'test-fixtures', 'gitweave-i2-wi6', 'dev-loop-replay.jsonl');
const ROWS: ReplayRow[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as ReplayRow);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
}

function makeWorktree(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'forge-gate-replay-'));
  git(path, ['init', '-q', '-b', 'main']);
  git(path, ['config', 'user.email', 't@forge']);
  git(path, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(path, '.gitignore'), '.forge/\n');
  git(path, ['add', '.gitignore']);
  git(path, ['commit', '-q', '-m', 'base']);
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

function toGateInfo(row: Extract<ReplayRow, { kind: 'gate' }>): GateRunInfo {
  return {
    passed: row.gate_passed,
    exitCode: row.gate_exit_code,
    durationMs: 0,
    stdoutTail: row.gate_stdout_tail,
    stderrTail: row.gate_stderr_tail,
    command: row.gate_command,
    iteration: row.iteration,
  };
}

type Snapshot = { iteration: number; head: string; brief: string | null };

/** Replays one dev-loop run; returns the brief after every gate run and every event. */
function replayRun(run: number): { snapshots: Snapshot[]; events: GateFeedbackEvent[] } {
  const wt = makeWorktree();
  try {
    const events: GateFeedbackEvent[] = [];
    const tracker = createGateFeedbackTracker({ worktreePath: wt.path, emit: (e) => events.push(e) });
    const snapshots: Snapshot[] = [];
    const briefPath = join(wt.path, '.forge', 'last-gate-failure.md');
    for (const row of ROWS.filter((r) => r.run === run)) {
      if (row.kind === 'iteration') {
        // The agent's turn: it commits (WI-6's agent committed every turn), then reports.
        writeFileSync(join(wt.path, 'plan.py'), `# iteration ${row.iteration}\n`);
        git(wt.path, ['add', 'plan.py']);
        git(wt.path, ['commit', '-q', '-m', `iteration ${row.iteration}`]);
        tracker.noteAgentTurn(row.last_assistant_text);
        continue;
      }
      tracker.onRun(toGateInfo(row));
      snapshots.push({
        iteration: row.iteration,
        head: git(wt.path, ['rev-parse', 'HEAD']),
        brief: existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : null,
      });
    }
    return { snapshots, events };
  } finally {
    wt.cleanup();
  }
}

const gateRows = (run: number) =>
  ROWS.filter((r): r is Extract<ReplayRow, { kind: 'gate' }> => r.run === run && r.kind === 'gate');

test('fixture is the I2 WI-6 sequence: two runs, eight gate.fail, the KeyError in every failing stdout', () => {
  assert.equal(ROWS.filter((r) => r.kind === 'gate' && r.message === 'gate.fail').length, 8);
  for (const r of ROWS) {
    if (r.kind === 'gate' && r.message === 'gate.fail') assert.match(r.gate_stdout_tail, /KeyError: \('team', 'ghost-team'\)/);
  }
});

test('each failing gate writes its OWN stdout/stderr verbatim, labelled with command, exit code and HEAD', () => {
  const { snapshots } = replayRun(1);
  const rows = gateRows(1);
  assert.equal(snapshots.length, rows.length);
  snapshots.forEach((s, i) => {
    const row = rows[i];
    if (row.gate_passed) return;
    assert.ok(s.brief, `iteration ${s.iteration}: a failing gate leaves a brief`);
    assert.ok(s.brief.startsWith(`${GATE_FAILURE_FEEDBACK_HEADING} (forge, iteration ${row.iteration})`));
    assert.ok(s.brief.includes(row.gate_stdout_tail), `iteration ${s.iteration}: gate stdout verbatim`);
    assert.ok(s.brief.includes(`Command: ${row.gate_command}`));
    assert.ok(s.brief.includes(`Exit code: ${row.gate_exit_code}`));
    assert.ok(s.brief.includes(`Gate ran at HEAD: ${s.head}`), `iteration ${s.iteration}: the HEAD the gate judged`);
    assert.match(s.brief, /A local re-run of the tests is never proof/);
  });
});

test('a repeat failure shows the previous gate output beside the current one and emits dev-loop.gate-output-repeated', () => {
  const { snapshots, events } = replayRun(1);
  const rows = gateRows(1);
  // iteration 0 is the must-fail pre-check before any agent work: never a "previous" for a repeat.
  const repeated = events.filter((e) => e.message === 'dev-loop.gate-output-repeated');
  assert.deepEqual(repeated.map((e) => e.metadata.iteration), [2, 3, 4, 5]);
  for (const e of repeated) {
    assert.equal(e.metadata.previous_iteration, (e.metadata.iteration as number) - 1);
    assert.equal(e.metadata.exit_code, 1);
    assert.equal(e.metadata.previous_exit_code, 1);
    assert.equal(typeof e.metadata.output_identical, 'boolean');
  }
  const iter3 = snapshots.find((s) => s.iteration === 3);
  const prevRow = rows.find((r) => r.iteration === 2);
  assert.ok(iter3?.brief && prevRow);
  assert.match(iter3.brief, /## Repeat failure — the previous gate run \(iteration 2\)/);
  assert.ok(iter3.brief.includes(prevRow.gate_stdout_tail), 'previous stdout is shown');
  assert.ok(iter3.brief.includes(rows.find((r) => r.iteration === 3)!.gate_stdout_tail), 'current stdout is shown');
  const iter1 = snapshots.find((s) => s.iteration === 1);
  assert.ok(iter1?.brief && !iter1.brief.includes('## Repeat failure'), 'iteration 1 follows only the iter-0 pre-check');
});

test('a "stale" claim answered by a failing gate at the current HEAD is refused by name', () => {
  const run1 = replayRun(1);
  const refused1 = run1.events.filter((e) => e.message === 'dev-loop.stale-claim-refused');
  // I2 run 1: the agent called the failure stale at iterations 2, 4 and 5.
  assert.deepEqual(refused1.map((e) => e.metadata.iteration), [2, 4, 5]);
  for (const e of refused1) {
    const snap = run1.snapshots.find((s) => s.iteration === e.metadata.iteration);
    assert.equal(e.metadata.head_sha, snap?.head, 'refusal names the HEAD the gate ran at');
    assert.equal(e.metadata.exit_code, 1);
    assert.match(String(e.metadata.claim_excerpt), /stale/i);
    assert.match(snap?.brief ?? '', /## Your "stale" claim is REFUSED/);
  }
  const run2 = replayRun(2);
  assert.deepEqual(run2.events.filter((e) => e.message === 'dev-loop.stale-claim-refused').map((e) => e.metadata.iteration), [2, 3]);
  // Run 2's iteration 4 fixed the bug: the gate passed and the brief is gone.
  assert.equal(run2.snapshots.at(-1)?.brief, null);
});

test('refusal path: a "stale" claim followed by a PASSING gate is not refused, and the brief is removed', () => {
  const wt = makeWorktree();
  try {
    const events: GateFeedbackEvent[] = [];
    const tracker = createGateFeedbackTracker({ worktreePath: wt.path, emit: (e) => events.push(e) });
    tracker.noteAgentTurn('Gate failure file is stale.');
    tracker.onRun({ passed: true, exitCode: 0, durationMs: 0, stdoutTail: 'ok', stderrTail: '', command: 'true', iteration: 1 });
    assert.equal(events.filter((e) => e.message === 'dev-loop.stale-claim-refused').length, 0);
    assert.equal(existsSync(join(wt.path, '.forge', 'last-gate-failure.md')), false);
  } finally {
    wt.cleanup();
  }
});

test('an unreadable HEAD is recorded as UNKNOWN, never as a current commit (§6.15)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-replay-nogit-'));
  try {
    const events: GateFeedbackEvent[] = [];
    const tracker = createGateFeedbackTracker({ worktreePath: dir, emit: (e) => events.push(e) });
    tracker.noteAgentTurn('this failure is stale');
    tracker.onRun({ passed: false, exitCode: 1, durationMs: 0, stdoutTail: 'boom', stderrTail: '', command: 'false', iteration: 1 });
    const brief = readFileSync(join(dir, '.forge', 'last-gate-failure.md'), 'utf8');
    assert.ok(brief.includes(`Gate ran at HEAD: ${HEAD_UNKNOWN}`));
    const refused = events.find((e) => e.message === 'dev-loop.stale-claim-refused');
    assert.equal(refused?.metadata.head_sha, HEAD_UNKNOWN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a brief that cannot be written is a named event, never swallowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-replay-blocked-'));
  try {
    writeFileSync(join(dir, '.forge'), 'a file where the .forge dir should be');
    const events: GateFeedbackEvent[] = [];
    const tracker = createGateFeedbackTracker({ worktreePath: dir, emit: (e) => events.push(e) });
    tracker.onRun({ passed: false, exitCode: 1, durationMs: 0, stdoutTail: 'x', stderrTail: '', command: 'false', iteration: 1 });
    const failed = events.find((e) => e.message === 'dev-loop.gate-feedback-write-failed');
    assert.ok(failed, 'write failure is emitted');
    assert.match(String(failed.metadata.error), /\S/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wiring through the real ralph runner: the turn that says "stale" is answered by the next gate, and the agent reads the refusal', async () => {
  const wt = makeWorktree();
  try {
    mkdirSync(join(wt.path, '.forge', 'work-items'), { recursive: true });
    const specPath = join(wt.path, '.forge', 'work-items', 'WI-6.md');
    writeFileSync(specPath, '# WI-6: plan engine\n');
    const events: GateFeedbackEvent[] = [];
    const tracker = createGateFeedbackTracker({ worktreePath: wt.path, emit: (e) => events.push(e) });
    // The production pair developer-loop.ts wires: the gate's onRun feeds the tracker,
    // the runner's onIteration hands it the agent's last text.
    const gate = makeQualityGateFromCmd(wt.path, ['sh', '-c', "echo \"KeyError: ('team', 'ghost-team')\"; exit 1"], (info) => tracker.onRun(info));
    const seen: string[] = [];
    const agent: AgentInvocation = async ({ worktreePath }) => {
      const p = join(worktreePath, '.forge', 'last-gate-failure.md');
      seen.push(existsSync(p) ? readFileSync(p, 'utf8') : '');
      return { filesChanged: [], costUsd: 0, lastAssistantText: 'All 6 tests pass. Gate failure file is stale from prior iteration.' };
    };
    await runRalph(
      {
        workItemSpecPath: specPath,
        worktreePath: wt.path,
        initiativeBudget: { iterations: 2, usd: Number.POSITIVE_INFINITY },
        brainQueryResults: '',
        cycleId: 'test-cycle',
        initiativeId: 'INIT-replay',
        qualityGate: gate,
        failOnHollowIter0Gate: true,
        onIteration: (_it, info) => tracker.noteAgentTurn(info.lastAssistantText),
      },
      agent,
    );
    assert.deepEqual(events.filter((e) => e.message === 'dev-loop.stale-claim-refused').map((e) => e.metadata.iteration), [1, 2]);
    assert.match(seen[1] ?? '', /## Your "stale" claim is REFUSED/, 'iteration 2 reads the refusal of its own claim');
    assert.match(seen[1] ?? '', /KeyError: \('team', 'ghost-team'\)/);
  } finally {
    wt.cleanup();
  }
});
