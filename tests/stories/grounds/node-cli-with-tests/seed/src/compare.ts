/**
 * Pure delta model for `--compare <ref>` analytics.
 *
 * `computeDelta(base, head, ref)` accepts two Summary snapshots and returns a
 * CompareResult containing:
 *   - headline totals for head and base
 *   - signed deltas (head - base) for each headline metric
 *   - per-author deltas across the union of authors present in either summary
 *
 * Pure: no I/O, no mutation of inputs, no git calls.
 */

import type { Summary } from './stats.ts';

/** Per-author delta between two summaries. */
export type AuthorDelta = {
  readonly author: string;
  readonly baseCommits: number;
  readonly headCommits: number;
  readonly deltaCommits: number;
  readonly baseChurn: number;   // base insertions + deletions
  readonly headChurn: number;   // head insertions + deletions
  readonly deltaChurn: number;  // headChurn - baseChurn
};

/** Result returned by `computeDelta`. */
export type CompareResult = {
  readonly ref: string;  // base ref name passed through for display
  readonly head: { commits: number; linesAdded: number; linesRemoved: number };
  readonly base: { commits: number; linesAdded: number; linesRemoved: number };
  readonly delta: { commits: number; linesAdded: number; linesRemoved: number };
  readonly authorDeltas: readonly AuthorDelta[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sum insertions + deletions across all authorChurn entries in a Summary. */
function totalInsertions(s: Summary): number {
  return s.authorChurn.reduce((acc, a) => acc + a.insertions, 0);
}

function totalDeletions(s: Summary): number {
  return s.authorChurn.reduce((acc, a) => acc + a.deletions, 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the delta between two Summary snapshots.
 *
 * @param base  - Summary for the base ref (the comparison point).
 * @param head  - Summary for HEAD (the current branch tip).
 * @param ref   - Human-readable name of the base ref (e.g. `"v0.1"`), stored
 *                verbatim in the returned `CompareResult.ref`.
 */
export function computeDelta(base: Summary, head: Summary, ref: string): CompareResult {
  // --- Headline totals ---
  const headCommits    = head.totalCommits;
  const baseCommits    = base.totalCommits;
  const headLinesAdded = totalInsertions(head);
  const baseLinesAdded = totalInsertions(base);
  const headLinesRemoved = totalDeletions(head);
  const baseLinesRemoved = totalDeletions(base);

  // --- Author deltas ---
  // Build lookup maps for fast access (author → AuthorChurn entry).
  const baseMap = new Map(base.authorChurn.map(a => [a.author, a]));
  const headMap = new Map(head.authorChurn.map(a => [a.author, a]));

  // Union of all authors in either summary.
  const allAuthors = new Set<string>([...baseMap.keys(), ...headMap.keys()]);

  const authorDeltas: AuthorDelta[] = [];
  for (const author of allAuthors) {
    const b = baseMap.get(author);
    const h = headMap.get(author);

    const bCommits = b?.commits ?? 0;
    const hCommits = h?.commits ?? 0;
    const bChurn   = (b?.insertions ?? 0) + (b?.deletions ?? 0);
    const hChurn   = (h?.insertions ?? 0) + (h?.deletions ?? 0);

    authorDeltas.push({
      author,
      baseCommits:  bCommits,
      headCommits:  hCommits,
      deltaCommits: hCommits - bCommits,
      baseChurn:    bChurn,
      headChurn:    hChurn,
      deltaChurn:   hChurn - bChurn,
    });
  }

  // Sort descending by |deltaCommits|, tie-break descending by |deltaChurn|.
  authorDeltas.sort((a, b) => {
    const diff = Math.abs(b.deltaCommits) - Math.abs(a.deltaCommits);
    if (diff !== 0) return diff;
    return Math.abs(b.deltaChurn) - Math.abs(a.deltaChurn);
  });

  return {
    ref,
    head: {
      commits:      headCommits,
      linesAdded:   headLinesAdded,
      linesRemoved: headLinesRemoved,
    },
    base: {
      commits:      baseCommits,
      linesAdded:   baseLinesAdded,
      linesRemoved: baseLinesRemoved,
    },
    delta: {
      commits:      headCommits      - baseCommits,
      linesAdded:   headLinesAdded   - baseLinesAdded,
      linesRemoved: headLinesRemoved - baseLinesRemoved,
    },
    authorDeltas,
  };
}
