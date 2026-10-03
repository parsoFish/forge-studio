/**
 * serve-supervisor — `forge studio` supervises `forge serve` exactly the way
 * it supervises the bridge and the UI (ADR 011/031 as merged in #1089): there
 * is no operator start/pause/resume/stop surface, only a supervisor that
 * adopts a live process or spawns one, and respawns it (with crash-loop
 * backoff) for as long as Studio owns the port.
 *
 * Every deck here injects a FAKE clock (see `makeFakeClock`) and fake
 * process-liveness/spawn/kill hooks — no real child process, no wall-clock
 * sleep. `clock.advance(ms)` fires every due timer in chronological order,
 * including ones scheduled by a timer that just fired, so a single call can
 * walk the supervisor through several transitions deterministically.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  superviseServe,
  SERVE_POLL_MS,
  SERVE_MIN_UPTIME_MS,
  SERVE_BACKOFF_INITIAL_MS,
  SERVE_BACKOFF_CAP_MS,
  type ServeSupervisorDeps,
} from '../../serve-supervisor.ts';

// ---------------------------------------------------------------------------
// Fake clock — discrete-event simulation. `setTimer`/`clearTimer` match the
// shapes `superviseServe` calls; `advance(ms)` moves time forward, firing
// every timer due at or before the new instant, in chronological order
// (re-scanning after each fire so a timer scheduled DURING a fire — e.g. the
// next poll, scheduled from inside the poll that just ran — is caught by the
// same `advance` call when it falls within the window).
// ---------------------------------------------------------------------------
type FakeClock = {
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  advance: (ms: number) => void;
};

function makeFakeClock(): FakeClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fireAt: number; fn: () => void }>();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fireAt: now + ms, fn });
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
    now() {
      return now;
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let earliestId: number | null = null;
        let earliestAt = Infinity;
        for (const [id, t] of timers) {
          if (t.fireAt <= target && t.fireAt < earliestAt) {
            earliestAt = t.fireAt;
            earliestId = id;
          }
        }
        if (earliestId === null) break;
        const t = timers.get(earliestId) as { fireAt: number; fn: () => void };
        timers.delete(earliestId);
        now = t.fireAt;
        t.fn();
      }
      now = target;
    },
  };
}

/** A fake, in-memory "disk" shared by one or more supervisor instances —
 *  mirrors the pid file + stop marker two real `forge studio` processes
 *  would share via the filesystem. */
type FakeDisk = {
  pid: number | null;
  stoppingPid: number | null;
  alive: Set<number>;
};

function makeFakeDisk(): FakeDisk {
  return { pid: null, stoppingPid: null, alive: new Set() };
}

function makeDeps(
  clock: FakeClock,
  disk: FakeDisk,
  overrides: Partial<ServeSupervisorDeps> & { spawnPid?: () => number } = {},
): ServeSupervisorDeps & { killed: Array<{ pid: number; signal: string }>; spawnCalls: number[]; logs: string[] } {
  const killed: Array<{ pid: number; signal: string }> = [];
  const spawnCalls: number[] = [];
  const logs: string[] = [];
  let nextSpawnPid = 1000;
  const defaultSpawn = (): number => {
    const pid = overrides.spawnPid ? overrides.spawnPid() : nextSpawnPid++;
    disk.pid = pid;
    disk.alive.add(pid);
    spawnCalls.push(pid);
    return pid;
  };
  const deps: ServeSupervisorDeps = {
    readPid: overrides.readPid ?? (() => disk.pid),
    readStoppingPid: overrides.readStoppingPid ?? (() => disk.stoppingPid),
    isAlive: overrides.isAlive ?? ((pid: number) => disk.alive.has(pid)),
    spawn: overrides.spawn ?? defaultSpawn,
    // A SIGTERM is not instant — `forge serve` traps it and drains in-flight
    // cycles before exiting. The fake therefore records the signal but does
    // NOT remove the pid from `disk.alive`; a test that cares about the
    // process actually exiting does that itself (`disk.alive.delete(pid)`),
    // exactly as a real exit event would.
    kill:
      overrides.kill ??
      ((pid: number, signal: NodeJS.Signals) => {
        killed.push({ pid, signal });
      }),
    markStopping: overrides.markStopping ?? ((pid: number) => { disk.stoppingPid = pid; }),
    setTimer: overrides.setTimer ?? clock.setTimer,
    clearTimer: overrides.clearTimer ?? clock.clearTimer,
    now: overrides.now ?? clock.now,
    log: overrides.log ?? ((line: string) => logs.push(line)),
  };
  return Object.assign(deps, { killed, spawnCalls, logs });
}

