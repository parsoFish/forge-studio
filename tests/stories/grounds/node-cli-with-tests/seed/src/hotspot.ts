/**
 * Churn × recency hotspot ranking.
 *
 * Pure module: no I/O, no git spawning. Takes a Commit[] produced by
 * src/git.ts and returns per-file hotspot entries sorted by score descending,
 * with ties broken by file path ascending.
 *
 * Score formula: commits / (daysSince + 1)
 * where daysSince = calendar days between lastDate and referenceDate.
 * If referenceDate < lastDate (negative daysSince), daysSince is clamped to 0.
 */

import type { Commit } from './git.ts';

/** Per-file hotspot entry. Immutable. */
export type HotspotEntry = {
  /** File path. */
  readonly file: string;
  /** Hotspot score: commits / (daysSince + 1). Higher = hotter. */
  readonly score: number;
  /** Number of commits that touched this file. */
  readonly commits: number;
  /** YYYY-MM-DD of the most recent commit touching this file. */
  readonly lastDate: string;
};

/**
 * Compute calendar days between two YYYY-MM-DD date strings.
 * Returns `to - from` in whole days. May be negative if `to` < `from`.
 */
function daysBetween(from: string, to: string): number {
  const msPerDay = 86_400_000;
  return Math.round((Date.parse(to) - Date.parse(from)) / msPerDay);
}

/**
 * Aggregate a list of commits into per-file hotspot entries.
 *
 * - Accumulates commit count and the most recent commit date per file.
 * - Score = commits / (daysSince + 1), where daysSince is clamped ≥ 0.
 * - Sorted: descending by score, then ascending by file path for ties.
 * - Returns an empty array for empty input.
 */
export function computeHotspots(
  commits: readonly Commit[],
  referenceDate: string,
): HotspotEntry[] {
  // Accumulate per-file commit count and latest date.
  const map = new Map<string, { commits: number; lastDate: string }>();

  for (const commit of commits) {
    for (const fileEntry of commit.files) {
      const existing = map.get(fileEntry.path);
      if (existing === undefined) {
        map.set(fileEntry.path, { commits: 1, lastDate: commit.date });
      } else {
        existing.commits += 1;
        // Keep the most recent (lexicographically largest YYYY-MM-DD) date.
        if (commit.date > existing.lastDate) {
          existing.lastDate = commit.date;
        }
      }
    }
  }

  // Build HotspotEntry[], compute scores.
  const result: HotspotEntry[] = [];
  for (const [file, data] of map) {
    const rawDays = daysBetween(data.lastDate, referenceDate);
    const daysSince = Math.max(0, rawDays); // clamp negative to 0
    const score = data.commits / (daysSince + 1);
    result.push({ file, score, commits: data.commits, lastDate: data.lastDate });
  }

  // Sort: descending by score, then ascending by file path for ties.
  result.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });

  return result;
}
