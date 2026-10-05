/**
 * serve-supervisor — `forge studio` supervises `forge serve` the same way it
 * already supervises the bridge and the UI (D-12 as merged in #1089):
 * whenever serve is live it claims every eligible pending manifest, and there
 * is no operator lifecycle control over it — no start/pause/resume/stop
 * surface. The one emergency halt is a different seam (row 207) and does not
 * live here.
 *
 * `superviseServe(opts)` → `{ stop(), getStatus() }`. Every dependency
 * (reading the pid/stop-marker files, checking liveness, spawning, signalling,
 * scheduling, logging, the clock) is injected — production defaults to the
 * real `@forge/flows` daemon helpers and the real clock; tests inject fakes
 * and never touch a real process or a real timer.
 *
 * BOOT: the pid file names a pid that is genuinely alive AND genuinely our
 * `forge serve` (never merely alive — pids are reused, see `isForgeServe`)
 * and the stop marker does NOT also name it → ADOPT it (supervise that pid;
 * spawn nothing). Same pid, but the marker DOES also name it → that process
 * is DRAINING from a stop issued by a previous `forge studio` (or a previous
 * boot of this one) — never adopt it as healthy and never signal it again;
 * just wait for it to actually exit, then spawn a fresh one. Otherwise (no
 * pid, a dead one, or a live one that is not our serve) → clear whatever
 * stale pid/marker is on disk and spawn fresh.
 *
 * POLL every SERVE_POLL_MS. A supervised pid that is dead (and we are not
 * stopped) triggers a crash-loop backoff respawn: the delay starts at
 * SERVE_BACKOFF_INITIAL_MS and doubles (capped at SERVE_BACKOFF_CAP_MS) on
 * each consecutive death whose uptime was under SERVE_MIN_UPTIME_MS; a death
 * AFTER a healthy uptime resets the delay back to the initial value. A pid
 * we are only waiting out (draining, from the boot case above) is spawned
 * over immediately once it exits — that is an orderly handoff, not a crash.
 *
 * STOP: clears whatever is pending (poll or backoff timer) and, if a pid is
 * currently supervised, marks it stopping and sends it exactly ONE SIGTERM —
 * never a second one, and never to a pid the stop marker already names (that
 * pid belongs to someone else's stop). The drain itself is not awaited; the
 * detached `forge serve` finishes in-flight cycles on its own. The log states
 * the real outcome of that signal — delivered, already gone, or failed (and
 * undoes the mark on a failed delivery) — never an unconditional "stopping".
 *
 * Every boot/spawn/respawn/stop transition logs one line via the injected
 * `log`, including the pid and, for a respawn, why (exit → backoff delay).
 */

import {
  daemonPaths,
  readPid as readPidFile,
  isAlive as isAliveImpl,
  spawnServeDetached,
  markStopping as markStoppingFile,
  clearPidFile as clearPidFileImpl,
} from '@forge/flows';
import { isForgeServePid } from '@forge/kernel';

export const SERVE_POLL_MS = 2_000;
export const SERVE_MIN_UPTIME_MS = 30_000;
export const SERVE_BACKOFF_INITIAL_MS = 1_000;
export const SERVE_BACKOFF_CAP_MS = 60_000;

/** The supervisor's own read-only view of serve's liveness — what the bridge
 *  health route and the Studio UI read (never operator-controllable). */
export type ServeSupervisorState = 'running' | 'draining' | 'restarting' | 'down' | 'unsupervised';

export type ServeSupervisorStatus = {
  state: ServeSupervisorState;
  pid: number | null;
  /** Count of respawns THIS instance has performed after a detected crash
   *  (never counts the initial boot adopt/spawn, nor a drain hand-off). */
  restarts: number;
  /** ISO instant the pending backoff respawn will fire, else null. */
  nextRestartAt: string | null;
};

/** The status a caller with no supervisor at all reports (dry-bridge, or the
 *  ATTACH path, which never supervises). Exported so callers that have no
 *  `ServeSupervisorHandle` can still answer the same shape. */
export const UNSUPERVISED_SERVE_STATUS: ServeSupervisorStatus = {
  state: 'unsupervised',
  pid: null,
  restarts: 0,
  nextRestartAt: null,
};

/** What the default `kill` reports back to `stop()` so it can log the REAL
 *  outcome instead of unconditionally claiming success: `signalled` (the
 *  SIGTERM was delivered), `gone` (ESRCH — the pid had already exited), or
 *  `failed` (any other error, e.g. EPERM — the signal was NOT delivered,
 *  carrying the error's `code`, or its message when there is none). */
