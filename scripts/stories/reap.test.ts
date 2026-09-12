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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectAgentRuns, decideReap, describeReap, descendantsOf, reapAgentRuns } from './reap.mjs';
import {
  readPlantRecord, readLastBeat, plantDiedMessage,
  everyPlantedPidVanished, plantVanishedInWindowMessage,
  memAvailableMiB, memoryClause,
} from './reap-plant.mjs';

const ROOT = '/home/parso/forge-projects';

// ---------------------------------------------------------------- decideReap

test('a pid whose cwd is inside the run worktree is reaped', () => {
  assert.deepEqual(decideReap({ pid: 42, cwd: `${ROOT}/projects/x`, ownRoot: ROOT }), { reap: true, provenance: 'cwd' });
});

test('a pid whose cwd IS the run worktree is reaped', () => {
  assert.deepEqual(decideReap({ pid: 42, cwd: ROOT, ownRoot: ROOT }), { reap: true, provenance: 'cwd' });
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
    procTable: () => new Map(),
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => false,
    graceMs: 50,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent, [[7, 'SIGTERM']]);
  assert.deepEqual(report.reaped, [{ pid: 7, dir: '/r/_logs/_agent-a', signal: 'SIGTERM', via: 'cwd' }]);
  assert.deepEqual(report.skipped, []);
});

test('a process still alive after the grace period is SIGKILLed — a bounded wait, never an unbounded one', async () => {
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => new Map(),
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
    procTable: () => new Map(),
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
    procTable: () => new Map(),
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

// ---------------------------------------------------------------------------
// bead forge-8vfn.5.45 — the descendant gap (S9 run 3, 2026-09-03)
//
// THE SECOND INCIDENT. A story run dispatched an agent; the reaper signalled
// the recorded `turn.pid` (1836206) and stopped there. That turn had a child,
// 1836213, which RE-PARENTED to a system pid when its parent died and outlived
// the run by ~3 minutes. The reaper's log for it was
// `NOT reaped: cwd unreadable — unknown provenance` — the parent was already
// dying, so its cwd link had gone, and the rule written for a stale pid file
// fired on a process we had just killed ourselves.
//
// Two defects, and they compound:
//  1. Only the recorded pid was ever enumerated. A dispatched turn leads its
//     own process group (`spawnAgentTurn` spawns `detached: true`, and
//     `killTrackedTurn` in packages/sessions/bridge-studio-lifecycle.ts
//     already signals `-pid` for exactly this reason) — the reaper did not.
//  2. An unreadable cwd on a pid THIS RUN RECORDED is not unknown provenance.
//     We wrote that pid file ourselves; provenance is by record. Unknown
//     provenance means a pid nothing in this run can account for.
//
// The containment rule is NOT relaxed: a pid whose cwd is READABLE and sits
// outside the run worktree is still never signalled, and refusing the recorded
// pid refuses its whole subtree — a tree whose root we cannot claim is not
// ours to kill.
// ---------------------------------------------------------------------------

test('descendantsOf walks the ppid chain transitively, and never loops on a cycle', () => {
  const table = new Map([
    [10, { ppid: 1, pgrp: 10 }],
    [11, { ppid: 10, pgrp: 10 }],
    [12, { ppid: 11, pgrp: 10 }],
    [13, { ppid: 1, pgrp: 13 }],
    [14, { ppid: 14, pgrp: 14 }],
  ]);
  assert.deepEqual(descendantsOf(10, table).sort((a, b) => a - b), [11, 12]);
  assert.deepEqual(descendantsOf(13, table), []);
  assert.deepEqual(descendantsOf(14, table), [], 'a self-parenting row must not spin');
});

test('decideReap: an unreadable cwd on a RECORDED pid that is GONE is provenance by record', () => {
  const d = decideReap({ pid: 42, cwd: null, ownRoot: ROOT, recorded: true, alive: false });
  assert.equal(d.reap, true);
  assert.match(d.provenance, /record/);
});

test('decideReap: a LIVE recorded pid whose cwd is unreadable is still unknown provenance', () => {
  // `readProcCwd` returns null both for "gone" and for "alive, but we lack the
  // standing to read it" — another user's process, or a kernel thread. Only the
  // first explains its own missing cwd. Conflating them is how a reused pid
  // would be admitted.
  const d = decideReap({ pid: 42, cwd: null, ownRoot: ROOT, recorded: true, alive: true });
  assert.equal(d.reap, false);
  assert.match(d.reason, /alive but its cwd is unreadable/);
});

test('decideReap: an unreadable cwd on a pid we did NOT record is still unknown provenance', () => {
  const d = decideReap({ pid: 42, cwd: null, ownRoot: ROOT, recorded: false });
  assert.equal(d.reap, false);
  assert.match(d.reason, /unreadable|unknown/i);
});

test('decideReap: a READABLE cwd outside the run worktree is refused even for a recorded pid', () => {
  // The containment rule the S3 incident bought, unchanged: being ours is not
  // a licence to signal a process we can see is working in someone else's tree.
  const d = decideReap({ pid: 42, cwd: '/home/parso/forge', ownRoot: ROOT, recorded: true, alive: true });
  assert.equal(d.reap, false);
  assert.match(d.reason, /outside/);
});

test('the process GROUP is signalled, but only when the recorded pid leads it', async () => {
  const sent = [];
  await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => new Map([[7, { ppid: 1, pgrp: 7 }]]),
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent, [
    [-7, 'SIGTERM'],
    [7, 'SIGTERM'],
  ]);
});

test('a recorded pid that does NOT lead its group is signalled alone — never `-pid` into a foreign group', () => {
  // `kill(-N)` where N is not a group leader signals SOMEONE ELSE'S group.
  // This is the §15.17 pattern-kill class through a numeric door.
  const sent = [];
  return reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => new Map([[7, { ppid: 1, pgrp: 4242 }]]),
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  }).then(() => {
    assert.deepEqual(sent, [[7, 'SIGTERM']]);
  });
});

