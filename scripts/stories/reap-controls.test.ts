/**
 * The reaper's REAL-PROCESS controls — split from `reap.test.ts` when 7.6.94's
 * plant instrumentation took that file past the 800-line cap (§0). SPLIT, NEVER
 * BASELINE (492).
 *
 * THE SPLIT IS ON A REAL SEAM, not at a convenient line. Everything left in
 * `reap.test.ts` decides: it injects a `procTable`, a `kill` and an `isAlive` and
 * asserts what `decideReap`/`reapAgentRuns` conclude — pure, fast, deterministic.
 * Everything here SPAWNS: detached turns, re-parenting grandchildren, a foreign
 * look-alike, and a process that leaves its group via `setsid`. Those are the only
 * tests in the file that can be defeated by the host rather than by the code, and
 * 7.6.94 exists because one of them was.
 *
 * Keeping them together makes that property visible: if a test in THIS file goes
 * red under load, the first question is whether its subject survived long enough to
 * be measured. No test in the other file can fail that way.
 *
 * `pricedGraceMs: 50` on every `reapAgentRuns` call below — findings row 62.
 * These real spawns never write an `events.jsonl`, so left at the real 30 s
 * default every one of them would sit out the whole window with a REAL
 * `sleep`, since none injects one: four tests at ~30 s apiece is minutes added
 * to this file alone for a wait none of them is testing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectAgentRuns, reapAgentRuns } from './reap.mjs';
import {
  readPlantRecord, readLastBeat, plantDiedMessage,
  everyPlantedPidVanished, plantVanishedInWindowMessage,
  memAvailableMiB,
} from './reap-plant.mjs';

// ------------------------------------------------- POSITIVE CONTROL (5.45)

/**
 * A POSITIVE CONTROL THAT CANNOT TELL A DEAD PLANT FROM A BROKEN REAPER IS NOT A
 * CONTROL — bead `forge-8vfn.7.6.94`, T1 rulings 937 and 944.
 *
 * WHAT HAPPENED. On D's post-merge run at `415f1be5` this test went red, and the
 * red said the reaper had failed. It had not. `alive === false` PASSED — nothing
 * escaped — and the SECOND assertion fired, because the reaper found both planted
 * pids already gone (`SIGTERM failed: kill ESRCH` twice) and honestly said so. The
 * grandchild is a `setInterval` that cannot exit on its own; something killed it
 * between the plant and the measurement, and the test rendered a vanished SUBJECT
 * as an absent PROPERTY.
 *
 * That is this campaign's recurring species living in the instrument rather than
 * the code: two causes behind one message. Worse than usual, because the message it
 * chose accuses the thing a costed run's teardown depends on — #720's "HALTS with
 * teardown" IS `reapAgentRuns`, so a spurious red here reads as a hole in the money
 * path and a spurious green means only that the plant survived. The control passed
 * for two different reasons and printed one result either way.
 *
 * SO THE PLANT IS CHECKED IMMEDIATELY BEFORE THE REAP. If it is already gone this
 * run measured NOTHING about the reaper, and it says exactly that, in words that
 * cannot be mistaken for the property failing.
 *
 * AND THE PLANT WRITES A HEARTBEAT, so the post-mortem can say WHEN it died rather
 * than only that it was dead. `setInterval(() => {}, 1000)` left nothing behind; the
 * grandchild now stamps a file every 100 ms, so its last stamp dates the death to a
 * tenth of a second and places it against whatever else was on the box. The temp
 * tree is KEPT on that path — the one case where the artefacts are the finding.
 *
 * WHO KILLED IT — ANSWERED (m7-c, T1 ruling 1204): the reaper's own group signal,
 * reported as a skip. See the last test in this file, which makes that window
 * deterministic. The vanished-in-window branch below stays as the guard for a
 * genuinely FOREIGN kill; after the fix, the reaper's own kills never reach it.
 */
