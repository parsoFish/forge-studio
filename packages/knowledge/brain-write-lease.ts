/**
 * forge-ler4 — the ONE lock a brain-writing turn takes, so the daemon's
 * reflector and a Studio KB job (drain/consolidate/`forge brain fix`) can
 * never have their writes to the SAME `brain/` tree misattributed to each
 * other. Rationale, the race, and why `proper-lockfile` (reused, not new):
 * `design.md`'s "Brain-write lease (forge-ler4)" section.
 */
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

import lockfile from 'proper-lockfile';

import { brainRootDir } from './kb-drain-edit-soundness.ts';

/** ~1.55s of retry patience — same budget `community-registry-lock.ts` uses
 *  for the analogous mutex. The window is deliberately narrow (a turn's
 *  START, not its whole body — `design.md`), so a bounded wait then a typed
 *  refusal is correct rather than hanging a drain round on a lease that may
 *  be held for minutes. */
export const BRAIN_WRITE_LEASE_RETRIES = Object.freeze({ retries: 5, minTimeout: 50 });

/** How old a lease's mtime may get before `proper-lockfile` compromises it.
 *  A live holder self-refreshes every `stale / 2` ms for as long as it holds
 *  the lease — even across a multi-minute spawn — so this only needs to
 *  cover the gap BETWEEN refreshes; a crashed holder's lease self-clears
 *  after this long instead of wedging brain/ forever. */
export const BRAIN_WRITE_LEASE_STALE_MS = 15_000;
/** How long past its last refresh a lock's holder PID is trusted — a PID reused by an unrelated
 *  process cannot hold the lease forever (forge-8vfn.8.1.21). */
export const BRAIN_WRITE_LEASE_PID_TRUST_MS = 4 * BRAIN_WRITE_LEASE_STALE_MS;

/** Contention, and ONLY contention — never a real I/O fault. Named so a
 *  caller can answer with a typed, visible refusal without pattern-matching
 *  a message, and so a genuine fault (EACCES, ENOSPC) is never mistaken for
 *  one and silently swallowed. */
export class BrainWriteLeaseContentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainWriteLeaseContentionError';
    Object.setPrototypeOf(this, BrainWriteLeaseContentionError.prototype);
  }
}

/** Test-only lock relocation (design.md, forge-ler4); unset ⇒ unchanged. */
export type BrainWriteLeaseOptions = { lockfilePath?: string };

/**
 * forge-8vfn.8.1.21 — mtime staleness alone has no notion of whether the holder is still running,
 * and a CPU-starved event loop can delay a live holder's `update` refresh past
 * `BRAIN_WRITE_LEASE_STALE_MS`, so a contender reclaimed a still-held lease. The holder records its
 * PID beside the lock, and a live PID refuses BEFORE any mtime reclaim. A missing record (a holder
 * that crashed before writing it) or a dead PID falls through to the mtime path, so a crashed
 * holder still self-clears; a record older than `BRAIN_WRITE_LEASE_PID_TRUST_MS` is not trusted, so
 * a reused PID cannot hold forever. Anything unreadable is UNKNOWN, and UNKNOWN refuses (§6.15).
 */
const HOLDER_PID_SUFFIX = '.holder-pid';

const errCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errCode(err) !== 'ESRCH';
  }
}

function heldByLiveHolder(lockfilePath: string, pidFilePath: string): boolean {
  let ageMs: number;
  try {
    ageMs = Date.now() - statSync(lockfilePath).mtimeMs;
  } catch (err) {
    return errCode(err) !== 'ENOENT';
  }
  if (ageMs > BRAIN_WRITE_LEASE_PID_TRUST_MS) return false;
  let raw: string;
  try {
    raw = readFileSync(pidFilePath, 'utf8').trim();
  } catch (err) {
    return errCode(err) !== 'ENOENT';
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  return isPidAlive(pid);
}

/**
 * Take the brain-write lease. Resolves to the release function; throws
 * `BrainWriteLeaseContentionError` when another writer holds it, and
 * re-throws anything else (a real I/O fault) unchanged — the caller must
 * treat that as fatal, never as "proceed unguarded".
 *
 * The caller is responsible for `brain/` already existing (both real
 * callers already ensure this) — `proper-lockfile` requires its target to
 * exist, and creating it here on a lease that then fails would leave a
 * directory behind the refusal.
 */
export async function acquireBrainWriteLease(forgeRoot: string, opts: BrainWriteLeaseOptions = {}): Promise<() => Promise<void>> {
  const target = brainRootDir(forgeRoot), lockfilePath = opts.lockfilePath ?? `${target}.lock`;
  const pidFilePath = `${lockfilePath}${HOLDER_PID_SUFFIX}`;
  const contentionError = () =>
    new BrainWriteLeaseContentionError(
      `brain-write-lease: brain/ is locked by another writer (${lockfilePath}) — the daemon's reflector or a Studio KB job (drain/consolidate/brain-fix) is mid-turn. Refused rather than risking a misattributed write; retry once it releases.`,
    );

  if (heldByLiveHolder(lockfilePath, pidFilePath)) throw contentionError();

  try {
    const release = await lockfile.lock(target, {
      stale: BRAIN_WRITE_LEASE_STALE_MS,
      retries: { ...BRAIN_WRITE_LEASE_RETRIES },
      lockfilePath,
      onCompromised: (err: Error) => {
        console.error(`brain-write-lease: lease compromised while held (${lockfilePath}): ${err.message}`);
        throw err;
      },
    });
    writeFileSync(pidFilePath, String(process.pid));
    return async () => {
      try {
        await release();
      } finally {
        try {
          unlinkSync(pidFilePath);
        } catch (err) {
          if (errCode(err) !== 'ENOENT') {
            const why = String(err);
            console.error(`brain-write-lease: could not remove holder record ${pidFilePath}: ${why}`);
          }
        }
      }
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOCKED') throw contentionError();
    throw err;
  }
}