test('descendants are enumerated BEFORE the parent is signalled, and each is signalled too', async () => {
  const sent = [];
  let tableReads = 0;
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => {
      tableReads += 1;
      assert.deepEqual(sent, [], 'the process table must be snapshotted before any signal breaks the ppid links');
      // 9 has escaped the group (it called setsid), so only an explicit
      // per-pid signal reaches it.
      return new Map([
        [7, { ppid: 1, pgrp: 7 }],
        [8, { ppid: 7, pgrp: 7 }],
        [9, { ppid: 8, pgrp: 9 }],
      ]);
    },
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.equal(tableReads, 1);
  assert.deepEqual(sent, [
    [-7, 'SIGTERM'],
    [9, 'SIGTERM'],
    [8, 'SIGTERM'],
    [7, 'SIGTERM'],
  ], 'leaves first, the recorded parent last');
  assert.deepEqual(
    report.reaped.map((r) => r.pid).sort((a, b) => a - b),
    [7, 8, 9],
  );
});

test('refusing the recorded pid refuses its whole subtree — nothing is signalled at all', async () => {
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/home/parso/forge',
    procTable: () => new Map([
      [7, { ppid: 1, pgrp: 7 }],
      [8, { ppid: 7, pgrp: 7 }],
    ]),
    kill: (pid, sig) => sent.push([pid, sig]),
    isAlive: () => true,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent, [], 'a tree whose root we cannot claim is not ours to kill');
  assert.equal(report.reaped.length, 0);
  assert.match(report.skipped[0].reason, /outside/);
});

test('a SECOND reap pass over the same runs is a clean no-op, not a reported failure', async () => {
  // `run.mjs` reaps twice — before the bridge teardown and again at the
  // verdict. Since 5.45 the second pass ADMITS the pid it already killed
  // (provenance by record), so its message has to say the process was already
  // gone rather than read as a reap that went wrong.
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => null,
    procTable: () => new Map(),
    kill: () => {
      throw new Error('kill ESRCH');
    },
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.equal(report.reaped.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /already gone/);
});

