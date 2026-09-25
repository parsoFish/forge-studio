/**
 * verify-cycle-teardown — M7-A finding row 82: a funded run's "REFUSING the
 * develop hand-off" early exit left the `forge studio` bridge it had spawned
 * AND that bridge's Next UI child running, reparented to init. Root cause,
 * read down to the byte: `startWatch()` never forwarded `spawnStudioReady`'s
 * own `stop` function into the object it returned, so the REFUSING branch's
 * `await watch.stop?.()` was an unconditional no-op, and `process.exit(1)`
 * fired one line later with nothing torn down. The outer fatal `main().catch`
 * had its own SECOND, weaker teardown (`activeWatchProc.kill('SIGTERM')` — no
 * process-GROUP kill, no SIGKILL escalation, no port verification) that only
 * covered a DIFFERENT set of exit paths. Two teardowns, two omissions — the
 * `residue.sh` shape (M7 row 875) all over again.
 *
 * The fix is ONE finally-level teardown (`runGuarded`) plus a
 * pid-recycle-guarded process-group kill (`killGroupIfLive`, using
 * `/proc/<pid>/stat` field 22 — start time — so a recycled pid is never
 * signalled) plus a post-teardown port + health verification
 * (`verifyTornDown`) that names a survivor instead of exiting green over one.
 *
 * Real processes/sockets are used wherever the property under test is "does
 * this actually kill a process / actually detect an open port" — a fake would
 * only prove the fake's own contract. Pure orchestration (call order,
 * escalation, the reused-vs-spawned branch, the finally-always-runs wiring)
 * is tested with injected collaborators, per this repo's own
 * verify-cycle-*.test.ts pattern (§15.163 — a behaviour exercised only by a
 * funded run is a behaviour nobody exercises).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

import {
  readProcStartTicks,
  captureHandle,
  killGroupIfLive,
  probeTcpOpen,
  probeHealthOk,
  verifyTornDown,
  teardownStudio,
  runGuarded,
} from './verify-cycle-teardown.mjs';

/** A real, detached child this suite can safely kill — never `sleep`/`bash`
 *  alone: detached so it is its own process-group leader, the same shape
 *  `spawnStudioReady` spawns (boot-studio.mjs `detached: true`). */
function spawnDetachedChild(script = 'setInterval(() => {}, 1000);') {
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore', detached: true });
}

/** Wait until `pred()` is true or `timeoutMs` elapses; used instead of a fixed
 *  sleep so the suite is not racing an arbitrary teardown latency. */
async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// readProcStartTicks — the pid-recycle guard's raw material
// ---------------------------------------------------------------------------
describe('readProcStartTicks — /proc/<pid>/stat field 22', () => {
  test('a live process has a numeric start-time field', () => {
    const child = spawnDetachedChild();
    try {
      const ticks = readProcStartTicks(child.pid);
      assert.match(String(ticks), /^\d+$/, `expected a numeric start-time field, got ${ticks}`);
    } finally {
      process.kill(-child.pid!, 'SIGKILL');
    }
  });

  test('a pid with no /proc entry returns null, not a throw', () => {
    // A pid this large is not a real process on any Linux host (max_pid ceilings
    // sit well under 2^22 by default); readdir/readFile on a missing /proc entry
    // must degrade to null, never crash the caller.
    assert.equal(readProcStartTicks(999999999), null);
  });

  test('the start ticks for the SAME live process are stable across two reads', () => {
    const child = spawnDetachedChild();
    try {
      const a = readProcStartTicks(child.pid);
      const b = readProcStartTicks(child.pid);
      assert.equal(a, b);
    } finally {
      process.kill(-child.pid!, 'SIGKILL');
    }
  });
});

