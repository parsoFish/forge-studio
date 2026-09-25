/**
 * Generic sort helper + column registry for the `--sort` CLI flag.
 *
 * Pure module: no I/O, no git spawning. Exports:
 *   - `sortRecords<T>` — stable sort of a record array by a named column
 *   - `COLUMNS` — map from command slug to the set of sortable column names
 *   - `NUMERIC_COLUMNS` — map from command slug to numeric column names
 */

/** Command slugs supported by gitpulse. */
export type CommandSlug =
  | 'churn'
  | 'ownership'
  | 'hotspots'
  | 'authors'
  | 'compare'
  | 'tags';

/**
 * Sort `records` by `column` in the given `direction`.
 *
 * - Does NOT mutate the input array; returns a new array.
 * - Numeric detection: `typeof record[column] === 'number'` on the first
 *   non-null record in the array.
 * - Numeric comparison: standard subtraction (`a - b`), not string comparison.
 * - Text comparison: direct `<`/`>` comparison; NOT `localeCompare`.
 * - Stability: index-based tie-break preserves original relative order.
 * - Empty array or unknown column → returns records unchanged (new array).
 */
export function sortRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  column: string,
  direction: 'asc' | 'desc',
): T[] {
  if (records.length === 0) return [];

  // Detect whether the column holds numeric values by inspecting the first
  // record that has a non-null value for the column.
  let isNumeric = false;
  for (const record of records) {
    const value = record[column];
    if (value !== null && value !== undefined) {
      isNumeric = typeof value === 'number';
      break;
    }
  }

  // Attach original indices for stable sort.
  const indexed = records.map((record, i) => ({ record, i }));

  indexed.sort((a, b) => {
    const av = a.record[column];
    const bv = b.record[column];

    let cmp: number;
    if (isNumeric) {
      // Numeric comparison via subtraction.
      cmp = (av as number) - (bv as number);
    } else {
      // Text comparison using direct < / > (not localeCompare).
      if ((av as string) < (bv as string)) {
        cmp = -1;
      } else if ((av as string) > (bv as string)) {
        cmp = 1;
      } else {
        cmp = 0;
      }
    }

    // Apply direction.
    if (direction === 'desc') cmp = -cmp;

    // Stable tie-break: preserve original order.
    return cmp !== 0 ? cmp : a.i - b.i;
  });

  return indexed.map(({ record }) => record);
}

/**
 * Map from command slug to the full set of valid sortable column names.
 *
 * Used by the CLI to validate `--sort` arguments.
 */
export const COLUMNS: Record<CommandSlug, ReadonlySet<string>> = {
  churn:     new Set(['file', 'insertions', 'deletions', 'commits']),
  ownership: new Set(['file', 'owner', 'ownerLines', 'busFactor']),
  hotspots:  new Set(['file', 'score', 'commits', 'lastDate']),
  authors:   new Set(['author', 'commits', 'insertions', 'deletions']),
  compare:   new Set(['author', 'baseCommits', 'headCommits', 'deltaCommits', 'baseChurn', 'headChurn', 'deltaChurn']),
  tags:      new Set(['name', 'date', 'commitsSince', 'uniqueAuthors', 'daysSince']),
};

/**
 * Map from command slug to the subset of columns whose values are numeric.
 *
 * Used by WI-2 to decide the default sort direction (numeric → desc, text → asc).
 */
export const NUMERIC_COLUMNS: Record<CommandSlug, ReadonlySet<string>> = {
  churn:     new Set(['insertions', 'deletions', 'commits']),
  ownership: new Set(['ownerLines', 'busFactor']),
  hotspots:  new Set(['score', 'commits']),
  authors:   new Set(['commits', 'insertions', 'deletions']),
  compare:   new Set(['baseCommits', 'headCommits', 'deltaCommits', 'baseChurn', 'headChurn', 'deltaChurn']),
  tags:      new Set(['commitsSince', 'uniqueAuthors', 'daysSince']),
};
