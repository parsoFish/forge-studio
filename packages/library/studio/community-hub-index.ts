/**
 * M6-D / operator ruling 478 — ask a declared hub what it PUBLISHES.
 *
 * A refresh re-verifies rows that already exist and never discovers one, so
 * four of the nine declared hubs contribute nothing and stay that way. The
 * design record is `packages/library/design.md` §"A hub is asked what it
 * publishes, and only a hub forge can reach": why GitHub-shaped hubs only, why
 * this proposes rather than writes, and why the layout convention is the one
 * install-by-URL already reads.
 *
 * Three rules belong beside the code:
 *
 *   - **It proposes; it never writes.** Nothing here touches `registry.yaml`.
 *   - **A discovered row is installable by construction** — same convention as
 *     `community-fetch-package.ts`, pinned against it by test rather than by
 *     agreement.
 *   - **A directory name is a stranger's string**: it passes `assertSkillSlug`
 *     or it is skipped, never sanitised into something that looks valid.
 */

import { assertSkillSlug } from '@forge/kernel/ids.ts';

import {
  CommunityRefreshError,
  fetchAllowedApiUrl,
  readJson,
  type CommunityRefreshErrorKind,
  type RequestCtx,
} from './community-refresh-api.ts';
import { githubRepoTree } from './community-fetch-package.ts';
import { parseCommunityUpstream } from './community-source-url.ts';

/** A row this hub publishes that the registry does not carry yet. */
export interface DiscoveredItem {
  id: string;
  /** The repository the row's `sourceUrl` will point at — the hub's own URL. */
  sourceUrl: string;
  /** What was matched, so a reviewer can see why the row was proposed: a
   *  `SKILL.md` path, or the registry's own server name. */
  path: string;
}

export type HubIndexOutcome =
  /** `partial` is TRUE when the source had more to give and the reader stopped
   *  at its own bound — the list is a FLOOR, not a total. Absent/false means
   *  the source was read to the end. A reader that returns a floor with no way
   *  to say so hands its caller a number that looks like an answer. */
  | { ok: true; hubId: string; discovered: DiscoveredItem[]; partial?: boolean; readCap?: string }
  | { ok: false; hubId: string; reason: 'not-reachable'; message: string }
  | { ok: false; hubId: string; reason: 'tree-truncated'; message: string }
  | { ok: false; hubId: string; reason: 'fetch-failed'; kind: CommunityRefreshErrorKind; message: string };

/** `skills/<name>/SKILL.md`, `<name>/SKILL.md`, or a root `SKILL.md` — the
 *  three shapes `community-fetch-package.ts` can install from, and therefore
 *  the only three worth proposing. */
function idForSkillPath(path: string, repo: string): string | null {
  if (path === 'SKILL.md') return repo; // a repo that IS one skill
  const m = /^(?:skills\/)?([^/]+)\/SKILL\.md$/.exec(path);
  return m ? m[1] : null;
}

/** Dispatch is by URL, never by `kinds` — design.md §"A second hub reader". ONE
 *  parse rule, used by the reader and by the dispatch, so they cannot disagree
 *  about which host a hub is. An unparseable URL is simply not the registry. */
const MCP_REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io';
function isMcpRegistry(url: string): boolean {
  try {
    return new URL(url).origin === MCP_REGISTRY_ORIGIN;
  } catch {
    return false;
  }
}

/** SELECT the final segment, then require it to pass UNCHANGED — never clean it
 *  up. design.md §"A second hub reader" has the why. */
function idForMcpServerName(name: string): string | null {
  const last = name.slice(name.lastIndexOf('/') + 1);
  if (last === '') return null;
  try {
    assertSkillSlug(last);
  } catch {
    return null;
  }
  return last;
}

/** Ask the MCP registry what it publishes. Its origin is already allowlisted
 *  and already read, so this opens no new external surface. */
