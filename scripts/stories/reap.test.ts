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

import { collectAgentRuns, decideReap, describeReap, descendantsOf, reapAgentRuns } from './reap.mjs';

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

// ------------------------------------------------- POSITIVE CONTROL (5.45)

test('POSITIVE CONTROL: a re-parenting GRANDCHILD is dead after the reap — the S9 run-3 shape', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-tree-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The dispatch shape, exactly: a detached turn (its own process group, as
  // `spawnAgentTurn` spawns it) which itself spawns the agent. The turn then
  // EXITS, so the agent re-parents and its parent's /proc/<pid>/cwd is gone —
  // the run-3 conditions, reproduced.
  const turn = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: process.cwd(), stdio: 'ignore' });
       console.log(String(c.pid));
       setTimeout(() => process.exit(0), 400);`,
    ],
    { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const grandchild = await new Promise((resolve) => {
    let buf = '';
    turn.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) resolve(Number.parseInt(buf.trim(), 10));
    });
  });
  t.after(() => {
    for (const pid of [turn.pid, grandchild]) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already reaped, which is the point */
      }
    }
  });

  const dir = join(root, '_logs', '_authoring-planted');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(turn.pid));

  // Let the turn exit, so the reaper meets a DYING parent with an unreadable
  // cwd — the exact condition that produced "unknown provenance" in run 3.
  await new Promise((r) => setTimeout(r, 700));

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25 });

  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    alive = false;
  }
  assert.equal(
    alive,
    false,
    `the re-parented grandchild survived the reap — the S9 run-3 escape is still open: ${JSON.stringify(report)}`,
  );
  assert.ok(
    report.reaped.some((r) => r.pid === grandchild),
    `the grandchild must be REPORTED reaped, not killed silently: ${JSON.stringify(report)}`,
  );
});

// ------------------------------------------------- NEGATIVE CONTROL (5.45)

test('NEGATIVE CONTROL: a foreign process with the SAME NAME as a dispatched agent survives', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-foreign-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'story-reap-foreign-tree-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  // Identical argv to the planted probe above, run by someone else, in someone
  // else's tree, and never recorded by this run. Nothing about a NAME may
  // admit it (COMMON §15.17), and it is not a descendant of anything we own.
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: elsewhere,
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(foreign.pid, 'SIGKILL');
    } catch {
      /* fine */
    }
  });

  // A real, claimable dispatch alongside it, so the reaper actually runs.
  const ours = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(ours.pid, 'SIGKILL');
    } catch {
      /* already reaped */
    }
  });
  const dir = join(root, '_logs', '_authoring-ours');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(ours.pid));

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 2000, pollMs: 25 });

  await new Promise((r) => setTimeout(r, 150));
  let foreignAlive = true;
  try {
    process.kill(foreign.pid, 0);
  } catch {
    foreignAlive = false;
  }
  assert.equal(foreignAlive, true, 'a same-named foreign process was killed — the reaper has become a pattern kill');
  assert.ok(
    report.reaped.some((r) => r.pid === ours.pid),
    'our own dispatch must still be reaped',
  );
  assert.ok(
    !report.reaped.some((r) => r.pid === foreign.pid),
    'the foreign pid must not even appear in the reaped report',
  );
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

// ----- POSITIVE CONTROL: the DESCENDANT WALK specifically, not the group -----

test('POSITIVE CONTROL: a grandchild that left the group via setsid is reaped by the ppid walk alone', async (t) => {
  // The earlier grandchild control is reaped by the GROUP sweep, so it would
  // still pass with the descendant walk deleted. This one can only be reached
  // by ancestry: the grandchild leads its OWN group (detached) and its cwd is
  // OUTSIDE the run root, so neither the group sweep nor any cwd rule finds
  // it. Its parent stays alive, so the ppid chain holds.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-walk-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'story-reap-walk-out-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  const turn = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
         cwd: ${JSON.stringify(elsewhere)}, stdio: 'ignore', detached: true });
       c.unref();
       console.log(String(c.pid));
       setInterval(() => {}, 1000);`,
    ],
    { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const grandchild = await new Promise((resolve) => {
    let buf = '';
    turn.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) resolve(Number.parseInt(buf.trim(), 10));
    });
  });
  t.after(() => {
    for (const pid of [turn.pid, grandchild]) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already reaped, which is the point */
      }
    }
  });

  const dir = join(root, '_logs', '_authoring-walk');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(turn.pid));

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25 });

  const entry = report.reaped.find((r) => r.pid === grandchild);
  assert.ok(entry, `the grandchild must be reaped: ${JSON.stringify(report)}`);
  assert.equal(entry.via, 'descendant', 'and by ANCESTRY — the group sweep cannot reach its own group');

  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, 'a setsid grandchild survived — the descendant walk is not doing its job');
});
