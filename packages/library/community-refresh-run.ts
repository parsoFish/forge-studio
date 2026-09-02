/**
 * W8-B5 WI-3 — the ONE load → refresh → write runner. Exit rows E1 and E7 are
 * really one row: `forge community refresh` (cli/community-refresh-cmd.ts) and
 * `POST /api/studio/community/refresh` (cli/bridge-studio-community.ts) must
 * be the SAME code path, not two hand-rolled copies that drift. Both call
 * `runCommunityRefresh`; neither knows how the registry is loaded, serialized,
 * or written, and `cli/bridge-studio-community-refresh.test.ts`'s P1 pins the
 * two surfaces byte-for-byte against each other so a future divergence is red
 * rather than silent.
 *
 * THE SPLIT OF RESPONSIBILITIES, deliberately:
 *
 *   orchestrator/studio/community-refresh-api.ts   fetch + parse. NO filesystem.
 *   THIS FILE                                      load + decide + write. NO printing, NO HTTP.
 *   community-refresh-cmd.ts                       argv + console + exit code.
 *   bridge-studio-community.ts                     HTTP status + JSON body.
 *
 * That is `migrateProjectConfig`'s own shape (cli/project-migrate.ts): a pure
 * decision function returning a typed `{ok:true,…} | {ok:false, reason, …}`
 * union that never throws for an EXPECTED failure, plus thin surfaces that
 * render it. A caller can therefore render a distinct remedy per `reason`
 * without parsing prose out of an error message.
 *
 * THE TWO RULES THAT ARE THE WHOLE POINT:
 *
 *   1. NOTHING IS WRITTEN UNLESS AT LEAST ONE SOURCE WAS ACTUALLY VERIFIED.
 *      A pass in which every fetch failed leaves the file byte-identical. The
 *      alternative — rewriting the document anyway — would move
 *      `meta.lastRefresh` forward and make a registry nobody could verify
 *      look freshly checked. That is the `declared-data-fails-open` shape this
 *      lane exists to close, and it would be invisible to an exit-code-only
 *      test, which is why every failure test here asserts the BYTES.
 *
 *   2. THE WRITE IS TEMP → RE-PARSE THROUGH THE ONE LOADER → RENAME, the same
 *      discipline the registry CRUD routes use (cli/bridge-studio-writes.ts's
 *      `mutateCommunityRegistry`). A document that cannot be re-loaded never
 *      lands, and a crash mid-write cannot leave a half-written registry
 *      behind. The destination is a FIXED, server-owned path
 *      (`communityRegistryPath(forgeRoot)`) with nothing request-derived in
 *      it, so no path guard applies and none is faked.
 *
 * CONCURRENCY (W8-B5 security review, FINDING 1). This file, the CRUD routes
 * and `commitRegistryDraft` are three independent read-modify-write callers
 * of the same document; before the fix none of them locked, so the last
 * `rename` won and the loser's update vanished with no error surfaced to
 * either caller. This lane made that materially worse: the window here is
 * NETWORK-bound (timeoutMs x N distinct sources — minutes for a large
 * registry), not the sub-millisecond fs window every earlier writer had.
 *
 * The cure is OPTIMISTIC CONCURRENCY, not a lock held across the network — a
 * lock spanning the fetches would block every curation edit for minutes,
 * trading a rare lost update for a common stall. So: fetch outside any lock,
 * THEN take the registry mutex (cli/community-registry-lock.ts), RE-LOAD the
 * document from disk under it, apply the freshly-verified facts onto that
 * re-loaded document, write, release.
 *
 * THAT COMPOSES ONLY BECAUSE OF SCHEMA v2's SHAPE, and this is the reason the
 * design is safe: a refresh writes ONLY the `sources` map and
 * `meta.lastRefresh`; CRUD writes ONLY `items`. Under a re-load-under-lock
 * the two therefore MERGE — a curation edit made while the fetches were in
 * flight survives, and so do the facts this pass verified. Under v1, where
 * both facts lived on the item rows, no such merge existed and one side would
 * have had to lose.
 */

