/**
 * Daemon control for `forge serve`: `forge studio` adopts a live one or
 * spawns one detached (apps/forge/serve-supervisor.ts), so the operator's
 * shell can come and go without stranding an in-flight initiative.
 *
 * State lives on disk (consistent with the file-based queue, ADR 011):
 *   _logs/daemon/forge.pid   — pid of the detached `forge serve`
 *   _logs/daemon/serve.log   — its stdout/stderr
 *   _logs/daemon/stopping    — the pid a stop was SIGNALLED to (W7-FIX-A3):
 *                              `stopping` while THAT pid is still alive
 *                              (draining in-flight cycles); a different or
 *                              dead pid never inherits it, and a supervisor
 *                              booting onto a pid this names waits for its
 *                              exit rather than adopting or re-signalling it
 *
 * This module is pure helpers + pid-file I/O only.
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { isProcessRunning } from '@forge/kernel';

export type DaemonPaths = {
  dir: string;
  pidFile: string;
  logFile: string;
  /** W7-FIX-A3: the stop marker — the pid a SIGTERM was sent to. */
  stoppingFile: string;
};

/** Resolve the daemon's runtime files under the forge install root. */
export function daemonPaths(forgeRoot: string): DaemonPaths {
  const dir = resolve(forgeRoot, '_logs', 'daemon');
  return {
    dir,
    pidFile: join(dir, 'forge.pid'),
    logFile: join(dir, 'serve.log'),
    stoppingFile: join(dir, 'stopping'),
  };
}

/** Read the recorded pid, or null if absent / unparseable. */
export function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True iff `pid` is genuinely RUNNING — delegates to `@forge/kernel`'s
 *  `isProcessRunning` (forge-8vfn.8.1.6: `kill(pid,0)` alone counts a ZOMBIE
 *  as alive). `procRoot` is a test seam only. */
export function isAlive(pid: number, procRoot?: string): boolean {
  return isProcessRunning(pid, procRoot);
}

/**
 * W7-FIX-A3: record the pid a stop was signalled to. Presence alone means
 * nothing: a caller compares it against a LIVE pid (`apps/forge/serve-
 * supervisor.ts`'s boot check, and `isStopping` below) — a marker left behind
 * by a finished drain never sticks to the next daemon, because the pid it
 * names is no longer alive.
 */
export function markStopping(forgeRoot: string, pid: number): void {
  const { dir, stoppingFile } = daemonPaths(forgeRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(stoppingFile, String(pid));
}

/**
 * W7-FIX-A3 (round-2 finding 9): drop the stop marker. It records a
 * TRANSITION (this pid was signalled and is draining), so it must not outlive
 * the pid file it describes — pids are reused, so a leftover marker would
 * make a brand-new daemon that happens to draw the same pid read as
 * draining forever, until someone deleted the file by hand. Both pid-file
 * writes below clear it; absent is a no-op.
 */
function clearStoppingMarker(forgeRoot: string): void {
  const { stoppingFile } = daemonPaths(forgeRoot);
  if (!existsSync(stoppingFile)) return;
  try {
    rmSync(stoppingFile);
  } catch {
    /* best-effort */
  }
}

/** Stale pid file (no live process) → clean it so `start` can proceed. */
export function reapStalePidFile(forgeRoot: string): void {
  const { pidFile } = daemonPaths(forgeRoot);
  const pid = readPid(pidFile);
  if (pid !== null && !isAlive(pid) && existsSync(pidFile)) {
    try {
      rmSync(pidFile);
    } catch {
      /* best-effort */
    }
  }
}

export function writePidFile(forgeRoot: string, pid: number): void {
  const { dir, pidFile } = daemonPaths(forgeRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(pidFile, String(pid));
  // A pid file is written by a daemon that is STARTING (spawnServeDetached
  // records its child here) — never one that is draining.
  clearStoppingMarker(forgeRoot);
}

export function clearPidFile(forgeRoot: string): void {
  const { pidFile } = daemonPaths(forgeRoot);
  if (existsSync(pidFile)) {
    try {
      rmSync(pidFile);
    } catch {
      /* best-effort */
    }
  }
  // The daemon this marker described is gone — the drain it recorded ended.
  clearStoppingMarker(forgeRoot);
}

// ---------- detached daemon spawn ----------

/**
 * Spawn `forge serve` (forever) as a detached process and record its pid.
 * `apps/forge/serve-supervisor.ts` calls this directly — `forge studio` is
 * the operator surface; it never shells out to a `forge start` CLI command.
 * stdout/stderr land in `_logs/daemon/serve.log`, the child is detached +
 * unref'd so it outlives the caller, and its pid is persisted to
 * `_logs/daemon/forge.pid`.
 *
 * Returns `{ pid, logFile }` on a fresh spawn, or `null` if a live daemon is
 * already running (the caller adopts that pid instead). Throws if the spawn
 * itself fails to produce a pid.
 *
 * Keep this dependency-free of the scheduler/queue: daemon.ts is imported BY
 * the scheduler (one-way edge), so it must not import back.
 */
export function spawnServeDetached(forgeRoot: string): { pid: number; logFile: string } | null {
  reapStalePidFile(forgeRoot);
  const pid = readPid(daemonPaths(forgeRoot).pidFile);
  if (pid !== null && isAlive(pid)) return null;

  const { dir, logFile } = daemonPaths(forgeRoot);
  mkdirSync(dir, { recursive: true });
  const logFd = openSync(logFile, 'a');
  const cliPath = resolve(forgeRoot, 'apps', 'forge', 'cli.ts');
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', cliPath, 'serve'],
    {
      cwd: forgeRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  child.unref();
  if (typeof child.pid !== 'number') {
    throw new Error('spawnServeDetached: failed to spawn the scheduler process');
  }
  writePidFile(forgeRoot, child.pid);
  return { pid: child.pid, logFile };
}
