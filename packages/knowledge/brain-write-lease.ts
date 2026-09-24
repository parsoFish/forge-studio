/**
 * forge-ler4 — the ONE lock a brain-writing turn takes, so the daemon's
 * reflector and a Studio KB job (drain/consolidate/`forge brain fix`) can
 * never have their writes to the SAME `brain/` tree misattributed to each
 * other. Rationale, the race, and why `proper-lockfile` (reused, not new):
 * `design.md`'s "Brain-write lease (forge-ler4)" section.
 */
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
export async function acquireBrainWriteLease(forgeRoot: string): Promise<() => Promise<void>> {
  const target = brainRootDir(forgeRoot);
  try {
    return await lockfile.lock(target, {
      stale: BRAIN_WRITE_LEASE_STALE_MS,
      retries: { ...BRAIN_WRITE_LEASE_RETRIES },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new BrainWriteLeaseContentionError(
        `brain-write-lease: brain/ is locked by another writer (${target}.lock) — the daemon's reflector or a Studio KB job (drain/consolidate/brain-fix) is mid-turn. Refused rather than risking a misattributed write; retry once it releases.`,
      );
    }
    throw err;
  }
}
