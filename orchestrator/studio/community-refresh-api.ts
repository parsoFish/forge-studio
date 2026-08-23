/**
 * W8-B5 WI-1 — forge's DETERMINISTIC community-registry refresh. No LLM
 * anywhere in this path: three fixed API calls, a fixed parse, a fixed write.
 *
 * WHAT IT REPLACES, AND WHAT IT INHERITS. The `community-refresh` OOTB agent
 * fetched upstream facts by reasoning and staged a draft; `commitRegistryDraft`
 * (orchestrator/interactive-finalizers.ts) then refused to commit any row whose
 * staged `evidence.json` did not say `verified`. That refusal is the part worth
 * keeping, and this module inherits it in a stronger, deterministic form:
 *
 *   A source row's facts are written ONLY from a 200 this process actually
 *   received. A missing/invalid credential, a rate limit, a 404, a network
 *   error, a timeout, a malformed body — each produces a DISTINCT NAMED error,
 *   and the affected row is left BYTE-IDENTICAL and reported. Nothing is ever
 *   stamped fresh on a failure. Fail loud, never serve stale.
 *
 * SHAPE. Pure logic plus an INJECTED fetch. `refreshCommunityRegistry` returns
 * a result object — `{ nextRegistry, outcomes, errors }` — and never touches
 * the filesystem: THE CALLER OWNS THE WRITE. That keeps the whole thing unit
 * testable without a network (no test in this repo makes a real request) and
 * mirrors `migrateProjectConfig`'s own compute-then-hand-back contract
 * (cli/project-migrate.ts).
 *
 * THE CREDENTIAL. `process.env.GH_TOKEN`, read by the ORCHESTRATOR PROCESS,
 * never by a spawned agent. It is deliberately absent from
 * `AGENT_ENV_ALLOWLIST` (orchestrator/spawn-env.ts) — putting it there would
 * hand the operator's PAT to every SDK-spawned agent child, which is the exact
 * leak class that allowlist exists to close. This module takes the token as a
 * PARAMETER so the seam stays explicit and testable; the token value is never
 * logged, echoed, written, or included in any error message — only "present /
 * absent / rejected by GitHub".
 *
 * SSRF. See ./community-source-url.ts: a row's `sourceUrl` is operator-typable
 * and is therefore never fetched — it is parsed into an upstream identity, and
 * every outbound URL is checked against a three-origin allowlist by exact
 * `URL.origin`. Redirects are `manual` and handled explicitly.
 */

import {
  COMMUNITY_REFRESH_ALLOWED_ORIGINS,
  formatStarCount,
  isAllowedApiOrigin,
  parseCommunityUpstream,
  type CommunityUpstream,
} from './community-source-url.ts';
import type { CommunityRegistry, CommunityRegistrySource } from './types.ts';

/** The env var carrying the GitHub credential. Named once, here, so the CLI's
 *  operator-facing error and this module's own error text cannot drift. */
export const GH_TOKEN_ENV = 'GH_TOKEN';

/** Injected fetch. Defaults to the global `fetch`; every test injects a stub. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Default per-request budget. `AbortSignal.timeout(ms)` is the house idiom
 *  (cli/demo-runtime.ts:103) — no new dependency, no hand-rolled timer race. */
export const DEFAULT_REFRESH_TIMEOUT_MS = 10_000;

/** Bounded redirect following. GitHub 301s a renamed repo (still on
 *  api.github.com), which is worth following; anything longer is a loop. */
const MAX_REDIRECTS = 3;

export type CommunityRefreshErrorKind =
  | 'missing-token'
  | 'invalid-token'
  | 'rate-limited'
  | 'timeout'
  | 'network-error'
  | 'blocked-origin'
  | 'blocked-redirect'
  | 'not-found'
  | 'http-error'
  | 'malformed-response';

/**
 * A DELIBERATELY NAMED error class with a `kind` discriminator, never a bare
 * `Error` — the CLI verb (`forge community refresh`, exit row E1) renders a
 * different operator remedy per kind, and a caller must be able to tell "the
 * refresh refused this" from an accidental crash bubbling through the same
 * call. Mirrors `InteractiveFinalizerError`'s own reasoning.
 */
