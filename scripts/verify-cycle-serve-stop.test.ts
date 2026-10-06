/**
 * Bead forge-8vfn.30.5 — verify-cycle's teardown SIGTERM'd Studio's process
 * group but the `forge serve` Studio had started survived (ppid 1, its own
 * group) and kept running the developer agent. It must be stopped by the pid
 * `forge serve` RECORDED, re-verified, and never by name/pattern.
 *
 * Every process here is a harmless `node -e setInterval` THIS test spawns, in
 * its own process group (detached, so a group kill of any other group cannot
 * reach it), with a pid file in a temp root. No real forge serve, no network,
 * never the real repo's `_logs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { snapshotServe, stopRecordedServe } from './verify-cycle-serve-stop.mjs';
import { teardownStudio } from './verify-cycle-teardown.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A detached stand-in whose cmdline looks like `node -e … cli.ts serve`. */
function spawnFakeServe(extra: string[] = ['cli.ts', 'serve']): ChildProcess {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', ...extra], { detached: true, stdio: 'ignore' });
  c.unref();
  return c;
}

function tempRoot(pidContent: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'vc-serve-stop-'));
  if (pidContent !== null) {
    mkdirSync(join(root, '_logs', 'daemon'), { recursive: true });
    writeFileSync(join(root, '_logs', 'daemon', 'forge.pid'), pidContent);
  }
  return root;
}

async function waitDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) { if (!alive(pid)) return true; await sleep(50); }
  return false;
}

test('stops the serve named by the recorded pid, even though it is in its own process group', async () => {
  const child = spawnFakeServe();
  const root = tempRoot(`${child.pid}\n`);
  try {
    await sleep(150);
    const snap = snapshotServe({ forgeRoot: root });
    assert.equal(snap.status, 'RECORDED');
    const r = await stopRecordedServe(snap, { notBeforeMs: Date.now() - 60_000, termWaitMs: 1500 });
    assert.equal(r.status, 'STOPPED', JSON.stringify(r));
    assert.equal(await waitDead(child.pid!), true);
  } finally {
    if (child.pid && alive(child.pid)) process.kill(child.pid, 'SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('pid file absent: UNKNOWN with a named message, nothing signalled', () => {
  const root = tempRoot(null);
  try {
    const snap = snapshotServe({ forgeRoot: root });
    assert.equal(snap.status, 'UNKNOWN');
    assert.match(snap.reason, /forge\.pid/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pid file unparseable: UNKNOWN, no guessing', () => {
  const root = tempRoot('not-a-pid\n');
  try {
    assert.equal(snapshotServe({ forgeRoot: root }).status, 'UNKNOWN');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('recorded pid whose cmdline is NOT a forge serve (recycled pid) is refused, never signalled', async () => {
  const bystander = spawnFakeServe(['unrelated']);
  const root = tempRoot(`${bystander.pid}\n`);
  try {
    await sleep(150);
    const r = await stopRecordedServe(snapshotServe({ forgeRoot: root }), { notBeforeMs: Date.now() - 60_000, termWaitMs: 200 });
    assert.equal(r.status, 'REFUSED', JSON.stringify(r));
    assert.match(r.reason, /cmdline/);
    assert.equal(alive(bystander.pid!), true, 'a process that is not our serve must survive');
  } finally {
    if (bystander.pid && alive(bystander.pid)) process.kill(bystander.pid, 'SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('a serve that started BEFORE this run (not one it caused) is refused, never signalled', async () => {
  const preexisting = spawnFakeServe();
  const root = tempRoot(`${preexisting.pid}\n`);
  try {
    await sleep(150);
    const r = await stopRecordedServe(snapshotServe({ forgeRoot: root }), { notBeforeMs: Date.now() + 3_600_000, termWaitMs: 200 });
    assert.equal(r.status, 'REFUSED', JSON.stringify(r));
    assert.match(r.reason, /before this run/);
    assert.equal(alive(preexisting.pid!), true);
  } finally {
    if (preexisting.pid && alive(preexisting.pid)) process.kill(preexisting.pid, 'SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('teardownStudio stops the recorded serve for a spawned studio, and leaves a REUSED studio\'s serve alone', async () => {
  for (const spawned of [true, false]) {
    const child = spawnFakeServe();
    const root = tempRoot(`${child.pid}\n`);
    try {
      await sleep(150);
      const res = await teardownStudio({
        handle: { pid: 999999999, startTicks: null }, spawned, ports: [], bridgeUrl: undefined,
        forgeRoot: root, notBeforeMs: Date.now() - 60_000, sleep: async () => {},
        verifyTornDown: async () => ({ complete: true, incomplete: [] }),
      });
      if (spawned) {
        assert.equal(res.serve?.status, 'STOPPED', JSON.stringify(res));
        assert.equal(await waitDead(child.pid!), true);
      } else {
        assert.equal(alive(child.pid!), true, 'a reused studio\'s serve is not ours to stop');
      }
    } finally {
      if (child.pid && alive(child.pid)) process.kill(child.pid, 'SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  }
});
