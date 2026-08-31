/**
 * W8-B5 security review, FINDING 1 — the ONE mutex every writer of
 * `studio/community/registry.yaml` takes.
 *
 * WHY THIS EXISTS. That file has two independent read-modify-write callers:
 *
 *   1. `runCommunityRefresh`      (cli/community-refresh-run.ts)
 *   2. `mutateCommunityRegistry`  (cli/bridge-studio-writes.ts — the CRUD routes)
 *
 * (HISTORY, W8-B5b: a third caller, `commitRegistryDraft`
 * (orchestrator/interactive-finalizers.ts), existed until the community-
 * refresh interactive session kind it finalized — mechanism A — retired,
 * superseded by `runCommunityRefresh`'s deterministic refresh, W8-B5.)
 *
 * Each loaded the document, computed a new one, then temp-wrote + renamed.
 * The rename is atomic, so the file was never CORRUPT — it was silently
 * WRONG: last rename wins, and the loser's update disappeared with no error
 * surfaced to either caller. A lock only one of the two honours is not a
 * lock, so both call THIS function; there is no second way to write the
 * file.
 *
 * `proper-lockfile` is already a direct dependency and already this repo's
 * established primitive for exactly this shape (cli/bridge-studio-runs.ts's
 * verdict mutex, orchestrator/drain-fix-loop.ts, orchestrator/manifest.ts,
 * orchestrator/review-comments.ts). Nothing new is introduced here.
 *
 * TWO DELIBERATE CHOICES:
 *
 * THE LOCK TARGET IS THE CONTAINING DIRECTORY, not `registry.yaml` itself.
 * proper-lockfile canonicalises its target with `fs.realpath`, which requires
 * that target to EXIST — and the registry file legitimately does not on a
 * fresh forge root (the CRUD routes treat a missing file as the empty
 * baseline), which is precisely when two concurrent creators would race with
 * nothing to serialise on. `studio/community/` always exists by the time any
 * writer may legitimately write, so locking it keeps the free canonicalisation
 * (every caller agrees on one lock even when `forgeRoot` reaches them through
 * a symlink — both surviving writers join `communityRegistryPath(forgeRoot)`,
 * a raw config path) AND covers the create-the-file case.
 * The lock itself is `studio/community.lock`, a directory proper-lockfile
 * makes and removes; a crashed holder's leftover self-clears once stale.
 *
 * `ELOCKED` is the only code translated into `CommunityRegistryLockError`.
 * Contention is a "try again in a moment" condition and its callers render it
 * as 503. Any OTHER failure (EACCES, ENOSPC, a broken filesystem) is a
 * genuine server fault, is NOT retryable, and is re-thrown unchanged so it
 * surfaces as a 500 rather than inviting a client to retry forever.
 */

import { dirname } from 'node:path';

import lockfile from 'proper-lockfile';

import { communityRegistryPath } from '../../orchestrator/studio/registry.ts';

/**
 * Retry budget for a contended registry lock: 5 retries from 50ms with
 * `retry`'s default factor of 2 — ~1.55s of total patience. Long enough to
 * ride out any other writer's fs-only critical section (both are
 * sub-millisecond once they hold the lock: no writer performs I/O over the
 * network while holding it), short enough that a genuinely wedged lock
 * answers the operator rather than hanging their request. Mirrors the
 * verdict mutex in cli/bridge-studio-runs.ts.
 */
export const COMMUNITY_REGISTRY_LOCK_RETRIES = Object.freeze({ retries: 5, minTimeout: 50 });

/**
 * How old a lock's mtime may get before proper-lockfile treats it as
 * abandoned and compromises it. A live holder refreshes the mtime every
 * `stale / 2` ms; a holder that crashed refreshes nothing, so its lock
 * self-clears after this long instead of wedging the registry forever. Stated
 * explicitly (rather than inherited from the library default) because
 * `cli/community-registry-lock.test.ts` pins the behaviour on it.
 */
export const COMMUNITY_REGISTRY_LOCK_STALE_MS = 10_000;

/** Contention, and ONLY contention. A deliberately named class so a caller
 *  can answer 503 ("someone else is writing, retry") without pattern-matching
 *  an error message, and so a real I/O fault is never mistaken for one. */
export class CommunityRegistryLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunityRegistryLockError';
    Object.setPrototypeOf(this, CommunityRegistryLockError.prototype);
  }
}

/** The lock target: the registry's containing directory. Callers must ensure
 *  it exists — `runCommunityRefresh` only locks once it has confirmed the
 *  registry file itself is there, and `mutateCommunityRegistry` creates the
 *  directory before locking so a fresh forge root's two writers still
 *  serialise against each other.
 *
 *  Exported so `cli/community-registry-lock.test.ts` can plant a stale lock at
 *  the REAL path rather than at a hand-typed guess of it: a test that builds
 *  the lock path itself goes silently green the day this target changes,
 *  which is precisely how a staleness test rots into an assertion about
 *  nothing. */
export function communityRegistryLockTarget(forgeRoot: string): string {
  return dirname(communityRegistryPath(forgeRoot));
}

/**
 * Take the registry mutex. Resolves to the release function; throws
 * `CommunityRegistryLockError` when another writer holds it, and re-throws
 * anything else unchanged.
 *
 * The caller MUST re-read the registry from disk INSIDE the lock — a lock
 * around a stale in-memory document serialises the writes but still loses the
 * other writer's update.
 */
export async function lockCommunityRegistry(forgeRoot: string): Promise<() => Promise<void>> {
  const target = communityRegistryLockTarget(forgeRoot);
  try {
    return await lockfile.lock(target, {
      stale: COMMUNITY_REGISTRY_LOCK_STALE_MS,
      retries: { ...COMMUNITY_REGISTRY_LOCK_RETRIES },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new CommunityRegistryLockError(
        `studio/community/registry.yaml is locked by another writer (${target}.lock) — a refresh, a curation edit or a draft commit is mid-write. Retry in a moment; nothing was changed.`,
      );
    }
    throw err;
  }
}
