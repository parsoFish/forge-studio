/**
 * Monitor — the ONE aggregate derivation behind both `/monitor` (the depth)
 * and Home's summary strip (the glance). W8-B1.
 *
 * Why this module exists at all: Home already derived a merged
 * everything-ledger inline in `app/page.tsx` and, right next to it, a
 * `liveCount` derived from an entirely different source (the constellation
 * hexes). The two disagreed in production — the regate row this lane closes
 * is Home reading "Active status — 0 live" directly above its own ledger
 * showing ten in-flight rows. Two derivations of "what is running" is the
 * `declared-data-fails-open` shape wearing a different hat: a number nothing
 * re-checks against the rows it summarises.
 *
 * The cure here is structural, not a patch: the headline counts are computed
 * FROM the same rows the ledger renders, so a summary that disagrees with the
 * list below it is no longer expressible. Monitor and Home render the same
 * `MonitorSummary` value; neither owns a private count.
 *
 * PURE — no reads, no async work, no live-refresh wiring. The callers do
 * the reading (`use-studio-home-data.ts` + `use-everything-ledger.ts`) and
 * hand the already-fetched data in. `scripts/home-no-new-polling.test.ts`
 * enforces that structurally, the same way it does for `home-view.ts`.
 */

import type { LedgerRow } from './history-ledger';
import type { Run, SessionIndexRow } from './studio-client';

/**
 * Ledger-row statuses that mean "this run is in flight right now".
 *
 * Closed on purpose. `LedgerRowStatus` is deliberately open (a session row
 * carries its runner's own raw phase verbatim — see history-ledger.ts), so a
 * membership test is the only honest way to read it: an unknown token counts
 * as neither live nor failed rather than being guessed into one.
 *
 * `'retrying'` is a `RunPhaseStatus` a flow-node row can carry — a phase
 * mid-retry is still consuming budget and still running.
 */
export const MONITOR_LIVE_ROW_STATUSES: ReadonlySet<string> = new Set(['active', 'running', 'retrying']);

/**
 * Ledger-row statuses that mean "this run stopped without succeeding".
 *
 * `'budget-exceeded'` is included: a run the ceiling stopped did not do the
 * work, and an operator scanning for trouble needs to see it. The raw status
 * still rides on the row itself (`data-run-status`), so nothing is flattened
 * away — only the count stops under-reporting.
 */
export const MONITOR_FAILED_ROW_STATUSES: ReadonlySet<string> = new Set(['failed', 'budget-exceeded']);

/** Run-level status meaning "queued, waiting for the scheduler to pick it up". */
export const MONITOR_QUEUED_RUN_STATUS = 'planned';

/** Run-level status meaning "stopped at a gate, waiting for the operator". */
export const MONITOR_GATED_RUN_STATUS = 'gated';

export type MonitorSummary = {
  /** Runs in flight (ledger rows, session rows excluded) + live sessions. */
  live: number;
  /** In-flight runs only — the half of `live` that is NOT an interactive session. */
  runsLive: number;
  /** Non-terminal interactive sessions — the other half of `live`. */
  sessionsLive: number;
  /** Ledger rows whose run stopped without succeeding. */
  failed: number;
  /** Flow runs queued for the scheduler. */
  queued: number;
  /** Flow runs stopped at an operator gate. */
  gatedRuns: number;
  /** Sessions the bridge says need the operator (its verdict, not re-derived). */
  sessionsNeedingYou: number;
  /** Project-gate / KB / parked-draft attention rows, counted by the caller. */
  attention: number;
  /**
   * Everything waiting on a human: gated runs + sessions needing you +
   * attention rows. Three genuinely different queues, summed for ONE
   * headline; each part stays separately readable above so a surface can
   * break it back out instead of re-deriving it.
   */
  needsYou: number;
  /** Total ledger rows this surface knows about — the denominator. */
  total: number;
};

/**
 * A session is live iff the bridge says it has not reached a terminal phase.
 * `terminal` is the bridge's own field (`collectStudioSessionIndexRows`), so
 * this never re-derives a lifecycle verdict client-side — the defect class
 * where two surfaces disagree about whether a session finished.
 */
export function isSessionLive(session: SessionIndexRow): boolean {
  return !session.terminal;
}

/**
 * Build the aggregate counts from ALREADY-FETCHED data.
 *
 * `ledgerRows` must be the SAME merged list the surface renders — that
 * identity is the whole point. Session-kind rows are excluded from the run
 * counts and counted from `sessions` instead: a session row carries its
 * runner's raw phase, not the run vocabulary, so counting it as a "run"
 * would both mis-classify it and double-count it against `sessions`.
 */
export function buildMonitorSummary(input: {
  ledgerRows: readonly LedgerRow[];
  runs: readonly Run[];
  sessions: readonly SessionIndexRow[];
  attentionCount: number;
}): MonitorSummary {
  const runRows = input.ledgerRows.filter((row) => row.linkKind !== 'session');
  const runsLive = runRows.filter((row) => MONITOR_LIVE_ROW_STATUSES.has(row.status)).length;
  const failed = runRows.filter((row) => MONITOR_FAILED_ROW_STATUSES.has(row.status)).length;
  const sessionsLive = input.sessions.filter(isSessionLive).length;
  const sessionsNeedingYou = input.sessions.filter((s) => s.needsYou).length;
  const queued = input.runs.filter((r) => r.status === MONITOR_QUEUED_RUN_STATUS).length;
  const gatedRuns = input.runs.filter((r) => r.status === MONITOR_GATED_RUN_STATUS).length;
  const attention = Math.max(0, Math.trunc(input.attentionCount));

  return {
    live: runsLive + sessionsLive,
    runsLive,
    sessionsLive,
    failed,
    queued,
    gatedRuns,
    sessionsNeedingYou,
    attention,
    needsYou: gatedRuns + sessionsNeedingYou + attention,
    total: input.ledgerRows.length,
  };
}

/** One tile of the Home summary strip / Monitor headline row. */
export type MonitorSummaryTile = {
  id: string;
  label: string;
  count: number;
  /** Where the tile takes the operator for the depth behind the number. */
  href: string;
};

/**
 * The strip Home renders. Deliberately a DERIVATION over `MonitorSummary`
 * rather than a second set of counts: Home cannot render a tile whose number
 * Monitor does not also hold.
 *
 * Every tile always renders, including at zero — a strip whose tiles appear
 * and vanish makes "nothing is running" indistinguishable from "the strip
 * broke", and the operator learns nothing from an absent row.
 */
export function buildMonitorSummaryTiles(summary: MonitorSummary): MonitorSummaryTile[] {
  return [
    { id: 'live', label: 'Live', count: summary.live, href: '/monitor' },
    { id: 'needs-you', label: 'Needs you', count: summary.needsYou, href: '/monitor' },
    { id: 'failed', label: 'Failed', count: summary.failed, href: '/monitor' },
    { id: 'queued', label: 'Queued', count: summary.queued, href: '/monitor' },
  ];
}

/** Monitor's own section list — the five things the pillar promises. */
export const MONITOR_SECTIONS = ['monitor-summary', 'scheduler', 'monitor-attention', 'monitor-sessions', 'monitor-runs', 'activity'] as const;
