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
 *
 * ROW 166 SUPERSEDES THIS FILE'S OWN "GREEN" CLAIM ABOUT THE CLEAR (below,
 * `T1 1418 DOOR`). A descendant census, however it is rooted, can only prove
 * a SPAWNED writer dead — `scheduler-run-one.ts`'s real heartbeat writer is a
 * `setInterval` inside the daemon's OWN process, no descendant at all, so
 * "the grandchild is confirmed dead" never implied "nothing is still writing
 * this manifest". `claimQueueWrites` (queue-claim.mjs) now never claims an
 * in-flight manifest while its owning scheduler is alive, full stop — the
 * DOOR test below now asserts LEFT, not cleared, while keeping every OTHER
 * thing it always proved (descendant confirmed dead, scheduler survives).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reapCensusAndSweep, stopSchedulerCensusAndRelease } from './sweep-teardown.mjs';
import { ownSchedulerPid } from './sweep-teardown-scheduler.mjs';
import {
  plantDaemonWithGrandchild, plantDaemonAsHeartbeatWriter, plantInitManifest, fastQuiesce, waitForFileToExist,
} from './sweep-teardown-plant.mjs';

const RESIDUE_SH = fileURLToPath(
  new URL('../../.claude/skills/tiered-orchestration/scripts/residue.sh', import.meta.url),
);

/** `residue.sh <root>` exits 1 on ANY non-zero gating item, so this reads its
 *  stdout regardless of exit code rather than letting a NOT CLEAN read throw. */
function runResidue(root: string): string {
  const r = spawnSync(RESIDUE_SH, [root], { encoding: 'utf8' });
  return r.stdout ?? '';
}

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
  // ROW 166 — the descendant census proves the GRANDCHILD dead (below); it
  // proves nothing about the daemon's OWN in-process heartbeat writer, which
  // no descendant census can ever see. The manifest is LEFT, not cleared,
  // for exactly the reason `claimQueueWrites` now states — this door's own
  // grandchild-writer fixture no longer stands in for "nothing is writing
  // this manifest", only for "this ONE spawned writer is dead".
  assert.ok(
    result.sweep.claim.left.some((l) =>
      l.path === join(root, '_queue', 'in-flight', 'INIT-mine.md') && l.state === 'in-flight'),
    `LEFT, because the scheduler that owns it is still alive: ${JSON.stringify(result.sweep.claim)}`,
  );
  assert.equal(
    result.sweep.claim.claimed.length, 0, `nothing claimed: ${JSON.stringify(result.sweep.claim)}`,
  );
  assert.deepEqual(result.reappearedArtefacts, [], `nothing may reappear: ${JSON.stringify(result.lines)}`);
  assert.equal(
    existsSync(heartbeat), true,
    'the heartbeat is left exactly where its live owner could still be writing it (row 166)',
  );

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

/**
 * ROW 166 (S10 run 44, bead `forge-8vfn.8.1.60`) — T1 1418 rooted the census
 * at the scheduler's OWN dispatch DESCENDANTS. That closes a writer running as
 * a spawned grandchild. It cannot close this one: `scheduler-run-one.ts`
 * writes `<manifest>.heartbeat` from a `setInterval` INSIDE THE DAEMON'S OWN
 * PROCESS — no descendant at all — and that pid is the ONE pid
 * `reapCensusAndSweep` deliberately never signals, because it must survive for
 * the next story in the batch. No process census, however it is rooted, can
 * ever prove that writer gone without killing the very process the design
 * requires to stay alive.
 *
 * MEASURED (S10 run 44): 08:26:17.459Z the own-artefacts clear removed
 * `_queue/in-flight/INIT-2026-09-28-coupling-sort-flag.md.heartbeat` and
 * re-read to confirm; 08:26:21Z "S10: green"; 08:26:22.212Z the scheduler's
 * heartbeat writer rewrote it — an orphan that outlived the run.
 *
 * THE FIX NEVER CLAIMS AN IN-FLIGHT MANIFEST WHILE ITS OWNING SCHEDULER IS
 * ALIVE (`queue-claim.mjs`'s own header) — `reapCensusAndSweep` now resolves
 * `schedulerAlive` from the SAME `schedulerPid` it already resolves, so a real
 * caller needs no new argument. The RED door below passes `schedulerAlive:
 * false` explicitly to stand in for the OLD shape while a REAL live scheduler
 * (found by `ownSchedulerPid`, exactly as production would) is running —
 * proving the defect is in the missing writer-check, not in scheduler
 * discovery, which T1 1418 already covers.
 */