export class CommunityRefreshError extends Error {
  readonly kind: CommunityRefreshErrorKind;

  constructor(kind: CommunityRefreshErrorKind, message: string) {
    super(message);
    this.name = 'CommunityRefreshError';
    this.kind = kind;
    // Restores the prototype chain under an ES5-target transpile, so
    // `instanceof CommunityRefreshError` never silently lies.
    Object.setPrototypeOf(this, CommunityRefreshError.prototype);
  }
}

/** `refreshed` — verified, at least one fact changed. `unchanged` — verified,
 *  facts identical (the row is still stamped: it WAS verified). `no-upstream` —
 *  the row's sourceUrl names no queryable upstream; honestly unrefreshable,
 *  never an error. `failed` — the fetch did not verify; the row is untouched. */
export type CommunityRefreshStatus = 'refreshed' | 'unchanged' | 'no-upstream' | 'failed';

export type CommunityRefreshOutcome = {
  /** The registry ITEM id — the granularity an operator reads. */
  id: string;
  /** The resolved source key the item shares with its siblings, or null. */
  source: string | null;
  status: CommunityRefreshStatus;
  detail: string;
};

export type CommunityRefreshFailure = {
  source: string;
  kind: CommunityRefreshErrorKind;
  message: string;
};

export type CommunityRefreshResult = {
  /** A NEW registry object. The caller serializes and writes it. */
  nextRegistry: CommunityRegistry;
  outcomes: readonly CommunityRefreshOutcome[];
  /** One entry per SOURCE that failed — deduped, so one 500 on a repo shared
   *  by three items is one error, not three. */
  errors: readonly CommunityRefreshFailure[];
};

export type RequestCtx = {
  fetchImpl: FetchLike;
  timeoutMs: number;
  token?: string | undefined;
};

// ---------------------------------------------------------------------------
// The guarded fetch — the ONE place an outbound request is made
// ---------------------------------------------------------------------------

/**
 * Every outbound request in this module goes through here. It:
 *   1. refuses any URL whose exact `origin` is outside the three-entry
 *      allowlist (never a `startsWith` on the raw string);
 *   2. sets `redirect: 'manual'` and resolves a 3xx explicitly, refusing one
 *      that leaves the allowlist and bounding the chain;
 *   3. classifies a thrown fetch into `timeout` vs `network-error`.
 *
 * EXPORTED on purpose (ADR-042's third boundary: a function with an explicit
 * error contract, exported so a test can drive it directly). The adapters
 * below all `encodeURIComponent`/`URLSearchParams` their inputs, so today no
 * adapter CAN reach this check with an escaping URL — which is precisely why
 * it must be tested directly rather than through them. It is the ratchet: the
 * containment is a property of the ONE fetch seam, not a discipline each
 * future adapter has to remember. `RequestCtx` is exported with it so a caller
 * (and a test) can construct one.
 */
export async function fetchAllowedApiUrl(ctx: RequestCtx, url: string, headers: Record<string, string>): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedApiOrigin(current)) {
      throw new CommunityRefreshError(
        'blocked-origin',
        `refusing to fetch "${current}" — outside the community-refresh API allowlist (${COMMUNITY_REFRESH_ALLOWED_ORIGINS.join(', ')}).`,
      );
    }
    let res: Response;
    try {
      res = await ctx.fetchImpl(current, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new CommunityRefreshError('timeout', `no response from "${current}" within ${ctx.timeoutMs}ms.`);
      }
      throw new CommunityRefreshError('network-error', `cannot reach "${current}" — ${(err as Error).message}`);
    }

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (location === null) {
      throw new CommunityRefreshError('blocked-redirect', `"${current}" answered ${res.status} with no Location header.`);
    }
    const next = new URL(location, current).toString();
    if (!isAllowedApiOrigin(next)) {
      throw new CommunityRefreshError(
        'blocked-redirect',
        `"${current}" redirected to "${next}", which is outside the community-refresh API allowlist — refusing to follow it.`,
      );
    }
    current = next;
  }
  throw new CommunityRefreshError('blocked-redirect', `"${url}" exceeded ${MAX_REDIRECTS} redirects — refusing to follow further.`);
}

