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

import { CommunityRefreshError, type CommunityRefreshErrorKind, type RequestCtx } from './community-refresh-api.ts';
import { githubRepoTree } from './community-fetch-package.ts';
import { parseCommunityUpstream } from './community-source-url.ts';

/** A row this hub publishes that the registry does not carry yet. */
export interface DiscoveredItem {
  id: string;
  /** The repository the row's `sourceUrl` will point at — the hub's own URL. */
  sourceUrl: string;
  /** Where the SKILL.md sits, so a reviewer can see what was matched. */
  path: string;
}

export type HubIndexOutcome =
  | { ok: true; hubId: string; discovered: DiscoveredItem[] }
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
