/**
 * `sweep-teardown.mjs` — the teardown half of the sweep, tested beside the
 * module it covers.
 *
 * SPLIT, NEVER BASELINE (ruling 492). `sweep.test.ts` reached 802 lines when
 * 689(iii)'s drain tests landed, over the 800-line hard cap. The cut follows
 * the MODULE boundary rather than the line count: everything here exercises
 * `scripts/stories/sweep-teardown.mjs` — `restoreSweptCommitted`,
 * `stopOwnScheduler`, `releaseOwnInFlight` — and nothing here touches the fence
 * or the residue sweep, which stay in `sweep.test.ts` with `sweep.mjs`.
 *
 * THE REAL-PROCESS PLANTS LIVE IN `sweep-teardown-plant.mjs` (T1 1372, same
 * split reason as `reap-plant.mjs`/`reap.test.ts`): this file was at 793/800
 * when a flake needed a real fix rather than a bigger bound, and the plants
 * now do their OWN event-based readiness waiting and OWN cleanup
 * registration — logic that belongs beside the spawning, not repeated at
 * every call site. See that file's header for the incident the split closes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { restoreSweptCommitted, releaseOwnInFlight, stopSchedulerCensusAndRelease, reapCensusAndSweep, teardownExitCode } from './sweep-teardown.mjs';
import { stopOwnScheduler, isRunning, DAEMON_PID_FILE } from './sweep-teardown-scheduler.mjs';
import { sweepProductFixtures } from './sweep.mjs';
import {
  killIfAlive, plantDaemonWithGrandchild, plantReapedRootWithGrandchild,
  plantInFlightClaim, plantInitManifest, fastQuiesce, waitForFileToExist,
  waitForProcVisible, withReady,
} from './sweep-teardown-plant.mjs';

/**
 * The leading sweep's missing paired restore — T1 ruling 594, half 2.
 *
 * `demos/stories/<id>/` is deleted before the bridge boots and rebuilt as beats
 * pass. Any exit between those two points leaves the repo missing committed
 * files, which `git status` then shows as deliberate deletions. Measured on
 * three lanes; the motivating case is a run that **refused at preflight** —
 * the runner doing exactly the right thing — and still lost three committed
 * files.
 */
