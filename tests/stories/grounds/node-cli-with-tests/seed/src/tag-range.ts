/**
 * Pure tag-range filtering module — no git spawning.
 *
 * Provides:
 *   - `filterCommitsByTagRange`: slice a commits array by resolved tag SHAs.
 *   - `resolveEffectiveBounds`: pick the narrower of a date bound vs a tag bound
 *     (used by the CLI to merge --since / --since-tag arguments).
 */

import type { Commit } from './git.ts';

// ---------------------------------------------------------------------------
// filterCommitsByTagRange
// ---------------------------------------------------------------------------

export type TagRangeOptions = {
  /** Exclusive lower bound — the commit matching this SHA is excluded. */
  sinceTagSha?: string;
  /** Inclusive upper bound — the commit matching this SHA is included. */
  untilTagSha?: string;
};

/**
 * Filter an array of commits (newest-first, as returned by `git log`) to the
 * range defined by `range`.
 *
 * Array orientation (newest-first):
 *   index 0 = newest commit, index n-1 = oldest commit
 *
 * - `sinceTagSha` is the exclusive lower bound in TIME (older end of the window):
 *   the tagged commit itself is excluded, and so are all commits older than it
 *   (higher index). In the array this means we stop BEFORE sinceIdx.
 * - `untilTagSha` is the inclusive upper bound in TIME (newer end of the window):
 *   the tagged commit IS included. In the array this means we start AT untilIdx.
 *
 * Slice semantics (newest-first array):
 *   sliceStart = untilIdx        (inclusive — the until-commit is included)
 *   sliceEnd   = sinceIdx        (exclusive — the since-commit is excluded)
 *   result     = commits[sliceStart .. sliceEnd]
 *
 * - When `untilTagSha` is not given: sliceStart = 0 (include from newest).
 * - When `untilTagSha` is given but not found: return [] (nothing qualifies).
 * - When `sinceTagSha` is not given: sliceEnd = commits.length (include to oldest).
 * - When `sinceTagSha` is given but not found: no lower-bound clip (sliceEnd unchanged).
 * - When range is inverted (sinceTagSha is newer than or equal to untilTagSha):
 *   sliceEnd ≤ sliceStart → return [].
 *
 * No git is spawned; this is a pure array operation.
 */
export function filterCommitsByTagRange(
  commits: readonly Commit[],
  range: TagRangeOptions,
): Commit[] {
  const { sinceTagSha, untilTagSha } = range;

  // Index of the since-tag commit (exclusive lower bound, older end, higher index).
  const sinceIdx = sinceTagSha !== undefined
    ? commits.findIndex((c) => c.hash === sinceTagSha)
    : -1;

  // Index of the until-tag commit (inclusive upper bound, newer end, lower index).
  const untilIdx = untilTagSha !== undefined
    ? commits.findIndex((c) => c.hash === untilTagSha)
    : -1;

  // --- Determine sliceStart (inclusive start of the result window) ---
  // until-tag = newer boundary = lower array index = start of slice.
  let sliceStart: number;
  if (untilTagSha === undefined) {
    sliceStart = 0; // no upper time bound → include all commits from newest
  } else if (untilIdx === -1) {
    return []; // until-tag specified but not in array → nothing qualifies
  } else {
    sliceStart = untilIdx; // include the until-commit
  }

  // --- Determine sliceEnd (exclusive end of the result window) ---
  // since-tag = older boundary = higher array index = end of slice (exclusive).
  let sliceEnd: number;
  if (sinceTagSha === undefined) {
    sliceEnd = commits.length; // no lower time bound → include to oldest
  } else if (sinceIdx === -1) {
    // since-tag specified but not found → treat as older than everything → no clip
    sliceEnd = commits.length;
  } else {
    sliceEnd = sinceIdx; // exclude the since-commit itself (and everything older)
  }

  if (sliceEnd <= sliceStart) return [];

  return commits.slice(sliceStart, sliceEnd) as Commit[];
}

// ---------------------------------------------------------------------------
// resolveEffectiveBounds
// ---------------------------------------------------------------------------

