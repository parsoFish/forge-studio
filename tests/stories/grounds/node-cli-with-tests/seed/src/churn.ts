/**
 * Per-file code-churn aggregation.
 *
 * Pure module: no I/O, no git spawning. Takes a Commit[] produced by
 * src/git.ts and returns a per-file churn summary sorted by total lines
 * changed (descending), with ties broken by file path (ascending).
 */

import type { Commit } from './git.ts';

/** Per-file churn summary. Immutable. */
export type FileChurn = {
  /** File path (renamed files use the new path). */
  readonly file: string;
  /** Total inserted lines across all commits touching this file. */
  readonly insertions: number;
  /** Total deleted lines across all commits touching this file. */
  readonly deletions: number;
  /** Number of commits that touched this file. */
  readonly commits: number;
};

/**
 * Aggregate a list of commits into per-file churn summaries.
 *
 * - Binary numstat (`-`) entries are already normalised to 0 by `parseLog`.
 * - Renamed files are counted under the new path (normalisation is done by
 *   `parseLog` via `normaliseFilePath`).
 * - Sorted: descending `(insertions + deletions)`, then ascending `file` for
 *   ties.
 * - Input array is not mutated.
 * - Returns an empty array for empty input.
 */
export function computeChurn(commits: readonly Commit[]): FileChurn[] {
  // Accumulate per-file totals.
  const map = new Map<string, { insertions: number; deletions: number; commits: number }>();

  for (const commit of commits) {
    for (const fileEntry of commit.files) {
      const existing = map.get(fileEntry.path);
      if (existing === undefined) {
        map.set(fileEntry.path, {
          insertions: fileEntry.insertions,
          deletions: fileEntry.deletions,
          commits: 1,
        });
      } else {
        existing.insertions += fileEntry.insertions;
        existing.deletions += fileEntry.deletions;
        existing.commits += 1;
      }
    }
  }

  // Convert to FileChurn[], then sort.
  const result: FileChurn[] = [];
  for (const [file, totals] of map) {
    result.push({ file, ...totals });
  }

  result.sort((a, b) => {
    const totalA = a.insertions + a.deletions;
    const totalB = b.insertions + b.deletions;
    if (totalB !== totalA) return totalB - totalA; // descending by total lines
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0; // ascending by path
  });

  return result;
}
