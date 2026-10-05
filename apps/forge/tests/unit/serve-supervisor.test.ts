/**
 * serve-supervisor — `forge studio` supervises `forge serve` exactly the way
 * it supervises the bridge and the UI (D-12 as merged in #1089): there
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
  type KillOutcome,
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
 *  would share via the filesystem. `foreign` names pids that are alive but
 *  are NOT our `forge serve` (pid reuse) — disjoint from `alive` by
 *  convention in these tests, mirroring `isForgeServePid` combined with
 *  liveness at the real call sites. */
type FakeDisk = {
  pid: number | null;
  stoppingPid: number | null;
  alive: Set<number>;
  foreign: Set<number>;
};

function makeFakeDisk(): FakeDisk {
  return { pid: null, stoppingPid: null, alive: new Set(), foreign: new Set() };
}

function makeDeps(
  clock: FakeClock,
  disk: FakeDisk,
  overrides: Partial<ServeSupervisorDeps> & { spawnPid?: () => number } = {},
): ServeSupervisorDeps & {
  killed: Array<{ pid: number; signal: string }>;
  spawnCalls: number[];
  logs: string[];
  clearStaleCalls: number[];
} {
  const killed: Array<{ pid: number; signal: string }> = [];
  const spawnCalls: number[] = [];
  const logs: string[] = [];
  const clearStaleCalls: number[] = [];
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
    isAlive: overrides.isAlive ?? ((pid: number) => disk.alive.has(pid) || disk.foreign.has(pid)),
    isForgeServe: overrides.isForgeServe ?? ((pid: number) => disk.alive.has(pid) && !disk.foreign.has(pid)),
    spawn: overrides.spawn ?? defaultSpawn,
    // A SIGTERM is not instant — `forge serve` traps it and drains in-flight
    // cycles before exiting. The fake therefore records the signal but does
    // NOT remove the pid from `disk.alive`; a test that cares about the
    // process actually exiting does that itself (`disk.alive.delete(pid)`),
    // exactly as a real exit event would.
    kill:
      overrides.kill ??
      ((pid: number, signal: NodeJS.Signals): KillOutcome => {
        killed.push({ pid, signal });
        return { status: 'signalled' };
      }),
    markStopping: overrides.markStopping ?? ((pid: number) => { disk.stoppingPid = pid; }),
    clearStaleRecord:
      overrides.clearStaleRecord ??
      (() => {
        clearStaleCalls.push(1);
        disk.pid = null;
        disk.stoppingPid = null;
      }),
    setTimer: overrides.setTimer ?? clock.setTimer,
    clearTimer: overrides.clearTimer ?? clock.clearTimer,
    now: overrides.now ?? clock.now,
    wallNow: overrides.wallNow ?? clock.now,
    log: overrides.log ?? ((line: string) => logs.push(line)),
  };
  return Object.assign(deps, { killed, spawnCalls, logs, clearStaleCalls });
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
// M7-E HIGH: a spawned pid that lost the per-root serve LOCK race refuses and
// exits immediately — that is not a crash, and respawning into it would
// crash-loop against the winner forever. The supervisor must adopt the
// winner instead.
// ---------------------------------------------------------------------------

test('a spawned serve that exits because another serve already won the per-root lock is ADOPTED, never crash-looped', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  const deps = makeDeps(clock, disk);
  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });
  const losingPid = deps.spawnCalls[0];

  // The real lock's winner writes ITS pid to the same forge.pid — a
  // DIFFERENT, live, genuinely-ours serve — right as our spawned pid dies
  // having lost the race (refused + exited, not a crash).
  const winnerPid = 9999;
  disk.alive.delete(losingPid);
  disk.pid = winnerPid;
  disk.alive.add(winnerPid);

  clock.advance(SERVE_POLL_MS); // poll detects the death
  assert.equal(deps.spawnCalls.length, 1, 'never respawns against the winner');
  assert.equal(handle.getStatus().state, 'running');
  assert.equal(handle.getStatus().pid, winnerPid);

  // No backoff timer is left pending either.
  clock.advance(SERVE_BACKOFF_CAP_MS * 2);
  assert.equal(deps.spawnCalls.length, 1, 'still never respawns');
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

