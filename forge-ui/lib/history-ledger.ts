/**
 * Shared run-history ledger engine (R6-05 Task 3, D2).
 *
 * SURFACE-AGNOSTIC ON PURPOSE: this module owns the row vocabulary — `when ·
 * what · outcome-narrative · status · cost` — shared by R6-05's flow-monitor
 * ledger and R6-06's (next initiative) agent-monitor ledger. It contains
 * NOTHING flow-specific (D2): no knowledge of `Run.phaseMeta`, no href
 * construction, no flow topology. `./flow-ledger.ts` is the FIRST caller,
 * turning a flow's `Run[]` into `LedgerRow[]`; R6-06 will add a second
 * caller for agent runs, reusing every export here unchanged. `href` is
 * always computed by the CALLER (D2, the reuse seam) so a different surface
 * can point rows at a different destination without touching this file.
 *
 * See `./history-ledger.test.ts` for the full acceptance contract.
 */

import type { RunStatus } from './studio-client';

// ---------------------------------------------------------------------------
// LedgerSegment — the closed, seven-member outcome-narrative vocabulary (D3)
// ---------------------------------------------------------------------------

/**
 * A single fact in a run's outcome narrative. CLOSED union — exactly seven
 * members (D3). Segment ORDER (produced by a caller's derivation, e.g.
 * `./flow-ledger.ts`'s `deriveFlowLedgerSegments`) is the run's own
 * chronology: work-items → gate-fails → review-findings →
 * gate-waiting|failed → merged → reflection-lost.
 */
export type LedgerSegment =
  | { kind: 'work-items'; done: number; total: number }
  /** dev node ONLY — D9. Never derived from any other node's `retries`. */
  | { kind: 'gate-fails'; count: number }
  | { kind: 'review-findings'; total: number; blocker: number; major: number; minor: number; info: number }
  | { kind: 'gate-waiting'; note: string }
  | { kind: 'failed'; note: string }
  | { kind: 'merged' }
  | { kind: 'reflection-lost'; cause: string };

/** The narrative's own joiner sequence — also the sequence `renderSegment`
 *  must neutralize inside any free-text note it interpolates (D11). */
const NARRATIVE_JOINER = ' → ';

/** Defuse the narrative's own joiner character out of caller-supplied free
 *  text (D11) — the note's INFORMATION survives byte-for-byte, only the
 *  arrow character itself is replaced, so a note can never be mistaken for a
 *  segment boundary when the rendered narrative is split back apart. */
function neutralizeJoiner(note: string): string {
  return note.split('→').join('-');
}

/**
 * Render one segment to its exact, pinned human-readable string. The
 * closed-vocabulary guarantee (D3) is closed at the CONTENT level too
 * (D11): `gate-waiting`/`failed` notes are free text this module does not
 * author, so the joiner sequence is neutralized before interpolation.
 */
export function renderSegment(seg: LedgerSegment): string {
  switch (seg.kind) {
    case 'work-items':
      return `dev ${seg.done}/${seg.total}`;
    case 'gate-fails':
      return `gate failed ×${seg.count}`;
    case 'review-findings':
      return `${seg.total} finding${seg.total === 1 ? '' : 's'} (${seg.blocker} blocker, ${seg.major} major)`;
    case 'gate-waiting':
      return `gated: ${neutralizeJoiner(seg.note)}`;
    case 'failed':
      return `failed: ${neutralizeJoiner(seg.note)}`;
    case 'merged':
      return 'merged';
    case 'reflection-lost':
      // Mirrors RunRail.tsx:304's existing "reflection lost: {cause}" wording
      // verbatim — a second phrasing for the same fact would be vocabulary
      // drift D3 forbids.
      return `reflection lost: ${seg.cause}`;
    default: {
      const exhaustive: never = seg;
      return exhaustive;
    }
  }
}

/**
 * Compose the full narrative string from a caller-ordered segment list.
 * Joins with " → " in the ARRAY order given — never re-sorted. Nothing true
 * to say (`[]`) renders `null`, never an empty string or invented filler.
 */
export function renderNarrative(segments: LedgerSegment[]): string | null {
  if (segments.length === 0) return null;
  return segments.map(renderSegment).join(NARRATIVE_JOINER);
}

// ---------------------------------------------------------------------------
// LedgerRow — the shared row shape
// ---------------------------------------------------------------------------

export type LedgerRow = {
  id: string;
  /** Raw ISO `run.startedAt`, or '' if absent (D7) — formatting is a
   *  presentation-time concern (`formatWhen`), never baked in here. */
  when: string;
  what: string;
  /** `renderNarrative(segments)` — D3. */
  narrative: string | null;
  /**
   * ROUND 3 (D11) — the MACHINE surface: `segments.map(s => s.kind)`, the
   * SAME order as the segments that produced `narrative`, from the SAME
   * derivation call so the two can never disagree. `[]` iff `narrative ===
   * null`.
   */
  narrativeKinds: string[];
  /** The REAL `RunStatus` vocabulary — D4. Never the mockup's invented
   *  'attention' status. */
  status: RunStatus;
  /** `run.costUsd`, read never re-summed — D8. */
  costUsd: number;
  /** Caller-computed — D2, the reuse seam. */
  href: string;
};

// ---------------------------------------------------------------------------
// sortLedgerRowsNewestFirst — pure, immutable, missing-`when` handling
// ---------------------------------------------------------------------------

/**
 * Sort rows newest-`when`-first, returning a NEW array (never mutates the
 * input — the standing "return new objects, never mutate inputs" rule). A
 * row with no `when` (empty string) sorts LAST, never first — a naive
 * ascending sort of `''` parsed as a Date yields `NaN`, whose comparator
 * behaviour is implementation-defined and could land an unstarted run at
 * the top of "most recent" history.
 */
export function sortLedgerRowsNewestFirst(rows: LedgerRow[]): LedgerRow[] {
  return [...rows].sort((a, b) => {
    const aMs = a.when ? new Date(a.when).getTime() : null;
    const bMs = b.when ? new Date(b.when).getTime() : null;
    if (aMs === null && bMs === null) return 0;
    if (aMs === null) return 1;
    if (bMs === null) return -1;
    return bMs - aMs;
  });
}

// ---------------------------------------------------------------------------
// formatWhen — deterministic, locale/wall-clock independent (D7)
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Format an ISO timestamp relative to an explicit `nowMs` — never reads
 * `Date.now()` or calls `toLocaleString()` internally (D7), so the result
 * is byte-identical regardless of process TZ/locale. A run with no
 * `startedAt` renders the honest placeholder `'—'`, never a fabricated
 * time or an `Invalid Date` leak.
 */
export function formatWhen(iso: string | undefined, nowMs: number): string {
  if (!iso) return '—';
  const thenMs = new Date(iso).getTime();
  const diffMs = nowMs - thenMs;
  const diffMinutes = Math.floor(diffMs / MINUTE_MS);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMs / HOUR_MS);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / DAY_MS);
  return `${diffDays}d ago`;
}