export type AppliedBound = {
  /** Effective since date (YYYY-MM-DD or null). */
  since: string | null;
  /** Effective until date (YYYY-MM-DD or null). */
  until: string | null;
  sinceTagSha: string | null;
  untilTagSha: string | null;
  /** Human-readable annotation for the since bound, e.g. which bound won. */
  sinceAnnotation: string | null;
  /** Human-readable annotation for the until bound. */
  untilAnnotation: string | null;
};

/**
 * Resolve the effective since/until bounds when the caller may supply both a
 * date bound (`--since` / `--until`) and a tag-based bound (`--since-tag` /
 * `--until-tag`).
 *
 * The narrower bound wins:
 *   - For `since`: the later date is narrower (fewer commits pass through).
 *   - For `until`: the earlier date is narrower.
 *
 * When both are given for the same dimension, an annotation is generated
 * explaining which was applied and why.
 */
export function resolveEffectiveBounds(opts: {
  sinceDate: string | null;
  untilDate: string | null;
  sinceTag: string | null;
  untilTag: string | null;
  /** Resolved commit SHA for the since-tag. */
  sinceTagSha: string | null;
  /** Resolved commit SHA for the until-tag. */
  untilTagSha: string | null;
  /** YYYY-MM-DD of the since-tag's commit (used for date comparison). */
  sinceTagCommitDate: string | null;
  /** YYYY-MM-DD of the until-tag's commit. */
  untilTagCommitDate: string | null;
}): AppliedBound {
  const {
    sinceDate, untilDate,
    sinceTag, untilTag,
    sinceTagSha, untilTagSha,
    sinceTagCommitDate, untilTagCommitDate,
  } = opts;

  // --- since bound ---
  let effectiveSince: string | null = sinceDate;
  let effectiveSinceTagSha: string | null = sinceTagSha;
  let sinceAnnotation: string | null = null;

  if (sinceDate !== null && sinceTagCommitDate !== null && sinceTag !== null) {
    // Both given — pick the narrower (later) since-date.
    if (sinceDate >= sinceTagCommitDate) {
      // Date is narrower or equal → use date, drop tag SHA bound.
      effectiveSince = sinceDate;
      effectiveSinceTagSha = null;
      sinceAnnotation =
        `(since ${sinceDate} — date bound was narrower than since-tag ${sinceTag})`;
    } else {
      // Tag is narrower → use tag SHA, keep tag commit date as the effective since.
      effectiveSince = sinceTagCommitDate;
      effectiveSinceTagSha = sinceTagSha;
      sinceAnnotation =
        `(since ${sinceTagCommitDate} from tag ${sinceTag} — tag bound was narrower than --since ${sinceDate})`;
    }
  } else if (sinceDate === null && sinceTagCommitDate !== null) {
    // Only tag given.
    effectiveSince = sinceTagCommitDate;
    effectiveSinceTagSha = sinceTagSha;
  }
  // else: only sinceDate given (already set above), or neither given.

  // --- until bound ---
  let effectiveUntil: string | null = untilDate;
  let effectiveUntilTagSha: string | null = untilTagSha;
  let untilAnnotation: string | null = null;

  if (untilDate !== null && untilTagCommitDate !== null && untilTag !== null) {
    // Both given — pick the narrower (earlier) until-date.
    if (untilDate <= untilTagCommitDate) {
      // Date is narrower or equal → use date, drop tag SHA bound.
      effectiveUntil = untilDate;
      effectiveUntilTagSha = null;
      untilAnnotation =
        `(until ${untilDate} — date bound was narrower than until-tag ${untilTag})`;
    } else {
      // Tag is narrower.
      effectiveUntil = untilTagCommitDate;
      effectiveUntilTagSha = untilTagSha;
      untilAnnotation =
        `(until ${untilTagCommitDate} from tag ${untilTag} — tag bound was narrower than --until ${untilDate})`;
    }
  } else if (untilDate === null && untilTagCommitDate !== null) {
    effectiveUntil = untilTagCommitDate;
    effectiveUntilTagSha = untilTagSha;
  }

  return {
    since: effectiveSince,
    until: effectiveUntil,
    sinceTagSha: effectiveSinceTagSha,
    untilTagSha: effectiveUntilTagSha,
    sinceAnnotation,
    untilAnnotation,
  };
}