/** Parses a JSON body, turning any surprise into a named malformed-response
 *  rather than a raw SyntaxError escaping from the middle of a refresh. */
async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new CommunityRefreshError('malformed-response', `cannot read the ${what} response body — ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body is not a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new CommunityRefreshError('malformed-response', `the ${what} response is not a JSON object — ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Adapter 1 — GitHub REST
// ---------------------------------------------------------------------------

export type GithubRepoFacts = {
  stars: number;
  upstreamUpdatedAt: string | null;
  archived: boolean;
  topics: string[];
  /** `html_url` — read to DETECT a rename, never written back over the
   *  operator's curated `sourceUrl` (a refresh reports; it does not re-curate). */
  htmlUrl: string | null;
};

/** Renders `x-ratelimit-reset` (unix seconds) as a human time. Defensive: a
 *  missing/garbage header must not turn a rate-limit report into a crash. */
function describeRateLimitReset(res: Response): string {
  const raw = res.headers.get('x-ratelimit-reset');
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'an unknown time (upstream sent no usable x-ratelimit-reset)';
  return new Date(seconds * 1000).toISOString();
}

export async function fetchGithubRepo(ctx: RequestCtx, owner: string, repo: string): Promise<GithubRepoFacts> {
  if (ctx.token === undefined || ctx.token === '') {
    // Belt-and-braces: refreshCommunityRegistry checks this up-front so no
    // request is ever attempted, but a direct caller must fail the same way.
    throw missingTokenError();
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetchAllowedApiUrl(ctx, url, {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'forge-community-refresh',
    // The ONLY place the credential is used. Never logged, never echoed.
    Authorization: `Bearer ${ctx.token}`,
  });

  if (res.status === 401) {
    throw new CommunityRefreshError(
      'invalid-token',
      `GitHub rejected the credential in ${GH_TOKEN_ENV} (401). Issue a fresh token with public repo read access and re-export ${GH_TOKEN_ENV}. (The value itself is never printed.)`,
    );
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new CommunityRefreshError(
      'rate-limited',
      `GitHub rate limit exhausted (${res.status}). The quota resets at ${describeRateLimitReset(res)}. An authenticated ${GH_TOKEN_ENV} raises the limit from 60 to 5000 requests/hour.`,
    );
  }
  if (res.status === 404) {
    throw new CommunityRefreshError('not-found', `GitHub has no repository "${owner}/${repo}" (404) — it was renamed, made private, or deleted.`);
  }
  if (!res.ok) {
    throw new CommunityRefreshError('http-error', `GitHub answered ${res.status} for "${owner}/${repo}".`);
  }

  const body = await readJson(res, 'GitHub repo');
  const stars = body['stargazers_count'];
  if (typeof stars !== 'number' || !Number.isFinite(stars)) {
    throw new CommunityRefreshError('malformed-response', `GitHub's response for "${owner}/${repo}" carries no numeric stargazers_count.`);
  }
  const pushedAt = body['pushed_at'];
  const archived = body['archived'];
  const topics = body['topics'];
  const htmlUrl = body['html_url'];
  return {
    stars,
    upstreamUpdatedAt: typeof pushedAt === 'string' ? pushedAt : null,
    archived: typeof archived === 'boolean' ? archived : false,
    topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === 'string') : [],
    htmlUrl: typeof htmlUrl === 'string' ? htmlUrl : null,
  };
}

// ---------------------------------------------------------------------------
// Adapter 2 — npm registry
// ---------------------------------------------------------------------------

export type PackageFacts = { version: string | null; upstreamUpdatedAt: string | null };

export async function fetchNpmPackage(ctx: RequestCtx, pkg: string): Promise<PackageFacts> {
  // A scoped name is sent with the "/" percent-encoded — the form the npm
  // registry documents. (Live-probed 2026-08-23: both the encoded and the raw
  // form answer 200; the encoded one is the documented contract, so it is what
  // is pinned.) The rest of the name is already constrained to
  // [a-z0-9._-] by the sourceUrl parser, so nothing else needs escaping.
  const path = pkg.startsWith('@') ? pkg.replace('/', '%2F') : pkg;
  const res = await fetchAllowedApiUrl(ctx, `https://registry.npmjs.org/${path}`, {
    Accept: 'application/json',
    'User-Agent': 'forge-community-refresh',
  });
  if (res.status === 404) {
    throw new CommunityRefreshError('not-found', `the npm registry has no package "${pkg}" (404).`);
  }
  if (!res.ok) {
    throw new CommunityRefreshError('http-error', `the npm registry answered ${res.status} for "${pkg}".`);
  }
  const body = await readJson(res, 'npm package');
  const distTags = body['dist-tags'];
  const latest =
    distTags !== null && typeof distTags === 'object' && !Array.isArray(distTags)
      ? (distTags as Record<string, unknown>)['latest']
      : undefined;
  const time = body['time'];
  const modified =
    time !== null && typeof time === 'object' && !Array.isArray(time)
      ? (time as Record<string, unknown>)['modified']
      : undefined;
  if (typeof latest !== 'string' && typeof modified !== 'string') {
    throw new CommunityRefreshError('malformed-response', `the npm registry response for "${pkg}" carries neither dist-tags.latest nor time.modified.`);
  }
  return {
    version: typeof latest === 'string' ? latest : null,
    upstreamUpdatedAt: typeof modified === 'string' ? modified : null,
  };
}

// ---------------------------------------------------------------------------
// Adapter 3 — MCP registry
// ---------------------------------------------------------------------------

/**
 * The MCP registry's listing is NESTED and namespaced. Live-probed shape
 * (2026-08-23):
 *
 *   { servers: [ { server: { name, title, version, remotes, ... },
 *                  _meta: { "io.modelcontextprotocol.registry/official":
 *                             { status, publishedAt, updatedAt, isLatest } } } ],
 *     metadata: { nextCursor, count } }
 *
 * Three traps this parser handles DEFENSIVELY rather than assuming away:
 *   - the real record is wrapped under a `server` key, not flat;
 *   - the metadata key is the literal dotted/slashed string
 *     `"io.modelcontextprotocol.registry/official"`, and it may be ABSENT
 *     entirely (a missing block degrades to a null timestamp, never a crash);
 *   - `isLatest` was observed `false` on listed rows, so the listing is NOT
 *     pre-filtered to latest versions — `version=latest` is requested and the
 *     first exact name match is taken, rather than trusting listing order.
 */
export async function fetchMcpServer(ctx: RequestCtx, serverName: string): Promise<PackageFacts> {
  const MAX_PAGES = 5;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ search: serverName, version: 'latest', limit: '50' });
    if (cursor !== null) qs.set('cursor', cursor);
    const res = await fetchAllowedApiUrl(ctx, `https://registry.modelcontextprotocol.io/v0/servers?${qs.toString()}`, {
      Accept: 'application/json',
      'User-Agent': 'forge-community-refresh',
    });
    if (!res.ok) {
      throw new CommunityRefreshError('http-error', `the MCP registry answered ${res.status} for "${serverName}".`);
    }
    const body = await readJson(res, 'MCP registry');
    const servers = body['servers'];
    if (!Array.isArray(servers)) {
      throw new CommunityRefreshError('malformed-response', `the MCP registry response for "${serverName}" has no "servers" array.`);
    }
    for (const row of servers) {
      if (row === null || typeof row !== 'object') continue;
      const server = (row as Record<string, unknown>)['server'];
      if (server === null || typeof server !== 'object') continue;
      const s = server as Record<string, unknown>;
      if (s['name'] !== serverName) continue;
      const meta = (row as Record<string, unknown>)['_meta'];
      const official =
        meta !== null && typeof meta === 'object'
          ? (meta as Record<string, unknown>)['io.modelcontextprotocol.registry/official']
          : undefined;
      const updatedAt =
        official !== null && typeof official === 'object'
          ? (official as Record<string, unknown>)['updatedAt']
          : undefined;
      return {
        version: typeof s['version'] === 'string' ? s['version'] : null,
        upstreamUpdatedAt: typeof updatedAt === 'string' ? updatedAt : null,
      };
    }
    const metadata = body['metadata'];
    const nextCursor =
      metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>)['nextCursor'] : undefined;
    if (typeof nextCursor !== 'string' || nextCursor === '') break;
    cursor = nextCursor;
  }
  throw new CommunityRefreshError('not-found', `the MCP registry lists no server named "${serverName}".`);
}

