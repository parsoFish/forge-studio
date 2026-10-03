/**
 * Tests for packages/flows/daemon.ts (P4 — managed background daemon).
 *   - pid file read / write / clear / stale-reap
 *   - isAlive probe (self pid is alive; an unused high pid is not)
 *   - the stop marker: write / read / clear-on-fresh-pid-file
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  daemonPaths,
  readPid,
  isAlive,
  writePidFile,
  clearPidFile,
  reapStalePidFile,
  spawnServeDetached,
  markStopping,
} from '../../daemon.ts';

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

/**
 * `forge-8vfn.8.1.6` follow-up (T1 review) — `kill(pid, 0)` alone counts a
 * ZOMBIE as alive (the kernel still holds its pid table entry until
 * something reaps it), which could disagree with the story runner's own
 * `/proc/<pid>/stat`-based preflight reading on the SAME pid. `isAlive`
 * delegates to `@forge/kernel`'s `isProcessRunning`, the ONE reading every
 * caller shares.
 *
 * A REAL, genuinely alive child proves the point `kill(pid, 0)` alone
 * cannot: the fixture `procRoot` reports its pid as zombie-state `Z`, and
 * `isAlive` must trust THAT reading over the real process table it would
 * otherwise consult.
 */
test('isAlive: a ZOMBIE-state /proc fixture reads as NOT alive, even for a genuinely live pid', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-isalive-zombie-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    mkdirSync(join(root, String(child.pid)));
    writeFileSync(
      join(root, String(child.pid), 'stat'),
      `${child.pid} (fixture) Z 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42`,
    );
    assert.equal(
      isAlive(child.pid!, root),
      false,
      'a zombie-state /proc reading must win over kill(pid,0), which cannot distinguish a zombie from a live process',
    );
  } finally {
    child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
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

// ---------- spawnServeDetached (M7-5 / ADR-031) ----------

test('spawnServeDetached: returns null when a live daemon is already running', () => {
  const root = tmpForge();
  // Our own (alive) pid stands in for a running daemon.
  writePidFile(root, process.pid);
  const result = spawnServeDetached(root);
  assert.equal(result, null, 'should not spawn a second daemon when one is live');
  rmSync(root, { recursive: true, force: true });
});

test('spawnServeDetached: a stale pid-file does not block a fresh start', () => {
  // A dead pid recorded on disk must NOT be treated as a live daemon — the
  // helper reaps it first (reapStalePidFile). We don't actually want a real
  // `forge serve` to launch in a unit test (cli.ts chdir's to the install
  // root and would touch the real queue), so this only proves the gate is
  // open after the reap, not the spawn itself (side-effect-free).
  const root = tmpForge();
  const { pidFile } = daemonPaths(root);
  // An unused high pid → reapStalePidFile should clear it, freeing a start.
  writePidFile(root, 2_147_483_640);
  assert.equal(isAlive(2_147_483_640), false, 'precondition: recorded pid is dead');

  reapStaleAndAssertClear(root, pidFile);
  rmSync(root, { recursive: true, force: true });
});

// Helper: prove the stale-pid gate is open without launching a daemon. This
// re-runs the exact reap the helper does as its first step, then checks the
// pid-file is gone (so spawnServeDetached's liveness check would return
// "not running" and proceed to spawn).
function reapStaleAndAssertClear(root: string, pidFile: string): void {
  reapStalePidFile(root);
  assert.equal(existsSync(pidFile), false, 'stale pid-file should be reaped before a fresh start');
  // The exported helper exists and is callable with this signature.
  assert.equal(typeof spawnServeDetached, 'function');
}

// ---------------------------------------------------------------------------
// W7-FIX-A3 (A3-07): the drain window is a REAL state. A SIGTERM keeps the
// daemon's pid alive until in-flight cycles settle — a plain pid probe reads
// "running" for the whole drain. `markStopping` records which pid a stop was
// signalled to; `apps/forge/serve-supervisor.ts` compares `readPid(
// stoppingFile)` against a LIVE pid to recognise that drain and never adopt
// or re-signal it, waiting instead for the pid to actually exit.
// ---------------------------------------------------------------------------

test('the stop marker names the signalled pid; a marker for a different pid never matches the live one', () => {
  const root = tmpForge();
  const { stoppingFile } = daemonPaths(root);
  writePidFile(root, process.pid);
  assert.equal(readPid(stoppingFile), null, 'no marker yet');

  markStopping(root, process.pid);
  assert.equal(readPid(stoppingFile), process.pid, 'marker names the live, signalled pid');

  // A marker for a DIFFERENT (e.g. previous) daemon does not match this one.
  markStopping(root, 2_147_483_640);
  assert.notEqual(readPid(stoppingFile), process.pid, 'a stale marker never matches the current live pid');
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 9): the marker is a TRANSITION record, not a
// permanent file. It only compares pids, and pids are reused (a long-lived
// WSL/container session wraps) — a fresh daemon that happens to draw the
// marked pid must not inherit a drain it was never part of. Both pid-file
// writes below clear it.
// ---------------------------------------------------------------------------

test('the stop marker is cleared when a pid file is written (a fresh daemon never inherits a drain)', () => {
  const root = tmpForge();
  const { stoppingFile } = daemonPaths(root);

  writePidFile(root, process.pid);
  markStopping(root, process.pid);
  assert.equal(readPid(stoppingFile), process.pid, 'precondition: draining');

  // A fresh daemon takes the SAME pid (pid reuse) — the marker must be gone.
  writePidFile(root, process.pid);
  assert.equal(existsSync(stoppingFile), false, 'writePidFile clears the stop marker');
  rmSync(root, { recursive: true, force: true });
});

test('the stop marker is cleared when the pid file is cleared (the drain that finished leaves nothing behind)', () => {
  const root = tmpForge();
  const { stoppingFile } = daemonPaths(root);
  writePidFile(root, process.pid);
  markStopping(root, process.pid);

  clearPidFile(root);
  assert.equal(existsSync(stoppingFile), false, 'clearPidFile clears the stop marker');
  rmSync(root, { recursive: true, force: true });
});

test('clearing an ABSENT marker is a no-op (both writes are safe on a never-stopped root)', () => {
  const root = tmpForge();
  assert.doesNotThrow(() => { writePidFile(root, process.pid); });
  assert.doesNotThrow(() => { clearPidFile(root); });
  assert.equal(existsSync(daemonPaths(root).stoppingFile), false);
  rmSync(root, { recursive: true, force: true });
});