function repoFixture() {
  const root = mkdtempSync(join(tmpdir(), 'forge-sweep-restore-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 't');
  mkdirSync(join(root, 'demos', 'stories', 'S10', 'frames'), { recursive: true });
  writeFileSync(join(root, 'demos', 'stories', 'S10', 'story.json'), '{"beats":[]}');
  for (const n of ['01', '02', '03']) writeFileSync(join(root, 'demos', 'stories', 'S10', 'frames', `${n}.png`), n);
  run('add', '-A');
  run('commit', '-qm', 'committed artifacts');
  return { root, swept: [join(root, 'demos', 'stories', 'S10')] };
}

test('594(2) RED: an abort after the leading sweep leaves committed files deleted — they come back', () => {
  const { root, swept } = repoFixture();
  rmSync(join(root, 'demos', 'stories', 'S10'), { recursive: true, force: true });

  const { restored, failed } = restoreSweptCommitted(root, swept);

  assert.deepEqual(failed, []);
  assert.equal(restored.length, 4, `all four committed paths return: ${restored.join(', ')}`);
  assert.ok(existsSync(join(root, 'demos', 'stories', 'S10', 'story.json')));
  assert.ok(existsSync(join(root, 'demos', 'stories', 'S10', 'frames', '03.png')));
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    '',
    'and the tree stops lying about what the repo contains',
  );
});

test('594(2) POSITIVE CONTROL: a run that REGENERATED its artifacts keeps them', () => {
  // The condition that makes this safe to run on every exit path. A finished
  // run's artifacts legitimately differ from HEAD; restoring them would destroy
  // the output the run exists to produce.
  const { root, swept } = repoFixture();
  writeFileSync(join(root, 'demos', 'stories', 'S10', 'story.json'), '{"beats":["fresh"]}');

  const { restored } = restoreSweptCommitted(root, swept);

  assert.deepEqual(restored, [], 'nothing was missing, so nothing is touched');
  assert.equal(
    readFileSync(join(root, 'demos', 'stories', 'S10', 'story.json'), 'utf8'),
    '{"beats":["fresh"]}',
    'the run\'s own output survives',
  );
});

test('594(2) POSITIVE CONTROL: a PARTIAL run keeps what it made and recovers what it did not reach', () => {
  // A's shape exactly: killed at beat 6, frames 02-05 modified and 06-11 plus
  // `story.json` deleted. The two halves must be judged per path, not per run.
  const { root, swept } = repoFixture();
  writeFileSync(join(root, 'demos', 'stories', 'S10', 'frames', '01.png'), 'regenerated');
  rmSync(join(root, 'demos', 'stories', 'S10', 'frames', '02.png'));
  rmSync(join(root, 'demos', 'stories', 'S10', 'frames', '03.png'));

  const { restored } = restoreSweptCommitted(root, swept);

  assert.deepEqual(restored, ['demos/stories/S10/frames/02.png', 'demos/stories/S10/frames/03.png']);
  assert.equal(
    readFileSync(join(root, 'demos', 'stories', 'S10', 'frames', '01.png'), 'utf8'),
    'regenerated',
    'what the run DID reach is untouched',
  );
});

test('594(2): an untracked artifact is not resurrected, and nothing outside the tree is reachable', () => {
  const { root, swept } = repoFixture();
  // S10's demo dir has never been committed on some heads; an untracked path
  // that the sweep removed is simply gone, and that is correct.
  mkdirSync(join(root, 'demos', 'stories', 'S11'), { recursive: true });
  const untracked = [join(root, 'demos', 'stories', 'S11')];
  rmSync(join(root, 'demos', 'stories', 'S11'), { recursive: true, force: true });
  assert.deepEqual(restoreSweptCommitted(root, untracked).restored, []);

  // A path outside the run's own worktree is refused before git is asked.
  assert.deepEqual(restoreSweptCommitted(root, ['/etc']).restored, []);
  assert.deepEqual(restoreSweptCommitted(root, [join(root, '..', 'elsewhere')]).restored, []);
  assert.deepEqual(restoreSweptCommitted(root, swept).restored, []);
});

/**
 * Stopping the scheduler the run started — T1 ruling 657(ii), bought by S10
 * run 9, where beat 7 pressed Start, a real daemon came up, and it was still
 * alive after the sweep.
 *
 * A scheduler left running is not cosmetic: `scheduler-start` renders ONLY at
 * `status: stopped` (`lib/scheduler-view.ts:44`), so the next run's beat 7 reds
 * at t+0 on a missing handle while the state it wants already holds.
 */
test('657(ii): the pid file path is the PRODUCT\'s, bound by this test', async () => {
  // `run.mjs` is plain node and cannot import the TypeScript, so the path is
  // written once in `sweep.mjs` and bound here — the same shape as
  // `STALL_CEILING_MS`. I looked for `_logs/.scheduler.pid` after run 9 and
  // reported a product gap that did not exist; a path written from memory is
  // the same class as a fixture written from memory.
  const { daemonPaths } = await import('../../packages/flows/daemon.ts');
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  assert.equal(join(root, DAEMON_PID_FILE), daemonPaths(root).pidFile);
});

test('657(ii): a daemon in ANOTHER tree is never ours to stop', () => {
  // `pkill -f` has matched the searcher's own shell three times this campaign.
  // The cwd check is why this signals nothing it does not own — and the pid
  // used here is THIS process, which is alive and demonstrably not in the
  // fixture tree, so the refusal is about ownership rather than liveness.
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  writeFileSync(join(root, DAEMON_PID_FILE), String(process.pid));

  const r = stopOwnScheduler(root);

  assert.equal(r.stopped, null, 'it must not signal a process it does not own');
  assert.match(r.note ?? '', /not this tree/, r.note ?? '');
  assert.doesNotThrow(() => process.kill(process.pid, 0), 'and this process is still alive, which is the point');
});

test('657(ii): no pid file is silence, not an error', () => {
  // A run whose beat 7 never pressed Start started no daemon. The sweep must
  // say nothing rather than invent a failure.
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  // `drained` joined the shape in 689(iii): every caller now has to distinguish
  // "the daemon released its claim" from "the daemon is gone", and a run that
  // started none did neither. `unknown` joined it at ROW 102b/18: a genuine
  // ENOENT (no pid file at all) is `unknown: false`, unlike an unreadable one.
  assert.deepEqual(stopOwnScheduler(root), { stopped: null, how: null, drained: false, unknown: false, note: null });
});

test('657(ii): a pid file holding nonsense says so instead of signalling', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  writeFileSync(join(root, DAEMON_PID_FILE), 'not-a-pid');

  const r = stopOwnScheduler(root);
  assert.equal(r.stopped, null);
  assert.match(r.note ?? '', /not a pid/, r.note ?? '');
});

test('657(ii): a dead pid is reported as gone, never as a kill', () => {
  // The distinction the log has to preserve: "I stopped it" and "it had already
  // exited" are different facts, and a sweep that says the first about the
  // second is the kind of claim this campaign keeps having to retract.
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  // A pid that is real in shape and certainly not running.
  writeFileSync(join(root, DAEMON_PID_FILE), '999999');

  const r = stopOwnScheduler(root);
  assert.equal(r.stopped, null);
  assert.match(r.note ?? '', /already gone/, r.note ?? '');
});

/**
 * T1 1372's third repro (RP's second load-repro pass, 1/20 red): a REAL
 * PRODUCT DEFECT, not a test artifact — `isRunning`'s old shape treated ANY
 * `/proc/<pid>/stat` read failure as "gone", the same conflation MUST 3
 * closed in the census one call site over. Under load, `stopOwnScheduler`
 * reported `how: 'SIGTERM'` at 192ms into a 300ms grace for a daemon whose
 * own SIGTERM-ignoring handler had already been confirmed installed (via the
 * kernel's own `SigCgt` record) before the signal was even sent — the only
 * way to reach that conclusion is a transient, non-ENOENT read failure on a
 * pid that was still genuinely alive, read as if it had exited.
 */
