/**
 * ProjectCycleLedger — the exact subtree a project detail page mounts to
 * render its own run-history (R4-12 F2). A thin presentational wrapper that
 * feeds a project's `Cycle[]` through the SHARED project-cycle adapter
 * (`../../../lib/project-cycle-ledger.ts`'s `deriveProjectCycleLedgerRows` —
 * the THIRD caller of the shared engine, after flow-ledger and agent-ledger)
 * into the SHARED `HistoryLedger` presentational component UNCHANGED.
 *
 * WHY `cycles` (NOT `rows`): the prop is the RAW `Cycle[]` from
 * `fetchCycles()` (`../../../lib/bridge-client.ts`), never pre-built
 * `LedgerRow[]`. It is therefore structurally impossible for a caller to
 * bypass the shared transform by handing this wrapper constructed rows — the
 * `deriveProjectCycleLedgerRows` derivation ALWAYS runs on the render path
 * (rule 38: the ONE non-empty row must actually reach the client through the
 * transform, not a hand-built stand-in). See
 * `../../../lib/project-cycle-ledger-render.test.ts` for the pinned contract.
 *
 * The page mounts `<ProjectCycleLedger cycles={…} nowMs={Date.now()} />` with
 * `cycles` = `fetchCycles()` output scoped to this project, populated in the
 * page's existing cycles-load effect. This component derives NOTHING itself
 * and constructs NO route — the shared adapter owns the `LedgerRow` shape and
 * the flow-run `href`; `HistoryLedger` owns the DOM.
 */

import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { deriveProjectCycleLedgerRows } from '@/lib/project-cycle-ledger';
import type { Cycle } from '@/lib/bridge-client';

export type ProjectCycleLedgerProps = {
  /** The project's own cycles, RAW from `fetchCycles()` — the transform runs
   *  here, so this is never pre-built `LedgerRow[]`. */
  cycles: Cycle[];
  /** Explicit "now", threaded straight through to `HistoryLedger` (D7) — the
   *  shared component reads it for `formatWhen`, never `Date.now()` itself. */
  nowMs: number;
};

export function ProjectCycleLedger({ cycles, nowMs }: ProjectCycleLedgerProps): JSX.Element {
  return <HistoryLedger rows={deriveProjectCycleLedgerRows(cycles)} nowMs={nowMs} />;
}