export type KillOutcome = { status: 'signalled' } | { status: 'gone' } | { status: 'failed'; code: string };

/** The injected test seam. Production defaults (see `superviseServe`) wrap
 *  the real `@forge/flows` daemon helpers, `process.kill`, `setTimeout` and
 *  `Date.now`. */
export type ServeSupervisorDeps = {
  /** The on-disk pid file's recorded pid, or null when absent/unparseable. */
  readPid: () => number | null;
  /** The on-disk stop marker's recorded pid, or null when absent. */
  readStoppingPid: () => number | null;
  /** True when `pid` is a genuinely running process. */
  isAlive: (pid: number) => boolean;
  /** True when `pid` is genuinely OUR `forge serve` — not merely alive. A
   *  pid file or stop marker can outlive the process it named; the OS then
   *  reuses the number for something else. Call sites combine this with
   *  `isAlive` (`isAlive(pid) && isForgeServe(pid)`) — a live pid that fails
   *  this is treated as dead for adoption and drain-wait purposes. */
  isForgeServe: (pid: number) => boolean;
  /** Spawn a fresh detached `forge serve`, returning its pid. */
  spawn: () => number;
  /** Signal a pid; reports the real outcome (see {@link KillOutcome}) —
   *  never swallows an error it cannot explain as "already gone". */
  kill: (pid: number, signal: NodeJS.Signals) => KillOutcome;
  /** Record that `pid` was just signalled to stop (the drain marker other
   *  supervisor instances must honour at boot). */
  markStopping: (pid: number) => void;
  /** Clear the on-disk pid file AND stop marker together — the record a
   *  stale (dead, reused, or never-delivered-a-signal) pid left behind, so
   *  neither a later boot/poll nor a fresh `spawn` misreads it. */
  clearStaleRecord: () => void;
  /** Schedule `fn` to run after `ms`; returns an opaque handle. */
  setTimer: (fn: () => void, ms: number) => unknown;
  /** Cancel a handle returned by `setTimer`. */
  clearTimer: (handle: unknown) => void;
  /** A MONOTONIC clock, in ms (default `performance.now()`) — durations only
   *  (uptime, backoff); immune to a system wall-clock jump. */
  now: () => number;
  /** Wall-clock ms (default `Date.now()`) — used ONLY to render
   *  `nextRestartAt` as a real ISO instant for the operator. */
  wallNow: () => number;
  /** One line per boot/spawn/respawn/stop transition. */
  log: (line: string) => void;
};

export type SuperviseServeOptions = Partial<ServeSupervisorDeps> & {
  /** The forge install root — resolves the real pid/stop-marker files and the
   *  real `spawnServeDetached` target when a dep is not injected. */
  forgeRoot: string;
  /** Log prefix for the default `log` — `[forge studio]` (canonical) or
   *  `[forge watch]` (deprecated alias). Defaults to `[forge studio]`. */
  logLabel?: string;
};

export type ServeSupervisorHandle = {
  /** Clear pending timers and, if a pid is currently supervised, mark it
   *  stopping and send it exactly one SIGTERM. Idempotent. Does not await
   *  the drain. */
  stop(): void;
  /** The current read-only status — what the bridge health route reports. */
  getStatus(): ServeSupervisorStatus;
};

function resolveDeps(opts: SuperviseServeOptions): ServeSupervisorDeps {
  const { forgeRoot } = opts;
  const label = opts.logLabel ?? '[forge studio]';
  const paths = daemonPaths(forgeRoot);
  return {
    readPid: opts.readPid ?? (() => readPidFile(paths.pidFile)),
    readStoppingPid: opts.readStoppingPid ?? (() => readPidFile(paths.stoppingFile)),
    isAlive: opts.isAlive ?? ((pid: number) => isAliveImpl(pid)),
    isForgeServe: opts.isForgeServe ?? ((pid: number) => isForgeServePid(pid, forgeRoot)),
    spawn:
      opts.spawn ??
      (() => {
        const result = spawnServeDetached(forgeRoot);
        if (result !== null) return result.pid;
        // A live daemon already owns the pid file (a boot-time race between
        // two supervisors) — adopt it rather than treating this as failure.
        const pid = readPidFile(paths.pidFile);
        if (pid === null) {
          throw new Error('serve-supervisor: spawnServeDetached reported a live daemon but no pid file is present');
        }
        return pid;
      }),
    kill:
      opts.kill ??
      ((pid: number, signal: NodeJS.Signals): KillOutcome => {
        try {
          process.kill(pid, signal);
          return { status: 'signalled' };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code === 'ESRCH') return { status: 'gone' };
          return { status: 'failed', code: code ?? (err as Error)?.message ?? String(err) };
        }
      }),
    markStopping: opts.markStopping ?? ((pid: number) => markStoppingFile(forgeRoot, pid)),
    clearStaleRecord: opts.clearStaleRecord ?? (() => clearPidFileImpl(forgeRoot)),
    setTimer: opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)),
    clearTimer: opts.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout)),
    now: opts.now ?? (() => performance.now()),
    wallNow: opts.wallNow ?? (() => Date.now()),
    log: opts.log ?? ((line: string) => console.log(`${label} serve ${line}`)),
  };
}

