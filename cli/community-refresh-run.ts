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
} from '../orchestrator/studio/community-refresh-api.ts';
import {
  communityRegistryPath,
  loadCommunityRegistry,
  serializeCommunityRegistry,
} from '../orchestrator/studio/registry.ts';

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

  if (!existsSync(path)) {
    return { ok: false, reason: 'registry-missing', path, message: `no community registry at ${path}` };
  }

  let registry;
  try {
    registry = loadCommunityRegistry(path);
  } catch (err) {
    return { ok: false, reason: 'registry-invalid', path, message: err instanceof Error ? err.message : String(err) };
  }

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
    try {
      writeRegistryAtomically(
        path,
        serializeCommunityRegistry({
          schemaVersion: result.nextRegistry.schemaVersion,
          lastRefresh: result.nextRegistry.lastRefresh,
          sources: result.nextRegistry.sources,
          items: result.nextRegistry.items,
          leadingComments: result.nextRegistry.leadingComments,
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