test('describeReap names the provenance rung that admitted each pid', () => {
  const lines = describeReap({
    reaped: [
      { pid: 7, dir: '/r/_logs/_a', signal: 'SIGTERM', via: 'record' },
      { pid: 8, dir: '/r/_logs/_a', signal: 'SIGKILL', via: 'group' },
    ],
    skipped: [{ pid: 9, dir: '/r/_logs/_a', reason: 'pid 9: cwd /elsewhere is outside the run worktree /r' }],
  });
  assert.match(lines[0], /pid 7 \(SIGTERM, by record\)/);
  assert.match(lines[1], /pid 8 \(SIGKILL, by group\)/);
  assert.match(lines[2], /NOT reaped: pid 9: cwd \/elsewhere is outside/);
});

// ------------------- 5.45 review round: group ownership must be EVIDENCED

test('a group whose leader is GONE is swept only when a surviving member corroborates', async () => {
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    // 7 is gone (no cwd, not alive); 8 still carries its process group and
    // sits inside the run worktree — that is the corroboration.
    cwdOf: (pid) => (pid === 8 ? '/r/projects/x' : null),
    isAlive: (pid) => pid === 8,
    procTable: () => new Map([[8, { ppid: 1, pgrp: 7 }]]),
    kill: (pid, sig) => sent.push([pid, sig]),
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.deepEqual(sent[0], [-7, 'SIGTERM'], 'the group our dispatch minted is swept');
  assert.ok(report.reaped.some((r) => r.pid === 8 && r.via === 'group'));
});

test('a group whose leader is GONE and whose members are all ELSEWHERE is NOT swept', async () => {
  // The pid-reuse shape: pid 7 died, the kernel handed 7 to an unrelated job
  // that became a group leader, and its workers are nothing to do with us.
  // Nothing corroborates, so `kill(-7)` is never sent.
  const sent = [];
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: (pid) => (pid === 8 ? '/somewhere/else' : null),
    isAlive: (pid) => pid === 8,
    procTable: () => new Map([[8, { ppid: 1, pgrp: 7 }]]),
    kill: (pid, sig) => sent.push([pid, sig]),
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.ok(
    !sent.some(([pid]) => pid < 0),
    `no group signal may be sent without corroboration: ${JSON.stringify(sent)}`,
  );
  assert.ok(!report.reaped.some((r) => r.pid === 8), 'a stranger in a reused group is not ours to reap');
});

test('a FAILED group signal is reported, not discarded', async () => {
  // The group kill is the only signal that can reach a process which joined
  // after the snapshot, so losing its failure is the 5.45 blind spot again.
  const report = await reapAgentRuns([{ dir: '/r/_logs/_agent-a', pid: 7 }], {
    ownRoot: '/r',
    cwdOf: () => '/r',
    procTable: () => new Map([[7, { ppid: 1, pgrp: 7 }]]),
    kill: (pid) => {
      if (pid < 0) throw new Error('EPERM');
    },
    isAlive: () => false,
    graceMs: 20,
    pollMs: 5,
    sleep: async () => {},
  });
  assert.ok(
    report.skipped.some((sk) => /process group 7/.test(sk.reason) && /EPERM/.test(sk.reason)),
    `the group signal's failure must appear in the report: ${JSON.stringify(report)}`,
  );
});

test('two recorded runs in ONE process tree report each pid exactly once', async () => {
  // A single dispatch can write TWO session dirs (the S3 incident did), and
  // 101 is a child of 100. Reporting it as both reaped and skipped is a report
  // that contradicts itself.
  const report = await reapAgentRuns(
    [
      { dir: '/r/_logs/_agent-outer', pid: 100 },
      { dir: '/r/_logs/_agent-inner', pid: 101 },
    ],
    {
      ownRoot: '/r',
      cwdOf: () => '/r',
      procTable: () =>
        new Map([
          [100, { ppid: 1, pgrp: 100 }],
          [101, { ppid: 100, pgrp: 100 }],
        ]),
      kill: () => {},
      isAlive: () => false,
      graceMs: 20,
      pollMs: 5,
      sleep: async () => {},
    },
  );
  const all = [...report.reaped.map((r) => r.pid), ...report.skipped.map((sk) => sk.pid)];
  assert.deepEqual(all.slice().sort((a, b) => a - b), [100, 101], `each pid exactly once: ${JSON.stringify(report)}`);
});