export async function indexMcpRegistryHub(
  ctx: RequestCtx,
  hub: { id: string; url: string },
  knownIds: ReadonlySet<string>,
): Promise<HubIndexOutcome> {
  if (!isMcpRegistry(hub.url)) {
    return {
      ok: false,
      hubId: hub.id,
      reason: 'not-reachable',
      message: `"${hub.url}" is not the MCP registry, and this indexer reads no other host.`,
    };
  }

  const MAX_PAGES = 5;
  const discovered: DiscoveredItem[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let partial = false;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ version: 'latest', limit: '50' });
      if (cursor !== null) qs.set('cursor', cursor);
      const res = await fetchAllowedApiUrl(ctx, `${MCP_REGISTRY_ORIGIN}/v0/servers?${qs.toString()}`, {
        Accept: 'application/json',
        'User-Agent': 'forge-community-refresh',
      });
      if (!res.ok) {
        throw new CommunityRefreshError('http-error', `the MCP registry answered ${res.status} when asked what it publishes.`);
      }
      const body = await readJson(res, 'MCP registry');
      const servers = body['servers'];
      if (!Array.isArray(servers)) {
        throw new CommunityRefreshError('malformed-response', 'the MCP registry listing has no "servers" array.');
      }
      for (const row of servers) {
        if (row === null || typeof row !== 'object') continue;
        const server = (row as Record<string, unknown>)['server'];
        if (server === null || typeof server !== 'object') continue;
        const name = (server as Record<string, unknown>)['name'];
        if (typeof name !== 'string') continue;
        const id = idForMcpServerName(name);
        if (id === null || seen.has(id) || knownIds.has(id)) continue;
        seen.add(id);
        discovered.push({ id, sourceUrl: hub.url, path: name });
      }
      const metadata = body['metadata'];
      const nextCursor =
        metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>)['nextCursor'] : undefined;
      if (typeof nextCursor !== 'string' || nextCursor === '') break;
      cursor = nextCursor;
      // A cursor still outstanding as the last page is consumed means the
      // registry has more and this reader is about to stop. MEASURED: it holds
      // at least 2000 servers and this bound reads 250, so silence here would
      // report a floor as a total.
      if (page === MAX_PAGES - 1) partial = true;
    }
  } catch (err) {
    if (err instanceof CommunityRefreshError) {
      return { ok: false, hubId: hub.id, reason: 'fetch-failed', kind: err.kind, message: err.message };
    }
    throw err; // a genuine crash, never laundered into a refusal
  }
  return {
    ok: true,
    hubId: hub.id,
    discovered: discovered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ...(partial ? { partial: true, readCap: `${MAX_PAGES} pages of 50` } : {}),
  };
}

/** The reader for a hub, by URL; the GitHub reader's refusal names the limit. */
export function indexerForHub(hub: { url: string }): typeof indexGithubHub {
  return isMcpRegistry(hub.url) ? indexMcpRegistryHub : indexGithubHub;
}

export async function indexGithubHub(
  ctx: RequestCtx,
  hub: { id: string; url: string },
  knownIds: ReadonlySet<string>,
): Promise<HubIndexOutcome> {
  const upstream = parseCommunityUpstream(hub.url);
  if (upstream === null || upstream.kind !== 'github') {
    return {
      ok: false,
      hubId: hub.id,
      reason: 'not-reachable',
      message:
        `"${hub.url}" is not a GitHub repository, and forge reaches no other kind of hub. ` +
        'It stays a declared source that contributes nothing until an operator decides forge may reach it.',
    };
  }
  const { owner, repo } = upstream;

  try {
    const { entries, truncated } = await githubRepoTree(ctx, owner, repo);
    if (truncated) {
      return {
        ok: false,
        hubId: hub.id,
        reason: 'tree-truncated',
        message: `GitHub truncated its listing of "${owner}/${repo}" — forge will not propose rows from a tree it could not enumerate in full.`,
      };
    }

    const discovered: DiscoveredItem[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const id = idForSkillPath(entry.path, repo);
      if (id === null || seen.has(id) || knownIds.has(id)) continue;
      // A directory name is a stranger's string. It becomes a registry id and
      // then a path segment, so it passes the same slug guard every other id in
      // this package does — and a name that fails it is skipped, not sanitised.
      try {
        assertSkillSlug(id);
      } catch {
        continue;
      }
      seen.add(id);
      discovered.push({ id, sourceUrl: hub.url, path: entry.path });
    }
    return { ok: true, hubId: hub.id, discovered: discovered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  } catch (err) {
    if (err instanceof CommunityRefreshError) {
      return { ok: false, hubId: hub.id, reason: 'fetch-failed', kind: err.kind, message: err.message };
    }
    throw err; // a genuine crash, never laundered into a refusal
  }
}