// ---------------------------------------------------------------------------
// The orchestrating function
// ---------------------------------------------------------------------------

function missingTokenError(): CommunityRefreshError {
  return new CommunityRefreshError(
    'missing-token',
    `${GH_TOKEN_ENV} is not set in this process's environment, and the registry has at least one github.com source. Export a GitHub token with public repo read access (${GH_TOKEN_ENV}=…) and re-run. Nothing was written. (${GH_TOKEN_ENV} is deliberately NOT on AGENT_ENV_ALLOWLIST — only the orchestrator process reads it, never a spawned agent.)`,
  );
}

/** `true` when the two source rows carry the same facts — the difference
 *  between a "refreshed" and an "unchanged" report. `fetchedAt`/`fetchedBy`
 *  are excluded on purpose: they record WHEN we verified, not WHAT we found. */
function sameFacts(a: CommunityRegistrySource, b: CommunityRegistrySource): boolean {
  return (
    a.stars === b.stars &&
    a.starsDisplay === b.starsDisplay &&
    a.upstreamUpdatedAt === b.upstreamUpdatedAt &&
    a.archived === b.archived &&
    a.version === b.version &&
    JSON.stringify(a.topics ?? []) === JSON.stringify(b.topics ?? [])
  );
}

async function fetchSourceFacts(ctx: RequestCtx, up: CommunityUpstream): Promise<Partial<CommunityRegistrySource> & { fetchedBy: string }> {
  if (up.kind === 'github') {
    const gh = await fetchGithubRepo(ctx, up.owner, up.repo);
    return {
      stars: gh.stars,
      starsDisplay: formatStarCount(gh.stars),
      upstreamUpdatedAt: gh.upstreamUpdatedAt,
      archived: gh.archived,
      topics: gh.topics,
      fetchedBy: 'api:github',
    };
  }
  if (up.kind === 'npm') {
    const npm = await fetchNpmPackage(ctx, up.pkg);
    return {
      stars: null,
      starsDisplay: null,
      upstreamUpdatedAt: npm.upstreamUpdatedAt,
      ...(npm.version !== null ? { version: npm.version } : {}),
      fetchedBy: 'api:npm',
    };
  }
  const mcp = await fetchMcpServer(ctx, up.server);
  return {
    stars: null,
    starsDisplay: null,
    upstreamUpdatedAt: mcp.upstreamUpdatedAt,
    ...(mcp.version !== null ? { version: mcp.version } : {}),
    fetchedBy: 'api:mcp-registry',
  };
}

