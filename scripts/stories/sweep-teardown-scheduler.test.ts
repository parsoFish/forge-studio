/**
 * sweep-teardown-scheduler.test.ts — T1 1418: the claim clear ran before the
 * SCHEDULER's dispatch was dead.
 *
 * SPLIT FROM `sweep-teardown.test.ts` AT THE CAP (SPLIT, NEVER BASELINE,
 * ruling 492 — the same reason `sweep-teardown-plant.mjs` split from this
 * file's own tests): that file sits at 795/800, five lines from the ceiling,
 * with no room for a new door. This one exercises `reapCensusAndSweep`'s
 * SCHEDULER-rooted census — a new root, not a new function — so it imports
 * the same module and the same real-process plants rather than repeating
 * either.
 *
 * MEASURED IN S10 RUN 24. At 13:31:18 the trailing census logged
 * "census-empty — no run root was recorded" — `reap.reaped` was empty,
 * because S10's agents are dispatched by the SCHEDULER, not the runner, so
 * `reapedPids` never named them. The queue-claim clear then ran; the
 * scheduler rewrote `_queue/in-flight/<id>.md.heartbeat` at :25; `run.mjs`
 * stopped the scheduler only at :54 (batch end). The clear ran nine seconds
 * before the writer it was clearing after was dead.
 *
 * THE FIX ROOTS THE SAME CENSUS AT THE SCHEDULER'S OWN DISPATCH DESCENDANTS
 * — never the scheduler pid itself, which must survive for the next story in
 * the batch (`run.mjs` stops it at batch end, unchanged). `reapCensusAndSweep`
 * now defaults its `schedulerPid` parameter to `ownSchedulerPid(root)` — the
 * same pid-file ownership test `stopOwnScheduler` already applies, PLUS an
 * argv check (review finding 2, below) — so a real caller in `run-story.mjs`
 * needs no new argument at all; the door below drives that same default. The
 * RED test passes `schedulerPid: null` explicitly, standing in for the OLD,
 * scheduler-blind shape.
 *
 * REVIEW FINDING 2 (below): `ownSchedulerPid` used to trust pid-file plus
 * `cwd === root` alone. A recycled pid whose new, unrelated owner happens to
 * share `root` as its `cwd` — any other process this SAME run spawned —
 * would pass that test and seed this census with a stranger's descendant
 * tree. `ownSchedulerPid` now also requires the pid's own argv to carry the
 * two tokens `spawnServeDetached` (`packages/flows/daemon.ts`) actually
 * spawns a daemon with; an impostor that only shares `cwd` returns `null`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reapCensusAndSweep } from './sweep-teardown.mjs';
import { ownSchedulerPid } from './sweep-teardown-scheduler.mjs';
import { plantDaemonWithGrandchild, plantInitManifest, fastQuiesce, waitForFileToExist } from './sweep-teardown-plant.mjs';

test('T1 1418 RED: with no scheduler root, the clear runs while the scheduler\'s own dispatched grandchild keeps rewriting the heartbeat', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-sched-census-red-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  // A real scheduler daemon (DAEMON_PID_FILE) whose grandchild — its own
  // dispatch, exactly like a develop cycle's phase agent — outlives it and
  // keeps rewriting the queue-claim heartbeat. Cleanup for both pids is
  // registered inside the plant call, before rmSync (order load-bearing —
  // see sweep-teardown.test.ts's RED test for why).
  const daemon = await plantDaemonWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-sched-red', sinceMs, evidenceDir,
    reapedPids: [], // T1 1418 — this run's own reap saw nothing; the scheduler dispatched it
    schedulerPid: null, // the OLD, scheduler-blind shape
    quiesce: fastQuiesce,
    censusBoundMs: 800, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(result.census.reason, 'census-empty — no run root was recorded, so there is nothing to confirm');
  // The live writer defeats the clear in one of two orders, and both ARE the
  // defect: the sweep removes the heartbeat and the writer recreates it
  // (cleared, then back — WSL), or the writer recreates it inside the sweep's
  // own remove-and-verify window (unremoved, "still present after removal" —
  // measured on the GitHub runner, PR #936 CI). Either way the clear ran
  // against a writer the scheduler-blind census never saw.
  const art = result.sweep?.artefacts;
  const clearedThenBack = art?.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat');
  const defeatedInWindow = art?.unremoved.some((u) => u.path === heartbeat && /still present after removal/.test(u.reason));
  assert.ok(clearedThenBack || defeatedInWindow, `the clear must have run against the live writer: ${JSON.stringify(result.sweep)}`);
  assert.equal(
    await waitForFileToExist(heartbeat), true,
    'RED: the scheduler\'s own grandchild outlived the scheduler-blind census and rewrote the heartbeat it just cleared',
  );
});

test('T1 1418 DOOR: reapCensusAndSweep roots its census at the scheduler\'s OWN dispatch descendants — killed, census-empty precedes the clear, and the scheduler itself survives', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-sched-census-green-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  const daemon = await plantDaemonWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-sched-green', sinceMs, evidenceDir,
    reapedPids: [], // still nothing this run's own reap saw — the SAME S10 shape
    // schedulerPid omitted — the production default, ownSchedulerPid(root),
    // finds this test's own planted daemon exactly as run-story.mjs would.
    quiesce: fastQuiesce,
    censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(result.census.empty, true, `census must settle: ${JSON.stringify(result.census)}`);
  assert.notEqual(
    result.census.reason, 'census-empty — no run root was recorded, so there is nothing to confirm',
    'must have actually found and censused the scheduler\'s own descendant, not trivially passed on an empty root list',
  );
  assert.ok(result.sweep, 'the sweep must have run — census was empty');
  assert.ok(result.sweep.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat'));
  assert.deepEqual(result.reappearedArtefacts, [], `nothing may reappear: ${JSON.stringify(result.lines)}`);
  assert.equal(existsSync(heartbeat), false, 'GREEN: the heartbeat stayed cleared — the scheduler\'s grandchild was dead before the clear ran');

  const ralphPid = Number(readFileSync(ralphPidFile, 'utf8'));
  assert.throws(() => process.kill(ralphPid, 0), 'the scheduler\'s dispatched grandchild must actually be dead');
  // THE SCHEDULER ITSELF SURVIVES — only its dispatch descendants are
  // censused and killed here; run.mjs stops the scheduler at batch end.
  assert.doesNotThrow(() => process.kill(daemon.pid!, 0), 'the scheduler must stay alive for the next story in the batch');
});

test('review finding 2 RED: a pid with the right cwd but the WRONG argv is not the daemon — ownSchedulerPid refuses it and its child survives the census', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-sched-impostor-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  // Same externally-observable shape as the legit plant above — a real pid
  // in DAEMON_PID_FILE, cwd === root, a live detached grandchild rewriting
  // the heartbeat — except its argv carries neither of spawnServeDetached's
  // own [cli.ts, serve] tokens: an impostor, never the daemon.
  const impostor = await plantDaemonWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile, { daemonArgv: ['/not/a/real/cli.ts', 'not-serve'] });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(ownSchedulerPid(root), null, 'cwd matches, but the argv does not — never trusted as the scheduler');

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-sched-impostor', sinceMs, evidenceDir,
    reapedPids: [], // this run's own reap saw nothing either — the impostor is the only pid anywhere
    // schedulerPid omitted — must default to ownSchedulerPid(root), which is null here.
    quiesce: fastQuiesce,
    censusBoundMs: 800, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(result.census.reason, 'census-empty — no run root was recorded, so there is nothing to confirm');
  const ralphPid = Number(readFileSync(ralphPidFile, 'utf8'));
  assert.doesNotThrow(
    () => process.kill(ralphPid, 0),
    'the impostor\'s child must SURVIVE — ownSchedulerPid correctly refused to vouch for a process it does not own',
  );
  assert.doesNotThrow(() => process.kill(impostor.pid!, 0), 'the impostor itself is untouched too — reapCensusAndSweep never signalled it');
});
