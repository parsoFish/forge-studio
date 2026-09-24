/**
 * forge-ler4 — the ONE lock a brain-writing turn takes, so the daemon's
 * reflector and a Studio KB job (drain / consolidate / `forge brain fix`)
 * can never have their writes to the SAME `brain/` tree misattributed to
 * each other.
 *
 * THE RACE. `kb-drain-edit-soundness.ts`'s `guardAgentKbEdits` decides what a
 * turn wrote by diffing a filesystem snapshot taken before the turn against
 * the tree after it, and a turn takes minutes. Any OTHER process's brain/
 * write inside that window is indistinguishable from the turn's own; for a
 * path INSIDE the turn's own KB the gate disposes of it on snapshot evidence
 * alone (`revertChange` — an rmSync for a file the write CREATED). Meanwhile
 * `orchestrator/phases/reflector.ts` writes brain themes from the daemon on
 * exactly the same tree, and `deriveKbActiveJob` (kb-job-state.ts) gates KB
 * jobs PER-KB — it takes no account of the reflector at all. An operator
 * clicking "Drain to green" while a cycle reflects is entirely reachable, and
 * nothing serialises the two. See `kb-drain-edit-soundness.ts`'s own
 * `outOfScopeNotDisposed` for the operator-facing half of this.
 *
 * `proper-lockfile` is already a direct dependency and this repo's
 * established primitive for exactly this shape — one directory locked, ELOCKED
 * translated to a named error class (`packages/library/community-registry-lock.ts`,
 * the same two-writer mutex problem; the verdict lock in
 * `packages/flows/bridge-studio-runs.ts`; `packages/flows/drain-fix-loop.ts`;
 * `packages/flows/manifest.ts`). Nothing new is introduced here.
 *
 * SCOPE. The lease wraps ONE brain-writing turn at a time: the reflector's own
 * SDK spawn plus its post-exit brain writes (retention frontmatter patch,
 * per-KB health), and — the shared choke point for the drain's round loop,
 * `runBrainConsolidateNow`, and `forge brain fix` alike — `runBrainFixTurn`
 * (`packages/sessions/kinds/brain-fix.ts`). W8-F1's own precedent: "guarding a
 * call site closes a door; guarding the turn closes the class." It does NOT
 * additionally wrap the drain's own extra re-audit around its injectable
 * `runFixTurn` seam (bridge-studio-kb-drain.ts — defence against a
 * test-stubbed turn bypassing the real gate): that diff runs synchronously
 * around the lease-protected call with no `await` in between, so its residual
 * window is microseconds of glue code, not the minutes-long spawn this bead
 * is about.
 *
 * LOCK TARGET. `brainRootDir(forgeRoot)` — the SAME `<forgeRoot>/brain` the
 * edit-soundness gate snapshots, reused rather than re-derived so the two can
 * never disagree about which tree they mean. Both writers already require it
 * to exist before they may write anything under it.
 */
import lockfile from 'proper-lockfile';

import { brainRootDir } from './kb-drain-edit-soundness.ts';

/**
 * Retry budget for a contended brain-write lease: 5 retries from 50ms with
 * `retry`'s default factor of 2 — ~1.55s of total patience, the SAME budget
 * `packages/library/community-registry-lock.ts` uses for the analogous mutex.
 * The window being serialised here is deliberately narrow (the START of a
 * turn, not its whole multi-minute body — see the module doc), so real
 * contention is rare; a bounded wait then a typed refusal is correct rather
 * than hanging a drain round or a cycle's reflect phase on a lease that may be
 * held for minutes.
 */
export const BRAIN_WRITE_LEASE_RETRIES = Object.freeze({ retries: 5, minTimeout: 50 });

/**
 * How old a lease's mtime may get before `proper-lockfile` treats it as
 * abandoned and compromises it. A live holder refreshes the mtime every
 * `stale / 2` ms for as long as it holds the lease — including across a
 * multi-minute SDK spawn, as long as the holding process's event loop keeps
 * turning — so this value only needs to cover the gap BETWEEN refreshes, not
 * the turn's own duration. A holder that crashed refreshes nothing, so its
 * lease self-clears after this long instead of wedging brain/ forever.
 */
export const BRAIN_WRITE_LEASE_STALE_MS = 15_000;

/**
 * Contention, and ONLY contention — never a real I/O fault. A named class so
 * a caller can answer with a typed, visible refusal ("the brain is mid-write
 * elsewhere, retry") without pattern-matching an error message, and so a
 * genuine filesystem fault (EACCES, ENOSPC, a broken realpath) is never
 * mistaken for one and silently swallowed.
 */
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
 * The caller is responsible for `brain/` already existing (both real callers
 * already ensure this before they could legitimately reach here) —
 * `proper-lockfile` requires its target to exist, and creating it here on a
 * lease that then fails to acquire would leave a directory behind a refusal.
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