test('row 166 RED: with the writer-check off, the clear runs while the scheduler\'s OWN in-process heartbeat writer keeps rewriting it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-writer-red-'));
  const sinceMs = Date.now() - 60_000;
  const heartbeat = plantInitManifest(root, sinceMs);

  // A lone daemon — no grandchild — writing ITS OWN heartbeat, exactly as
  // `scheduler-run-one.ts`'s `setInterval` does for an in-flight cycle.
  await plantDaemonAsHeartbeatWriter(t, root, `
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-writer-red', sinceMs, evidenceDir,
    reapedPids: [], // this run's own reap saw nothing — the scheduler owns the writer, not a dispatch
    schedulerAlive: false, // the OLD, writer-blind shape
    quiesce: fastQuiesce,
    censusBoundMs: 800, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(
    result.census.empty, true, `the OS census sees no descendant at all: ${JSON.stringify(result.census)}`,
  );
  const mineManifest = join(root, '_queue', 'in-flight', 'INIT-mine.md');
  assert.ok(
    result.sweep?.claim.claimed.some((c: { path: string }) => c.path === mineManifest),
    `the writer-blind shape claims the still-live manifest: ${JSON.stringify(result.sweep?.claim)}`,
  );
  // The live writer defeats the clear in one of the same two orders T1 1418
  // measured — cleared then rewritten, or rewritten inside the remove-and-
  // verify window — and either is the defect: a census with nothing to see
  // can never stand in for asking the daemon itself.
  const art = result.sweep?.artefacts;
  const clearedThenBack = art?.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat');
  const defeatedInWindow = art?.unremoved.some((u: { path: string }) => u.path === heartbeat);
  assert.ok(
    clearedThenBack || defeatedInWindow,
    `the clear must have run against the live writer: ${JSON.stringify(result.sweep)}`,
  );
  assert.equal(
    await waitForFileToExist(heartbeat), true,
    'RED: the scheduler\'s own in-process writer outlived the writer-blind clear and rewrote the heartbeat it just cleared',
  );
});

test('row 166 DOOR: reapCensusAndSweep never claims an in-flight manifest while its owning scheduler is alive — the writer never has anything to race', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-writer-green-'));
  const sinceMs = Date.now() - 60_000;
  const heartbeat = plantInitManifest(root, sinceMs);

  const daemon = await plantDaemonAsHeartbeatWriter(t, root, `
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-writer-green', sinceMs, evidenceDir,
    reapedPids: [], // still nothing this run's own reap saw — the SAME S10 shape
    // schedulerAlive omitted — the production default, resolved from
    // ownSchedulerPid(root), which finds this test's own planted daemon
    // exactly as run-story.mjs would.
    quiesce: fastQuiesce,
    censusBoundMs: 800, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(
    result.census.empty, true, `the OS census still sees no descendant: ${JSON.stringify(result.census)}`,
  );
  assert.ok(result.sweep, 'the sweep must have run — the OS census was empty');
  assert.equal(
    result.sweep.claim.claimed.length, 0,
    `GREEN: the still-live manifest must never be claimed: ${JSON.stringify(result.sweep.claim)}`,
  );
  const mineManifest = join(root, '_queue', 'in-flight', 'INIT-mine.md');
  assert.ok(
    result.sweep.claim.left.some((l: { path: string, state: string }) =>
      l.path === mineManifest && l.state === 'in-flight'),
    `LEFT, named, because the scheduler that owns it is alive: ${JSON.stringify(result.sweep.claim.left)}`,
  );
  assert.ok(
    !result.sweep.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat'),
    `GREEN: never cleared, so never had anything for the writer to race: ` +
    `${JSON.stringify(result.sweep.artefacts)}`,
  );
  assert.equal(
    existsSync(heartbeat), true,
    'GREEN: the heartbeat was left exactly where its live owner could still be writing it',
  );
  // THE SCHEDULER ITSELF SURVIVES — this fix never signals it; only what it
  // still owns is left alone.
  assert.doesNotThrow(
    () => process.kill(daemon.pid!, 0), 'the scheduler must stay alive for the next story in the batch',
  );
});

/**
 * ROW 166 FOLLOW-UP, END TO END (bead `forge-8vfn.8.1.60`) — the per-story
 * sweep above LEAVES a deferred initiative while its scheduler is alive; this
 * proves the OTHER half: once that scheduler is confirmed dead, batch-end
 * `stopSchedulerCensusAndRelease` captures and clears exactly what was left —
 * the manifest, its heartbeat, its worktrees AND its dispatch dir — and
 * `.claude/skills/tiered-orchestration/scripts/residue.sh`, the operator's own
 * gate, reads the difference directly rather than this file asserting it on
 * residue.sh's behalf.
 *
 * The daemon here takes NODE'S OWN DEFAULT SIGTERM BEHAVIOUR (exit, no
 * handler installed) — it never prints the drain-done line `stopOwnScheduler`
 * looks for, so `drained` reads `false` exactly as a daemon killed mid-cycle
 * would, landing in the SAME "did not drain" branch the deferred clear runs
 * from. No grandchild is planted: the writer IS the daemon (row 166's whole
 * point), so the pre-signal descendant snapshot is legitimately empty and the
 * census that gates the clear settles on the daemon's own death alone.
 */
