/**
 * Row 187 (forge-8vfn.8.5.23) — a killed run's DETACHED agent turns.
 *
 * Measured (run 4): after a SIGINT to the story runner, S10's architect turn
 * — spawned by the bridge with `detached: true` + `unref()`, its own process
 * group, its pid in `_logs/_architect-<sid>/turn.pid` — outlived both the
 * runner and the bridge and wrote `projects/gitpulse/_architect/<sid>/…` into
 * the REAL ground seven minutes later, after the stop path's capture+clear
 * had already run. And (run 5) the bridge took ~20 s to exit after its group
 * SIGTERM, with the stop path long since "done".
 *
 * ROW 213 (forge-8vfn.8.5.49) — a SECOND detached survivor, `forge serve`
 * itself (`spawnServeDetached`, `packages/flows/daemon.ts`): `detached:
 * true`, `unref()`, its OWN process group, its pid in `_logs/daemon/forge.pid`
 * (`DAEMON_PID_FILE`). A costed run killed mid-S10 left exactly this alive,
 * and it rewrote `_queue/in-flight/<id>.md.heartbeat` for two hours after the
 * stop path had already declared itself done. The stand-in below is a real
 * process for the same reason the architect turn above is one: this path's
 * own ownership and liveness reads are `/proc`-based and cannot be exercised
 * against a mock.
 *
 * ROW 215 (forge-8vfn.8.5.51) — EVERY elapsed-time measurement in this file
 * uses `performance.now()` (monotonic), never `Date.now()` (wall clock): a
 * WSL clock step-back during a long campaign made a `Date.now()`-measured
 * duration go NEGATIVE, which this file's own `took >= 450`-style assertions
 * would then fail on a run that actually behaved correctly.
 *
 * The turn here is the real shape: a node process in its OWN session and
 * group (`setsid`), re-parented away from this test (the `sh` that launched
 * it exits at once), cwd inside the run root, recording its own pid in a
 * `_logs/_architect-*` dir — exactly what `spawnAgentTurn` leaves behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { runStopPath } from './stop-path.mjs';
import { groundManifest } from './ground-hash.mjs';
import { DAEMON_PID_FILE, STOPPING_FILE } from './sweep-teardown-scheduler.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return false;
  }
}

/** A detached turn that writes into the ground `delayMs` after it starts. */
function spawnDetachedTurn(root: string, sid: string, delayMs: number) {
  const logDir = join(root, '_logs', `_architect-${sid}`);
  mkdirSync(logDir, { recursive: true });
  const late = join(root, 'projects', 'ground', '_architect', sid, 'late.md');
  const script =
    `require('fs').writeFileSync(${JSON.stringify(join(logDir, 'turn.pid'))}, process.pid + '\\n');` +
    `setTimeout(() => { require('fs').mkdirSync(require('path').dirname(${JSON.stringify(late)}), { recursive: true });` +
    ` require('fs').writeFileSync(${JSON.stringify(late)}, 'written after the stop'); }, ${delayMs});` +
    'setTimeout(() => {}, 60000);';
  execFileSync('sh', ['-c', `setsid ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} </dev/null >/dev/null 2>&1 &`], { cwd: root });
  return { pidFile: join(logDir, 'turn.pid'), late };
}

// Row 215 (forge-8vfn.8.5.51) — `performance.now()`, never `Date.now()`: a WSL
// clock step-back during a long campaign makes a wall-clock-measured deadline
// go negative mid-wait, which would end this loop instantly (or never) rather
// than actually bounding it at `ms`.
async function waitForFile(path: string, ms = 5_000) {
  const until = performance.now() + ms;
  while (!existsSync(path) && performance.now() < until) await sleep(20);
  assert.ok(existsSync(path), `${path} never appeared`);
}

