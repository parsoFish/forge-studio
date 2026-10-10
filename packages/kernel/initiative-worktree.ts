/**
 * The one answer to "is this path the initiative's own forge worktree?" (forge-nk1y.20).
 *
 * A manifest `worktree_path` later reaches `rmSync`, `git -C` and `git worktree remove
 * --force`. The only legitimate value is exactly `<forgeRoot>/_worktrees/<initiativeId>`
 * (the one place `scheduler-run-one.ts` creates a cycle worktree). There is NO "anywhere
 * under the projects root" alternative: nothing writes an in-place worktree, and that
 * fallback admitted another project's directory or the repo itself.
 *
 * Identity, not a prefix: the candidate is decomposed into segments and `resolveGuardedPath`
 * realpath-walks `_worktrees` and the initiative segment, so a symlinked `_worktrees`, a
 * symlinked `<id>`, an alias of another initiative's worktree and a dangling link are all
 * refused. `forgeRoot` is trusted (config-derived) and may itself be a symlinked checkout.
 *
 * The RAW string is judged, not its `resolve()`d text: `<other>/lnk/../../<id>` normalises to the
 * own worktree but the sinks resolve `..` physically through `lnk` ('non-canonical').
 *
 * Returns `null` when accepted, else a fixed reason NAME that never carries a path (safe to
 * log). Accepted on purpose: ONE trailing `/`, and a `_worktrees/<id>` that no longer exists
 * (finalize/requeue hold the path after removal).
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSafeSegment, resolveGuardedPath } from './path-guard.ts';

/**
 * Is the RAW string already canonical: absolute, with no `.`/`..` segment and no empty
 * segment except ONE trailing slash? `resolve()` text-normalises `a/lnk/../b` to `a/b`, but
 * every sink (rmSync, `git -C`) hands the raw string to the kernel, which resolves `..`
 * PHYSICALLY through `lnk` — so a containment verdict on the normalised text says nothing
 * about where the raw string lands. Judge the raw string, never the normalised one.
 */
export function isCanonicalAbsolutePath(p: string): boolean {
  if (typeof p !== 'string' || !isAbsolute(p)) return false;
  const rest = p.split(sep).slice(1);
  return rest.every((s, i) => s !== '.' && s !== '..' && (s !== '' || i === rest.length - 1));
}

export type InitiativeWorktreeRefusal =
  | 'unsafe-initiative-id'
  | 'not-absolute'
  | 'forge-root-unavailable'
  | 'non-canonical'
  | 'indeterminate'
  | 'not-under-forge-worktrees'
  | 'not-this-initiative'
  | 'symlink-or-alias';

export function initiativeWorktreeRefusal(
  p: string,
  opts: { forgeRoot: string; initiativeId: string },
): InitiativeWorktreeRefusal | null {
  if (typeof opts.initiativeId !== 'string' || !isSafeSegment(opts.initiativeId)) return 'unsafe-initiative-id';
  // A relative candidate resolves against process.cwd(), not forgeRoot — refuse it before any resolution.
  if (typeof p !== 'string' || !isAbsolute(p)) return 'not-absolute';
  if (typeof opts.forgeRoot !== 'string' || opts.forgeRoot === '') return 'forge-root-unavailable';

  const forgeRoot = resolve(opts.forgeRoot);
  // `resolve()` normalises `..`, so a surviving '..' in `rel` means the candidate lies above `_worktrees`.
  const rel = relative(join(forgeRoot, '_worktrees'), resolve(p));
  const segments = rel.split(sep);
  if (rel === '' || segments.some((s) => s === '' || s === '.' || s === '..')) return 'not-under-forge-worktrees';
  if (segments.length !== 1 || segments[0] !== opts.initiativeId) return 'not-this-initiative';
  if (!isCanonicalAbsolutePath(p)) return 'non-canonical';

  // `_worktrees` is a segment of the walk, not part of the trusted root, so a symlinked `_worktrees` is refused too.
  const guarded = resolveGuardedPath(forgeRoot, ['_worktrees', opts.initiativeId]);
  if (guarded.ok) return null;
  switch (guarded.kind) {
    case 'root': return 'forge-root-unavailable';
    case 'unsafe': return 'unsafe-initiative-id';
    case 'indeterminate': return 'indeterminate';
    case 'alias': return 'symlink-or-alias';
  }
}
