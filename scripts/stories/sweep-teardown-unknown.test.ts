/**
 * sweep-teardown-unknown.test.ts — ROW 101 / M7-D findings 2 and 3
 * (M7-COMMON §6.15, T1 1512): an unreadable scheduler pidfile, `/proc/<pid>`
 * read, or process table must never read as "no daemon" / "no descendants".
 *
 * SPLIT OUT of `sweep-teardown.test.ts` (795/800, no room) and
 * `sweep-teardown-scheduler.test.ts` (which owns the real-daemon-plant doors
 * for `reapCensusAndSweep`'s scheduler root) — this file doors the FAILURE
 * paths those two leave untested: a pidfile or `/proc` read that fails for a
 * reason OTHER than the daemon being genuinely absent.
 *
 * THE CHAIN THIS CLOSES. `ownSchedulerPidState` used to fold ANY pidfile or
 * `/proc` read failure into "no daemon" (`ownSchedulerPid` returning `null`).
 * `reapCensusAndSweep`'s `schedulerPid` default is exactly that value, and
 * when both it and `reapedPids` are empty, the census is never even attempted
 * (`bareRoots.length > 0 || schedulerPid !== null` is false) — the trailing
 * sweep proceeds to clear `_queue/`, `_worktrees/` and this run's ground
 * while a live scheduler's dispatch may still be writing. The SAME shape
 * applies to `stopSchedulerCensusAndRelease`'s own pre-signal snapshot: an
 * unreadable pidfile there leaves `daemonPid = null`, so if `stopOwnScheduler`
 * (a SEPARATE, later read of the same file) still finds and kills a real
 * daemon, its descendants were never snapshotted and the release that follows
 * can proceed against writers nobody censused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** A pid that is certainly GONE: a child this test spawned and already reaped.
 *  A literal like 7 is a live process on some hosts (the GitHub runner: PR #949
 *  CI run 36197789614), which makes the census non-empty and the control red. */
function deadPid(): number {
  const r = spawnSync('true');
  if (typeof r.pid !== 'number') throw new Error('could not spawn a throwaway child');
  return r.pid;
}

import {
  reapCensusAndSweep, stopSchedulerCensusAndRelease, ownSchedulerPid, ownSchedulerPidState, DAEMON_PID_FILE,
} from './sweep-teardown.mjs';

function rootWithPidFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  writeFileSync(join(root, DAEMON_PID_FILE), '999999');
  return root;
}

// ---------------------------------------------------------- ownSchedulerPidState

