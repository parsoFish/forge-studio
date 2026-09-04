/**
 * kb-runs.ts (W7-B2, knowledge-20) — map the KB run-history rows
 * (`GET /api/studio/kbs/:id/runs`, packages/knowledge/bridge-studio-kb-drain.ts's
 * `listKbRuns`) onto the shared `LedgerRow` shape `HistoryLedger` renders,
 * exactly the way `agent-ledger.ts` maps agent history. Pure — directly
 * unit-testable (./kb-runs.test.ts).
 */

import { sortLedgerRowsNewestFirst, type LedgerRow } from './history-ledger';
import type { KbRunRow } from './studio-client';

const KB_RUN_WHAT: Record<KbRunRow['kind'], string> = {
  drain: 'Drain to green',
  consolidate: 'Consolidate',
  cleanup: 'Cleanup plan',
};

/** One KB run → one ledger row. `href`: drain/consolidate runs live on the
 *  KB health tab itself (the drain panel + this ledger are its record);
 *  a cleanup run is a real session with its own page. */
export function toKbRunLedgerRow(kbId: string, run: KbRunRow): LedgerRow {
  const href =
    run.kind === 'cleanup'
      ? `/sessions/kb-cleanup/${encodeURIComponent(run.id)}${run.project ? `?project=${encodeURIComponent(run.project)}` : ''}`
      : `/knowledge?id=${encodeURIComponent(kbId)}&tab=health#kb-drain-panel`;
  return {
    id: run.id,
    when: run.when,
    what: KB_RUN_WHAT[run.kind],
    narrative: run.detail,
    // history-ledger invariant: narrativeKinds is [] iff narrative === null.
    narrativeKinds: run.detail !== null ? ['kb-run-detail'] : [],
    status: run.status,
    costUsd: run.costUsd,
    href,
  };
}

export function toKbRunLedgerRows(kbId: string, runs: readonly KbRunRow[]): LedgerRow[] {
  return sortLedgerRowsNewestFirst(runs.map((r) => toKbRunLedgerRow(kbId, r)));
}
