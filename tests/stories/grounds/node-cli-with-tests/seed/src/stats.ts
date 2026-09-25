/**
 * Commit-stats aggregation.
 *
 * Pure: given an array of Commit records, return an immutable Summary. No I/O,
 * no mutation of the input. This is the unit-tested analytics core.
 */

import type { Commit } from './git.ts';
import { computeChurn } from './churn.ts';
import type { FileChurn } from './churn.ts';
import { computeOwnership } from './ownership.ts';
import type { FileOwnership } from './ownership.ts';
import { computeHotspots } from './hotspot.ts';
import type { HotspotEntry } from './hotspot.ts';

/** Per-author commit count. */
export type AuthorCount = {
  readonly author: string;
  readonly commits: number;
};

/** Per-author line-churn (insertions + deletions) across all commits. */
export type AuthorChurn = {
  readonly author: string;
  readonly commits: number;
  readonly insertions: number;
  readonly deletions: number;
};

/** Aggregated commit statistics for a repository. */
export type Summary = {
  /** Total number of commits considered. */
  readonly totalCommits: number;
  /** Commit counts per author, descending; ties broken by author name asc. */
  readonly byAuthor: readonly AuthorCount[];
  /**
   * Per-author churn (insertions + deletions), descending total churn;
   * ties broken by author name ascending.
   */
  readonly authorChurn: readonly AuthorChurn[];
  /**
   * Per-file churn (insertions + deletions), descending total lines changed;
   * ties broken by file path ascending.
   */
  readonly fileChurn: readonly FileChurn[];
  /** Earliest commit date (`YYYY-MM-DD`), or null when there are no commits. */
  readonly firstDate: string | null;
  /** Latest commit date (`YYYY-MM-DD`), or null when there are no commits. */
  readonly lastDate: string | null;
  /**
   * Per-file ownership records. Populated only when `repoPath` is provided
   * in options; otherwise an empty array.
   */
  readonly ownershipEntries: readonly FileOwnership[];
  /**
   * Per-file hotspot entries, sorted by score descending.
   * Always populated (empty when commits is empty).
   */
  readonly hotspotEntries: readonly HotspotEntry[];
};

export type { FileChurn, FileOwnership, HotspotEntry };

/**
 * Aggregate commits into a Summary. Author order is by descending commit count,
 * then ascending author name for deterministic tie-breaking. Date range spans
 * the lexically smallest/largest `YYYY-MM-DD` dates (ISO dates sort correctly
 * as plain strings). Returns null dates for an empty input.
 *
 * `authorChurn` is sorted by descending total lines changed (insertions +
 * deletions), with ties broken by author name ascending.
 *
 * Options:
 *   - `top`: if a positive integer, each ranked list is sliced to this length.
 *   - `repoPath`: if provided, enables `computeOwnership` for git-blame data.
 */
export function summarize(
  commits: readonly Commit[],
  options?: { top?: number; repoPath?: string },
): Summary {
  if (!Array.isArray(commits)) {
    throw new TypeError('summarize: commits must be an array');
  }

  const counts = new Map<string, number>();
  const churnIns = new Map<string, number>();
  const churnDel = new Map<string, number>();
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  for (const commit of commits) {
    counts.set(commit.author, (counts.get(commit.author) ?? 0) + 1);
    churnIns.set(commit.author, (churnIns.get(commit.author) ?? 0) + commit.insertions);
    churnDel.set(commit.author, (churnDel.get(commit.author) ?? 0) + commit.deletions);

    if (commit.date.length > 0) {
      if (firstDate === null || commit.date < firstDate) firstDate = commit.date;
      if (lastDate === null || commit.date > lastDate) lastDate = commit.date;
    }
  }

  let byAuthor: readonly AuthorCount[] = [...counts.entries()]
    .map(([author, n]) => ({ author, commits: n }))
    .sort((a, b) => (b.commits - a.commits) || a.author.localeCompare(b.author));

  let authorChurn: readonly AuthorChurn[] = [...counts.entries()]
    .map(([author, n]) => ({
      author,
      commits: n,
      insertions: churnIns.get(author) ?? 0,
      deletions: churnDel.get(author) ?? 0,
    }))
    .sort((a, b) => {
      const totalA = a.insertions + a.deletions;
      const totalB = b.insertions + b.deletions;
      return (totalB - totalA) || a.author.localeCompare(b.author);
    });

  let fileChurn: readonly FileChurn[] = computeChurn(commits);

  // Apply top cap if requested.
  const top = options?.top;
  if (typeof top === 'number' && top >= 1) {
    byAuthor = byAuthor.slice(0, top);
    authorChurn = authorChurn.slice(0, top);
    fileChurn = fileChurn.slice(0, top);
  }

  // Compute ownership (requires repoPath for git blame).
  let ownershipEntries: readonly FileOwnership[] = [];
  if (options?.repoPath !== undefined) {
    const rawOwnership = computeOwnership(commits, options.repoPath);
    ownershipEntries = typeof top === 'number' && top >= 1
      ? rawOwnership.slice(0, top)
      : rawOwnership;
  }

  // Compute hotspots (pure — no I/O).
  const referenceDate = new Date().toISOString().slice(0, 10);
  const rawHotspots = computeHotspots(commits, referenceDate);
  const hotspotEntries: readonly HotspotEntry[] = typeof top === 'number' && top >= 1
    ? rawHotspots.slice(0, top)
    : rawHotspots;

  return {
    totalCommits: commits.length,
    byAuthor,
    authorChurn,
    fileChurn,
    firstDate,
    lastDate,
    ownershipEntries,
    hotspotEntries,
  };
}