// ---------------------------------------------------------------------------
// Pid reuse (M7-E review MEDIUM): a pid file or stop marker names a pid the
// OS has since handed to an unrelated process must never be adopted, never
// be waited on as "draining", and must not wedge the supervisor forever —
// the stale record is cleared and a fresh `forge serve` spawns immediately.
// `disk.foreign` (see `makeFakeDisk`) stands in for such a pid: alive, but
// `isForgeServe` reports false for it.
// ---------------------------------------------------------------------------

test('boot: a MARKED pid that is alive but is no longer our serve (pid reuse) — no wait, stale record cleared, fresh spawn', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  disk.pid = 777;
  disk.stoppingPid = 777; // marked stopping by a previous instance
  disk.foreign.add(777); // alive, but NOT our serve (its number was reused)
  const deps = makeDeps(clock, disk);

  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });

  assert.equal(deps.spawnCalls.length, 1, 'spawns immediately — never waits out a foreign pid as a drain');
  assert.notEqual(handle.getStatus().pid, 777);
  assert.equal(handle.getStatus().state, 'running');
  assert.ok(deps.clearStaleCalls.length >= 1, 'the stale pid file + stop marker are cleared before spawning');
  handle.stop();
});

test('boot: an UNMARKED live pid that is not our serve (pid reuse) — not adopted; spawns fresh', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  disk.pid = 555;
  disk.foreign.add(555); // alive, but NOT our serve; no stop marker at all
  const deps = makeDeps(clock, disk);

  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });

  assert.equal(deps.spawnCalls.length, 1, 'a foreign live pid is never adopted');
  assert.notEqual(handle.getStatus().pid, 555);
  assert.ok(deps.clearStaleCalls.length >= 1, 'the stale record is cleared so a real spawnServeDetached cannot re-read it as "already running"');
  handle.stop();
});

test('drain-wait: the pid being waited out turns foreign mid-poll (its number got reused) — treated as gone, stale record cleared, fresh spawn', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();

  // Instance 1 spawns A, then stops: marks A, SIGTERMs it, A stays "alive"
  // (draining) per the usual SIGTERM-is-not-instant convention.
  const deps1 = makeDeps(clock, disk);
  const studio1 = superviseServe({ forgeRoot: '/irrelevant', ...deps1 });
  const pidA = deps1.spawnCalls[0];
  studio1.stop();
  assert.ok(disk.alive.has(pidA));

  // Instance 2 boots onto A while it is genuinely still draining (ours).
  const deps2 = makeDeps(clock, disk, { spawnPid: () => 2000 });
  const studio2 = superviseServe({ forgeRoot: '/irrelevant', ...deps2 });
  assert.equal(studio2.getStatus().state, 'draining');
  assert.equal(deps2.spawnCalls.length, 0);

  // Before A's real exit is observed, the OS hands pid A to an unrelated
  // process (the extreme case) — A is still "alive" but no longer ours.
  disk.alive.delete(pidA);
  disk.foreign.add(pidA);
  clock.advance(SERVE_POLL_MS);

  assert.equal(deps2.killed.length, 0, 'the foreign process on A is never signalled — just no longer waited on');
  assert.equal(deps2.spawnCalls.length, 1, 'treated as gone — a fresh serve spawns rather than waiting forever');
  assert.notEqual(deps2.spawnCalls[0], pidA);
  assert.ok(deps2.clearStaleCalls.length >= 1, 'the stale record is cleared before the fresh spawn');
  studio2.stop();
});

// ---------------------------------------------------------------------------
// Default kill + stop() logging (M7-E review MEDIUM): the default `kill`
// must not swallow every error, and `stop()` must log the REAL outcome
// (signalled / already gone / FAILED) rather than unconditionally claiming
// "stopping". These three drive the REAL default `kill` (no `kill` override)
// so the production `process.kill` wrapping itself is exercised.
// ---------------------------------------------------------------------------