test('POSITIVE CONTROL: a re-parenting GRANDCHILD is dead after the reap — the S9 run-3 shape', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-tree-'));
  // Kept when the plant dies before the measurement: on that path the heartbeat
  // file IS the evidence, and deleting it would destroy the only record of when.
  let keepArtifacts = false;
  t.after(() => {
    if (keepArtifacts) return;
    rmSync(root, { recursive: true, force: true });
  });
  const beatPath = join(root, 'plant-heartbeat');
  const recordPath = join(root, 'plant-record.json');
  // Read BEFORE the plant and again at any failure — D's ask. A flat reading
  // ELIMINATES OOM rather than leaving it the untested comfortable explanation;
  // "no evidence" was a fact about our instruments, not about the box.
  const memAtPlantMiB = memAvailableMiB();

  // The dispatch shape, exactly: a detached turn (its own process group, as
  // `spawnAgentTurn` spawns it) which itself spawns the agent. The turn then
  // EXITS, so the agent re-parents and its parent's /proc/<pid>/cwd is gone —
  // the run-3 conditions, reproduced.
  const turn = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const fs = require('node:fs');
       // The grandchild stamps the beat file every 100 ms. Its LAST stamp is the
       // only thing that can date a death nobody witnessed (7.6.94).
       const c = spawn(process.execPath, ['-e',
         "const fs = require('node:fs'); const b = process.env.PLANT_BEAT;" +
         " fs.writeFileSync(b, String(Date.now()));" +
         " setInterval(() => fs.writeFileSync(b, String(Date.now())), 100);"
       ], { cwd: process.cwd(), stdio: 'ignore', env: process.env });
       fs.writeFileSync(process.env.PLANT_RECORD, JSON.stringify({
         turnPid: process.pid, grandchildPid: c.pid, plantedAtMs: Date.now(),
       }));
       console.log(String(c.pid));
       setTimeout(() => process.exit(0), 400);`,
    ],
    {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PLANT_BEAT: beatPath, PLANT_RECORD: recordPath },
    },
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

  // THE PLANT MUST BE ALIVE FOR THIS TO MEASURE ANYTHING (7.6.94). A grandchild
  // that is already gone makes both assertions below unanswerable, and the second
  // one would blame the reaper for a kill it never performed.
  let plantAlive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    plantAlive = false;
  }
  if (!plantAlive) {
    keepArtifacts = true;
    const planted = readPlantRecord(recordPath);
    assert.fail(plantDiedMessage({
      pid: grandchild,
      plantedAtMs: planted === null ? null : planted.plantedAtMs,
      lastBeatMs: readLastBeat(beatPath),
      nowMs: Date.now(),
      artefactDir: root,
      memAtPlantMiB,
      memNowMiB: memAvailableMiB(),
    }));
  }

  // FROM HERE, ANY FAILURE KEEPS THE TREE — D's finding. `keepArtifacts` was set
  // only on the dead-plant path, so the run that most needed the 100 ms heartbeat
  // (the plant alive at the check and gone at the SIGTERM) deleted it in
  // `t.after`. D went looking for it and it was already gone. The evidentiary
  // need is identical in every failing case, so the flag is raised before the
  // assertions and lowered only by reaching the end of them.
  keepArtifacts = true;

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25, pricedGraceMs: 50 });

  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    alive = false;
  }
  // ESCAPE FIRST, REPORTING SECOND, and each message names WHICH property failed —
  // the plant was verified alive a moment ago, so neither can now be a dead-subject
  // artefact (7.6.94).
  assert.equal(
    alive,
    false,
    `ESCAPE: the re-parented grandchild survived the reap — the S9 run-3 escape is still open (the plant was verified ALIVE immediately before the reap, so this is the reaper): ${JSON.stringify(report)}`,
  );
  // THE THIRD CASE, BEFORE THE REPORTING ASSERTION (D, on their gate). Alive at
  // the check, `ESRCH` for every planted pid at the signal: the plant vanished
  // inside one `reapAgentRuns` call. Blaming the reaper for a kill it did not
  // make is this bead's own defect in a narrower window.
  if (everyPlantedPidVanished({ pids: [turn.pid, grandchild], report })) {
    assert.fail(plantVanishedInWindowMessage({
      pids: [turn.pid, grandchild],
      lastBeatMs: readLastBeat(beatPath),
      nowMs: Date.now(),
      artefactDir: root,
      memAtPlantMiB,
      memNowMiB: memAvailableMiB(),
    }));
  }
  assert.ok(
    report.reaped.some((r) => r.pid === grandchild),
    `REPORTING: the grandchild was killed but not REPORTED reaped (the plant was verified ALIVE immediately before the reap, and at least one planted pid was still signalable, so this is the reaper): ${JSON.stringify(report)}`,
  );
  // Every assertion passed, so the tree is residue rather than evidence.
  keepArtifacts = false;
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

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 2000, pollMs: 25, pricedGraceMs: 50 });

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

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25, pricedGraceMs: 50 });

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

// ------------------------------------------- THE REAPER'S OWN GROUP SIGNAL (m7-c)

/**
 * WHO KILLED THE PLANT — the mechanism 7.6.94 left open, found by lane m7-c
 * (2026-09-19, T1 ruling 1204). It was the reaper. Step 4 signals the GROUP
 * first (`kill(-leader)`), then every claimed pid. The re-parented grandchild is
 * a member of that group, so the group signal kills it; when init reaps it before
 * the per-pid SIGTERM lands, that SIGTERM throws ESRCH and the pid was filed as
 * SKIPPED ("already gone, nothing to reap"). Nothing escaped — the report lied
 * about a kill the reaper made. Seen live at load 35 with MemAvailable flat
 * (−41 MiB), which retires the OOM lead.
 *
 * The window is made DETERMINISTIC here rather than waited for under load: the
 * injected `kill` pauses after every GROUP signal, long enough for the kernel to
 * deliver it and init to reap the member, before the per-pid signals run. Before
 * the fix this reports `reaped: []` with both pids skipped ESRCH, every time.
 */
test('the reaper\'s OWN group signal is a reap: a member it killed is REAPED, never skipped as already gone', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-groupsig-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The dispatch shape, as the positive control above: a detached turn (own
  // group) spawns the agent in that group and exits, so the agent re-parents.
  const turn = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100)'], { cwd: process.cwd(), stdio: 'ignore' });
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
  const dir = join(root, '_logs', '_authoring-groupsig');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(turn.pid));
  await new Promise((r) => setTimeout(r, 700));
  process.kill(grandchild, 0); // precondition: the member is alive before the reap (throws if not)

  const pauseAfterGroupSignalMs = 300;
  const kill = (pid, sig) => {
    process.kill(pid, sig);
    if (pid < 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseAfterGroupSignalMs);
  };
  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25, pricedGraceMs: 50, kill });

  let alive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, `precondition of the property: the member is dead after the reap: ${JSON.stringify(report)}`);
  const entry = report.reaped.find((r) => r.pid === grandchild);
  assert.ok(entry, `the member the GROUP signal killed is reaped, not skipped as already gone: ${JSON.stringify(report)}`);
  assert.equal(entry.signal, 'SIGTERM');
  assert.ok(
    !report.skipped.some((s) => s.pid === grandchild),
    `and it is not ALSO listed as skipped: ${JSON.stringify(report.skipped)}`,
  );
  // The turn exited on its own before any signal: THAT pid is honestly "already gone".
  assert.ok(report.skipped.some((s) => s.pid === turn.pid && /already gone/.test(s.reason)), `the turn that exited by itself stays skipped: ${JSON.stringify(report)}`);
});

// ----------------------------------------- T1 1450/1451: a foreign LIVE pid

/**
 * T1 1451's hypothesis, PROVEN OR DISPROVEN against a real process rather
 * than argued from the source. `reap.test.ts`, `reap-marker.test.ts` and
 * `reap-cancelled.test.ts` feed `reapAgentRuns`/`decideReap` hardcoded pid
 * literals (4242, 100/101, 9001, 9101, 7, 1388950…) as a "recorded, gone"
 * dispatch — under suite churn a fixed number CAN be a real, live, foreign
 * process, and `record` provenance exists precisely to signal a pid whose cwd
 * cannot be read. Every one of those call sites was read for this report: all
 * pair the fake pid with an INJECTED `kill`, or never reach `kill` at all
 * (`recordReapedCancellations`, `describeReap`, `plantDiedMessage` are pure
 * report/decision functions with no signal in them). None reaches a real
 * signal on a foreign pid — this test proves WHY, on the real kill path,
 * rather than only by absence of a counter-example.
 *
 * A `sleep 30` this test spawns and owns stands in for "a hardcoded literal
 * that happens to collide with a real host process". `reapAgentRuns` is
 * called with NO `kill` and NO `isAlive`/`cwdOf`/`procTable` — every
 * dependency is the real, default implementation — so this is genuinely the
 * kill path production uses, not a stub of it.
 */
test('T1 1451: a live foreign pid fed to reapAgentRuns as "recorded" — real kill path, cwd containment fires first, it SURVIVES', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-foreign-live-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'story-reap-foreign-live-tree-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  const foreign = spawn('sleep', ['30'], { cwd: elsewhere, stdio: 'ignore', detached: true });
  foreign.unref();
  t.after(() => {
    try { process.kill(foreign.pid, 'SIGKILL'); } catch { /* already gone */ }
  });

  // Fed in exactly as the hardcoded-pid tests do — a bare `{ dir, pid }`, no
  // `collectAgentRuns`, no `turn.pid` ever written to disk — but with no opts
  // beyond `ownRoot`/`graceMs`/`pollMs`/`pricedGraceMs`, so `cwdOf`,
  // `procTable`, `isAlive` and `kill` are ALL the real, default
  // implementations.
  const report = await reapAgentRuns(
    [{ dir: join(root, '_logs', '_agent-fed'), pid: foreign.pid }],
    { ownRoot: root, graceMs: 200, pollMs: 25, pricedGraceMs: 50 },
  );

  let alive = true;
  try {
    process.kill(foreign.pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(
    alive, true,
    `a live foreign pid fed in as "recorded" was signalled — cwd containment did not fire first: ${JSON.stringify(report)}`,
  );
  assert.equal(report.reaped.length, 0, 'nothing may be reported reaped');
  assert.equal(report.skipped.length, 1);
  assert.match(
    report.skipped[0].reason, /outside the run worktree/,
    'refused because its REAL cwd is readable and outside — not merely because it was never dispatched',
  );
});

/**
 * The narrower, more dangerous edge: what if the fed-in pid's cwd cannot be
 * READ at all — the one real-world condition a same-uid spawn can never
 * reproduce (a different owner, or a kernel thread with no userspace cwd),
 * which is also the ONLY gate `record` provenance needs besides `!alive`.
 * `cwdOf` is stubbed unreadable to reach it; `isAlive` is left the REAL
 * default (`process.kill(pid, 0)`), because that is the one question this
 * rung must answer honestly before it may ever fire without a cwd — and for
 * a genuinely live pid, a REAL check never answers it "false".
 */
test('T1 1451: a live foreign pid whose cwd cannot be read is still refused — "record" needs a REAL isAlive() to say false, and it never lies', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-foreign-unreadable-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const foreign = spawn('sleep', ['30'], { cwd: root, stdio: 'ignore', detached: true });
  foreign.unref();
  t.after(() => {
    try { process.kill(foreign.pid, 'SIGKILL'); } catch { /* already gone */ }
  });

  const report = await reapAgentRuns(
    [{ dir: join(root, '_logs', '_agent-fed'), pid: foreign.pid }],
    { ownRoot: root, cwdOf: () => null, graceMs: 200, pollMs: 25, pricedGraceMs: 50 },
  );

  let alive = true;
  try {
    process.kill(foreign.pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(
    alive, true,
    `a live foreign pid with an unreadable cwd was signalled by "record" provenance: ${JSON.stringify(report)}`,
  );
  assert.equal(report.reaped.length, 0);
  assert.match(report.skipped[0].reason, /alive but its cwd is unreadable/, 'the LIVE branch fired, never "record"');
});
