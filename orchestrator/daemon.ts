/**
 * Daemon + poll-toggle control for `forge serve`.
 *
 * Why this exists: `forge serve` is a long-lived foreground process. An
 * operator who closes the terminal (or doesn't realise it must stay open)
 * kills it mid-cycle and strands the in-flight initiative. The daemon
 * commands run `forge serve` detached so the shell can come and go, plus a
 * file-flag poll toggle so the operator can stop/resume *claiming new work*
 * without tearing the process down.
 *
 * State lives on disk (consistent with the file-based queue, ADR 011):
 *   _logs/daemon/forge.pid   — pid of the detached `forge serve`
 *   _logs/daemon/serve.log   — its stdout/stderr
 *   <queueRoot>/.paused      — presence = scheduler won't claim new work
 *
 * This module is pure helpers + flag I/O only. It must NOT import the
 * scheduler (the scheduler imports `isPaused` from here — keep that edge
 * one-way to avoid a cycle).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type DaemonPaths = {
  dir: string;
  pidFile: string;
  logFile: string;
};

/** Resolve the daemon's runtime files under the forge install root. */
export function daemonPaths(forgeRoot: string): DaemonPaths {
  const dir = resolve(forgeRoot, '_logs', 'daemon');
  return {
    dir,
    pidFile: join(dir, 'forge.pid'),
    logFile: join(dir, 'serve.log'),
  };
}

/** Read the recorded pid, or null if absent / unparseable. */
export function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True iff a process with this pid is alive (signal 0 probe). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours to signal → still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type DaemonState = {
  running: boolean;
  pid: number | null;
  /** Wall-clock ISO the pid file was written (≈ daemon start), if running. */
  startedAt: string | null;
  paused: boolean;
};

export function daemonState(forgeRoot: string, queueRoot: string): DaemonState {
  const { pidFile } = daemonPaths(forgeRoot);
  const pid = readPid(pidFile);
  const running = pid !== null && isAlive(pid);
  let startedAt: string | null = null;
  if (running && existsSync(pidFile)) {
    try {
      startedAt = new Date(statSync(pidFile).mtimeMs).toISOString();
    } catch {
      /* best-effort */
    }
  }
  return { running, pid: running ? pid : null, startedAt, paused: isPaused(queueRoot) };
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
}

// ---------- poll toggle (pause/resume) ----------

/**
 * The pause flag lives at `<queueRoot>/.paused`. Presence (not contents)
 * is the signal; we still write a timestamp + reason for the operator.
 */
export function pausedFlagPath(queueRoot = '_queue'): string {
  return join(resolve(queueRoot), '.paused');
}

export function isPaused(queueRoot = '_queue'): boolean {
  return existsSync(pausedFlagPath(queueRoot));
}

export function setPaused(paused: boolean, queueRoot = '_queue', reason = ''): void {
  const flag = pausedFlagPath(queueRoot);
  if (paused) {
    mkdirSync(dirname(flag), { recursive: true });
    writeFileSync(
      flag,
      `paused_at: ${new Date().toISOString()}\nreason: ${reason || '(none)'}\n`,
    );
  } else if (existsSync(flag)) {
    try {
      rmSync(flag);
    } catch {
      /* best-effort */
    }
  }
}