test('row 187 (RED before the fix): a killed run reaps its story\'s detached turn BEFORE the clear, so the ground ends where it started', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-'));
  mkdirSync(join(root, 'projects', 'ground'), { recursive: true });
  writeFileSync(join(root, 'projects', 'ground', 'README.md'), 'the pinned ground\n');
  const startedMs = Date.now() - 1_000;
  const before = groundManifest(join(root, 'projects', 'ground'));

  const turn = spawnDetachedTurn(root, '2026-10-02T13-00-00-deadbeef', 1_500);
  await waitForFile(turn.pidFile);
  const pid = Number(readFileSync(turn.pidFile, 'utf8').trim());
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  assert.ok(alive(pid));

  let aliveAtClear: boolean | null = null;
  await runStopPath({
    root, startedMs, bridgeProc: null,
    clear: () => { aliveAtClear = alive(pid); },
    log: () => {},
  });

  assert.equal(aliveAtClear, false, 'the turn must be gone BEFORE the capture+clear reads the ground');
  await sleep(2_000); // well past the turn's own 1.5 s write
  assert.equal(existsSync(turn.late), false, 'a reaped turn wrote into the ground after the stop path finished');
  assert.deepEqual(groundManifest(join(root, 'projects', 'ground')), before, 'the ground must equal its start hash');
});

test('row 187: the stop path waits for the bridge group to exit, escalating to SIGKILL past its bound', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-'));
  // A bridge that ignores SIGTERM entirely — its own group, like `forge studio`.
  const bridge = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
    detached: true, stdio: 'ignore',
  });
  bridge.unref();
  t.after(() => { try { process.kill(-(bridge.pid as number), 'SIGKILL'); } catch { /* gone */ } });
  await sleep(300);
  let bridgeAliveAtClear: boolean | null = null;
  // Row 215 — `performance.now()`, never `Date.now()` (see this file's header).
  const began = performance.now();
  const report = await runStopPath({
    root, startedMs: Date.now(), bridgeProc: bridge as never,
    clear: () => { bridgeAliveAtClear = alive(bridge.pid as number); },
    log: () => {},
    bridgeExitBoundMs: 500,
  });
  const took = performance.now() - began;
  assert.equal(bridgeAliveAtClear, false, 'the bridge group must be gone before the stop path declares done');
  assert.ok(took >= 450, `must actually wait out the bound before SIGKILL — took ${took} ms`);
  assert.ok(took < 5_000, `bounded — took ${took} ms`);
  assert.match(JSON.stringify(report), /SIGKILL/);
});

/**
 * A real process standing in for `forge serve`: it writes its OWN pid to
 * `<root>/_logs/daemon/forge.pid` (`DAEMON_PID_FILE`) — exactly where
 * `spawnServeDetached` writes a real daemon's — and then rewrites a heartbeat
 * file every 200 ms, forever, until SIGTERM, when it exits cleanly. `cwd:
 * root` is load-bearing: `stopOwnScheduler`'s own ownership test is "the pid
 * file names a pid whose cwd resolves back to `root`".
 */
function spawnFakeServeDaemon(root: string, heartbeat: string, opts: { onSigterm?: string } = {}) {
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  const pidFile = join(root, DAEMON_PID_FILE);
  const onSigterm = opts.onSigterm ?? "process.on('SIGTERM', () => process.exit(0));";
  const script =
    `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
    `${onSigterm}` +
    `setInterval(() => { try { require('fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 200);`;
  return spawn(process.execPath, ['-e', script], { cwd: root, stdio: 'ignore' });
}

test('row 213 (RED before the fix): a killed run stops the scheduler daemon it started, before the clear — nothing rewrites the queue heartbeat after', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-serve-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '_queue', 'in-flight'), { recursive: true });
  const heartbeat = join(root, '_queue', 'in-flight', 'INIT-2026-10-03-exclude-author-flag.md.heartbeat');
  writeFileSync(heartbeat, '0');

  const daemon = spawnFakeServeDaemon(root, heartbeat);
  t.after(() => { try { process.kill(daemon.pid as number, 'SIGKILL'); } catch { /* gone */ } });
  const pidFile = join(root, DAEMON_PID_FILE);
  await waitForFile(pidFile);
  const daemonPid = Number(readFileSync(pidFile, 'utf8').trim());
  assert.ok(alive(daemonPid), 'the fake daemon must actually be running before the stop path runs');

  const startedMs = Date.now() - 1_000;
  const report = await runStopPath({
    root, startedMs, bridgeProc: null,
    // Stands in for `run.mjs`'s real `clear` — the post-stop sweep removing
    // the queue manifest's heartbeat, and reporting it as cleared so
    // `runStopPath`'s own row 213 re-read can confirm it stays gone.
    clear: () => {
      try { rmSync(heartbeat); } catch { /* already gone */ }
      return { cleared: ['_queue/in-flight/INIT-2026-10-03-exclude-author-flag.md.heartbeat'] };
    },
    log: () => {},
  });

  assert.equal(alive(daemonPid), false, 'the scheduler daemon this run started must be dead after the stop path');
  assert.equal(report.sched?.stopped, daemonPid, 'the pid-file daemon must have been signalled by the stop path');
  // Past the daemon's own 200 ms heartbeat interval AND this path's own
  // re-read settle — a live daemon would have rewritten the heartbeat by now.
  await sleep(600);
  assert.equal(existsSync(heartbeat), false, 'RED: the heartbeat must not reappear once its writer is actually dead');
  assert.deepEqual(report.reappeared, [], 'the stop path\'s own re-read must not have seen it reappear either');
});

test('row 213: a daemon pid file naming an already-dead pid is read, found dead, and never signalled or errored', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-serve-dead-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });

  // A real pid, guaranteed exited before the stop path ever reads it.
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await new Promise((resolve) => dead.once('exit', resolve));
  writeFileSync(join(root, DAEMON_PID_FILE), String(dead.pid));

  const startedMs = Date.now() - 1_000;
  const report = await runStopPath({
    root, startedMs, bridgeProc: null, clear: () => {}, log: () => {},
  });

  assert.equal(report.sched?.stopped, null, 'a dead pid must never read as stopped — there was nothing to stop');
  assert.equal(report.sched?.unknown, false, 'a genuinely gone pid is a known outcome, never UNKNOWN');
  assert.match(String(report.sched?.note), /already gone/);
});

