/**
 * The branch diff a work item is judged against, and the ONE rule that says
 * whether a changed path is inside a work item's declared scope. Split out of
 * `stop-conditions.ts` (forge-mfv5.1.52) so the required-paths gate and the
 * autocommit safety net share the matcher: the gate used to look each scope
 * entry up as an exact path, so a directory scope (`tests/`) could never be
 * met and gitweave I4's WI-13 spun on −3 `required-paths-missing`.
 */

import { globMatches } from '@forge/projects';
import { execFileSync } from 'node:child_process';

/**
 * True iff `changedPath` is covered by one of `scope`'s entries — exact
 * match, a directory prefix (entry ends with `/`, matching `isTrackedConfig`
 * in `packages/flows/pr-branch-sync.ts` and `trackedConfigProbe`/
 * `giTextCovers` in `packages/projects/preflight-repo.ts`), or a `*`-only
 * glob (`globMatches`, imported from `@forge/projects` — the one glob
 * matcher, never a second copy). A directory entry carries its own `/`, so
 * `startsWith` is a path-boundary match: `tests/` never covers `tests_old/x`.
 */
export function pathInScope(changedPath: string, scope: readonly string[]): boolean {
  return scope.some((entry) => {
    if (entry === changedPath) return true;
    if (entry.endsWith('/')) return changedPath.startsWith(entry);
    if (entry.includes('*')) return globMatches(entry, changedPath);
    return false;
  });
}

/** The paths `git diff --name-only <base>...HEAD` lists, or why it could not be read. */
export type BranchDiff = { paths: ReadonlySet<string> } | { error: string };

/**
 * The paths different on this branch vs its merge base with `main`/`master`.
 * A failure (no git, no base branch, detached HEAD) is returned by name, never
 * as an empty set (§6.15): callers fail closed AND say why.
 */
export function readBranchDiff(worktreePath: string): BranchDiff {
  try {
    const baseBranch = resolveBaseBranch(worktreePath);
    const out = execFileSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    const lines = out.toString('utf8').split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    return { paths: new Set(lines) };
  } catch (err) {
    // execFileSync's message names the command; git's own reason is on `stderr`.
    const cause = String((err as { stderr?: unknown }).stderr ?? '').trim().split('\n')[0];
    const head = err instanceof Error ? err.message.split('\n')[0]! : String(err);
    return { error: cause ? `${head}: ${cause}` : head };
  }
}

/**
 * Resolve the project's base branch name. Prefers `main`; falls back to
 * `master`. Surfaced by claude-harness cycle 1 (2026-05-24): a fresh
 * `git init` defaults to `master`, but the gate hard-coded `main`, so
 * the diff silently returned empty for 5 iterations even though the
 * agent's commits were on the branch. Throws if neither exists so the
 * caller's catch logs the degraded state.
 */
export function resolveBaseBranch(worktreePath: string): string {
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        cwd: worktreePath,
        stdio: 'pipe',
      });
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error('no main or master branch in worktree');
}
