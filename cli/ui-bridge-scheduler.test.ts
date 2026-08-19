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

import { startBridge } from './ui-bridge.ts';
import { writePidFile, daemonPaths, isPaused, pausedFlagPath } from '../orchestrator/daemon.ts';

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

test('POST /api/scheduler/start clears a stale .paused flag (pause → stop → start must actually claim work)', async () => {
  const queueRoot = join(forgeRoot, '_queue');
  // Our own live pid stands in for the daemon (no real spawn); the flag was
  // left armed by an earlier pause.
  writePidFile(forgeRoot, process.pid);
  await fetch(`${url}/api/scheduler/pause`, { method: 'POST', headers: CSRF });
  assert.equal(isPaused(queueRoot), true, 'precondition: paused');

  const res = await fetch(`${url}/api/scheduler/start`, { method: 'POST', headers: CSRF });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; state: { running: boolean; paused: boolean } };
  assert.equal(body.ok, true);
  assert.equal(body.state.paused, false, 'the returned state reports the flag cleared');
  assert.equal(isPaused(queueRoot), false, 'the artifact: .paused is gone from disk');
  assert.equal(existsSync(pausedFlagPath(queueRoot)), false);
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (A3-07): Stop is not a silent control. The daemon keeps its pid
// alive while it drains in-flight cycles after SIGTERM, so a plain liveness
// poll read "running" for the whole drain. The stop route marks the pid it
// signalled; `GET /api/scheduler/status` reports `stopping:true` for as long
// as that pid is alive — any poller (a second tab, a reload) sees the honest
// transitional state, not just the tab that clicked.
// ---------------------------------------------------------------------------

test('POST /api/scheduler/stop → stopping:true, and GET /status keeps reporting stopping while the signalled pid drains', async () => {
  // A stand-in daemon that TRAPS SIGTERM and stays alive (the drain window),
  // so the route's SIGTERM does not kill it and the pid stays alive.
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' });
  assert.ok(typeof child.pid === 'number');
  const childPid = child.pid as number;
  try {
    writePidFile(forgeRoot, childPid);
    // Give the child a beat to install its SIGTERM handler.
    await new Promise((r) => setTimeout(r, 300));

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
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
  }
  // Once the pid is gone the daemon is plainly stopped — never "stopping".
  const after = (await (await fetch(`${url}/api/scheduler/status`)).json()) as { running: boolean; stopping?: boolean };
  assert.equal(after.running, false);
  assert.equal(after.stopping, false);
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
