/**
 * preflight.mjs — memory and the host lock, both ported lessons.
 *
 * MEMORY. A memory-starved host OOM-kills the browser and produces a trailing
 * cluster of `Target crashed` failures that read exactly like code defects
 * (measured on this 13 GB box with a foreign 10 GB process). The runner
 * refuses up front and names the symptom, so nobody spends 45 minutes reading
 * a crash as a product bug. If the figure cannot be read, it refuses too —
 * "we could not tell" is not "there is plenty".
 *
 * HOST LOCK. 4123/4124 are host-global, so exactly one story run may hold the
 * host at a time. The lock therefore lives in the OS temp dir, NOT in the
 * worktree: a lock inside the repo gives every worktree its own lock file, so
 * two lanes would each acquire "the" lock and both run — a per-repo lock on a
 * host-global resource is not a lock at all. Implemented with
 * `proper-lockfile`, already a dependency here — no new one, and it handles
 * staleness for us rather than us hand-rolling a PID file (and a holder PID is
 * not a liveness check anyway).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import lockfile from 'proper-lockfile';

/**
 * The floor, in MB of MemAvailable. Chosen as the headroom a chromium context
 * plus a production Next server need on this host; below it the browser is
 * the thing that dies, not the code under test.
 */
export const MIN_AVAILABLE_MB = 1500;

/** Pure: judge an available-MB figure. */
export function memoryVerdict(availableMb) {
  if (typeof availableMb !== 'number' || !Number.isFinite(availableMb)) {
    return Object.freeze({
      ok: false,
      reason:
        'could not read MemAvailable from /proc/meminfo. Refusing rather than assuming there is ' +
        `enough: a story run under memory pressure dies with "Target crashed", which reads exactly ` +
        'like a code defect.',
    });
  }
  if (availableMb < MIN_AVAILABLE_MB) {
    return Object.freeze({
      ok: false,
      reason:
        `only ${availableMb} MB available, floor is ${MIN_AVAILABLE_MB} MB. Refusing: at this level ` +
        'the browser is OOM-killed and the run fails with "Target crashed" — that is memory, not code. ' +
        'Free memory (check for a leaked process) and re-run.',
    });
  }
  return Object.freeze({ ok: true, reason: `${availableMb} MB available` });
}

/** Read MemAvailable in MB, or null when it cannot be read. */
export function readAvailableMb(meminfoPath = '/proc/meminfo') {
  try {
    const m = readFileSync(meminfoPath, 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return m ? Math.floor(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

/**
 * Take the host lock. Returns a release function.
 *
 * The lock file lives under the gitignored operator root so it is never
 * committed and never collides with a tracked path.
 */
export function hostLockPath() {
  return join(tmpdir(), 'forge-stories-host.lock');
}

export async function acquireHostLock() {
  const lockPath = hostLockPath();
  if (!existsSync(lockPath)) writeFileSync(lockPath, 'forge story runner host lock\n');
  try {
    return await lockfile.lock(lockPath, { stale: 30 * 60 * 1000, retries: 0 });
  } catch (e) {
    throw new Error(
      `another story run holds the host lock (${lockPath}): ${e?.message ?? e}. ` +
        'Ports 4123/4124 are host-global — exactly one story run at a time.',
    );
  }
}
