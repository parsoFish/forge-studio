/**
 * Pure analytics for the `gitpulse tags` subcommand.
 *
 * No I/O, no git spawning — receives pre-parsed data from src/git.ts and
 * returns computed TagSpan records and the median inter-tag gap.
 */

import type { Commit, TagEntry } from './git.ts';

/** Computed span between two consecutive tags (or from the beginning to the oldest tag). */
export type TagSpan = {
  /** Tag name, e.g. "v0.3". */
  readonly name: string;
  /** Tag date in YYYY-MM-DD form. */
  readonly date: string;
  /** Count of commits in (prevTag..thisTag]. */
  readonly commitsSince: number;
  /** Count of distinct author strings in the span. */
  readonly uniqueAuthors: number;
  /**
   * Calendar days between this tag's date and the previous (older) tag's date.
   * `null` for the oldest tag (no predecessor).
   */
  readonly daysSince: number | null;
};

/**
 * Compute the calendar-day difference between two YYYY-MM-DD date strings.
 * Anchors to UTC midnight to avoid timezone edge cases.
 */
function daysBetween(olderDate: string, newerDate: string): number {
  const older = new Date(`${olderDate}T00:00:00Z`).getTime();
  const newer = new Date(`${newerDate}T00:00:00Z`).getTime();
  return Math.floor((newer - older) / 86400000);
}

/**
 * Compute one TagSpan per tag from the git-seam data.
 *
 * @param tags - Tags sorted newest-first (as returned by `readTags`).
 * @param commitsBySpan - `commitsBySpan[i]` is the commits for `tags[i]`
 *   (i.e. commits in (tags[i+1]..tags[i]] for all but the oldest).
 */
export function computeTagSpans(
  tags: readonly TagEntry[],
  commitsBySpan: readonly Commit[][],
): TagSpan[] {
  return tags.map((tag, i) => {
    const commits = commitsBySpan[i] ?? [];
    const commitsSince = commits.length;
    const uniqueAuthors = new Set(commits.map((c) => c.author)).size;

    // The next tag in the newest-first list is the OLDER adjacent tag.
    // daysSince = this tag's date - previous (older) tag's date.
    // For the oldest tag (last element), there is no predecessor → null.
    const olderTag = tags[i + 1];
    const daysSince =
      olderTag !== undefined ? daysBetween(olderTag.date, tag.date) : null;

    return { name: tag.name, date: tag.date, commitsSince, uniqueAuthors, daysSince };
  });
}

/**
 * Compute the median inter-tag gap in calendar days.
 *
 * Excludes `null` values (the oldest tag has no predecessor gap).
 * Returns `null` if fewer than 2 non-null daysSince values exist (no gaps).
 */
export function computeMedianGapDays(spans: readonly TagSpan[]): number | null {
  const gaps = spans
    .map((s) => s.daysSince)
    .filter((d): d is number => d !== null);

  if (gaps.length === 0) return null;

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);

  if (gaps.length % 2 === 1) {
    return gaps[mid];
  }
  // Even number: average the two middle values
  return (gaps[mid - 1] + gaps[mid]) / 2;
}