test('the grace period is ONE window for the whole teardown, not one per dispatched run', async () => {
  // Per-run waits make teardown cost runs.length x graceMs inside a `finally`.
  let sleeps = 0;
  await reapAgentRuns(
    [
      { dir: '/r/_logs/_a', pid: 11 },
      { dir: '/r/_logs/_b', pid: 12 },
      { dir: '/r/_logs/_c', pid: 13 },
    ],
    {
      ownRoot: '/r',
      cwdOf: () => '/r',
      procTable: () => new Map(),
      kill: () => {},
      isAlive: () => true, // never dies, so the full window is spent
      graceMs: 40,
      pollMs: 10,
      sleep: async () => {
        sleeps += 1;
      },
    },
  );
  assert.equal(sleeps, 4, 'three runs must still cost exactly one grace window of poll steps');
});

// ------------- 7.6.94: the plant's own instrumentation, as pure functions -----

/**
 * These belong in THIS file rather than beside the control they serve, and the
 * reason is the split's own rule: the controls file spawns, this one decides.
 * `plantDiedMessage` decides what a reader is told, and it is the one part of
 * 7.6.94 that can be driven straight at its inputs — the condition it reports
 * (something killing a `setInterval` child) is not reproducible on demand, so
 * without these the branch would ship unproven.
 */
test('7.6.94: the PLANT DIED message dates the death from the heartbeat', () => {
  const now = Date.parse('2026-09-13T00:00:10.000Z');
  const msg = plantDiedMessage({
    pid: 4242,
    plantedAtMs: now - 3000,
    lastBeatMs: now - 1200,
    nowMs: now,
    artefactDir: '/tmp/story-reap-tree-abc',
  });
  assert.match(msg, /PLANT DIED before the reap: pid 4242/);
  assert.match(msg, /planted 3000 ms earlier/);
  assert.match(msg, /last heartbeat 1200 ms ago, 1800 ms after planting/, 'both ages, so the death is placed against the run AND the plant');
  assert.match(msg, /\/tmp\/story-reap-tree-abc/, 'the kept artefacts are where the post-mortem starts');
});

test('7.6.94: a plant that never wrote a heartbeat says so, rather than printing a bare number', () => {
  const now = Date.now();
  const msg = plantDiedMessage({ pid: 7, plantedAtMs: now - 500, lastBeatMs: null, nowMs: now, artefactDir: '/tmp/x' });
  assert.match(msg, /never wrote a heartbeat/);
  assert.doesNotMatch(msg, /NaN|undefined|null/, 'an absent measurement must not render as a value');
});

test('7.6.94: an unrecorded plant time is reported as unknown, not as zero', () => {
  const now = Date.now();
  const msg = plantDiedMessage({ pid: 7, plantedAtMs: null, lastBeatMs: now - 10, nowMs: now, artefactDir: '/tmp/x' });
  assert.match(msg, /planted an unknown time earlier/);
  assert.doesNotMatch(msg, /planted 0 ms|NaN/, 'a missing record is not an instant plant');
});

/**
 * THE DISCRIMINATOR, and the reason the bead exists. On D's run at `415f1be5`
 * the control blamed the reaper for a kill it never performed. This message must
 * be impossible to read that way — so it carries neither of the other two
 * failures' words, and says outright that nothing was measured.
 */
test('7.6.94: the PLANT DIED message can never be read as the property failing', () => {
  const now = Date.now();
  const msg = plantDiedMessage({ pid: 7, plantedAtMs: now - 100, lastBeatMs: now - 50, nowMs: now, artefactDir: '/tmp/x' });
  assert.match(msg, /MEASURED NOTHING about the reaper/);
  assert.match(msg, /NOT evidence of a reaper defect/);
  for (const claim of ['ESCAPE', 'REPORTING', 'survived the reap', 'must be REPORTED reaped', 'escape is still open']) {
    assert.doesNotMatch(msg, new RegExp(claim), `a dead plant must not print the property's words: "${claim}"`);
  }
});

