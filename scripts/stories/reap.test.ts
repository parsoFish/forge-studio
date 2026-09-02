/**
 * reap.test.ts — every agent a story run dispatched is dead when the run ends.
 *
 * THE INCIDENT THIS CLOSES (bead `forge-8vfn.5.37`, LIFECYCLE half; measured
 * 2026-09-02 on the S3 run). Beat 11 presses `run-onboarding-agent`, which
 * dispatches a real Agent. The story run then finished, wrote its verdict and
 * exited — and the Agent kept running as an ORPHAN. Five minutes later it had
 * left the run's worktree entirely and was executing `forge constraints
 * author` and `forge preflight converge --accept …` inside ANOTHER session's
 * checkout, where it added ten files to that tree's copy of the story ground.
 * Nothing was red anywhere: the project's own `.gitignore` ignores `.forge/`
 * and forge's ignores `projects/*`, so no `git status` in either tree ever
 * showed it.
 *
 * The orphan window IS the escape window. A run that has written its verdict
 * has, by definition, stopped watching; anything still executing after that
 * point is unobserved by the gate that started it.
 *
 * WHY THE CONTAINMENT CHECK IS PART OF THE REAPER AND NOT AN AFTERTHOUGHT.
 * The remedy is a kill, and a kill aimed by a pattern is how three sessions
 * died in this campaign already (COMMON §15.17: never `pkill -f` a shared
 * pattern on this host). So every pid is resolved to its OWN `/proc/<pid>/cwd`
 * and signalled only when that cwd sits inside the run's worktree — the same
 * rule, and the same `readProcCwd`, the bridge-identity decision already uses.
 * An unreadable cwd is UNKNOWN provenance, and unknown provenance is not our
 * provenance: it is skipped and reported, never signalled on a guess.
 *
 * This closes 5.37's LIFECYCLE half only. The containment half — an agent that
 * should never have been able to `cd` out of its worktree at all — is
 * M4-agents' (5.37's cwd/root pinning), and `forge-8vfn.5.38` (the event log
 * stops before the agent does) is untouched by this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectAgentRuns, decideReap, reapAgentRuns } from './reap.mjs';

const ROOT = '/home/parso/forge-projects';

// ---------------------------------------------------------------- decideReap

test('a pid whose cwd is inside the run worktree is reaped', () => {
  assert.deepEqual(decideReap({ pid: 42, cwd: `${ROOT}/projects/x`, ownRoot: ROOT }), { reap: true });
});

test('a pid whose cwd IS the run worktree is reaped', () => {
  assert.deepEqual(decideReap({ pid: 42, cwd: ROOT, ownRoot: ROOT }), { reap: true });
});

test('a pid whose cwd is OUTSIDE the run worktree is skipped, never signalled', () => {
  const d = decideReap({ pid: 42, cwd: '/home/parso/forge', ownRoot: ROOT });
  assert.equal(d.reap, false);
  assert.match(d.reason, /outside/);
});

test('a sibling path that merely shares a prefix is not "inside" — /home/parso/forge-projects-evil', () => {
  // The lexical trap: `startsWith(root)` alone would reap another lane's tree.
  const d = decideReap({ pid: 42, cwd: `${ROOT}-evil/x`, ownRoot: ROOT });
  assert.equal(d.reap, false);
});

test('an unreadable cwd is unknown provenance and is skipped, not guessed', () => {
  const d = decideReap({ pid: 42, cwd: null, ownRoot: ROOT });
  assert.equal(d.reap, false);
  assert.match(d.reason, /unreadable|unknown/i);
});

test('a non-numeric or non-positive pid never reaches a signal', () => {
  for (const pid of [0, -1, Number.NaN, '  ', undefined]) {
    assert.equal(decideReap({ pid, cwd: ROOT, ownRoot: ROOT }).reap, false, `pid ${String(pid)}`);
  }
});

// ------------------------------------------------------------ collectAgentRuns

test('collects every session dir carrying a turn.pid that this run created', () => {
  const runs = collectAgentRuns('/r', 1000, {
    listDirs: () => [
      { name: '_agent-onboarding-agent-A', mtimeMs: 1500 },
      { name: '_onboarding-B', mtimeMs: 2000 },
    ],
    readPid: (p) => (p.includes('_agent-onboarding-agent-A') ? 111 : 222),
  });
  assert.deepEqual(
    runs.map((r) => r.pid),
    [111, 222],
  );
});

test('a session dir older than the run is NOT collected — a previous run\'s residue is not ours to kill', () => {
  const runs = collectAgentRuns('/r', 1000, {
    listDirs: () => [{ name: '_agent-old', mtimeMs: 999 }],
    readPid: () => 111,
  });
  assert.deepEqual(runs, []);
});

test('a session dir with no turn.pid is skipped without throwing', () => {
  const runs = collectAgentRuns('/r', 0, {
    listDirs: () => [{ name: '_agent-x', mtimeMs: 10 }],
    readPid: () => null,
  });
  assert.deepEqual(runs, []);
});

test('an unreadable _logs/ yields no runs rather than aborting the run teardown', () => {
  const runs = collectAgentRuns('/r', 0, {
    listDirs: () => {
      throw new Error('ENOENT');
    },
    readPid: () => 1,
  });
  assert.deepEqual(runs, []);
});

// -------------------------------------------------------------- reapAgentRuns

test('SIGTERM first; a process that exits within the grace period is never SIGKILLed', async () => {
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => false,
    graceMs: 50,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent, [[7, 'SIGTERM']]);
  assert.deepEqual(report.reaped, [{ pid: 7, dir: '/r/_logs/_agent-a', signal: 'SIGTERM' }]);
  assert.deepEqual(report.skipped, []);
});

test('a process still alive after the grace period is SIGKILLed — a bounded wait, never an unbounded one', async () => {
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => true,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent, [
    [7, 'SIGTERM'],
    [7, 'SIGKILL'],
  ]);
  assert.equal(report.reaped[0].signal, 'SIGKILL');
});

test('a pid outside the run worktree is reported and NEVER signalled', async () => {
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/home/parso/forge',
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => true,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent, [], 'no signal may be sent to a pid we could not place in our own tree');
  assert.equal(report.reaped.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /outside/);
});

test('a kill that throws (already gone, or not ours) is recorded, never propagated into run teardown', async () => {
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    kill: () => {
      throw new Error('ESRCH');
    },
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.equal(report.reaped.length, 0);
  assert.match(report.skipped[0].reason, /ESRCH/);
});

// --------------------------------------------------------- POSITIVE CONTROL

test('POSITIVE CONTROL: a planted long-lived child registered as a dispatched agent is DEAD after the reap', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // A real child that would outlive the run, with its cwd inside the run root
  // — exactly the orphan shape the S3 run left behind.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already reaped, which is the point */
    }
  });

  // Register it the way a dispatch does: a session dir under _logs/ with turn.pid.
  const dir = join(root, '_logs', '_agent-planted-probe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(child.pid));

  const runs = collectAgentRuns(root, 0);
  assert.equal(runs.length, 1, 'the planted child must be collected from its turn.pid');
  assert.equal(runs[0].pid, child.pid);

  const report = await reapAgentRuns(runs, { ownRoot: root, graceMs: 3000, pollMs: 25 });
  assert.equal(report.skipped.length, 0, `nothing should have been skipped: ${JSON.stringify(report.skipped)}`);
  assert.equal(report.reaped.length, 1);

  // The assertion that matters: the process is GONE, measured on /proc, not
  // inferred from the signal having been sent.
  await new Promise((r) => setTimeout(r, 100));
  let alive = true;
  try {
    process.kill(child.pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, 'the planted child survived a run-end reap — the orphan window is still open');
});

test('NEGATIVE CONTROL: the same planted child is NOT reaped when its cwd is outside the run root', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-out-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'story-reap-elsewhere-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: elsewhere,
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      /* fine */
    }
  });

  const dir = join(root, '_logs', '_agent-planted-probe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(child.pid));

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 200, pollMs: 25 });
  assert.equal(report.reaped.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /outside/);

  let alive = true;
  try {
    process.kill(child.pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, true, 'a process outside the run root must survive — the reaper is not a pattern kill');
});