// ---------------------------------------------------------------------------
// Boot: adopt vs spawn
// ---------------------------------------------------------------------------

test('adopts a live pid on boot — spawns nothing', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  disk.pid = 777;
  disk.alive.add(777);
  const deps = makeDeps(clock, disk);

  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });

  assert.equal(deps.spawnCalls.length, 0, 'a live pid is adopted, never spawned over');
  assert.equal(handle.getStatus().pid, 777);
  assert.equal(handle.getStatus().state, 'running');
  handle.stop();
});

test('spawns a fresh serve when no pid file exists', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  const deps = makeDeps(clock, disk);

  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });

  assert.equal(deps.spawnCalls.length, 1, 'no pid on disk → exactly one spawn');
  assert.equal(handle.getStatus().state, 'running');
  assert.equal(handle.getStatus().pid, deps.spawnCalls[0]);
  handle.stop();
});

test('a dead pid recorded on disk is not adopted — it is spawned over', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  disk.pid = 555; // present but NOT in disk.alive
  const deps = makeDeps(clock, disk);

  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });

  assert.equal(deps.spawnCalls.length, 1);
  assert.notEqual(handle.getStatus().pid, 555);
  handle.stop();
});

// ---------------------------------------------------------------------------
// Respawn after death (crash) — the normal in-session recovery path
// ---------------------------------------------------------------------------

test('respawns after the supervised pid dies', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  const deps = makeDeps(clock, disk);
  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });
  assert.equal(deps.spawnCalls.length, 1);
  const firstPid = deps.spawnCalls[0];

  // The process dies; the supervisor only learns this at its next poll tick.
  disk.alive.delete(firstPid);
  clock.advance(SERVE_POLL_MS); // poll detects death, schedules the backoff respawn
  assert.equal(handle.getStatus().state, 'restarting');
  assert.equal(deps.spawnCalls.length, 1, 'not respawned yet — still inside the backoff delay');

  clock.advance(SERVE_BACKOFF_INITIAL_MS); // backoff elapses → respawn
  assert.equal(deps.spawnCalls.length, 2, 'respawned after the initial backoff delay');
  assert.equal(handle.getStatus().state, 'running');
  assert.equal(handle.getStatus().pid, deps.spawnCalls[1]);
  handle.stop();
});

// ---------------------------------------------------------------------------
// Crash-loop backoff: doubling to a cap, reset after a healthy uptime
// ---------------------------------------------------------------------------

