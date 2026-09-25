/**
 * Author-filter module.
 *
 * Pure, zero-I/O filter that narrows a Commit[] by author name or email
 * using simple glob patterns (`*`-only wildcard, case-insensitive).
 *
 * Does NOT use `matchGlob` from `src/glob.ts` — uses an inline regex builder
 * so this module has no intra-project dependencies.
 */

import type { Commit } from './git.ts';

/** Result of filtering commits by author pattern. */
export type AuthorFilterResult = {
  /** Commits that matched at least one pattern. */
  readonly filtered: Commit[];
  /** Number of commits that did NOT match any pattern. */
  readonly excludedCount: number;
};

/**
 * Build a case-insensitive RegExp from a simple glob pattern that supports
 * only `*` as a wildcard (matches any substring). An empty string pattern
 * compiles to a regex that matches nothing.
 *
 * Examples:
 *   'Ada*'    → /^ada.*$/i
 *   '*@example.com' → /^.*@example\.com$/i
 *   ''        → never matches (returns null)
 */
function buildPattern(glob: string): RegExp | null {
  if (glob.length === 0) return null;
  const escaped = glob
    .split('*')
    .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Filter `commits` to those whose author name OR author email matches ANY
 * of the given `patterns` (union / OR semantics). Matching is case-insensitive
 * and uses simple `*`-wildcard glob syntax.
 *
 * Rules:
 * - If `patterns` is empty, return all commits with `excludedCount: 0`.
 * - An empty-string pattern `''` matches nothing.
 * - `'*'` matches every commit.
 * - `excludedCount` = `commits.length - filtered.length`.
 */
export function filterAuthorCommits(
  commits: Commit[],
  patterns: readonly string[],
): AuthorFilterResult {
  if (patterns.length === 0) {
    return { filtered: [...commits], excludedCount: 0 };
  }

  // Pre-compile all patterns once.
  const regexes: Array<RegExp | null> = patterns.map(buildPattern);

  const filtered = commits.filter((commit) =>
    regexes.some((re) => {
      if (re === null) return false;
      return re.test(commit.author) || re.test(commit.authorEmail);
    }),
  );

  return {
    filtered,
    excludedCount: commits.length - filtered.length,
  };
}
