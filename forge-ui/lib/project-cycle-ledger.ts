/**
 * Project-cycle run-history ledger derivation (R4-12 F2) — the THIRD caller
 * of the shared engine in `./history-ledger.ts`, after `./flow-ledger.ts`
 * (R6-05) and `./agent-ledger.ts` (R6-06). Turns a project's own cycles
 * (`GET /api/cycles` -> `Cycle[]`, `./bridge-client.ts`) into `LedgerRow[]`
 * so a project detail page renders its cycles in the SAME `when · what ·
 * outcome-narrative · status · cost` vocabulary the flow and agent monitors
 * already render — REUSING `LedgerRow`/`renderNarrative`/
 * `sortLedgerRowsNewestFirst` unchanged (D2, the reuse seam) rather than
 * forking a fourth, parallel row vocabulary of its own.
 *
 * ⚑ NO status filter — every cycle becomes a row (completed / merged / done
 * INCLUDED, not just live work). A project's ledger is its history.
 *
 * ⚑ href carries the FULL `cycleId` string AS-IS (P0 census): a completed
 * `cycleId` from `GET /api/cycles` resolves as a `runId` on
 * `/flows/forge-develop/run/<cycleId>` (same string) — NEVER a bare
 * `initiativeId` (the two differ: `<ISO-ish-timestamp>_<initiativeId>` vs
 * `<initiativeId>`).
 *
 * ⚑ costUsd is `null` — a `Cycle` carries no cost source, so an honest
 * absent-cost (history-ledger's rule), NEVER a fabricated `0`/`$0.00`.
 *
 * See `./project-cycle-ledger.test.ts` for the full acceptance contract.
 */

import {
  renderNarrative,
  sortLedgerRowsNewestFirst,
  type LedgerSegment,
  type LedgerRow,
} from './history-ledger';
import type { Cycle } from './bridge-client';

/** The develop flow a project's cycles are runs of — the surface a `cycleId`
 *  resolves against as a `runId` (P0 census). */
const DEVELOP_FLOW_ID = 'forge-develop';

/**
 * Derive a cycle's outcome-narrative segments from what the `Cycle` genuinely
 * carries — the same honest-omit discipline `./flow-ledger.ts` uses (never a
 * fabricated zero/empty fact). A `Cycle` reports no work-item counts, gate
 * retries, or review findings, so the one fact it does carry that maps onto
 * the shared vocabulary is its terminal-merge state: a `merged`/`done` status
 * means the cycle reached a confirmed PR merge (the cycle-status parallel to
 * flow-ledger's `run.status === 'complete' -> merged`; `merged` is the
 * transient pass-through, `done` the settled terminal — both imply the merge
 * happened, per `Cycle.status`'s own note). Never emitted for an in-flight /
 * failed / pending / ready-for-review cycle.
 */
function deriveProjectCycleLedgerSegments(cycle: Cycle): LedgerSegment[] {
  const segments: LedgerSegment[] = [];
  if (cycle.status === 'merged' || cycle.status === 'done') {
    segments.push({ kind: 'merged' });
  }
  return segments;
}

/**
 * Assemble a project's `Cycle[]` into `LedgerRow[]`, newest-first, via the
 * shared engine. `id`/`status` are copied verbatim from the cycle (status is
 * the CYCLE's own status, never re-derived); `when` carries the raw ISO
 * `startedAt` (or `''` if absent) — never `endedAt`, never a pre-formatted
 * relative time (D7, formatting is a presentation-time concern). `what` is
 * the cycle's `initiativeId` (mirrors flow-ledger's `run.initiative`).
 * `narrative`/`narrativeKinds` come from the SAME
 * `deriveProjectCycleLedgerSegments(cycle)` call so they can never disagree.
 * `costUsd` is `null` — no cost source exists on a `Cycle`. `href` carries
 * the FULL `cycleId` AS-IS (D2, the reuse seam; P0 census).
 */
export function deriveProjectCycleLedgerRows(cycles: Cycle[]): LedgerRow[] {
  const rows: LedgerRow[] = cycles.map((cycle) => {
    const segments = deriveProjectCycleLedgerSegments(cycle);
    return {
      id: cycle.cycleId,
      when: cycle.startedAt ?? '',
      what: cycle.initiativeId,
      narrative: renderNarrative(segments),
      narrativeKinds: segments.map((s) => s.kind),
      status: cycle.status,
      costUsd: null,
      href: `/flows/${DEVELOP_FLOW_ID}/run/${cycle.cycleId}`,
    };
  });
  return sortLedgerRowsNewestFirst(rows);
}
