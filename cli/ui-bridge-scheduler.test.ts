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