import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import {
  GH_TOKEN_ENV,
  CommunityRefreshError,
  refreshCommunityRegistry,
  type CommunityRefreshFailure,
  type CommunityRefreshOutcome,
  type FetchLike,
} from './studio/community-refresh-api.ts';
import { communityRegistryPath, loadCommunityRegistry, serializeCommunityRegistry } from './studio/community-registry.ts';
import { communitySourceKey } from './studio/community-source-url.ts';
import type { CommunityRegistry, CommunityRegistrySource } from '@forge/contracts/studio/types.ts';
import { CommunityRegistryLockError, lockCommunityRegistry } from './community-registry-lock.ts';

/** Per-status tallies, computed once here so the CLI's printed tally and the
 *  route's JSON body cannot disagree about what happened. */
export type CommunityRefreshCounts = {
  total: number;
  refreshed: number;
  unchanged: number;
  noUpstream: number;
  failed: number;
};

/**
 * Every way this can refuse, as a discriminator rather than a message
 * substring. `missing-token` / `invalid-token` / `rate-limited` are the three
 * the fetch core itself aborts the whole pass on (they are not per-row
 * conditions); the rest are this module's own.
 */
export type CommunityRefreshRunReason =
  | 'missing-token'
  | 'invalid-token'
  | 'rate-limited'
  | 'refresh-refused'
  | 'registry-missing'
  | 'registry-invalid'
  | 'registry-locked'
  | 'all-sources-failed'
  | 'write-failed';

export type CommunityRefreshRunResult =
  | {
      ok: true;
      /** Absolute path of the registry — printed by the CLI, echoed by the route. */
      path: string;
      /** False for a dry run, and false for a pass in which nothing verified. */
      wrote: boolean;
      dryRun: boolean;
      /** `meta.lastRefresh` as it now stands on disk (unchanged when `wrote` is false). */
      lastRefresh: string | null;
      counts: CommunityRefreshCounts;
      outcomes: readonly CommunityRefreshOutcome[];
      /** MAY be non-empty on an `ok:true` result: a pass where some sources
       *  verified and others failed writes the verified rows (the failed ones
       *  are carried forward byte-for-byte) and reports the failures. Callers
       *  must treat a non-empty `errors` as a failed run — the CLI exits 1. */
      errors: readonly CommunityRefreshFailure[];
    }
  | {
      ok: false;
      reason: CommunityRefreshRunReason;
      message: string;
      path: string;
      /** Present when the pass got far enough to produce a per-row report
       *  (i.e. `all-sources-failed`), so a caller can still show the rows. */
      counts?: CommunityRefreshCounts;
      outcomes?: readonly CommunityRefreshOutcome[];
      errors?: readonly CommunityRefreshFailure[];
    };

/**
 * The operator-facing remedy for a refusal — ONE source of this wording so the
 * CLI's stderr and the route's JSON body cannot drift into telling an operator
 * two different things about the same credential.
 *
 * The 60-vs-5000 figures are measured, not folklore: an unauthenticated
 * `GET https://api.github.com/repos/...` answers `x-ratelimit-limit: 60`, an
 * authenticated one `5000` (live-probed 2026-08-23 from this host). The
 * credential VALUE never appears here or anywhere else — only "absent",
 * "rejected by GitHub", or nothing at all.
 */