// ---------------------------------------------------------------------------
// killGroupIfLive — the pid-recycle-guarded process-group kill
// ---------------------------------------------------------------------------
describe('killGroupIfLive', () => {
  test('signals a live process group and it actually dies', async () => {
    const child = spawnDetachedChild();
    const handle = captureHandle(child);
    const result = killGroupIfLive(handle, 'SIGKILL');
    assert.equal(result.signalled, true);
    await waitFor(() => readProcStartTicks(handle.pid) === null);
  });

  test('a handle for an already-gone process is reported, not thrown', () => {
    const result = killGroupIfLive({ pid: 999999999, startTicks: '1' }, 'SIGTERM');
    assert.equal(result.signalled, false);
    assert.match(result.reason, /gone/);
  });

  test('a null handle is a no-op', () => {
    const result = killGroupIfLive(null, 'SIGTERM');
    assert.equal(result.signalled, false);
    assert.match(result.reason, /no handle/);
  });

  // THE PID-RECYCLE GUARD (fix item 2): a handle whose recorded start-time no
  // longer matches the live process at that pid must NEVER be signalled — the
  // pid was reused by an unrelated process in the interim.
  test('a handle whose start-time no longer matches the live pid is REFUSED — never signalled', async () => {
    const child = spawnDetachedChild();
    try {
      const wrongHandle = { pid: child.pid, startTicks: 'not-the-real-start-time' };
      const result = killGroupIfLive(wrongHandle, 'SIGKILL');
      assert.equal(result.signalled, false);
      assert.match(result.reason, /recycled/);
      // Proof, not assertion-of-intent: the process must still be alive.
      assert.notEqual(readProcStartTicks(child.pid), null, 'the guard must not have killed it');
    } finally {
      process.kill(-child.pid!, 'SIGKILL');
    }
  });

  test('injected collaborators are honoured (pure-orchestration seam)', () => {
    const calls: Array<[number, string]> = [];
    const result = killGroupIfLive(
      { pid: 4242, startTicks: 'abc' },
      'SIGTERM',
      { readStartTicks: () => 'abc', kill: (pid: number, sig: string) => { calls.push([pid, sig]); } },
    );
    assert.equal(result.signalled, true);
    assert.deepEqual(calls, [[-4242, 'SIGTERM']], 'must signal the process GROUP (negative pid)');
  });

  test('a kill() that throws (e.g. EPERM) is reported, not propagated', () => {
    const result = killGroupIfLive(
      { pid: 4242, startTicks: 'abc' },
      'SIGTERM',
      { readStartTicks: () => 'abc', kill: () => { throw new Error('EPERM'); } },
    );
    assert.equal(result.signalled, false);
    assert.match(result.reason, /EPERM/);
  });
});