test('crash-loop backoff doubles on consecutive quick crashes, caps at 60s, and resets after a healthy uptime', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  const deps = makeDeps(clock, disk);
  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });

  const spawnTimes: number[] = [clock.now()];

  /** Kill the current pid immediately (quick crash, uptime ~0) and advance
   *  through detection + backoff to the next spawn; returns the observed
   *  backoff delay (time between detection-eligible tick and the respawn). */
  function crashQuicklyAndRecordNextSpawn(): number {
    const beforeSpawns = deps.spawnCalls.length;
    const pid = deps.spawnCalls[deps.spawnCalls.length - 1];
    disk.alive.delete(pid);
    clock.advance(SERVE_POLL_MS); // detect death
    const delayStart = clock.now();
    // Advance in small increments until the respawn lands, so we measure the
    // exact backoff delay rather than assuming it.
    let guard = 0;
    while (deps.spawnCalls.length === beforeSpawns) {
      clock.advance(1); // 1ms granularity — fine since we only assert the final delta
      guard += 1;
      if (guard > SERVE_BACKOFF_CAP_MS + 1000) throw new Error('respawn never landed');
    }
    spawnTimes.push(clock.now());
    return clock.now() - delayStart;
  }

  const delay1 = crashQuicklyAndRecordNextSpawn();
  assert.equal(delay1, SERVE_BACKOFF_INITIAL_MS, 'first quick crash backs off by the initial delay');

  const delay2 = crashQuicklyAndRecordNextSpawn();
  assert.equal(delay2, SERVE_BACKOFF_INITIAL_MS * 2, 'second consecutive quick crash doubles the delay');

  const delay3 = crashQuicklyAndRecordNextSpawn();
  assert.equal(delay3, SERVE_BACKOFF_INITIAL_MS * 4, 'third consecutive quick crash doubles again');

  // Keep crashing quickly until the cap is reached and stays there.
  let lastDelay = delay3;
  for (let i = 0; i < 10; i += 1) {
    const d = crashQuicklyAndRecordNextSpawn();
    assert.ok(d <= SERVE_BACKOFF_CAP_MS, `backoff ${d} must never exceed the ${SERVE_BACKOFF_CAP_MS}ms cap`);
    if (lastDelay >= SERVE_BACKOFF_CAP_MS) {
      assert.equal(d, SERVE_BACKOFF_CAP_MS, 'once capped, the delay stays at the cap');
    }
    lastDelay = d;
  }
  assert.equal(lastDelay, SERVE_BACKOFF_CAP_MS, 'repeated quick crashes converge on the cap');

  // Now let the current pid live a HEALTHY uptime before it dies.
  const healthyPid = deps.spawnCalls[deps.spawnCalls.length - 1];
  clock.advance(SERVE_MIN_UPTIME_MS); // no death yet — just polls quietly
  assert.equal(handle.getStatus().state, 'running', 'still alive and healthy through the uptime window');
  disk.alive.delete(healthyPid);
  const beforeReset = deps.spawnCalls.length;
  clock.advance(SERVE_POLL_MS); // detect death AFTER a healthy run
  let guard2 = 0;
  const resetStart = clock.now();
  while (deps.spawnCalls.length === beforeReset) {
    clock.advance(1);
    guard2 += 1;
    if (guard2 > SERVE_BACKOFF_CAP_MS + 1000) throw new Error('respawn never landed after healthy uptime');
  }
  const delayAfterHealthy = clock.now() - resetStart;
  assert.equal(delayAfterHealthy, SERVE_BACKOFF_INITIAL_MS, 'a healthy uptime resets the backoff to its initial delay');

  handle.stop();
});

// ---------------------------------------------------------------------------
// stop() — exactly one SIGTERM, polling stops, no respawn afterwards
// ---------------------------------------------------------------------------

test('stop() sends exactly one SIGTERM and stops polling', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  const deps = makeDeps(clock, disk);
  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });
  const pid = deps.spawnCalls[0];

  handle.stop();
  assert.deepEqual(deps.killed, [{ pid, signal: 'SIGTERM' }]);
  assert.equal(handle.getStatus().state, 'down');

  // Calling stop() again must never re-signal.
  handle.stop();
  assert.equal(deps.killed.length, 1, 'stop() is idempotent — never a second SIGTERM');

  // Time passing after stop() must not resume polling (isAlive would have to
  // be consulted for a poll to matter — assert via spawn/kill call counts,
  // which only change if polling is still live).
  const spawnsBefore = deps.spawnCalls.length;
  const killsBefore = deps.killed.length;
  clock.advance(10 * SERVE_POLL_MS + SERVE_BACKOFF_CAP_MS);
  assert.equal(deps.spawnCalls.length, spawnsBefore, 'no further spawns after stop()');
  assert.equal(deps.killed.length, killsBefore, 'no further signals after stop()');
});

