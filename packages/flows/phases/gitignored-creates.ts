/**
 * ADR 051 decision 5 — "does git see this path?", answered once per pass.
 *
 * A work item's `creates:` list is what the required-paths check reads the diff
 * for. A path under a gitignored directory can never appear in that diff, so the
 * check passes on its ABSENCE: the work is graded as done because the evidence
 * it looks for is invisible. That is the declared-data-fails-open shape in its
 * most expensive form, and the project manager is the last place to catch it
 * before an agent is dispatched against the set.
 *
 * The predicate is built HERE, from one batched `git check-ignore --stdin` over
 * the union of every WI's `creates:` paths, and injected into the pure validator
 * in `@forge/flows` — which is why that validator needs no repository to test
 * and this module needs no work-item vocabulary.
 */

import { spawnSync } from 'node:child_process';

import { isContainedWorktreePath } from '../manifest-path-guard.ts';

/** What `isContainedWorktreePath` needs to judge the root this module spawns in. */
export type WorktreeGuard = { forgeRoot: string; projectsRoot?: string; initiativeId: string };

/**
 * The set of paths git ignores, from ONE `git check-ignore` call.
 *
 * `--stdin` takes the whole list and prints back only the ignored ones, so the
 * cost is one process for a set of any size rather than one per path (the
 * existing per-path `check-ignore -q` shape in `packages/projects` predates a
 * caller with a list). A git failure — not a repository, git absent, a path git
 * refuses — yields an EMPTY set, so the rule declines to fire rather than
 * inventing a verdict: a validator that cannot see the repository must not
 * accuse a work item of hiding from it.
 */
export function gitIgnoredPaths(
  worktreePath: string,
  paths: readonly string[],
  guard: WorktreeGuard,
): ReadonlySet<string> {
  const unique = [...new Set(paths.filter((p) => p.length > 0))];
  if (unique.length === 0) return new Set();
  // CONTAINMENT AT THE SINK, not only at the caller. `worktreePath` reaches
  // here from a manifest, which is request-derived, and `git -C <dir>` runs in
  // whatever directory it is given. The same predicate `writeManifest`'s
  // choke point uses (`isContainedWorktreePath`) decides whether this module
  // may spawn at all; an uncontained root yields the EMPTY set, so the rule
  // declines rather than running git somewhere nobody sanctioned. The paths
  // themselves go over STDIN, never argv, so a leading `-` is a pathname to
  // `--stdin` rather than an option.
  if (!isContainedWorktreePath(worktreePath, guard)) return new Set();
  const res = spawnSync('git', ['-C', worktreePath, 'check-ignore', '--stdin'], {
    input: unique.join('\n') + '\n',
    encoding: 'utf8',
  });
  // `check-ignore` exits 0 when it matched something, 1 when it matched
  // nothing, and >1 on a real error. Only the last is a reason to give up.
  if (res.error !== undefined || (res.status !== 0 && res.status !== 1)) return new Set();
  return new Set(
    (res.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

/**
 * The predicate `validateWorkItemSet` takes, built from ONE call for the whole
 * set. Exported as the predicate rather than the set so its single caller — the
 * project manager, a file already over the 800-line cap — gains one line, not a
 * local, a comment and a lambda.
 */
export function isIgnoredPathFor(
  worktreePath: string,
  creates: readonly string[],
  guard: WorktreeGuard,
): (relPath: string) => boolean {
  const ignored = gitIgnoredPaths(worktreePath, creates, guard);
  return (relPath) => ignored.has(relPath);
}