/**
 * Refresh every resolvable upstream in `registry`, returning a NEW registry
 * plus a per-item report. Never mutates the input. Never writes anything.
 *
 * ABORTS the whole pass (throws) on a credential problem — missing token, 401,
 * exhausted rate limit — because none of those are per-row conditions and
 * continuing would produce a report full of identical failures while the
 * operator's real problem goes unnamed. Every OTHER failure is per-source: the
 * row is left untouched and recorded in `errors`.
 */
export async function refreshCommunityRegistry(opts: {
  registry: CommunityRegistry;
  fetchImpl?: FetchLike;
  token?: string | undefined;
  now?: Date;
  timeoutMs?: number;
}): Promise<CommunityRefreshResult> {
  const { registry } = opts;
  const ctx: RequestCtx = {
    fetchImpl: opts.fetchImpl ?? ((url, init) => fetch(url, init)),
    timeoutMs: opts.timeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS,
    token: opts.token,
  };
  const nowIso = (opts.now ?? new Date()).toISOString();

  // ---- Phase 1: resolve every item to an upstream. ZERO requests. ---------
  const upstreamByItem = new Map<string, CommunityUpstream | null>();
  const upstreamByKey = new Map<string, CommunityUpstream>();
  for (const item of registry.items) {
    const up = parseCommunityUpstream(item.sourceUrl);
    upstreamByItem.set(item.id, up);
    if (up !== null) upstreamByKey.set(up.key, up);
  }

  // The credential is required by the GITHUB arm only, and is checked BEFORE
  // any request so a missing token writes nothing at all (exit row E1).
  const needsGithub = [...upstreamByKey.values()].some((u) => u.kind === 'github');
  if (needsGithub && (ctx.token === undefined || ctx.token === '')) throw missingTokenError();

  // ---- Phase 2: one request per distinct SOURCE. -------------------------
  const nextSources: Record<string, CommunityRegistrySource> = {};
  const statusByKey = new Map<string, CommunityRefreshStatus>();
  const detailByKey = new Map<string, string>();
  const errors: CommunityRefreshFailure[] = [];
  let verifiedAny = false;

  for (const [key, up] of upstreamByKey) {
    const existing = registry.sources[key];
    try {
      const facts = await fetchSourceFacts(ctx, up);
      const next: CommunityRegistrySource = {
        stars: facts.stars ?? null,
        starsDisplay: facts.starsDisplay ?? null,
        upstreamUpdatedAt: facts.upstreamUpdatedAt ?? null,
        ...(facts.archived !== undefined ? { archived: facts.archived } : {}),
        ...(facts.topics !== undefined ? { topics: facts.topics } : {}),
        ...(facts.version !== undefined ? { version: facts.version } : {}),
        fetchedAt: nowIso,
        fetchedBy: facts.fetchedBy,
      };
      nextSources[key] = next;
      verifiedAny = true;
      const unchanged = existing !== undefined && sameFacts(existing, next);
      statusByKey.set(key, unchanged ? 'unchanged' : 'refreshed');
      detailByKey.set(
        key,
        unchanged
          ? `verified against ${facts.fetchedBy}; nothing changed`
          : `verified against ${facts.fetchedBy}${next.stars !== null ? ` — ${next.stars} stars` : ''}`,
      );
    } catch (err) {
      // A credential-level failure is not a per-row condition: re-throw so the
      // caller writes NOTHING (exit row E1).
      if (err instanceof CommunityRefreshError && (err.kind === 'invalid-token' || err.kind === 'rate-limited' || err.kind === 'missing-token')) {
        throw err;
      }
      const kind = err instanceof CommunityRefreshError ? err.kind : 'network-error';
      const message = err instanceof CommunityRefreshError ? err.message : `unexpected failure — ${(err as Error).message}`;
      errors.push({ source: key, kind, message });
      statusByKey.set(key, 'failed');
      detailByKey.set(key, message);
      // NEVER stamp a row on a failure: carry the existing row forward
      // byte-for-byte, or leave it absent if there never was one.
      if (existing !== undefined) nextSources[key] = existing;
    }
  }

  // NOTE ON ORPHANS: `nextSources` is built from the items' RESOLVED keys
  // only, so a source row no item refers to any more is dropped by
  // construction — nothing reads it, so nothing would keep it honest, and a
  // stale repo fact lingering under a key nothing resolves is exactly the
  // shape schema v2 exists to remove. `forge studio lint` flags such an orphan
  // (community-registry/orphan-source) before a refresh ever runs, so this is
  // never a silent surprise. Every STILL-REFERENCED source is present above:
  // refreshed, or carried forward byte-for-byte on failure.

  // ---- Phase 3: the per-item report. ------------------------------------
  const outcomes: CommunityRefreshOutcome[] = registry.items.map((item) => {
    const up = upstreamByItem.get(item.id) ?? null;
    if (up === null) {
      return {
        id: item.id,
        source: null,
        status: 'no-upstream' as const,
        detail: `"${item.sourceUrl}" names no queryable upstream (not a github.com repo, an npm package, or an MCP registry server) — this row is honestly unrefreshable and was left untouched.`,
      };
    }
    return {
      id: item.id,
      source: up.key,
      status: statusByKey.get(up.key) ?? 'failed',
      detail: detailByKey.get(up.key) ?? 'no result recorded for this source',
    };
  });

  return {
    nextRegistry: {
      ...registry,
      // Stamped only when at least one source was actually verified: a pass in
      // which every fetch failed refreshed nothing, and saying otherwise would
      // be exactly the "stale served as fresh" failure this module exists to
      // prevent.
      lastRefresh: verifiedAny ? nowIso : registry.lastRefresh,
      sources: nextSources,
      items: registry.items.map((item) => ({ ...item })),
    },
    outcomes,
    errors,
  };
}
