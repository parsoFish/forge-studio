/**
 * Tests for orchestrator/daemon.ts (P4 — managed background daemon).
 *   - pid file read / write / clear / stale-reap
 *   - isAlive probe (self pid is alive; an unused high pid is not)
 *   - pause flag set/clear and isPaused
 *   - daemonState reflects pid liveness + pause flag
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  daemonPaths,
  readPid,
  isAlive,
  writePidFile,
  clearPidFile,
  reapStalePidFile,
  daemonState,
  isPaused,
  setPaused,
  pausedFlagPath,
} from './daemon.ts';

function tmpForge(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-daemon-'));
  mkdirSync(join(dir, '_logs'), { recursive: true });
  mkdirSync(join(dir, '_queue'), { recursive: true });
  return dir;
}

test('isAlive: own pid alive, unused high pid not', () => {
  assert.equal(isAlive(process.pid), true);
  // PIDs are capped well below this on Linux; nothing should own it.
  assert.equal(isAlive(2_147_483_640), false);
});

test('pid file: write → read → clear round-trips', () => {
  const root = tmpForge();
  assert.equal(readPid(daemonPaths(root).pidFile), null);
  writePidFile(root, 4242);
  assert.equal(readPid(daemonPaths(root).pidFile), 4242);
  clearPidFile(root);
  assert.equal(readPid(daemonPaths(root).pidFile), null);
  rmSync(root, { recursive: true, force: true });
});

test('reapStalePidFile removes a pid file whose process is dead', () => {
  const root = tmpForge();
  writePidFile(root, 2_147_483_640); // dead
  assert.ok(existsSync(daemonPaths(root).pidFile));
  reapStalePidFile(root);
  assert.equal(existsSync(daemonPaths(root).pidFile), false);
  rmSync(root, { recursive: true, force: true });
});

test('reapStalePidFile keeps a pid file whose process is alive', () => {
  const root = tmpForge();
  writePidFile(root, process.pid); // alive
  reapStalePidFile(root);
  assert.equal(readPid(daemonPaths(root).pidFile), process.pid);
  rmSync(root, { recursive: true, force: true });
});

test('pause flag: set/clear toggles isPaused', () => {
  const root = tmpForge();
  const q = join(root, '_queue');
  assert.equal(isPaused(q), false);
  setPaused(true, q, 'maintenance');
  assert.equal(isPaused(q), true);
  assert.ok(existsSync(pausedFlagPath(q)));
  setPaused(false, q);
  assert.equal(isPaused(q), false);
  rmSync(root, { recursive: true, force: true });
});

test('daemonState reflects liveness and pause flag', () => {
  const root = tmpForge();
  const q = join(root, '_queue');
  let st = daemonState(root, q);
  assert.equal(st.running, false);
  assert.equal(st.pid, null);
  assert.equal(st.paused, false);

  writePidFile(root, process.pid);
  setPaused(true, q, 'test');
  st = daemonState(root, q);
  assert.equal(st.running, true);
  assert.equal(st.pid, process.pid);
  assert.equal(st.paused, true);
  assert.ok(typeof st.startedAt === 'string');
  rmSync(root, { recursive: true, force: true });
});