export function communityRefreshRemedy(reason: CommunityRefreshRunReason): string {
  switch (reason) {
    case 'missing-token':
      return (
        `Export a GitHub token with public-repository read access as ${GH_TOKEN_ENV} and re-run. ` +
        'GitHub allows 60 unauthenticated API requests per hour and 5000 authenticated ones, so the refresh ' +
        `requires the credential rather than degrading to an anonymous best effort. See \`.env.example\` (${GH_TOKEN_ENV}). ` +
        `${GH_TOKEN_ENV} is read by the orchestrator process only — it is deliberately absent from AGENT_ENV_ALLOWLIST ` +
        'and is never handed to a spawned agent.'
      );
    case 'invalid-token':
      return (
        `GitHub rejected the credential currently in ${GH_TOKEN_ENV}. Issue a fresh token with public-repository ` +
        `read access and re-export ${GH_TOKEN_ENV}, then re-run. See \`.env.example\`. (The value is never printed.)`
      );
    case 'rate-limited':
      return (
        'Wait for the quota to reset, or export a token with more headroom. GitHub allows 60 unauthenticated ' +
        `requests per hour and 5000 authenticated ones — see \`.env.example\` (${GH_TOKEN_ENV}).`
      );
    case 'registry-missing':
      return 'This forge install has no community registry to refresh. Nothing was created — a refresh verifies an existing curated list, it does not seed one.';
    case 'registry-invalid':
      return 'Fix the registry by hand (or with `forge studio lint`) and re-run. A refresh never half-trusts a document the loader refuses.';
    case 'registry-locked':
      return 'Another writer (a curation edit, a draft commit, or a second refresh) holds the registry lock. Nothing was written — the verified facts of this pass were discarded rather than raced onto a document someone else is mid-way through changing. Re-run in a moment.';
    case 'all-sources-failed':
      return 'Nothing was written: no source produced a verified answer, so stamping the file would have made an unverified registry look freshly checked. Re-run once the upstreams answer.';
    case 'write-failed':
      return 'The refreshed document could not be written. The registry on disk is unchanged — the write is temp-file-then-rename, so a failure never leaves a half-written file.';
    case 'refresh-refused':
      return 'The refresh refused to continue. Nothing was written.';
  }
}

function countOutcomes(outcomes: readonly CommunityRefreshOutcome[]): CommunityRefreshCounts {
  const counts: CommunityRefreshCounts = { total: outcomes.length, refreshed: 0, unchanged: 0, noUpstream: 0, failed: 0 };
  for (const o of outcomes) {
    if (o.status === 'refreshed') counts.refreshed += 1;
    else if (o.status === 'unchanged') counts.unchanged += 1;
    else if (o.status === 'no-upstream') counts.noUpstream += 1;
    else counts.failed += 1;
  }
  return counts;
}

/** One line per FAILED SOURCE, each carrying its own error kind, so a timeout,
 *  a network error and a 404 read as three different problems rather than one
 *  generic "refresh failed". */
function describeFailures(errors: readonly CommunityRefreshFailure[]): string {
  return errors.map((e) => `${e.source}: [${e.kind}] ${e.message}`).join('\n');
}

/** The temp → re-parse → rename write. Throws on a document the ONE loader
 *  refuses; the temp file is removed either way, so a failed write never
 *  leaves debris beside the real registry. */