test('control: no pidfile at all (real ENOENT) is genuinely "no daemon", exactly as today', () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-none-'));
  try {
    const state = ownSchedulerPidState(root);
    assert.deepEqual(state, { pid: null, unknown: false });
    assert.equal(ownSchedulerPid(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROW 101 (RED) / M7-D finding 2: an unreadable (non-ENOENT) pidfile is UNKNOWN, not "no daemon"', () => {
  const root = rootWithPidFile();
  chmodSync(join(root, DAEMON_PID_FILE), 0o000);
  try {
    const state = ownSchedulerPidState(root);
    assert.equal(state.pid, null);
    assert.equal(state.unknown, true, `an EACCES pidfile read must be UNKNOWN, not folded into "no daemon": ${JSON.stringify(state)}`);
    assert.match(state.error ?? '', /EACCES|permission/i);
    // ownSchedulerPid's own bare-pid contract is unchanged — still null either way.
    assert.equal(ownSchedulerPid(root), null);
  } finally {
    chmodSync(join(root, DAEMON_PID_FILE), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------- reapCensusAndSweep: scheduler

test('ROW 101 (RED) / M7-D finding 2: reapCensusAndSweep REFUSES the trailing sweep when the scheduler state is UNKNOWN, never clears', async () => {
  const root = rootWithPidFile();
  chmodSync(join(root, DAEMON_PID_FILE), 0o000);
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  const claim = join(root, '_queue', 'in-flight', 'INIT-x.md.heartbeat');
  writeFileSync(claim, 'beat');
  try {
    const result = await reapCensusAndSweep({
      root, storyId: 'S-unknown-sched', sinceMs: Date.now() - 60_000, evidenceDir: join(root, 'queue-claim'),
      reapedPids: [], // schedulerPid omitted — the production default
    });
    assert.equal(result.sweep, null, 'nothing may be cleared while the scheduler state is UNKNOWN');
    assert.equal(result.census.empty, false);
    assert.match(result.census.reason, /UNKNOWN|could not determine/i);
    assert.ok(
      result.lines.some((l: string) => /REFUSING/.test(l)),
      `expected a named REFUSING line: ${JSON.stringify(result.lines)}`,
    );
    assert.equal(fileStillThere(claim), true, 'the claim must still be on disk — nothing was cleared');
  } finally {
    chmodSync(join(root, DAEMON_PID_FILE), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

function fileStillThere(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

test('control: reapCensusAndSweep with schedulerPid explicitly null (opt-out) skips resolution and proceeds exactly as before', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-optout-'));
  try {
    const result = await reapCensusAndSweep({
      root, storyId: 'S-optout', sinceMs: Date.now() - 60_000, evidenceDir: join(root, 'queue-claim'),
      reapedPids: [], schedulerPid: null,
    });
    assert.equal(result.census.reason, 'census-empty — no run root was recorded, so there is nothing to confirm');
    assert.ok(result.sweep, 'an explicit opt-out must still reach the sweep, as documented');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------- reapCensusAndSweep: proc table

test('ROW 101 (RED) / M7-D finding 6: reapCensusAndSweep REFUSES when its OWN process-table read is UNKNOWN, never clears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-table-'));
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  const claim = join(root, '_queue', 'in-flight', 'INIT-y.md.heartbeat');
  writeFileSync(claim, 'beat');
  try {
    const result = await reapCensusAndSweep({
      root, storyId: 'S-unknown-table', sinceMs: Date.now() - 60_000, evidenceDir: join(root, 'queue-claim'),
      reapedPids: [deadPid()], // non-empty so the table read is actually attempted
      schedulerPid: null,
      procTable: () => null, // simulates a real /proc listing failure
    });
    assert.equal(result.sweep, null, 'nothing may be cleared while the process table is UNKNOWN');
    assert.equal(result.census.empty, false);
    assert.match(result.census.reason, /process table/i);
    assert.equal(fileStillThere(claim), true, 'the claim must still be on disk — nothing was cleared');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('control: reapCensusAndSweep with a real (non-null) process table proceeds exactly as before', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-table-ctrl-'));
  try {
    const result = await reapCensusAndSweep({
      root, storyId: 'S-table-ctrl', sinceMs: Date.now() - 60_000, evidenceDir: join(root, 'queue-claim'),
      reapedPids: [deadPid()], schedulerPid: null,
      procTable: () => new Map(),
    });
    assert.ok(result.sweep, 'a real (empty) table must not be refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------- stopSchedulerCensusAndRelease: snapshot

test('ROW 101 (RED) / M7-D finding 3: stopSchedulerCensusAndRelease REFUSES the whole teardown-release step on an unreadable pidfile', async () => {
  const root = rootWithPidFile();
  chmodSync(join(root, DAEMON_PID_FILE), 0o000);
  try {
    const result = await stopSchedulerCensusAndRelease(root);
    assert.equal(result.release, null, 'the release must never run when the pre-signal snapshot is UNKNOWN');
    assert.equal(result.sched, null);
    assert.equal(result.census?.empty, false);
    assert.ok(
      result.lines.some((l: string) => /REFUSING/.test(l)),
      `expected a named REFUSING line: ${JSON.stringify(result.lines)}`,
    );
  } finally {
    chmodSync(join(root, DAEMON_PID_FILE), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test('control: stopSchedulerCensusAndRelease with genuinely no pidfile (real ENOENT) proceeds exactly as before', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-stop-ctrl-'));
  try {
    const result = await stopSchedulerCensusAndRelease(root);
    assert.equal(result.sched.stopped, null);
    assert.equal(result.sched.note, null);
    assert.equal(result.census, null, 'no daemon means nothing to census, unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------- residual: reapCensusAndSweep re-checks _logs/ itself --
//
// `reapedPids` (`run-story.mjs`'s `reap.reaped.map((r) => r.pid)`) never
// carries a PID_READ_UNKNOWN row — it lands in `reap.skipped` — so an
// unreadable `_logs/` or `turn.pid` from THIS run's own dispatch collection
// can pass through as an empty, CONFIRMED `reapedPids` set, and the trailing
// sweep would clear `_queue/`, `_worktrees/` and this run's ground while an
// agent this run failed to even enumerate might still be alive. Closed by
// having `reapCensusAndSweep` re-run the same read independently
// (`agentRunsReadable`, reap.mjs) rather than trusting `run-story.mjs`'s
// derived set — `run-story.mjs` sits at its own 800-line cap and is not
// touched here.

test('ROW 101 (RED) residual: reapCensusAndSweep REFUSES when its OWN re-check of _logs/ turns up a PID_READ_UNKNOWN row, never clears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-agentruns-'));
  const dir = join(root, '_logs', '_agent-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '4242');
  chmodSync(join(dir, 'turn.pid'), 0o000);
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  const claim = join(root, '_queue', 'in-flight', 'INIT-z.md.heartbeat');
  writeFileSync(claim, 'beat');
  try {
    const result = await reapCensusAndSweep({
      root, storyId: 'S-unknown-agentruns', sinceMs: Date.now() - 60_000, evidenceDir: join(root, 'queue-claim'),
      reapedPids: [], // exactly the S10 shape — this run's own reap saw nothing
      schedulerPid: null, // isolates this door from the scheduler-unknown one
    });
    assert.equal(result.sweep, null, 'nothing may be cleared while this run\'s own dispatch collection is UNKNOWN');
    assert.equal(result.census.empty, false);
    assert.match(result.census.reason, /dispatched-agent collection could not be confirmed/i);
    assert.ok(
      result.lines.some((l: string) => /REFUSING/.test(l)),
      `expected a named REFUSING line: ${JSON.stringify(result.lines)}`,
    );
    assert.equal(fileStillThere(claim), true, 'the claim must still be on disk — nothing was cleared');
  } finally {
    chmodSync(join(dir, 'turn.pid'), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test('control: reapCensusAndSweep with a genuinely absent _logs/ (real ENOENT) proceeds exactly as before', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-teardown-unknown-agentruns-ctrl-'));
  try {
    const result = await reapCensusAndSweep({
      root, storyId: 'S-agentruns-ctrl', sinceMs: Date.now() - 60_000, evidenceDir: join(root, 'queue-claim'),
      reapedPids: [], schedulerPid: null,
    });
    assert.equal(result.census.reason, 'census-empty — no run root was recorded, so there is nothing to confirm');
    assert.ok(result.sweep, 'a genuinely absent _logs/ must not be refused — there is nothing to confirm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
