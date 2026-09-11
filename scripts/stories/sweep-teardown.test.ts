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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { restoreSweptCommitted, stopOwnScheduler, releaseOwnInFlight, DAEMON_PID_FILE } from './sweep-teardown.mjs';

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
  // started none did neither.
  assert.deepEqual(stopOwnScheduler(root), { stopped: null, how: null, drained: false, note: null });
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
  const child = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => {
      setTimeout(() => {
        require('node:fs').appendFileSync(${JSON.stringify(log)}, '[serve] exited cleanly\\n');
        process.exit(0);
      }, 600);
    });
    setInterval(() => {}, 1000);
  `], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(child.pid));
  await new Promise((r) => setTimeout(r, 200)); // let the handler install

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
  const child = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, DAEMON_PID_FILE), String(child.pid));
  await new Promise((r) => setTimeout(r, 200));

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
