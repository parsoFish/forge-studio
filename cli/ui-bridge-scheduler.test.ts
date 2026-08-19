/**
 * Tests for the bridge scheduler-lifecycle routes — M7-5 (ADR-031).
 *
 * POST /api/scheduler/start was reworked to call the shared
 * `spawnServeDetached` helper directly instead of shelling out to the
 * (now-deleted) `forge start` CLI command. These tests pin the route's
 * contract WITHOUT launching a real `forge serve` daemon (cli.ts chdir's to
 * the install root, so a real spawn would touch the live queue):
 *
 *   - when a live daemon already exists, the route reports `alreadyRunning`
 *     and does NOT spawn (the helper's null-return branch),
 *   - GET /api/scheduler/status mirrors the on-disk pid-file state,
 *   - POST /api/scheduler/pause + /resume toggle the `.paused` flag directly
 *     (these already called the shared helper; we guard against regression).
 *
 * Started against a temp forgeRoot with `port: 0`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { startBridge } from './ui-bridge.ts';
import { writePidFile, clearPidFile, daemonPaths, isPaused, setPaused, pausedFlagPath, markStopping } from '../orchestrator/daemon.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-sched-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue'), { recursive: true });
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/scheduler/start reports alreadyRunning for a live daemon (no spawn)', async () => {
  // Seed our own (alive) pid as the daemon so spawnServeDetached short-circuits
  // to its null branch — the route must NOT launch a second process.
  writePidFile(forgeRoot, process.pid);
  const res = await fetch(`${url}/api/scheduler/start`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; alreadyRunning?: boolean; started?: boolean; state: { running: boolean; pid: number | null } };
  assert.equal(body.ok, true);
  assert.equal(body.alreadyRunning, true, 'should report alreadyRunning, not started');
  assert.notEqual(body.started, true);
  assert.equal(body.state.running, true);
  assert.equal(body.state.pid, process.pid);
});

test('GET /api/scheduler/status mirrors the on-disk pid-file state', async () => {
  // (pid-file from the previous test still records our live pid.)
  const res = await fetch(`${url}/api/scheduler/status`);
  assert.equal(res.status, 200);
  const state = (await res.json()) as { running: boolean; pid: number | null; paused: boolean };
  assert.equal(state.running, true);
  assert.equal(state.pid, process.pid);
});

test('POST /api/scheduler/pause + /resume toggle the .paused flag', async () => {
  const queueRoot = join(forgeRoot, '_queue');
  const pauseRes = await fetch(`${url}/api/scheduler/pause`, { method: 'POST', headers: CSRF });
  assert.equal(pauseRes.status, 200);
  assert.equal(isPaused(queueRoot), true, 'pause should write the .paused flag');
  assert.equal(existsSync(pausedFlagPath(queueRoot)), true);

  const resumeRes = await fetch(`${url}/api/scheduler/resume`, { method: 'POST', headers: CSRF });
  assert.equal(resumeRes.status, 200);
  assert.equal(isPaused(queueRoot), false, 'resume should clear the .paused flag');
});

test('scheduler state-changing routes reject requests without the CSRF header', async () => {
  const res = await fetch(`${url}/api/scheduler/pause`, { method: 'POST' });
  assert.equal(res.status, 403, 'missing x-forge-csrf must be rejected');
});

test('the daemon pid-file lives at _logs/daemon/forge.pid under forgeRoot', () => {
  // Sanity: the route and helper agree on the pid-file location the UI polls.
  assert.equal(daemonPaths(forgeRoot).pidFile, join(forgeRoot, '_logs', 'daemon', 'forge.pid'));
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (A3-05): Start keeps the card's promise. `.paused` is a queue
// flag independent of process liveness, so pause → stop → Start used to bring
// the daemon back with the stale flag still armed: the ONLY offered action
// promised "queued work will run" and the scheduler's poll loop refused every
// claim. Start clears the pause flag — before the spawn attempt, so both the
// fresh-spawn and the alreadyRunning branch report `paused:false`.
// ---------------------------------------------------------------------------

test('POST /api/scheduler/start clears a stale .paused flag on a FRESH spawn (pause → stop → start must actually claim work)', async () => {
  const queueRoot = join(forgeRoot, '_queue');
  // No live daemon (the pid file is reaped/absent), so the route takes its
  // fresh-spawn branch. `spawnServeDetached` launches `node
  // --experimental-strip-types <forgeRoot>/orchestrator/cli.ts serve`, which
  // does not exist under this temp root — the child exits immediately, which
  // is exactly what we want: the SPAWN BRANCH runs (that's what's under test)
  // without a real scheduler ever claiming from the live queue.
  clearPidFile(forgeRoot);
  setPaused(true, queueRoot, 'stale flag from an earlier pause');
  assert.equal(isPaused(queueRoot), true, 'precondition: paused');

  const res = await fetch(`${url}/api/scheduler/start`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; started?: boolean; alreadyRunning?: boolean; state: { paused: boolean } };
  assert.equal(body.ok, true);
  assert.equal(body.started, true, 'precondition: this is the fresh-spawn branch');
  assert.equal(body.state.paused, false, 'the returned state reports the flag cleared');
  assert.equal(isPaused(queueRoot), false, 'the artifact: .paused is gone from disk');
  assert.equal(existsSync(pausedFlagPath(queueRoot)), false);
  clearPidFile(forgeRoot);
});

// W7-FIX-A3 (round-2 finding 4): Start is not Resume. Clearing `.paused`
// BEFORE the already-running check meant a Start clicked from a stale tab (one
// whose 10s poll still showed "stopped") silently un-paused a daemon another
// tab had deliberately paused — a queue-wide state change from a button whose
// only claimed effect is "start the process that is not running".
test('POST /api/scheduler/start on an ALREADY-RUNNING daemon leaves .paused armed (Start is not Resume)', async () => {
  const queueRoot = join(forgeRoot, '_queue');
  // Our own live pid stands in for the daemon (no spawn — the route reports
  // alreadyRunning), paused on purpose by another tab.
  writePidFile(forgeRoot, process.pid);
  await fetch(`${url}/api/scheduler/pause`, { method: 'POST', headers: CSRF });
  assert.equal(isPaused(queueRoot), true, 'precondition: paused');

  const res = await fetch(`${url}/api/scheduler/start`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; alreadyRunning?: boolean; state: { running: boolean; paused: boolean } };
  assert.equal(body.alreadyRunning, true, 'precondition: this is the already-running branch');
  assert.equal(isPaused(queueRoot), true, 'the deliberate pause survives — Resume is the control that clears it');
  assert.equal(body.state.paused, true, 'the reported state is the REAL one');

  // Leave the queue unpaused for the tests below.
  await fetch(`${url}/api/scheduler/resume`, { method: 'POST', headers: CSRF });
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (A3-07): Stop is not a silent control. The daemon keeps its pid
// alive while it drains in-flight cycles after SIGTERM, so a plain liveness
// poll read "running" for the whole drain. The stop route marks the pid it
// signalled; `GET /api/scheduler/status` reports `stopping:true` for as long
// as that pid is alive — any poller (a second tab, a reload) sees the honest
// transitional state, not just the tab that clicked.
// ---------------------------------------------------------------------------

/**
 * A stand-in daemon that TRAPS SIGTERM and stays alive (the drain window), so
 * the route's SIGTERM does not kill it and the pid stays alive.
 *
 * W7-FIX-A3 (round-2 finding 10): READINESS AND EXIT ARE SIGNALLED, never
 * slept on. The child prints `ready` only AFTER its SIGTERM trap is installed
 * (a fixed 300ms sleep raced a loaded runner: a slow boot meant the route's
 * SIGTERM hit the default handler and killed it, failing `running:true`), and
 * teardown awaits the real `exit` event (a fixed 200ms sleep raced libuv's
 * reap: `process.kill(pid, 0)` still succeeded, failing `running:false`).
 */