test('7.6.94: an unreadable or absent plant record reads as UNKNOWN, never as a plant time', () => {
  assert.equal(readPlantRecord(join(tmpdir(), 'no-such-plant-record-7694.json')), null);
  assert.equal(readLastBeat(join(tmpdir(), 'no-such-heartbeat-7694')), null);

  const dir = mkdtempSync(join(tmpdir(), 'plant-record-'));
  writeFileSync(join(dir, 'rec.json'), '{ not json');
  assert.equal(readPlantRecord(join(dir, 'rec.json')), null, 'a corrupt record is absent, not a crash');
  writeFileSync(join(dir, 'rec2.json'), JSON.stringify({ turnPid: 1, grandchildPid: 2 }));
  assert.equal(readPlantRecord(join(dir, 'rec2.json')), null, 'a record with no plantedAtMs cannot date anything');
  writeFileSync(join(dir, 'beat'), 'not-a-number');
  assert.equal(readLastBeat(join(dir, 'beat')), null);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * THE THIRD CASE — bead `forge-8vfn.7.6.94`, found by D on their own gate after
 * the first cut merged.
 *
 * The split shipped two states: the plant dead BEFORE the liveness check
 * (`PLANT DIED`) and the reaper genuinely failing (`REPORTING`). D's red was
 * neither — `plantAlive` true, `alive === false` after so nothing escaped, and the
 * reaper reporting `kill ESRCH` for BOTH planted pids. The plant vanished inside
 * one `reapAgentRuns` call, and the control accused the reaper of losing a kill it
 * never made: this bead's own defect, in a narrower window.
 *
 * Doored here rather than in the controls file for the same reason the rest of
 * `reap-plant.mjs` is: the condition cannot be produced on demand, and a pure
 * function can be driven straight at its inputs.
 */
test('7.6.94: every planted pid ESRCH at the signal is the VANISHED case, not a reaper failure', () => {
  const report = {
    reaped: [],
    skipped: [
      { pid: 1388950, reason: 'pid 1388950: SIGTERM failed: kill ESRCH — the process was already gone' },
      { pid: 1388927, reason: 'pid 1388927: SIGTERM failed: kill ESRCH — the process was already gone' },
    ],
  };
  assert.equal(everyPlantedPidVanished({ pids: [1388927, 1388950], report }), true, 'D\'s exact report');
});

test('7.6.94: ONE surviving signalable pid is NOT the vanished case — that is the reaper\'s to answer', () => {
  const report = {
    reaped: [{ pid: 1388950 }],
    skipped: [{ pid: 1388927, reason: 'pid 1388927: SIGTERM failed: kill ESRCH — the process was already gone' }],
  };
  assert.equal(
    everyPlantedPidVanished({ pids: [1388927, 1388950], report }), false,
    'if the reaper could signal one of them, the run measured something and the reporting assertion stands',
  );
});

test('7.6.94: a skip for a reason OTHER than ESRCH is not a vanishing', () => {
  const report = { reaped: [], skipped: [{ pid: 7, reason: 'pid 7: outside this run\'s tree — not ours to kill' }] };
  assert.equal(everyPlantedPidVanished({ pids: [7], report }), false, 'refused-to-kill and could-not-find are different facts');
});

test('7.6.94: an empty skip list is not a vanishing', () => {
  assert.equal(everyPlantedPidVanished({ pids: [7], report: { reaped: [], skipped: [] } }), false);
  assert.equal(everyPlantedPidVanished({ pids: [7], report: {} }), false, 'a report with no skipped field cannot say anything vanished');
});

test('7.6.94: the VANISHED message blames nothing and keeps the artefacts', () => {
  const now = Date.now();
  const msg = plantVanishedInWindowMessage({ pids: [11, 22], lastBeatMs: now - 340, nowMs: now, artefactDir: '/tmp/story-reap-tree-X' });
  assert.match(msg, /PLANT VANISHED IN THE WINDOW: every planted pid \(11, 22\)/);
  assert.match(msg, /last heartbeat was 340 ms before this line/);
  assert.match(msg, /MEASURED NOTHING about the reaper's reporting/);
  assert.match(msg, /\/tmp\/story-reap-tree-X/);
  for (const claim of ['killed but not REPORTED reaped', 'escape is still open', 'so this is the reaper']) {
    assert.doesNotMatch(msg, new RegExp(claim), `a vanished plant must not print the reaper's words: "${claim}"`);
  }
});

/**
 * THE RETENTION FLAG IS RAISED BEFORE THE ASSERTIONS, and this door exists
 * because a mutation proved nothing else checks it.
 *
 * D lost the heartbeat on the run that most needed it: `keepArtifacts` was set
 * only on the dead-plant path, so a failure in the third case deleted the tree in
 * `t.after`. The fix raises the flag before the assertions and lowers it only by
 * reaching the end of them — but **no door can exercise it**, because no test can
 * make the positive control fail on demand. Deleting the line left all 45 green.
 *
 * So this reads the source, in the same wiring-door pattern as the trailing
 * sweep's delivery seam. It catches DELETION — someone removing or reordering the
 * raise — and not corruption, which is the whole of what M4 showed.
 */
test('7.6.94: the controls file raises keepArtifacts BEFORE the reap, not only on the dead-plant path', () => {
  const src = readFileSync(join(import.meta.dirname, 'reap-controls.test.ts'), 'utf8');
  const raise = src.indexOf('keepArtifacts = true;\n\n  const report = await reapAgentRuns');
  assert.notEqual(raise, -1, 'the flag must be raised immediately before the reap, so any later failure keeps the tree');
  // SEARCHED FROM THE RAISE, because `indexOf` from 0 finds the DECLARATION
  // (`let keepArtifacts = false;`) and that sits above everything — the first
  // draft of this door asserted `lower > raise` against it and failed on correct
  // code. A door that matches the wrong occurrence of its own needle reports the
  // fix as the defect.
  const lower = src.indexOf('keepArtifacts = false;', raise);
  assert.notEqual(lower, -1, 'and lowered after the assertions, so a clean pass still cleans up');
});

/**
 * 7.6.94's memory reading — D's ask, and the reason it is worth two lines: a
 * reading at BOTH ends eliminates OOM if memory is flat, rather than leaving it
 * the comfortable explanation nobody tested. "No evidence" was a fact about our
 * instruments, not about the box.
 */
test('7.6.94: the memory clause reports both ends and the DELTA, because direction is the finding', () => {
  assert.match(memoryClause(5089, 4210), /5089 MiB at the plant -> 4210 MiB now \(-879 MiB\)/);
  assert.match(memoryClause(4000, 4600), /\(\+600 MiB\)/, 'a rise is as much a finding as a fall');
});

test('7.6.94: an unreadable meminfo is UNREADABLE, never zero', () => {
  assert.match(memoryClause(null, 4210), /UNREADABLE at the plant/);
  assert.match(memoryClause(4210, null), /UNREADABLE now/);
  assert.match(memoryClause(null, null), /UNREADABLE at both ends/);
  for (const c of [memoryClause(null, 4210), memoryClause(4210, null), memoryClause(null, null)]) {
    assert.doesNotMatch(c, /\b0 MiB\b/, 'a machine that could not be read is not a machine with no memory free');
  }
  assert.equal(memAvailableMiB('/proc/no-such-root-7694'), null, 'an absent procfs reads null, not 0');

  // TWO WAYS TO FAIL, AND ONLY ONE WAS DOORED. The line above exercises the
  // THROW (no such file); a mutation returning 0 for a meminfo that exists and
  // carries no `MemAvailable:` line survived it, because nothing reached that
  // branch. A readable file without the field is a real shape — a container's
  // procfs, an older kernel — and it must read UNKNOWN like the absent one.
  const proc = mkdtempSync(join(tmpdir(), 'meminfo-'));
  writeFileSync(join(proc, 'meminfo'), 'MemTotal:       16332188 kB\nSwapFree:        11710412 kB\n');
  assert.equal(memAvailableMiB(proc), null, 'a meminfo with no MemAvailable line is UNKNOWN, never 0');
  writeFileSync(join(proc, 'meminfo'), 'MemAvailable:    5242880 kB\n');
  assert.equal(memAvailableMiB(proc), 5120, 'and a real one is read in MiB');
  rmSync(proc, { recursive: true, force: true });
});
