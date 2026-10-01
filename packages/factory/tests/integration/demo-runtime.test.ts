/**
 * forge-8vfn.8.5.6 — a HARD crash mid-`forge demo capture` leaves the
 * detached dev-server process group running (`startServer`, demo-runtime.ts)
 * with nothing left to stop it: the normal path's `stop()` only runs when the
 * capture reaches it. `sweepStaleServer` runs at the start of the NEXT
 * capture and kills a recorded group ONLY when `/proc` still shows a live
 * process at that pid AND its start time still matches the recorded one — a
 * recycled pid must never be killed (§6.13).
 *
 * Real processes throughout (a real `sleep 30`, real `/proc` reads) — no
 * mocking the thing under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readProcStartTime,
  serverRecordPath,
  sweepStaleServer,
  writeServerRecord,
} from '../../demo-runtime.ts';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000, intervalMs = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

/** A real detached process group leader this file fully owns and always
 *  reaps, win or lose. */
function spawnFixtureGroup(): ChildProcess {
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

function killGroupIfAlive(pid: number): void {
  if (!isAlive(pid)) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function freshBundleDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-demo-sweep-'));
}

test('sweepStaleServer: kills a recorded process group when /proc still shows a live pid+starttime match, and clears the record', async () => {
  const bundleDir = freshBundleDir();
  const child = spawnFixtureGroup();
  const pid = child.pid;
  try {
    assert.ok(pid, 'fixture process has a pid');
    const self = readProcStartTime(pid!);
    assert.equal(self.kind, 'ok', 'the freshly spawned fixture process has a readable /proc start time');
    writeServerRecord(bundleDir, { pid: pid!, starttime: (self as { kind: 'ok'; starttime: string }).starttime });

    sweepStaleServer(bundleDir);

    const dead = await waitUntil(() => !isAlive(pid!));
    assert.ok(dead, 'the recorded process group was killed by the sweep');
    assert.equal(existsSync(serverRecordPath(bundleDir)), false, 'the stale record was removed');
  } finally {
    killGroupIfAlive(pid!);
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('sweepStaleServer: CONTROL — a record whose starttime does not match the live process is never killed', async () => {
  const bundleDir = freshBundleDir();
  const child = spawnFixtureGroup();
  const pid = child.pid;
  try {
    assert.ok(pid);
    const self = readProcStartTime(pid!);
    assert.equal(self.kind, 'ok');
    const realStarttime = (self as { kind: 'ok'; starttime: string }).starttime;
    // Guaranteed different from the live process's real start time, however
    // long the host has been up — a recycled-pid shape, never trusted.
    const wrongStarttime = `${Number(realStarttime) + 999_999}`;
    writeServerRecord(bundleDir, { pid: pid!, starttime: wrongStarttime });

    sweepStaleServer(bundleDir);

    await new Promise((r) => setTimeout(r, 300));
    assert.ok(isAlive(pid!), 'a starttime mismatch (recycled pid) must never be killed');
  } finally {
    killGroupIfAlive(pid!);
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('sweepStaleServer: CONTROL — a record naming a pid that no longer exists is removed with no error', () => {
  const bundleDir = freshBundleDir();
  try {
    // `true` exits immediately; its pid is free by the time we read it back.
    const finished = spawnSync('true', []);
    const deadPid = finished.pid;
    assert.ok(deadPid, 'fixture exited process has a pid');
    assert.equal(isAlive(deadPid!), false, 'fixture precondition: the exited pid is not alive');

    writeServerRecord(bundleDir, { pid: deadPid!, starttime: '123' });
    assert.doesNotThrow(() => sweepStaleServer(bundleDir));
    assert.equal(existsSync(serverRecordPath(bundleDir)), false, 'a record for a gone pid is cleared');
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('sweepStaleServer: no record at all is a silent no-op', () => {
  const bundleDir = freshBundleDir();
  try {
    assert.doesNotThrow(() => sweepStaleServer(bundleDir));
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
});