test('isRunning: ENOENT means gone', () => {
  assert.equal(isRunning('999999', '/no-such-proc-root-for-this-test'), false);
});

test('isRunning: MUST-3-class fix — a read failure OTHER than ENOENT is never read as "exited"', () => {
  // A real EACCES via chmodSync — the one failure mode a fixture cannot fake
  // (Linux enforces it for the owning user too), the same technique
  // reap-census.test.ts uses for the identical class of door.
  const root = mkdtempSync(join(tmpdir(), 'forge-isrunning-proc-'));
  mkdirSync(join(root, '12345'));
  writeFileSync(join(root, '12345', 'stat'), '12345 (fixture) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  chmodSync(join(root, '12345', 'stat'), 0o000);
  try {
    assert.equal(
      isRunning('12345', root), true,
      'an unreadable-for-a-reason-other-than-ENOENT pid must be treated as still running, never concluded exited',
    );
  } finally {
    chmodSync(join(root, '12345', 'stat'), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * RP's own review of the row-75 load repro asked this explicitly: does
 * `isRunning` treat state `Z` (zombie — exited, not yet reaped) AND `X`
 * (dead — a state `man proc` calls "should never be seen", but a starved
 * host can stretch the window a read actually lands in) as not running? It
 * must, and only a fixture can prove `X` at all — a real process passes
 * through it far too fast to plant deliberately.
 */
test('isRunning: fixture states Z (zombie) and X (dead) both read as not running', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isrunning-states-'));
  try {
    for (const [pid, state] of [['111', 'Z'], ['222', 'X']] as const) {
      mkdirSync(join(root, pid));
      writeFileSync(join(root, pid, 'stat'), `${pid} (fixture) ${state} 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42`);
      assert.equal(isRunning(pid, root), false, `state ${state} must read as not running`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isRunning: a real, live process reads as running', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isrunning-real-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    assert.equal(isRunning(String(child.pid)), true);
  } finally {
    killIfAlive(child.pid!);
    rmSync(root, { recursive: true, force: true });
  }
});

test('689(iii): a daemon that DRAINS is waited for, and never killed', async () => {
  // MEASURED, NOT ARGUED. S10 run 10's `serve.log` ends:
  //   [serve] received SIGTERM — draining 1 in-flight cycle(s); send SIGTERM again to force-quit
  //   [serve] waiting on 1 in-flight cycle(s) before exit…
  // and then the sweep's SIGKILL landed 4 seconds later, mid-drain. The daemon
  // was already doing the right thing — `scheduler.ts:298-301` awaits every
  // in-flight cycle and prints `[serve] exited cleanly` — and we cut it off, so
  // it never released its claim and `_queue/in-flight/` kept a manifest with a
  // heartbeat that would never advance. That residue reds the NEXT run at a beat
  // that has nothing to do with the code under test.
  //
  // The child here is a real process in the fixture tree (the `cwd` check is
  // load-bearing, so a fake pid would not exercise it) that traps SIGTERM,
  // takes longer than the old 4-second window, writes the product's own
  // completion line, and exits.
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  const log = join(root, '_logs', 'daemon', 'serve.log');
  writeFileSync(log, '[serve] forever-mode\n');
  const ready = join(root, 'daemon.ready');
  const child = spawn(process.execPath, ['-e', withReady(`
    process.on('SIGTERM', () => {
      setTimeout(() => {
        require('node:fs').appendFileSync(${JSON.stringify(log)}, '[serve] exited cleanly\\n');
        process.exit(0);
      }, 600);
    });
    setInterval(() => {}, 1000);
  `, ready)], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(child.pid));
  // Wait on the script's own marker, not a fixed sleep or /proc's SigCgt bit
  // (T1 1372) — see sweep-teardown-plant.mjs's header for why both of those
  // were tried and found unreliable.
  await waitForFileToExist(ready);

  const r = stopOwnScheduler(root, 10_000);

  assert.equal(r.stopped, child.pid);
  assert.equal(r.how, 'SIGTERM', `it must not escalate to SIGKILL on a daemon that is draining: ${r.note}`);
  assert.equal(r.drained, true, 'and it must SAY the drain completed, not merely that the process is gone');
  assert.match(readFileSync(log, 'utf8'), /exited cleanly/);
});

test('689(iii): a daemon that ignores SIGTERM is still killed, and the note says it did not drain', async () => {
  // The other half. A bounded wait that never escalates is a hang, and a
  // teardown that hangs is how a funded run's tree is left holding the run-lock.
  const root = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  writeFileSync(join(root, '_logs', 'daemon', 'serve.log'), '[serve] forever-mode\n');
  const ready = join(root, 'daemon.ready');
  const child = spawn(process.execPath, ['-e', withReady(`
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `, ready)], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(child.pid));
  // Wait on the script's own marker, not the clock — see the DRAIN test above.
  await waitForFileToExist(ready);

  const r = stopOwnScheduler(root, 700);

  assert.equal(r.stopped, child.pid);
  assert.equal(r.how, 'SIGKILL');
  assert.equal(r.drained, false, 'a killed daemon did not release its claim, and the sweep needs to know');
  assert.match(r.note ?? '', /did not drain/, r.note ?? '');
});

test('689(iii) fallback: an in-flight manifest naming THIS tree is released, and one naming another tree is not', () => {
  // The fallback for a daemon that could not drain. S10 run 10's SIGKILL left
  // `INIT-…-exclude-author-filter-flag.md` in `_queue/in-flight/` with a
  // heartbeat frozen at the instant of the kill; the next run would have found
  // `start-work-develop` disabled — "nothing is ready to start (blocked,
  // running, or done)" — and red at a beat with nothing to do with its code.
  //
  // ATTRIBUTED, NEVER A PATTERN OR A WINDOW. The manifest names the tree it was
  // minted for in `project_repo_path`, so ownership is read from the artifact
  // rather than guessed from mtime — a concurrent lane's manifest in a shared
  // queue must survive, and a time window cannot tell the two apart.
  const root = mkdtempSync(join(tmpdir(), 'forge-queue-'));
  const inFlight = join(root, '_queue', 'in-flight');
  mkdirSync(inFlight, { recursive: true });
  writeFileSync(join(inFlight, 'INIT-mine.md'), `---\nproject_repo_path: ${root}/projects/gitpulse\n---\n`);
  writeFileSync(join(inFlight, 'INIT-mine.md.heartbeat'), '2026-09-11T07:53:27.192Z');
  writeFileSync(join(inFlight, 'INIT-theirs.md'), '---\nproject_repo_path: /home/parso/forge-m6-a/projects/gitweave\n---\n');
  writeFileSync(join(inFlight, '.gitkeep'), '');

  const r = releaseOwnInFlight(root);

  assert.deepEqual(r.released.sort(), ['INIT-mine.md', 'INIT-mine.md.heartbeat'], 'the heartbeat goes with its manifest');
  assert.equal(existsSync(join(inFlight, 'INIT-theirs.md')), true, "another tree's claim is not ours to release");
  assert.equal(existsSync(join(inFlight, '.gitkeep')), true, 'and the directory keeps its marker');
  assert.equal(existsSync(join(inFlight, 'INIT-mine.md')), false);
});

test('689(iii) fallback: no in-flight dir, or nothing of ours in it, is silence', () => {
  const bare = mkdtempSync(join(tmpdir(), 'forge-queue-'));
  assert.deepEqual(releaseOwnInFlight(bare), { released: [], failed: [] });

  const root = mkdtempSync(join(tmpdir(), 'forge-queue-'));
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(join(root, '_queue', 'in-flight', 'INIT-theirs.md'), '---\nproject_repo_path: /elsewhere/projects/x\n---\n');
  assert.deepEqual(releaseOwnInFlight(root), { released: [], failed: [] });
});

/**
 * Finding row 75 (T1 rulings 1258, 1332) — `stopOwnScheduler` signals ONLY the
 * recorded daemon pid, and `spawnAgentTurn` spawns its dispatches `detached:
 * true` (reap.mjs's header), so a phase agent the daemon started is its OWN
 * process group and outlives a daemon killed before it drained. Measured: a
 * heartbeat written back 13s after a runner printed CLEARED, a loop still
 * committing into the ground 2.7 minutes later. `stopSchedulerCensusAndRelease`
 * closes this by snapshotting the daemon's descendants BEFORE any signal (the
 * same reap.mjs 5.45 lesson: once the daemon exits, the kernel reparents its
 * children as part of that exit, so a walk mounted afterwards can no longer
 * find them under it), killing them directly, censusing, and only THEN
 * releasing the queue claim — with a re-read after, because the census cannot
 * see a writer outside the daemon's own tree.
 *
 * Every planted process is cleaned up in `t.after` in the SAME test (T3 rule 9).
 */

test('finding row 75 RED: the OLD sequence releases the claim while a detached grandchild is still rewriting the heartbeat', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-census-red-'));
  const ralphPidFile = join(root, 'ralph.pid');
  const { heartbeat } = plantInFlightClaim(root);

  // `plantDaemonWithGrandchild` registers cleanup for BOTH pids itself —
  // BEFORE its own readiness wait runs, so a wait that times out under load
  // still cleans up what it spawned (T3 rule 9) — and, by event (the
  // kernel's own SigCgt record), confirms both the daemon's and the
  // grandchild's SIGTERM handlers are installed before returning: no fixed
  // sleep needed here (T1 1372). KILL HOOKS REGISTERED BEFORE THE DIRECTORY
  // REMOVAL, and that order is load-bearing, not cosmetic: node:test runs
  // `t.after` hooks in the order they were REGISTERED, so this call's own
  // cleanup (registered inside it) precedes the rmSync below.
  const daemon = await plantDaemonWithGrandchild(t, root, `
    process.on('SIGTERM', () => {}); // ignored — this is the writer that must be force-killed
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The OLD sequence, exactly as `run.mjs` ran it before this fix: stop, then
  // release, with nothing in between confirming the grandchild is gone.
  const sched = stopOwnScheduler(root, 300);
  assert.equal(sched.how, 'SIGKILL', 'the daemon ignores SIGTERM and must be force-killed');
  assert.equal(sched.drained, false);
  const rel = releaseOwnInFlight(root);
  assert.ok(rel.released.includes('INIT-mine.md.heartbeat'), 'the old code reports it released');

  assert.equal(
    await waitForFileToExist(heartbeat), true,
    'RED: the grandchild the daemon spawned outlived it and rewrote the heartbeat the old sequence just released',
  );
});

test('finding row 75 DOOR: stopSchedulerCensusAndRelease kills the grandchild, censuses empty, and the release HOLDS', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-census-green-'));
  const ralphPidFile = join(root, 'ralph.pid');
  const { heartbeat } = plantInFlightClaim(root);

  // Cleanup for both pids is registered inside the plant call, before rmSync
  // — see the RED test above for why that order matters.
  const daemon = await plantDaemonWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await stopSchedulerCensusAndRelease(root, { graceMs: 300, censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 150 });

  assert.equal(result.sched.how, 'SIGKILL');
  assert.equal(result.sched.drained, false);
  assert.equal(result.census?.empty, true, `census must settle: ${JSON.stringify(result.census)}`);
  assert.ok(result.release?.released.includes('INIT-mine.md.heartbeat'));
  assert.deepEqual(result.release?.reappeared, [], `nothing may reappear: ${JSON.stringify(result.lines)}`);
  assert.equal(existsSync(heartbeat), false, 'GREEN: the heartbeat stayed cleared — the writer was dead before the release ran');

  const ralphPid = Number(readFileSync(ralphPidFile, 'utf8'));
  assert.throws(() => process.kill(ralphPid, 0), 'the grandchild must actually be dead, not merely unwritten-to');
});

test('finding row 75 DOOR (second): a writer OUTSIDE the daemon\'s tree is invisible to the census and caught only by the re-read', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-census-sibling-'));
  const { heartbeat } = plantInFlightClaim(root);

  // A daemon with NO grandchild — the census over its own tree settles empty
  // immediately. The sibling below is spawned directly by the TEST, sharing no
  // ancestry with the daemon at all: exactly "a process writing the same path"
  // that never descended from the run root.
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  const daemonReady = join(root, 'daemon.ready');
  const daemon = spawn(process.execPath, ['-e', withReady(`
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `, daemonReady)], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(daemon.pid));
  t.after(() => killIfAlive(daemon.pid!));

  const sibling = spawn(process.execPath, ['-e', `
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, 'sibling'); } catch {} }, 20);
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  // Kill before rmSync — see the RED test above for why the order matters.
  t.after(() => killIfAlive(sibling.pid!));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Wait on the script's own marker, not the clock (T1 1372) — the daemon's
  // own SIGTERM handler having actually run, and the sibling genuinely
  // visible in /proc.
  await waitForFileToExist(daemonReady);
  await waitForProcVisible(sibling.pid!);

  const result = await stopSchedulerCensusAndRelease(root, { graceMs: 300, censusBoundMs: 2000, censusPollMs: 20, rereadDelayMs: 150 });

  assert.equal(result.census?.empty, true, 'the census is legitimately empty — the sibling is not in the daemon\'s tree');
  assert.ok(result.release?.released.includes('INIT-mine.md.heartbeat'), 'the release itself still ran');
  assert.ok(
    (result.release?.reappeared ?? []).includes('INIT-mine.md.heartbeat'),
    `the re-read must catch what the census could not: ${JSON.stringify(result.lines)}`,
  );
  assert.ok(
    result.lines.some((l: string) => /RELEASE DID NOT HOLD/.test(l)),
    'never a silent CLEARED for a path that came back',
  );
});

test('finding row 75 DOOR (third): a TERM-respecting grandchild exits within the bound — no escalation needed', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-census-term-'));
  const ralphPidFile = join(root, 'ralph.pid');
  const cleanExitMarker = join(root, 'clean-exit.marker');
  const { heartbeat } = plantInFlightClaim(root);

  // Cleanup for both pids is registered inside the plant call, before rmSync
  // — see the RED test above for why that order matters.
  const daemon = await plantDaemonWithGrandchild(t, root, `
    process.on('SIGTERM', () => {
      require('node:fs').writeFileSync(${JSON.stringify(cleanExitMarker)}, 'clean');
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await stopSchedulerCensusAndRelease(root, { graceMs: 300, censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 100 });

  assert.equal(result.census?.empty, true);
  assert.ok(result.census!.waitedMs < 1500, `a TERM-respecting child must not consume the full bound: waited ${result.census!.waitedMs} ms`);
  assert.equal(existsSync(cleanExitMarker), true, 'the grandchild exited on its own SIGTERM handler, never SIGKILLed');
  assert.equal(existsSync(heartbeat), false);
});

/**
 * Finding row 75's SECOND half (T1 rulings 1258, 1332) — the story's own
 * trailing sweep (`run-story.mjs`: `reapAgentRuns` → `quiesceWriters` →
 * `sweepProductFixtures`) had the identical shape: `quiesceWriters` only ever
 * PRINTED whether the tree settled, and the clear ran regardless. This is the
 * ralph-loop evidence row 75 actually came through — a develop cycle's phase
 * agent, dispatched the way `spawnAgentTurn` dispatches everything (detached,
 * its own process group), outliving `reapAgentRuns`'s own kill and rewriting
 * `_queue/in-flight/<init>.md.heartbeat` after this runner had already printed
 * CLEARED. `reapCensusAndSweep` gates `sweepProductFixtures` on a fresh census
 * of every reaped pid's descendants, exactly like `stopSchedulerCensusAndRelease`
 * gates the scheduler's release.
 */

test('finding row 75 (agent half) RED: the OLD sequence (sweepProductFixtures alone) leaves a heartbeat a live grandchild keeps rewriting', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-red-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {}); // ignored — this is the writer that must be force-killed
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // The OLD sequence: `quiesceWriters` only prints, and the trailing sweep
  // ran regardless of what it found. Standing in for that here with the sweep
  // call alone, exactly as run-story.mjs made it before this fix.
  const evidenceDir = join(root, 'queue-claim');
  const sweep = sweepProductFixtures('S-red', root, { sinceMs, evidenceDir });
  assert.ok(sweep.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat'), `must have cleared it: ${JSON.stringify(sweep)}`);

  assert.equal(
    await waitForFileToExist(heartbeat), true,
    'RED: the grandchild outlived reapAgentRuns and rewrote the heartbeat the old sequence just cleared',
  );
});

test('finding row 75 (agent half) DOOR: reapCensusAndSweep kills the grandchild, censuses empty, and the clear HOLDS', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-green-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-green', sinceMs, evidenceDir,
    reapedPids: [parent.pid],
    quiesce: fastQuiesce,
    censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(result.census.empty, true, `census must settle: ${JSON.stringify(result.census)}`);
  assert.ok(result.sweep, 'the sweep must have run — census was empty');
  assert.ok(result.sweep.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat'));
  assert.deepEqual(result.reappearedArtefacts, [], `nothing may reappear: ${JSON.stringify(result.lines)}`);
  assert.equal(existsSync(heartbeat), false, 'GREEN: the heartbeat stayed cleared — the writer was dead before the clear ran');

  const ralphPid = Number(readFileSync(ralphPidFile, 'utf8'));
  assert.throws(() => process.kill(ralphPid, 0), 'the grandchild must actually be dead');
  assert.throws(() => process.kill(parent.pid!, 0), 'and the reaped root too');
});

/**
 * D's review of #906, MUST 2, doored AT THE ORCHESTRATION LEVEL (not only in
 * `reap-census.test.ts`'s `verifiedKill` unit and real-process doors): a pid
 * `descendantsOf` finds in the pre-signal snapshot, but that CANNOT be
 * identified (no readable `stat` — the fixture below never creates one for
 * it, standing in for a pid already recycled or gone the instant the
 * snapshot was taken) must never reach the injected `kill` at all. This is
 * the exact wiring the review asked to see proven, not merely the shared
 * primitive underneath it.
 */
test('finding row 75 (agent half) DOOR: MUST 2 — a snapshotted descendant with no verifiable identity is never signalled', async (t) => {
  const procRoot = mkdtempSync(join(tmpdir(), 'reap-census-must2-proc-'));
  // The root (100) gets a real, matching identity — it must remain a
  // legitimate, usable census root so the test proves the ONE unidentifiable
  // descendant is skipped, not that the whole census gave up.
  mkdirSync(join(procRoot, '100'));
  writeFileSync(join(procRoot, '100', 'stat'), '100 (root) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  // pid 555 is what `descendantsOf` finds via the mocked table below, but it
  // has NO stat file here at all — `identifyPid` reads it as `startTime:
  // null`, standing in for a pid this run can no longer verify as its own.
  t.after(() => rmSync(procRoot, { recursive: true, force: true }));

  const sent: Array<[number, string]> = [];
  const result = await reapCensusAndSweep({
    root: '/does-not-matter', storyId: 'S-must2', sinceMs: Date.now(), evidenceDir: '/does-not-matter',
    reapedPids: [100],
    quiesce: async () => ({ pids: { gone: [], alive: [], waitedMs: 0, timedOut: false }, tree: { quiet: true, waitedMs: 0, timedOut: false, reads: 1 }, settled: true }),
    sweep: () => ({ removed: [], failed: [], claim: { claimed: [] }, artefacts: { cleared: [] }, lines: [] }),
    procTable: () => new Map([[100, { ppid: 1, pgrp: 100 }], [555, { ppid: 100, pgrp: 100 }]]),
    kill: (pid: number, sig: string) => { sent.push([pid, sig]); },
    listPids: () => ['100'], // 555 is not even alive — the point is it must never be SIGNALLED, not that it survives
    procRoot,
    censusBoundMs: 200, censusPollMs: 20,
  });

  assert.ok(!sent.some(([pid]) => String(pid) === '555'), `pid 555 must never be signalled without a verified identity: ${JSON.stringify(sent)}`);
  assert.ok(
    result.lines.some((l: string) => /555.*no longer the recorded process/.test(l)),
    `the refusal must be named: ${JSON.stringify(result.lines)}`,
  );
});

test('finding row 75 (agent half) DOOR (second): a writer OUTSIDE this run\'s dispatch tree recreates a cleared artefact — caught only by the re-read', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-sibling-'));
  const sinceMs = Date.now() - 60_000;
  const heartbeat = plantInitManifest(root, sinceMs);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // No planted root at all — `reapedPids` is empty, so the census is
  // vacuously empty immediately. The sibling below shares no ancestry with
  // anything this run dispatched, exactly the shape the census cannot see.
  const sibling = spawn(process.execPath, ['-e', `
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, 'sibling'); } catch {} }, 20);
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  t.after(() => killIfAlive(sibling.pid!));
  await waitForProcVisible(sibling.pid!); // wait on the event, not the clock (T1 1372)

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-sibling', sinceMs, evidenceDir,
    reapedPids: [],
    censusBoundMs: 2000, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(result.census.empty, true, 'legitimately empty — this run dispatched nothing');
  // The sibling writes every 20ms, racing the IMMEDIATE capture-then-verify
  // inside `captureAndClearMintedRunArtefacts` itself (rmSync then a same-
  // tick existsSync — no JS-level gap, but under heavy contention the OS can
  // still preempt this process between those two syscalls and let the
  // sibling's own write land in between). Both outcomes of that race are
  // SAFE and are asserted on here, per T1 1372 ("assert on outcome, not
  // timing"): either the immediate check already caught the sibling (never
  // counted as cleared at all, reported unremoved on the spot), or it looked
  // clear for an instant and the LATER, DELAYED re-read below catches it.
  // What must never happen, either way, is a silent, uncontested CLEARED —
  // asserted last, regardless of which path was taken.
  const cleared = result.sweep?.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat') ?? false;
  const unremoved = (result.sweep?.artefacts.unremoved ?? []).some((u: { path: string }) => u.path.endsWith('INIT-mine.md.heartbeat'));
  assert.ok(cleared || unremoved, `the sibling must be caught one way or the other: ${JSON.stringify(result.sweep?.artefacts)}`);
  if (cleared) {
    assert.ok(
      result.reappearedArtefacts.includes('_queue/in-flight/INIT-mine.md.heartbeat'),
      `cleared immediately, so the re-read must catch the sibling's next write: ${JSON.stringify(result.lines)}`,
    );
  }
  assert.ok(
    result.lines.some((l: string) => /ARTEFACT CLEAR DID NOT HOLD/.test(l) || /NOT REMOVED|still present after removal/.test(l)),
    `never a silent CLEARED for a path a live writer outside the census still holds: ${JSON.stringify(result.lines)}`,
  );
});

test('finding row 75 (agent half) DOOR (third): a TERM-respecting grandchild exits within the bound — no escalation needed', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-term-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const cleanExitMarker = join(root, 'clean-exit.marker');
  const heartbeat = plantInitManifest(root, sinceMs);

  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {
      require('node:fs').writeFileSync(${JSON.stringify(cleanExitMarker)}, 'clean');
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-term', sinceMs, evidenceDir,
    reapedPids: [parent.pid],
    quiesce: fastQuiesce,
    censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 100,
  });

  assert.equal(result.census.empty, true);
  assert.ok(result.census.waitedMs < 1500, `a TERM-respecting child must not consume the full bound: waited ${result.census.waitedMs} ms`);
  assert.equal(existsSync(cleanExitMarker), true, 'the grandchild exited on its own SIGTERM handler, never SIGKILLed');
  assert.equal(existsSync(heartbeat), false);
});