async function startTrappedChild(): Promise<{ pid: number; kill: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  assert.ok(typeof child.pid === 'number');
  const pid = child.pid as number;
  const exited = once(child, 'exit');
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) {
        child.stdout?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('stand-in daemon exited before signalling ready')));
  });
  return {
    pid,
    kill: async () => {
      child.kill('SIGKILL');
      await exited;
    },
  };
}

test('POST /api/scheduler/stop → stopping:true, and GET /status keeps reporting stopping while the signalled pid drains', async () => {
  const child = await startTrappedChild();
  try {
    writePidFile(forgeRoot, child.pid);

    const res = await fetch(`${url}/api/scheduler/stop`, { method: 'POST', headers: CSRF });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; stopping?: boolean; state: { running: boolean; stopping?: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.stopping, true);
    assert.equal(body.state.running, true, 'the pid is still alive — draining');
    assert.equal(body.state.stopping, true, 'the state itself carries the transitional flag');

    // Any poller sees it — not just the response to the click.
    const status = (await (await fetch(`${url}/api/scheduler/status`)).json()) as { running: boolean; stopping?: boolean };
    assert.equal(status.running, true);
    assert.equal(status.stopping, true);
  } finally {
    await child.kill();
  }
  // Once the pid is gone the daemon is plainly stopped — never "stopping".
  const after = (await (await fetch(`${url}/api/scheduler/status`)).json()) as { running: boolean; stopping?: boolean };
  assert.equal(after.running, false);
  assert.equal(after.stopping, false);
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 3): Stop is IDEMPOTENT while a pid drains. The
// scheduler's own signal handler treats a SECOND SIGTERM as force-quit
// (`orchestrator/scheduler.ts` onSignal: signalCount === 2 → process.exit),
// so a second Stop — from another tab, or from one whose 10s poll had not yet
// flipped to `stopping` — hard-killed the in-flight cycles the first Stop was
// politely draining. The marker the route already writes is the fact that
// makes the second click a no-op.
// ---------------------------------------------------------------------------

test('POST /api/scheduler/stop on an already-stopping pid does NOT re-signal (a second SIGTERM force-quits in-flight cycles)', async () => {
  const child = await startTrappedChild();
  try {
    writePidFile(forgeRoot, child.pid);
    const first = (await (await fetch(`${url}/api/scheduler/stop`, { method: 'POST', headers: CSRF })).json()) as {
      ok: boolean; stopping?: boolean; alreadyStopping?: boolean;
    };
    assert.equal(first.stopping, true, 'precondition: the first Stop signalled the pid');
    assert.notEqual(first.alreadyStopping, true);

    // The second click: same live, already-marked pid.
    const res = await fetch(`${url}/api/scheduler/stop`, { method: 'POST', headers: CSRF });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; alreadyStopping?: boolean; state: { running: boolean; stopping?: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.alreadyStopping, true, 'the second Stop reports the drain already under way');
    assert.equal(body.state.running, true, 'the drain was NOT force-quit — the pid is still alive');
    assert.equal(body.state.stopping, true);
    // The stand-in traps SIGTERM but NOT a second one specially; the real
    // proof the route did not re-signal is that the pid survives the call.
    assert.equal(process.kill(child.pid, 0), true);
  } finally {
    await child.kill();
  }
});

// A marker naming a DIFFERENT (older) pid must not suppress a real Stop — the
// suppression is keyed on "this live pid is the one already draining".
test('POST /api/scheduler/stop still signals when the marker names another pid (a stale marker never swallows a Stop)', async () => {
  const child = await startTrappedChild();
  try {
    writePidFile(forgeRoot, child.pid);
    markStopping(forgeRoot, 2_147_483_640); // an unrelated, dead pid
    const body = (await (await fetch(`${url}/api/scheduler/stop`, { method: 'POST', headers: CSRF })).json()) as {
      ok: boolean; stopping?: boolean; alreadyStopping?: boolean; state: { stopping?: boolean };
    };
    assert.equal(body.stopping, true, 'the live pid is signalled + marked');
    assert.notEqual(body.alreadyStopping, true);
    assert.equal(body.state.stopping, true, 'the marker now names THIS pid');
  } finally {
    await child.kill();
  }
});

test('R5-01-F1: FORGE_DRY_BRIDGE=1 refuses scheduler start/stop with the typed 409', async () => {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const startRes = await fetch(`${url}/api/scheduler/start`, { method: 'POST', headers: CSRF });
    assert.equal(startRes.status, 409);
    assert.deepEqual(await startRes.json(), { error: 'dry-bridge', route: '/api/scheduler/start', method: 'POST', action: 'daemon' });

    const stopRes = await fetch(`${url}/api/scheduler/stop`, { method: 'POST', headers: CSRF });
    assert.equal(stopRes.status, 409);
    assert.deepEqual(await stopRes.json(), { error: 'dry-bridge', route: '/api/scheduler/stop', method: 'POST', action: 'daemon' });
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});