test('row 213: a daemon pid file naming a pid that runs under a DIFFERENT root is never signalled', async (t) => {
  const ownRoot = mkdtempSync(join(tmpdir(), 'stop-path-serve-own-'));
  const foreignRoot = mkdtempSync(join(tmpdir(), 'stop-path-serve-foreign-'));
  t.after(() => { rmSync(ownRoot, { recursive: true, force: true }); rmSync(foreignRoot, { recursive: true, force: true }); });
  mkdirSync(join(ownRoot, '_logs', 'daemon'), { recursive: true });

  // A real, live daemon-shaped process — but its OWN cwd is the FOREIGN root,
  // never ownRoot. ownRoot's own pid file merely NAMES its pid, exactly the
  // shape a stale or hand-edited pid file would be.
  const foreign = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
    cwd: foreignRoot, stdio: 'ignore',
  });
  t.after(() => { try { process.kill(foreign.pid as number, 'SIGKILL'); } catch { /* gone */ } });
  await waitForProcVisible(foreign.pid as number);
  writeFileSync(join(ownRoot, DAEMON_PID_FILE), String(foreign.pid));

  const startedMs = Date.now() - 1_000;
  const report = await runStopPath({
    root: ownRoot, startedMs, bridgeProc: null, clear: () => {}, log: () => {},
  });

  assert.equal(report.sched?.stopped, null, 'a pid that runs under another tree is never ours to stop');
  assert.match(String(report.sched?.note), /not this tree — not ours to stop/);
  assert.ok(alive(foreign.pid as number), 'the foreign process must be completely untouched — never signalled');
});

/** Is `pid` visible in `/proc` at all yet — the kernel accepted the fork. */
async function waitForProcVisible(pid: number, ms = 5_000) {
  const until = performance.now() + ms; // row 215 — monotonic, see this file's header
  while (!existsSync(`/proc/${pid}`) && performance.now() < until) await sleep(10);
  assert.ok(existsSync(`/proc/${pid}`), `pid ${pid} never became visible in /proc`);
}

/**
 * THE DOUBLE-SIGTERM DEFECT, END TO END. `forge studio`'s own supervisor
 * (`apps/forge/serve-supervisor.ts`) marks the scheduler daemon stopping and
 * sends it ONE SIGTERM, synchronously, as part of its own exit sequence
 * (`apps/forge/forge-watch.ts`'s `runExitSequence`) — BEFORE studio itself
 * exits. `scheduler.ts` treats a second SIGTERM as an operator's force-quit
 * (`process.exit(130)`, no drain). The fake studio below runs that SAME
 * sequence for real, against a real stand-in serve that COUNTS the SIGTERMs
 * it actually receives — proving `runStopPath`'s own `stopScheduler` step
 * never sends one of its own once studio's group is confirmed gone.
 */