export function superviseServe(opts: SuperviseServeOptions): ServeSupervisorHandle {
  const deps = resolveDeps(opts);

  let stopped = false;
  /** The pid we currently supervise as "ours, running" — null while there is
   *  nothing live under our care (a backoff respawn is pending, or we're
   *  waiting out someone else's drain). */
  let currentPid: number | null = null;
  let startedAt = 0;
  let backoffMs: number = SERVE_BACKOFF_INITIAL_MS;
  let restarts = 0;
  /** Non-null while waiting, at boot, for a pid ANOTHER stop already
   *  signalled to finish draining — never adopted, never signalled by us. */
  let drainingPid: number | null = null;
  let pendingHandle: unknown = null;
  let nextRestartAtMs: number | null = null;

  function schedulePoll(): void {
    pendingHandle = deps.setTimer(poll, SERVE_POLL_MS);
    nextRestartAtMs = null;
  }

  function scheduleRespawn(delayMs: number): void {
    nextRestartAtMs = deps.wallNow() + delayMs;
    pendingHandle = deps.setTimer(() => {
      pendingHandle = null;
      if (stopped) return;
      doSpawn(true);
      schedulePoll();
    }, delayMs);
  }

  function clearPending(): void {
    if (pendingHandle !== null) {
      deps.clearTimer(pendingHandle);
      pendingHandle = null;
    }
    nextRestartAtMs = null;
  }

  function doSpawn(isRestart: boolean): void {
    startedAt = deps.now();
    if (isRestart) restarts += 1;
    try {
      const pid = deps.spawn();
      currentPid = pid;
      deps.log(`${isRestart ? 'respawned' : 'spawned'} pid ${pid}`);
    } catch (err) {
      // A spawn that throws is a death at uptime 0: the next poll sees no
      // pid and takes the crash-loop backoff, and the status reads
      // `restarting` — never an exception escaping a timer into Studio.
      currentPid = null;
      deps.log(`FAILED to spawn forge serve: ${(err as Error).message}`);
    }
  }

  function poll(): void {
    pendingHandle = null;
    if (stopped) return;

    if (drainingPid !== null) {
      const alive = deps.isAlive(drainingPid);
      if (alive && deps.isForgeServe(drainingPid)) {
        schedulePoll();
        return;
      }
      // Either it exited, or (pid reuse) the OS handed its number to an
      // unrelated process while we waited — both mean nothing is left to
      // drain. Clear the stale record before spawning (M7-E review MEDIUM).
      deps.log(
        alive
          ? `drained pid ${drainingPid} is alive but is no longer our serve — treating as gone`
          : `drained pid ${drainingPid} has exited — spawning`,
      );
      drainingPid = null;
      deps.clearStaleRecord();
      doSpawn(false);
      schedulePoll();
      return;
    }

    if (currentPid !== null && deps.isAlive(currentPid)) {
      schedulePoll();
      return;
    }

    const diedPid = currentPid;
    currentPid = null;

    // M7-E HIGH: a pid we SPAWNED can die at uptime ~0 because it lost the
    // per-root serve lock race — refusing and exiting, never a crash. Re-read
    // the pid file BEFORE taking the backoff path: a DIFFERENT, live,
    // genuinely-ours pid there is that race's winner — adopt it rather than
    // respawning into the same lock it would also lose.
    const winnerPid = deps.readPid();
    if (winnerPid !== null && winnerPid !== diedPid && deps.isAlive(winnerPid) && deps.isForgeServe(winnerPid)) {
      currentPid = winnerPid;
      startedAt = deps.now();
      backoffMs = SERVE_BACKOFF_INITIAL_MS;
      deps.log(`pid ${diedPid} exited — pid ${winnerPid} already holds the lock; adopting it`);
      schedulePoll();
      return;
    }

    // Otherwise a genuine crash. Measure its uptime to decide the backoff
    // delay before respawning: a quick death doubles the delay (capped); a
    // healthy uptime resets it.
    const uptime = deps.now() - startedAt;
    if (uptime >= SERVE_MIN_UPTIME_MS) backoffMs = SERVE_BACKOFF_INITIAL_MS;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, SERVE_BACKOFF_CAP_MS);
    deps.log(`pid ${diedPid} exited after ${uptime}ms — respawning in ${delay}ms`);
    scheduleRespawn(delay);
  }

  function boot(): void {
    const pid = deps.readPid();
    if (pid !== null) {
      const alive = deps.isAlive(pid);
      const ours = alive && deps.isForgeServe(pid);
      const stoppingPid = deps.readStoppingPid();
      if (stoppingPid === pid) {
        if (ours) {
          // Someone already signalled THIS pid to stop — it is draining, not
          // healthy. Never adopt it, never signal it again; just wait it out.
          drainingPid = pid;
          deps.log(`pid ${pid} is draining (already signalled to stop) — waiting for it to exit`);
          schedulePoll();
          return;
        }
        // The marked pid is gone, or (pid reuse) no longer our serve —
        // nothing is left to drain. Clear the stale record (review MEDIUM)
        // and fall through to spawn fresh below.
        deps.log(`pid ${pid} was marked stopping but is ${alive ? 'no longer our serve' : 'gone'} — clearing the stale record`);
        deps.clearStaleRecord();
      } else if (ours) {
        currentPid = pid;
        startedAt = deps.now();
        deps.log(`adopted pid ${pid}`);
        schedulePoll();
        return;
      } else if (alive) {
        // A live process sits on the recorded pid, but it is not our `forge
        // serve` (pid reuse) — never adopt a stranger. Clear the stale
        // record so the default `spawn` (which itself treats "pid file names
        // a live process" as already-running) cannot re-read this same
        // foreign pid back as its own result.
        deps.log(`pid ${pid} is alive but is not our serve — not adopting; clearing the stale record`);
        deps.clearStaleRecord();
      }
    }
    doSpawn(false);
    schedulePoll();
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearPending();
    const pidToSignal = currentPid;
    currentPid = null;
    drainingPid = null;
    if (pidToSignal !== null && deps.readStoppingPid() !== pidToSignal) {
      // Mark BEFORE signalling, not after: two `forge studio` instances can
      // race this exact stop, and marking first is what lets the SECOND
      // caller's `readStoppingPid() !== pidToSignal` guard above see the
      // FIRST caller's mark in time to skip its own signal — avoiding a
      // double SIGTERM. The marker means "this pid was asked to drain", so a
      // signal that provably never reached it (anything but ESRCH) UNDOES
      // the mark immediately below — only ESRCH (already gone) leaves it,
      // since a future boot/poll already clears a marked-but-dead pid on its
      // own (review MEDIUM).
      deps.markStopping(pidToSignal);
      const outcome = deps.kill(pidToSignal, 'SIGTERM');
      if (outcome.status === 'signalled') {
        deps.log(`stopping pid ${pidToSignal} (SIGTERM)`);
      } else if (outcome.status === 'gone') {
        deps.log(`pid ${pidToSignal} was already gone before the stop signal`);
      } else {
        deps.log(`FAILED to signal pid ${pidToSignal}: ${outcome.code} — not marked as stopping`);
        deps.clearStaleRecord();
      }
    }
  }

  function getStatus(): ServeSupervisorStatus {
    if (stopped) return { state: 'down', pid: null, restarts, nextRestartAt: null };
    if (drainingPid !== null) return { state: 'draining', pid: drainingPid, restarts, nextRestartAt: null };
    if (currentPid !== null) return { state: 'running', pid: currentPid, restarts, nextRestartAt: null };
    return {
      state: 'restarting',
      pid: null,
      restarts,
      nextRestartAt: nextRestartAtMs !== null ? new Date(nextRestartAtMs).toISOString() : null,
    };
  }

  boot();

  return { stop, getStatus };
}
