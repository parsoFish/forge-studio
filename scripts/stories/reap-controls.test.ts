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
 * WHO KILLS IT REMAINS OPEN on the bead. OOM under three concurrent suites is a
 * candidate with no evidence; a sibling's reap sweeping planted pids is another.
 * 35/35 twice at loadavg 9.2 and 12.7 bounds the rate and says nothing about the
 * mechanism (§15.508) — which is why this change buys a better red rather than
 * claiming a cause.
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
    }));
  }

  // FROM HERE, ANY FAILURE KEEPS THE TREE — D's finding. `keepArtifacts` was set
  // only on the dead-plant path, so the run that most needed the 100 ms heartbeat
  // (the plant alive at the check and gone at the SIGTERM) deleted it in
  // `t.after`. D went looking for it and it was already gone. The evidentiary
  // need is identical in every failing case, so the flag is raised before the
  // assertions and lowered only by reaching the end of them.
  keepArtifacts = true;

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25 });

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