test('studio-then-serve: the daemon receives studio\'s ONE SIGTERM and none from the stop path itself', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stop-path-studio-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
  const log = join(root, '_logs', 'daemon', 'serve.log');
  writeFileSync(log, '[serve] forever-mode\n');
  const sigCountFile = join(root, 'sigterm-count');
  writeFileSync(sigCountFile, '0');

  // Readiness is a MARKER EACH SCRIPT WRITES ITSELF, as its own last
  // statement, never `/proc/<pid>` visibility alone — T1 1372
  // (`sweep-teardown-plant.mjs`'s own header): a pid is visible in `/proc`
  // the instant the kernel accepts the fork, well before node has loaded and
  // registered a `process.on('SIGTERM', ...)` line. This file's own helper
  // tests already use that shape for `spawnFakeServeDaemon`'s single
  // top-of-script line; this test chains TWO such processes, so the gap a
  // `/proc`-only wait leaves is wider, not narrower.
  const serveReady = join(root, 'serve.ready');
  const studioReady = join(root, 'studio.ready');

  // The stand-in `forge serve`: counts every SIGTERM it actually receives.
  // It only drains on the FIRST one — a second is the real daemon's
  // force-quit shape, which this script deliberately does not implement, so
  // a regression here would kill it uncleanly rather than let the test pass
  // by coincidence.
  const serve = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    let count = 0;
    process.on('SIGTERM', () => {
      count += 1;
      fs.writeFileSync(${JSON.stringify(sigCountFile)}, String(count));
      if (count > 1) return;
      setTimeout(() => {
        fs.appendFileSync(${JSON.stringify(log)}, '[serve] exited cleanly\\n');
        process.exit(0);
      }, 300);
    });
    fs.writeFileSync(${JSON.stringify(serveReady)}, '1');
    setInterval(() => {}, 1000);
  `], { cwd: root, stdio: 'ignore' });
  t.after(() => { try { process.kill(serve.pid as number, 'SIGKILL'); } catch { /* gone */ } });
  writeFileSync(join(root, DAEMON_PID_FILE), String(serve.pid));
  await waitForFile(serveReady);

  // The fake studio: on the group SIGTERM `runStopPath` sends, it waits —
  // standing in for `apps/forge/forge-watch.ts`'s real `shutdown()`, which
  // awaits the UI child's own termination BEFORE `runExitSequence` ever
  // stops the serve supervisor — and only THEN runs the real supervisor's
  // mark-then-signal sequence and exits. The delay is what makes the
  // ordering fix load-bearing rather than an accident of how fast a bare
  // signal handler happens to run: a `stopScheduler` called too early (the
  // OLD position, right after the reap, with no wait for this group to be
  // gone) would run WHILE studio is still mid-shutdown, see no marker yet,
  // and send its own SIGTERM — exactly the double-signal row 213 exists to
  // stop. `runStopPath`'s `bridgeExitBoundMs` below is generous enough to
  // outlast it without widening any OTHER test's own bound.
  const studio = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {
      setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(join(root, STOPPING_FILE))}, String(${serve.pid}));
        try { process.kill(${serve.pid}, 'SIGTERM'); } catch {}
        process.exit(0);
      }, 200);
    });
    fs.writeFileSync(${JSON.stringify(studioReady)}, '1');
    setInterval(() => {}, 1000);
  `], { detached: true, stdio: 'ignore' });
  studio.unref();
  t.after(() => { try { process.kill(-(studio.pid as number), 'SIGKILL'); } catch { /* gone */ } });
  await waitForFile(studioReady);

  const startedMs = Date.now() - 1_000;
  const report = await runStopPath({
    root, startedMs, bridgeProc: studio as never,
    clear: () => {}, log: () => {},
  });

  assert.equal(
    Number(readFileSync(sigCountFile, 'utf8')), 1,
    'the daemon must receive exactly ONE SIGTERM — studio\'s own, never a second one from the stop path',
  );
  assert.equal(report.sched?.stopped, serve.pid);
  assert.equal(report.sched?.drained, true, 'the daemon must be reported as drained, never force-killed by a second signal');
  assert.match(readFileSync(log, 'utf8'), /exited cleanly/);
});