function writeRegistryAtomically(destPath: string, serialized: string): void {
  mkdirSync(dirname(destPath), { recursive: true });
  const tempPath = join(dirname(destPath), `.registry.yaml.tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(tempPath, serialized, 'utf8');
  try {
    loadCommunityRegistry(tempPath); // structural round-trip — the ONE loader is the validator
    renameSync(tempPath, destPath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

/**
 * The ONE load of the registry this module performs — used both for the
 * pre-network snapshot and for the re-read under the lock, so the two cannot
 * disagree about what "missing" or "invalid" means, and so this file keeps a
 * single `existsSync` call site (scripts/check-request-path-sinks.mjs counts
 * them). `loadCommunityRegistry` throws bare on a missing file, which is why
 * the existence check leads.
 */
function loadRegistryOrReason(
  path: string,
):
  | { ok: true; registry: CommunityRegistry }
  | { ok: false; reason: 'registry-missing' | 'registry-invalid'; message: string } {
  if (!existsSync(path)) return { ok: false, reason: 'registry-missing', message: `no community registry at ${path}` };
  try {
    return { ok: true, registry: loadCommunityRegistry(path) };
  } catch (err) {
    return { ok: false, reason: 'registry-invalid', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The `sources` map to write, computed from the registry AS RE-LOADED UNDER
 * THE LOCK plus the facts THIS pass actually verified.
 *
 * Only VERIFIED keys are applied. A source whose fetch failed is deliberately
 * NOT carried over from this pass's own starting snapshot: that snapshot is
 * now stale by definition (another refresh may have landed real facts for it
 * while we were on the network), and re-writing our older copy over it would
 * be the very clobber this whole design removes. Such a key falls through to
 * `current.sources[key]` — whatever is on disk right now — untouched.
 *
 * Three concurrent-edit cases, each resolved deliberately:
 *
 *  - An item ADDED while the fetches were in flight simply has no verified
 *    facts this pass. It keeps whatever row the disk holds for its key
 *    (usually none). That is correct, not an error — a refresh reports on
 *    what it queried, and it never queried this one.
 *  - An item DELETED while the fetches were in flight takes its source row
 *    with it: the row is now referenced by nothing, and an unreferenced row
 *    is PRUNED. That matches the pruning `refreshCommunityRegistry` already
 *    performs by construction and the `community-registry/orphan-source`
 *    rule `forge studio lint` enforces — an unread repo fact under a key
 *    nothing resolves is exactly what schema v2 exists to remove.
 *  - An item whose `sourceUrl` was EDITED resolves to a different key, so it
 *    reads as an add plus a delete, handled by the two rules above.
 */
function mergeVerifiedSources(
  current: CommunityRegistry,
  verifiedSources: Readonly<Record<string, CommunityRegistrySource>>,
): Record<string, CommunityRegistrySource> {
  const merged: Record<string, CommunityRegistrySource> = {};
  for (const item of current.items) {
    const key = communitySourceKey(item.sourceUrl);
    if (key === null) continue; // no queryable upstream — nothing to key a row on
    const row = verifiedSources[key] ?? current.sources[key];
    if (row !== undefined) merged[key] = row;
  }
  return merged;
}

/** The subset of this pass's `sources` map that was genuinely VERIFIED —
 *  derived from the per-item outcomes rather than from a second declared
 *  list, so it cannot drift from what the operator is shown. */
function verifiedSourcesOf(
  outcomes: readonly CommunityRefreshOutcome[],
  sources: Readonly<Record<string, CommunityRegistrySource>>,
): Record<string, CommunityRegistrySource> {
  const out: Record<string, CommunityRegistrySource> = {};
  for (const o of outcomes) {
    if (o.source === null) continue;
    if (o.status !== 'refreshed' && o.status !== 'unchanged') continue;
    const row = sources[o.source];
    if (row !== undefined) out[o.source] = row;
  }
  return out;
}

export type RunCommunityRefreshOptions = {
  forgeRoot: string;
  /** Injected in every test; production passes nothing and the fetch core
   *  falls back to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Explicit credential. Omitted in production so BOTH surfaces read
   *  `process.env[GH_TOKEN_ENV]` through this ONE line and cannot diverge on
   *  which variable, or which emptiness, counts as absent. */
  token?: string | undefined;
  now?: Date;
  timeoutMs?: number;
  /** Compute and report, write nothing. */
  dryRun?: boolean;
};

/**
 * Load the registry, refresh every resolvable upstream, and write the result
 * back IF anything was actually verified. Never throws for an expected
 * failure — every one of them is a typed `{ok:false, reason}`.
 */
export async function runCommunityRefresh(opts: RunCommunityRefreshOptions): Promise<CommunityRefreshRunResult> {
  const path = communityRegistryPath(opts.forgeRoot);
  const dryRun = opts.dryRun === true;

  const initial = loadRegistryOrReason(path);
  if (!initial.ok) return { ok: false, reason: initial.reason, path, message: initial.message };
  const registry = initial.registry;

  // The ONE place either surface reads the credential out of the environment.
  // An empty string is treated as absent by the fetch core, so a blanked
  // export cannot masquerade as a credential.
  const token = opts.token !== undefined ? opts.token : process.env[GH_TOKEN_ENV];

  let result;
  try {
    result = await refreshCommunityRegistry({
      registry,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      token,
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
  } catch (err) {
    if (err instanceof CommunityRefreshError) {
      // The three credential-level kinds the core aborts the whole pass on map
      // 1:1 onto a reason; anything else it could ever throw lands on the
      // catch-all rather than being silently re-labelled as one of them.
      const reason: CommunityRefreshRunReason =
        err.kind === 'missing-token' || err.kind === 'invalid-token' || err.kind === 'rate-limited' ? err.kind : 'refresh-refused';
      return { ok: false, reason, path, message: err.message };
    }
    throw err; // genuinely unexpected — never dressed up as an expected refusal
  }

  const counts = countOutcomes(result.outcomes);
  const verified = counts.refreshed + counts.unchanged;

  if (verified === 0 && result.errors.length > 0) {
    return {
      ok: false,
      reason: 'all-sources-failed',
      path,
      message: `no source produced a verified answer, so nothing was written:\n${describeFailures(result.errors)}`,
      counts,
      outcomes: result.outcomes,
      errors: result.errors,
    };
  }

  // `verified === 0` with no errors means the registry simply has nothing
  // queryable (every row a blog post, or no rows at all). That is not a
  // failure — but there is nothing to stamp, so the file is left alone.
  const shouldWrite = verified > 0 && !dryRun;

  if (shouldWrite) {
    // ---- The critical section. Everything above ran WITHOUT the lock (the
    // network phase is the whole point); everything below re-derives from the
    // document as it stands RIGHT NOW, so a curation edit that landed while
    // we were fetching is merged, never overwritten.
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockCommunityRegistry(opts.forgeRoot);
    } catch (err) {
      if (err instanceof CommunityRegistryLockError) {
        return { ok: false, reason: 'registry-locked', path, message: err.message, counts, outcomes: result.outcomes, errors: result.errors };
      }
      throw err; // a real I/O fault taking the lock is not a retryable refusal
    }
    try {
      // The document may have changed — or vanished — since the load at the
      // top of this function. Re-read it here and NOWHERE else: a lock around
      // a stale in-memory copy serialises the writes but still loses the
      // other writer's update, which is the defect this closes.
      const reloaded = loadRegistryOrReason(path);
      if (!reloaded.ok) {
        return {
          ok: false,
          reason: reloaded.reason,
          path,
          // Named as "while this refresh was fetching" so an operator reads a
          // concurrent removal/corruption as what it is, not as a state the
          // registry was already in when the pass started.
          message: `${reloaded.message} (detected while committing a completed refresh — nothing was written)`,
          counts,
          outcomes: result.outcomes,
          errors: result.errors,
        };
      }
      const current = reloaded.registry;
      writeRegistryAtomically(
        path,
        serializeCommunityRegistry({
          // schemaVersion / items / leadingComments are the RE-LOADED
          // document's own: a refresh is not a curation edit and owns none of
          // them. Only `sources` and `lastRefresh` below are this pass's.
          schemaVersion: current.schemaVersion,
          lastRefresh: result.nextRegistry.lastRefresh,
          sources: mergeVerifiedSources(current, verifiedSourcesOf(result.outcomes, result.nextRegistry.sources)),
          items: current.items,
          leadingComments: current.leadingComments,
        }),
      );
    } catch (err) {
      return {
        ok: false,
        reason: 'write-failed',
        path,
        message: err instanceof Error ? err.message : String(err),
        counts,
        outcomes: result.outcomes,
        errors: result.errors,
      };
    } finally {
      await release();
    }
  }

  return {
    ok: true,
    path,
    wrote: shouldWrite,
    dryRun,
    // Only a real write moves the stamp an operator can see on disk.
    lastRefresh: shouldWrite ? result.nextRegistry.lastRefresh : registry.lastRefresh,
    counts,
    outcomes: result.outcomes,
    errors: result.errors,
  };
}