function superviseWithRealKill(
  pid: number,
  overrides: Partial<ServeSupervisorDeps> = {},
): { logs: string[]; marked: number[]; clearStaleCalls: number[] } {
  const logs: string[] = [];
  const marked: number[] = [];
  const clearStaleCalls: number[] = [];
  const noopTimer = { setTimer: () => 0, clearTimer: () => {} };
  const handle = superviseServe({
    forgeRoot: '/irrelevant',
    readPid: () => pid,
    readStoppingPid: () => null,
    isAlive: () => true,
    isForgeServe: () => true,
    spawn: () => { throw new Error('must not spawn — a live pid is adopted'); },
    markStopping: (p: number) => { marked.push(p); },
    clearStaleRecord: () => { clearStaleCalls.push(1); },
    now: () => 0,
    log: (line: string) => { logs.push(line); },
    ...noopTimer,
    ...overrides,
  });
  handle.stop();
  return { logs, marked, clearStaleCalls };
}

test('default kill: ESRCH (pid already gone) → stop() logs "already gone", never claims it signalled, and leaves the mark (next boot clears it)', () => {
  // A pid number nothing owns — real process.kill throws ESRCH on it, the
  // same constant `packages/flows/tests/integration/daemon.test.ts` uses for
  // "definitely not a running process".
  const deadPid = 2_147_483_640;
  const { logs, marked, clearStaleCalls } = superviseWithRealKill(deadPid);

  assert.deepEqual(marked, [deadPid], 'mark-before-kill still records the pid it attempted to signal');
  assert.ok(
    logs.some((l) => /already gone/i.test(l)),
    `expected an "already gone" log line, got: ${JSON.stringify(logs)}`,
  );
  assert.ok(
    !logs.some((l) => /stopping pid .* \(SIGTERM\)/.test(l)),
    'must never claim "stopping" for a signal that was not delivered',
  );
  assert.equal(clearStaleCalls.length, 0, 'ESRCH leaves the mark — a future boot/poll clears it once observed dead');
});

test('default kill: a non-ESRCH failure (EPERM) → stop() logs FAILED with the real error code and UNDOES the premature mark', () => {
  // pid 1 (init) — this test's own process has no permission to signal it,
  // so the real process.kill(1, 'SIGTERM') reliably throws EPERM.
  const { logs, marked, clearStaleCalls } = superviseWithRealKill(1);

  assert.deepEqual(marked, [1], 'mark-before-kill recorded the pid before the signal attempt failed');
  assert.ok(
    logs.some((l) => /FAILED/.test(l) && /EPERM/.test(l)),
    `expected a FAILED log line naming EPERM, got: ${JSON.stringify(logs)}`,
  );
  assert.ok(
    !logs.some((l) => /stopping pid .* \(SIGTERM\)/.test(l)),
    'must never claim "stopping" for a signal that failed to deliver',
  );
  assert.equal(clearStaleCalls.length, 1, 'a non-ESRCH failure undoes the premature mark-before-kill');
});

test('default kill: a real, signallable child → stop() logs "stopping pid … (SIGTERM)"', async () => {
  const { spawn: spawnChild } = await import('node:child_process');
  const child = spawnChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const { logs, clearStaleCalls } = superviseWithRealKill(child.pid!);
    assert.ok(
      logs.some((l) => new RegExp(`stopping pid ${child.pid} \\(SIGTERM\\)`).test(l)),
      `expected a "stopping pid ${child.pid} (SIGTERM)" log line, got: ${JSON.stringify(logs)}`,
    );
    assert.equal(clearStaleCalls.length, 0, 'a successful signal never undoes its own mark');
  } finally {
    child.kill('SIGKILL');
  }
});

test('a spawn that throws reads as a death at uptime 0: status restarting, backoff respawn, nothing escapes the timer', () => {
  const clock = makeFakeClock();
  const disk = makeFakeDisk();
  let failing = true;
  let next = 500;
  const deps = makeDeps(clock, disk, {
    spawn: () => {
      if (failing) throw new Error('spawn EAGAIN');
      return next++;
    },
  });

  const handle = superviseServe({ forgeRoot: '/irrelevant', ...deps });
  assert.equal(handle.getStatus().pid, null, 'the failed boot spawn supervises nothing');

  clock.advance(SERVE_POLL_MS);
  assert.equal(handle.getStatus().state, 'restarting');
  assert.equal(deps.logs.some((l) => l.includes('FAILED to spawn forge serve: spawn EAGAIN')), true);

  failing = false;
  clock.advance(SERVE_BACKOFF_INITIAL_MS);
  assert.equal(handle.getStatus().state, 'running');
  assert.equal(handle.getStatus().pid, 500);
  handle.stop();
});