test('no respawn after stop() — even when a backoff respawn was already pending', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  const deps = makeDeps(clock, disk);
  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });
  const pid = deps.spawnCalls[0];

  // Crash — this schedules a pending backoff respawn.
  disk.alive.delete(pid);
  clock.advance(SERVE_POLL_MS);
  assert.equal(handle.getStatus().state, 'restarting');
  assert.equal(deps.spawnCalls.length, 1);

  // Stop BEFORE the backoff elapses.
  handle.stop();
  assert.equal(deps.killed.length, 0, 'the pid that already died is never signalled');

  // Advance well past when the pending respawn would have fired.
  clock.advance(SERVE_BACKOFF_CAP_MS * 2);
  assert.equal(deps.spawnCalls.length, 1, 'the pending backoff respawn never fires after stop()');
});

// ---------------------------------------------------------------------------
// Never signal a pid twice across Studio restarts (orchestrator amendment):
// a second supervisor booting while the first's SIGTERM is still draining
// must not adopt the draining pid as healthy, must not signal it again, and
// must wait for its real exit before spawning a replacement.
// ---------------------------------------------------------------------------

test('never signals a pid twice across studio restarts — start, stop, reboot onto the still-draining pid, exit, respawn, stop', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();

  // Instance 1: boots, spawns pid A.
  const deps1 = makeDeps(clock, disk);
  const studio1 = superviseServe({ forgeRoot: '/irrelevant', ...deps1 });
  const pidA = deps1.spawnCalls[0];
  assert.equal(deps1.spawnCalls.length, 1);

  // Instance 1 stops: marks A as stopping, sends exactly one SIGTERM to A.
  // SIGTERM is not instant — A stays "alive" (draining) until it actually
  // exits, exactly like a real `forge serve` finishing its drain.
  studio1.stop();
  assert.deepEqual(deps1.killed, [{ pid: pidA, signal: 'SIGTERM' }]);
  assert.equal(disk.stoppingPid, pidA, 'the stop marker names A');
  assert.ok(disk.alive.has(pidA), 'A is still alive — draining, not yet exited');

  // Instance 2 boots while A is still alive and marked stopping: it must
  // NOT adopt A as healthy, must NOT spawn a replacement yet, and must NOT
  // signal A again.
  const deps2 = makeDeps(clock, disk, { spawnPid: () => 2000 });
  const studio2 = superviseServe({ forgeRoot: '/irrelevant', ...deps2 });
  assert.equal(deps2.spawnCalls.length, 0, 'a draining pid is never adopted nor spawned over immediately');
  assert.equal(deps2.killed.length, 0, 'a draining pid is never re-signalled at boot');
  assert.equal(studio2.getStatus().state, 'draining');
  assert.equal(studio2.getStatus().pid, pidA);

  // A finally exits (its own drain completes).
  disk.alive.delete(pidA);
  clock.advance(SERVE_POLL_MS);
  assert.equal(deps2.killed.length, 0, 'A is never signalled — it was simply waited out');
  assert.equal(deps2.spawnCalls.length, 1, 'once A is confirmed gone, instance 2 spawns a fresh serve (B)');
  const pidB = deps2.spawnCalls[0];
  assert.notEqual(pidB, pidA);
  assert.equal(studio2.getStatus().state, 'running');
  assert.equal(studio2.getStatus().pid, pidB);

  // Instance 2 stops: exactly one SIGTERM, to B — never a second one to A.
  studio2.stop();
  assert.deepEqual(deps2.killed, [{ pid: pidB, signal: 'SIGTERM' }]);
  assert.equal(deps1.killed.length, 1, 'A was signalled exactly once total, by instance 1, never again');
});