// ---------------------------------------------------------------------------
// probeTcpOpen / probeHealthOk — the post-teardown verification primitives
// ---------------------------------------------------------------------------
describe('probeTcpOpen', () => {
  test('a real listening port probes open', async () => {
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = srv.address() as AddressInfo;
      assert.equal(await probeTcpOpen('127.0.0.1', port), true);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  test('a closed port probes closed (connection refused)', async () => {
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const { port } = srv.address() as AddressInfo;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    assert.equal(await probeTcpOpen('127.0.0.1', port), false);
  });
});

describe('probeHealthOk', () => {
  test('an ok response is healthy', async () => {
    assert.equal(await probeHealthOk('http://x', { fetchImpl: async () => ({ ok: true }) as Response }), true);
  });
  test('a non-ok response is not healthy', async () => {
    assert.equal(await probeHealthOk('http://x', { fetchImpl: async () => ({ ok: false }) as Response }), false);
  });
  test('a fetch that throws (connection refused) is not healthy', async () => {
    assert.equal(await probeHealthOk('http://x', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), false);
  });
});

// ---------------------------------------------------------------------------
// verifyTornDown — fix item 3: name every survivor, never exit green over one
// ---------------------------------------------------------------------------
describe('verifyTornDown', () => {
  test('every port closed + health refused → complete, nothing logged as incomplete', async () => {
    const logs: string[] = [];
    const result = await verifyTornDown({
      ports: [4123, 4124], bridgeUrl: 'http://127.0.0.1:4123',
      log: (m: string) => logs.push(m),
      probeTcpOpen: async () => false,
      probeHealthOk: async () => false,
    });
    assert.deepEqual(result, { complete: true, incomplete: [] });
    assert.ok(!logs.some((l) => /TEARDOWN-INCOMPLETE/.test(l)));
  });

  test('a port still listening is named BY NUMBER — a silent survivor is the defect', async () => {
    const logs: string[] = [];
    const result = await verifyTornDown({
      ports: [4123, 4124], bridgeUrl: 'http://127.0.0.1:4123',
      log: (m: string) => logs.push(m),
      probeTcpOpen: async (_h: string, port: number) => port === 4124,
      probeHealthOk: async () => false,
    });
    assert.equal(result.complete, false);
    assert.deepEqual(result.incomplete, [4124]);
    assert.ok(logs.some((l) => l === 'TEARDOWN-INCOMPLETE port 4124 still listening'), logs.join('\n'));
  });

  test('the bridge health endpoint still answering also counts as incomplete', async () => {
    const logs: string[] = [];
    const result = await verifyTornDown({
      ports: [4123, 4124], bridgeUrl: 'http://127.0.0.1:4123',
      log: (m: string) => logs.push(m),
      probeTcpOpen: async () => false,
      probeHealthOk: async () => true,
    });
    assert.equal(result.complete, false);
    assert.ok(logs.some((l) => /TEARDOWN-INCOMPLETE.*health/.test(l)), logs.join('\n'));
  });

  test('no bridgeUrl given → health check is skipped, not thrown', async () => {
    const result = await verifyTornDown({
      ports: [4123], bridgeUrl: undefined,
      probeTcpOpen: async () => false,
      probeHealthOk: async () => { throw new Error('must not be called'); },
    });
    assert.equal(result.complete, true);
  });
});

// ---------------------------------------------------------------------------
// teardownStudio — the orchestrator: SIGTERM, bounded wait, SIGKILL, verify
// ---------------------------------------------------------------------------
describe('teardownStudio', () => {
  // Fix item 1 half A + the incident's own scenario: a studio this run
  // REUSED (spawned: false) is NEVER touched.
  test('a REUSED studio (spawned: false) is never signalled', async () => {
    const killCalls: unknown[] = [];
    const result = await teardownStudio({
      handle: null, spawned: false, ports: [4123, 4124], bridgeUrl: 'http://127.0.0.1:4123',
      killGroupIfLive: (...args: unknown[]) => { killCalls.push(args); return { signalled: true }; },
    });
    assert.deepEqual(result, { attempted: false, complete: true, incomplete: [] });
    assert.equal(killCalls.length, 0, 'a reused studio must never be signalled');
  });

  test('spawned: true but handle missing is also treated as nothing-to-tear-down (defensive)', async () => {
    const killCalls: unknown[] = [];
    const result = await teardownStudio({
      handle: null, spawned: true, ports: [4123], bridgeUrl: 'http://x',
      killGroupIfLive: (...args: unknown[]) => { killCalls.push(args); return { signalled: true }; },
    });
    assert.equal(result.attempted, false);
    assert.equal(killCalls.length, 0);
  });

  // Fix item 2: SIGTERM, then SIGKILL after a bounded wait.
  test('a spawned studio gets SIGTERM first, SIGKILL second, in order', async () => {
    const sigs: string[] = [];
    const handle = { pid: 4242, startTicks: '1' };
    await teardownStudio({
      handle, spawned: true, ports: [4123, 4124], bridgeUrl: 'http://127.0.0.1:4123',
      sleep: async () => {},
      killGroupIfLive: (h: unknown, sig: string) => { sigs.push(sig); return { signalled: true }; },
      verifyTornDown: async () => ({ complete: true, incomplete: [] }),
    });
    assert.deepEqual(sigs, ['SIGTERM', 'SIGKILL']);
  });

  // Fix item 3: a survivor after SIGTERM+SIGKILL is reported, not swallowed.
  test('a port still answering after SIGTERM+SIGKILL surfaces as incomplete', async () => {
    const handle = { pid: 4242, startTicks: '1' };
    const result = await teardownStudio({
      handle, spawned: true, ports: [4123, 4124], bridgeUrl: 'http://127.0.0.1:4123',
      sleep: async () => {},
      killGroupIfLive: () => ({ signalled: true }),
      verifyTornDown: async () => ({ complete: false, incomplete: [4123] }),
    });
    assert.equal(result.attempted, true);
    assert.equal(result.complete, false);
    assert.deepEqual(result.incomplete, [4123]);
  });

  test('an END-TO-END real spawn + teardown: the child is dead and its port is closed', async () => {
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const { port } = srv.address() as AddressInfo;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    // Spawn a REAL detached child that binds the port srv just released.
    const child = spawn(process.execPath, ['-e', `
      const net = require('net');
      const s = net.createServer();
      s.listen(${port}, '127.0.0.1');
    `], { stdio: 'ignore', detached: true });
    await waitFor(async () => probeTcpOpen('127.0.0.1', port), 3000);
    const handle = captureHandle(child);
    const result = await teardownStudio({
      handle, spawned: true, ports: [port], bridgeUrl: undefined, sleep: async (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
    });
    assert.equal(result.complete, true, JSON.stringify(result));
    assert.equal(await probeTcpOpen('127.0.0.1', port), false);
  });
});

// ---------------------------------------------------------------------------
// runGuarded — fix item 1 half B: ONE finally-level teardown, not per-branch
// calls. This IS the wiring the incident's REFUSING branch skipped.
// ---------------------------------------------------------------------------
describe('runGuarded', () => {
  // Test (a): the incident itself — an early REFUSING exit (thrown, matching
  // the real fix's `throw` in place of `process.exit(1)`) must still tear
  // down a studio this run spawned.
  test('a body that throws (the REFUSING path) still tears down a SPAWNED studio', async () => {
    const calls: unknown[] = [];
    const watch = { spawned: true, handle: { pid: 1, startTicks: '1' }, bridgeUrl: 'http://127.0.0.1:4123' };
    await assert.rejects(
      runGuarded(
        { getWatch: () => watch, ports: [4123, 4124], log: () => {} },
        async () => { throw new Error('REFUSING the develop hand-off — the architect stage did not succeed'); },
        { teardownStudio: async (opts: unknown) => { calls.push(opts); return { attempted: true, complete: true, incomplete: [] }; } },
      ),
      /REFUSING the develop hand-off/,
    );
    assert.equal(calls.length, 1, 'teardown must run exactly once on the thrown-error exit path');
    assert.deepEqual((calls[0] as { spawned: boolean }).spawned, true);
  });

  test('a normal (non-throwing) completion also tears down through the SAME path', async () => {
    const calls: unknown[] = [];
    const watch = { spawned: true, handle: { pid: 1, startTicks: '1' }, bridgeUrl: 'http://127.0.0.1:4123' };
    const returned = await runGuarded(
      { getWatch: () => watch, ports: [4123, 4124], log: () => {} },
      async () => 'ok',
      { teardownStudio: async (opts: unknown) => { calls.push(opts); return { attempted: true, complete: true, incomplete: [] }; } },
    );
    assert.equal(returned, 'ok', 'the body\'s own return value must survive the finally');
    assert.equal(calls.length, 1);
  });

  test('nothing ever spawned (getWatch returns null) — teardown is never invoked', async () => {
    let called = false;
    const returned = await runGuarded(
      { getWatch: () => null, ports: [4123, 4124], log: () => {} },
      async () => 'ok',
      { teardownStudio: async () => { called = true; return { attempted: true, complete: true, incomplete: [] }; } },
    );
    assert.equal(returned, 'ok');
    assert.equal(called, false);
  });

  // Fix item 3's non-zero-exit half, surfaced through a callback rather than
  // a global `process.exitCode` write (kept out of this pure module so it
  // stays testable without mutating the test runner's own exit code).
  test('an incomplete teardown fires onIncomplete with the survivor detail', async () => {
    const incompletes: unknown[] = [];
    const watch = { spawned: true, handle: { pid: 1, startTicks: '1' }, bridgeUrl: 'http://127.0.0.1:4123' };
    await runGuarded(
      { getWatch: () => watch, ports: [4123, 4124], log: () => {}, onIncomplete: (r: unknown) => incompletes.push(r) },
      async () => 'ok',
      { teardownStudio: async () => ({ complete: false, incomplete: [4124] }) },
    );
    assert.equal(incompletes.length, 1);
    assert.deepEqual(incompletes[0], { complete: false, incomplete: [4124] });
  });

  test('a complete teardown never fires onIncomplete', async () => {
    let called = false;
    const watch = { spawned: true, handle: { pid: 1, startTicks: '1' }, bridgeUrl: 'http://127.0.0.1:4123' };
    await runGuarded(
      { getWatch: () => watch, ports: [4123, 4124], log: () => {}, onIncomplete: () => { called = true; } },
      async () => 'ok',
      { teardownStudio: async () => ({ attempted: true, complete: true, incomplete: [] }) },
    );
    assert.equal(called, false);
  });

  test('a teardown that itself throws never masks the body\'s own error', async () => {
    const watch = { spawned: true, handle: { pid: 1, startTicks: '1' }, bridgeUrl: 'http://127.0.0.1:4123' };
    await assert.rejects(
      runGuarded(
        { getWatch: () => watch, ports: [4123, 4124], log: () => {} },
        async () => { throw new Error('the real failure'); },
        { teardownStudio: async () => { throw new Error('teardown blew up too'); } },
      ),
      /the real failure/,
    );
  });
});