test('row 166 END TO END: the per-story sweep leaves a deferred initiative; batch-end captures, clears it, and residue.sh reads clean', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-e2e-deferred-'));
  const sinceMs = Date.now() - 60_000;
  const id = 'INIT-mine';
  const heartbeat = plantInitManifest(root, sinceMs);
  // THE REST OF WHAT AN IN-FLIGHT CYCLE MINTS — `mintedRunArtefactsToClear`'s
  // own shape, the same fixture `sweep.test.ts`'s 7.6.146 door plants.
  mkdirSync(join(root, '_worktrees', id), { recursive: true });
  writeFileSync(join(root, '_worktrees', id, 'marker'), '1');
  mkdirSync(join(root, '_worktrees', 'wi', id), { recursive: true });
  writeFileSync(join(root, '_worktrees', 'wi', id, 'marker'), '1');
  const cycleDir = join(root, '_logs', `2026-09-28T08-26-00_${id}`);
  mkdirSync(cycleDir, { recursive: true });
  writeFileSync(join(cycleDir, 'events.jsonl'), '{}\n');

  const daemon = await plantDaemonAsHeartbeatWriter(t, root, `
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
  `);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // --- PER-STORY: the scheduler is alive, so this deferred initiative is
  // claimed and cleared by NOTHING here.
  const perStory = await reapCensusAndSweep({
    root, storyId: 'S-e2e', sinceMs, evidenceDir: join(root, 'queue-claim'),
    reapedPids: [],
    quiesce: fastQuiesce,
    censusBoundMs: 800, censusPollMs: 20, rereadDelayMs: 150,
  });
  assert.equal(perStory.sweep?.claim.claimed.length, 0, 'nothing claimed while the scheduler is alive');
  assert.equal(existsSync(heartbeat), true, 'heartbeat left');
  assert.equal(existsSync(join(root, '_worktrees', id)), true, 'worktree left');
  assert.equal(existsSync(join(root, '_worktrees', 'wi', id)), true, 'wi worktree left');
  assert.equal(existsSync(cycleDir), true, 'dispatch dir left');

  const beforeResidue = runResidue(root);
  assert.match(
    beforeResidue, /VERDICT NOT CLEAN/, `residue.sh must see the deferred residue: ${beforeResidue}`,
  );

  // --- BATCH END: the daemon is stopped and confirmed dead.
  const stop = await stopSchedulerCensusAndRelease(root, {
    graceMs: 2000, censusBoundMs: 2000, censusPollMs: 20, rereadDelayMs: 150, sinceMs,
  });
  assert.equal(
    stop.sched.drained, false, `no drain-done line from a lone daemon: ${JSON.stringify(stop.sched)}`,
  );
  assert.equal(
    stop.census?.empty, true, `no descendant was ever spawned: ${JSON.stringify(stop.census)}`,
  );
  assert.ok(stop.deferred, `the deferred clear must have run: ${JSON.stringify(stop.lines)}`);
  const manifestPath = join(root, '_queue', 'in-flight', `${id}.md`);
  assert.ok(
    stop.deferred!.claim.claimed.some((c: { path: string }) => c.path === manifestPath),
    `the manifest must be claimed and captured to evidence at batch end: ${JSON.stringify(stop.deferred!.claim)}`,
  );
  const cleared: string[] = stop.deferred!.artefacts.cleared;
  assert.ok(
    cleared.some((p) => p.includes(`${id}.md.heartbeat`)), `heartbeat cleared: ${JSON.stringify(cleared)}`,
  );
  assert.ok(cleared.includes(`_worktrees/${id}`), `worktree cleared: ${JSON.stringify(cleared)}`);
  assert.ok(
    cleared.some((p) => p.endsWith(`_${id}`) && p.startsWith('_logs/')),
    `dispatch dir cleared: ${JSON.stringify(cleared)}`,
  );

  assert.equal(existsSync(heartbeat), false, 'the heartbeat is gone');
  assert.equal(existsSync(join(root, '_worktrees', id)), false, 'the worktree is gone');
  assert.equal(existsSync(cycleDir), false, 'the dispatch dir is gone');
  assert.throws(
    () => process.kill(daemon.pid!, 0), 'the daemon must actually be dead, not merely unwritten-to',
  );

  // NO REAPPEARANCE — the daemon is confirmed dead, not merely quiet for a
  // moment, so a second, later read must still agree with the first.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(
    existsSync(heartbeat), false, 'the heartbeat never comes back once its writer is actually dead',
  );

  const afterResidue = runResidue(root);
  assert.match(
    afterResidue, /VERDICT clean/, `residue.sh must read clean after the batch-end clear: ${afterResidue}`,
  );
});