test('finding row 75 (agent half): a non-empty census refuses the sweep entirely — nothing is cleared, nothing is claimed', async (t) => {
  // A pure unit check, fully injected: `procTable`/`kill`/`listPids` never
  // touch the real /proc or a real process at all — pid 999 is fabricated and
  // `listPids` reports it alive on every call, so the census can never settle.
  // MUST 2 (D's review): a root now needs a MATCHING recorded identity to be
  // usable at all, so the fixture procRoot gives 999 a real `stat` — the same
  // shape `identifyPid` reads at snapshot time and `verifiedKill` re-reads
  // before any signal — kept static across every call in this test so the
  // identity always matches and 999 survives for the full bound on its own
  // ground, not because its identity could not be verified at all.
  const procRoot = mkdtempSync(join(tmpdir(), 'reap-census-refuse-proc-'));
  mkdirSync(join(procRoot, '999'));
  writeFileSync(join(procRoot, '999', 'stat'), '999 (fixture) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  t.after(() => rmSync(procRoot, { recursive: true, force: true }));

  let sweepCalled = false;
  const killed: Array<[number, string]> = [];
  const result = await reapCensusAndSweep({
    root: '/does-not-matter', storyId: 'S-refuse', sinceMs: Date.now(), evidenceDir: '/does-not-matter',
    reapedPids: [999],
    quiesce: async () => ({ pids: { gone: [], alive: [], waitedMs: 0, timedOut: false }, tree: { quiet: true, waitedMs: 0, timedOut: false, reads: 1 }, settled: true }),
    sweep: () => { sweepCalled = true; return { removed: [], failed: [], claim: { claimed: [] }, artefacts: { cleared: [] }, lines: [] }; },
    procTable: () => new Map([[999, { ppid: 1, pgrp: 999 }]]),
    kill: (pid: number, sig: string) => { killed.push([pid, sig]); },
    listPids: () => ['999'],
    procRoot,
    censusBoundMs: 100, censusPollMs: 20,
  });

  assert.equal(result.census.empty, false);
  assert.equal(result.sweep, null);
  assert.equal(sweepCalled, false, 'the clear must never run when the census could not settle');
  assert.ok(result.lines.some((l: string) => /REFUSING to run the trailing sweep/.test(l)));
  assert.ok(
    killed.some(([pid, sig]) => String(pid) === '999' && sig === 'SIGKILL'),
    // census.survivors comes from the (mocked) live listing, which reports
    // pids as strings — the escalation must still reach it regardless.
    `the survivor must still have been escalated to SIGKILL: ${JSON.stringify(killed)}`,
  );
});

/**
 * MUST 1 (D's review of #906) — `run.mjs`'s `finally` called
 * `stopSchedulerCensusAndRelease`, printed its lines, and never read
 * `stop.census`/`stop.release.reappeared` again: a surviving daemon
 * grandchild printed "REFUSING to release…" or "RELEASE DID NOT HOLD…" and
 * the process still exited 0 on an otherwise-green run. `teardownExitCode`
 * is the SEAM the review asked for — a pure fold of a `stop` result into the
 * run's exit code, injectable directly (no need to drive `main()` itself,
 * which boots a real bridge and browser and cannot be unit-tested at all).
 */
test('teardownExitCode: a clean teardown leaves the exit code exactly as it was', () => {
  const clean = { census: { empty: true, survivors: [], waitedMs: 0, reason: 'census-empty' }, release: { released: [], failed: [], reappeared: [] } };
  assert.deepEqual(teardownExitCode(0, clean), { exitCode: 0, lines: [] });
  assert.deepEqual(teardownExitCode(1, clean), { exitCode: 1, lines: [] }, 'a story\'s own red must survive a clean teardown unchanged');
});

test('teardownExitCode: census === null (no daemon, or it drained) is not a failure', () => {
  assert.deepEqual(teardownExitCode(0, { census: null, release: null }), { exitCode: 0, lines: [] });
});

test('teardownExitCode: MUST 1 RED->GREEN — a census that never settled forces the exit code non-zero, named', () => {
  const stuck = { census: { empty: false, survivors: ['4242'], waitedMs: 5000, reason: 'pid(s) 4242 still alive after 5000 ms' }, release: null };
  const r = teardownExitCode(0, stuck);
  assert.equal(r.exitCode, 1, 'an otherwise-green run must not exit 0 on a teardown that never confirmed empty');
  assert.ok(r.lines.some((l) => /TEARDOWN FAILURE/.test(l) && /4242/.test(l)));
});

test('teardownExitCode: a reappeared release path forces the exit code non-zero, named', () => {
  const reappeared = { census: { empty: true, survivors: [], waitedMs: 10, reason: 'census-empty' }, release: { released: ['INIT-x.md.heartbeat'], failed: [], reappeared: ['INIT-x.md.heartbeat'] } };
  const r = teardownExitCode(0, reappeared);
  assert.equal(r.exitCode, 1);
  assert.ok(r.lines.some((l) => /TEARDOWN FAILURE/.test(l) && /INIT-x\.md\.heartbeat/.test(l)));
});

test('teardownExitCode: an already-red exit code is never reset or overridden by a teardown failure', () => {
  const stuck = { census: { empty: false, survivors: ['1'], waitedMs: 5000, reason: 'stuck' }, release: null };
  assert.equal(teardownExitCode(1, stuck).exitCode, 1);
  assert.equal(teardownExitCode(2, stuck).exitCode, 2, 'a specific non-zero code is preserved, not flattened to 1');
});

test('teardownExitCode: both failures at once still produce ONE forced non-zero code, both named', () => {
  const both = {
    census: { empty: false, survivors: ['1'], waitedMs: 5000, reason: 'stuck' },
    release: { released: ['x'], failed: [], reappeared: ['x'] },
  };
  const r = teardownExitCode(0, both);
  assert.equal(r.exitCode, 1);
  assert.equal(r.lines.length, 2);
});
