/**
 * W8-B5 WI-1 — the community refresh's URL layer: the fixed API-origin
 * allowlist, and the `sourceUrl` -> upstream-identity parser.
 *
 * WHY THIS IS A LEAF MODULE OF ITS OWN. Two very different callers need the
 * SAME normalization and there must be exactly one of it:
 *
 *   - `orchestrator/studio/registry.ts` resolves an item's `sourceUrl` to the
 *     `sources:` row that holds that repo's facts (read time, no network);
 *   - `orchestrator/studio/community-refresh-api.ts` resolves the same
 *     `sourceUrl` to the API call it is allowed to make (refresh time).
 *
 * A second, re-typed copy of the parser would be the campaign's most-repeated
 * defect one layer down: the read path and the refresh path would silently key
 * the same repo differently.
 *
 * THE CONTAINMENT RULE (exit row E3). `sourceUrl` is operator-typable through
 * the registry CRUD form (`apps/forge/bridge-studio-writes.ts`), so it is attacker-
 * controlled input reaching forge's own server process. Therefore:
 *
 *   1. A row's `sourceUrl` is NEVER fetched. It is PARSED into an upstream
 *      identity; the refresh then builds its own request URL against a fixed
 *      API origin. An unparseable `sourceUrl` is "no upstream" — honestly
 *      unrefreshable, not an error, never a fetch.
 *   2. Every outbound URL is checked with `new URL(...).origin` compared
 *      EXACTLY against the three-entry allowlist. Never `startsWith` on the
 *      raw string: `https://api.github.com.evil.com/…` and
 *      `https://api.github.com@evil.com/…` both start with an allowlisted
 *      origin and both resolve to an attacker's host.
 *
 * This is the containment ratchet (cli/studio-path-guard.ts's
 * `resolveGuardedPath`, orchestrator/interactive-finalizers.ts's guarded
 * writes) applied to the NETWORK seam instead of the filesystem seam.
 */

/** The ONLY origins the community refresh may ever call. Frozen: a runtime
 *  push onto this array would silently widen the whole containment. */
export const COMMUNITY_REFRESH_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  'https://api.github.com',
  'https://registry.modelcontextprotocol.io',
  'https://registry.npmjs.org',
]);

/** A parsed upstream identity. `key` is the normalized `sources:` map key —
 *  the ONE identity two registry items sharing an upstream collapse onto
 *  (exit row E5: one repo, one star count, by construction). */
export type CommunityUpstream =
  | { kind: 'github'; owner: string; repo: string; key: string }
  | { kind: 'npm'; pkg: string; key: string }
  | { kind: 'mcp'; server: string; key: string };

/** GitHub owner/repo grammar. Deliberately narrower than GitHub's own: no
 *  path separators, no `%`, no `..` — the segment is interpolated into a
 *  request path, so it must not be able to climb or inject. */
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** npm package-name grammar (unscoped part). Lowercase by npm's own rule. */
const NPM_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** True iff `url` parses AND its ORIGIN is exactly one of the three allowed
 *  API origins. Origin covers scheme + host + port, so `http://`, a
 *  lookalike host and a non-default port are all refused by construction. */
export function isAllowedApiOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return COMMUNITY_REFRESH_ALLOWED_ORIGINS.includes(parsed.origin);
}

/** Shared refusals every host arm applies: https only, no userinfo, no
 *  explicit non-default port. (`new URL` normalizes away a default `:443`,
 *  so a surviving `port` is always an explicit non-default one.) */
function isStructurallySafe(u: URL): boolean {
  return u.protocol === 'https:' && u.username === '' && u.password === '' && u.port === '';
}

function pathSegments(u: URL): string[] {
  return u.pathname.split('/').filter((s) => s.length > 0);
}

/**
 * Parses an operator-typed `sourceUrl` into the upstream identity the refresh
 * is allowed to query. Returns `null` for ANYTHING it does not fully
 * recognise — that is the honest "this row has no upstream source" answer, not
 * an error: the registry legitimately carries curated rows whose source is a
 * blog post (`pre-impl-interview` -> firecrawl.dev), and those must read
 * unrefreshed forever rather than be fabricated or fetched.
 */
export function parseCommunityUpstream(sourceUrl: string): CommunityUpstream | null {
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (!isStructurallySafe(u)) return null;

  const segs = pathSegments(u);

  if (u.hostname === 'github.com') {
    if (segs.length < 2) return null;
    const owner = segs[0];
    const repo = segs[1].replace(/\.git$/, '');
    if (!GITHUB_SEGMENT_RE.test(owner) || !GITHUB_SEGMENT_RE.test(repo)) return null;
    return { kind: 'github', owner, repo, key: `github:${owner.toLowerCase()}/${repo.toLowerCase()}` };
  }

  if (u.hostname === 'www.npmjs.com' || u.hostname === 'npmjs.com') {
    // https://www.npmjs.com/package/<name> or /package/@scope/<name>
    if (segs.length < 2 || segs[0] !== 'package') return null;
    const rest = segs.slice(1);
    if (rest[0].startsWith('@')) {
      if (rest.length !== 2) return null;
      const scope = rest[0].slice(1);
      if (!NPM_NAME_RE.test(scope) || !NPM_NAME_RE.test(rest[1])) return null;
      const pkg = `@${scope}/${rest[1]}`;
      return { kind: 'npm', pkg, key: `npm:${pkg}` };
    }
    if (rest.length !== 1 || !NPM_NAME_RE.test(rest[0])) return null;
    return { kind: 'npm', pkg: rest[0], key: `npm:${rest[0]}` };
  }

  if (u.hostname === 'registry.modelcontextprotocol.io') {
    // forge's declared identity form for an MCP-registry row:
    // https://registry.modelcontextprotocol.io/servers/<name>, where <name> is
    // the registry's own `server.name` (reverse-DNS-ish and itself containing
    // a `/`, e.g. "ac.inference.sh/mcp"), so the remaining segments are
    // re-joined rather than taken as one.
    if (segs.length < 2 || segs[0] !== 'servers') return null;
    const server = segs.slice(1).join('/');
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(server) || server.includes('..')) return null;
    return { kind: 'mcp', server, key: `mcp:${server}` };
  }

  return null;
}

/** The `sources:` map key for a `sourceUrl`, or `null` when the row has no
 *  recognised upstream. The ONE place the read path and the refresh path
 *  agree on identity. */
export function communitySourceKey(sourceUrl: string): string | null {
  return parseCommunityUpstream(sourceUrl)?.key ?? null;
}

/**
 * The human display string for a star count — DERIVED from the number, never
 * curated free text. Under schema v1 `starsDisplay` was hand-typed alongside
 * `stars`, so the two could (and did) disagree; deriving it removes the
 * second place to be wrong.
 */
export function formatStarCount(stars: number | null): string | null {
  if (stars === null || !Number.isFinite(stars) || stars < 0) return null;
  const trim = (n: number): string => n.toFixed(1).replace(/\.0$/, '');
  if (stars >= 1_000_000) return `${trim(stars / 1_000_000)}M`;
  if (stars >= 10_000) return `${Math.round(stars / 1000)}k`;
  if (stars >= 1000) {
    const k = trim(stars / 1000);
    // 9999 -> "10.0" -> "10" : it crossed the thousand boundary on rounding.
    return `${k}k`;
  }
  return String(Math.round(stars));
}
