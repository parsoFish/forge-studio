/**
 * Flow-specific run-history ledger derivation (R6-05 Task 3) — the FIRST
 * caller of the shared engine in `./history-ledger.ts`. Turns a flow's own
 * `Run[]` into `LedgerRow[]`, sourcing every segment from real, already-
 * derived `Run`/`RunPhaseMeta` fields — nothing here is re-derived or
 * re-summed (ADR-008: nothing new is stored).
 *
 * ⚑ D9 — `gate-fails` is sourced from `phaseMeta['dev'].retries` ONLY.
 * Every other node's `retries` is a count of `error`-typed events (spawn
 * errors, budget exhaustion, scope violations), NOT a gate-failure fact —
 * rendering it as "gate failed ×N" would be a false claim about the run.
 *
 * ⚑ Segment ORDER is the run's own chronology (verified against
 * `studio/flows/forge-develop/flow.yaml`): work-items → gate-fails →
 * review-findings → gate-waiting|failed → merged → reflection-lost. Each
 * segment is read from its OWN named `Run`/`RunPhaseMeta` field directly
 * (never by iterating `Object.keys(run.phaseMeta)`, whose insertion order
 * tracks event ARRIVAL in the source log, not the flow's declared topology).
 *
 * See `./flow-ledger.test.ts` for the full acceptance contract.
 */

import {
  renderNarrative,
  sortLedgerRowsNewestFirst,
  type LedgerSegment,
  type LedgerRow,
} from './history-ledger';
import type { Run } from './studio-client';

/**
 * Derive this run's outcome-narrative segments, in canonical chronological
 * order. Every segment is OMITTED (never rendered as a fabricated zero/
 * empty fact) when its source is absent or has nothing notable to report —
 * the same honest-omit discipline `renderNarrative`'s empty-list -> `null`
 * rule already establishes one level up.
 */
export function deriveFlowLedgerSegments(run: Run): LedgerSegment[] {
  const segments: LedgerSegment[] = [];

  // 1. work-items — the dev node's fan-out (run.workItems, never re-derived).
  //    `done` counts ONLY status === 'complete'; `total` is `.length`. Never
  //    fabricated when workItems is empty/absent.
  if (run.workItems && run.workItems.length > 0) {
    const done = run.workItems.filter((wi) => wi.status === 'complete').length;
    segments.push({ kind: 'work-items', done, total: run.workItems.length });
  }

  // 2. gate-fails — dev node's OWN quality-gate retries ONLY (D9). Zero is
  //    not a fact worth reporting; a node with no phaseMeta entry produces
  //    no segment either (never a fallback to 0 that then gets reported).
  const devMeta = run.phaseMeta['dev'];
  if (devMeta && devMeta.retries > 0) {
    segments.push({ kind: 'gate-fails', count: devMeta.retries });
  }

  // 3. review-findings — adversarial-review node, read verbatim from
  //    phaseMeta.findings (R6-05 WI-1, D8's sibling rule: never recomputed
  //    from blocker+major+minor+info). A clean pass (total === 0) has
  //    nothing notable to report in the terse narrative — a different rule
  //    from WI-1's own phaseMeta layer, which keeps the real zero.
  const findings = run.phaseMeta['adversarial-review']?.findings;
  if (findings && findings.total > 0) {
    segments.push({
      kind: 'review-findings',
      total: findings.total,
      blocker: findings.blocker,
      major: findings.major,
      minor: findings.minor,
      info: findings.info,
    });
  }

  // 4. gate-waiting | failed — the run's terminal-ish state at/around the
  //    review verdict gate. Both derive from run.status (never fabricated
  //    for an in-flight run, and mutually exclusive with `merged` since
  //    RunStatus is a single scalar — a run cannot be both 'gated'/'failed'
  //    and 'complete').
  if (run.status === 'gated' && run.gateNote !== undefined) {
    segments.push({ kind: 'gate-waiting', note: run.gateNote });
  } else if (run.status === 'failed' && run.failNote !== undefined) {
    segments.push({ kind: 'failed', note: run.failNote });
  }

  // 5. merged — run.status === 'complete' implies a CONFIRMED remote PR
  //    merge (D10, traced to confirmPrMerged's fail-closed chain). Earned by
  //    status, never fabricated for an in-flight or failed run.
  if (run.status === 'complete') {
    segments.push({ kind: 'merged' });
  }

  // 6. reflection-lost — async, post-merge reflect crash/budget/kill
  //    (R4-11-F1). Read verbatim from run.reflectionLost, independent of
  //    status — a merged run's reflection can be lost after the merge.
  if (run.reflectionLost !== undefined) {
    segments.push({ kind: 'reflection-lost', cause: run.reflectionLost });
  }

  return segments;
}

/**
 * Assemble a flow's `Run[]` into `LedgerRow[]`, newest-first. `what`/
 * `status`/`costUsd` are copied verbatim from the run (never re-derived —
 * a row's status is the RUN's own status, D4; cost is never re-summed,
 * D8). `when` carries the raw ISO `startedAt` (or `''` if absent) — no
 * formatting applied at derivation time (D7). `narrative`/`narrativeKinds`
 * come from the SAME `deriveFlowLedgerSegments(run)` call so they can never
 * disagree (D11). `href` mirrors `RunRail.tsx`'s own existing "Run detail
 * →" link target verbatim (D2, the reuse seam).
 *
 * R6-06 D8: `run.trigger` (already on the wire `Run` type — R2-08-F4/R6-01
 * WI-2, not new here) is now also attached to `row.trigger`, verbatim,
 * carried through the SAME conditional-spread convention `parseRun` already
 * uses for it — an absent `run.trigger` leaves `row.trigger` genuinely
 * absent (byte-identical-when-absent: every EXISTING flow-ledger row is
 * unaffected). `linkKind` is NEVER set here — this caller's rows are already
 * scoped to "inside a flow run" by construction (D8).
 */
export function deriveFlowLedgerRows(runs: Run[]): LedgerRow[] {
  const rows: LedgerRow[] = runs.map((run) => {
    const segments = deriveFlowLedgerSegments(run);
    return {
      id: run.id,
      when: run.startedAt ?? '',
      what: run.initiative,
      narrative: renderNarrative(segments),
      narrativeKinds: segments.map((s) => s.kind),
      status: run.status,
      costUsd: run.costUsd,
      href: `/flows/${encodeURIComponent(run.flowId)}/run/${encodeURIComponent(run.id)}`,
      ...(run.trigger !== undefined ? { trigger: run.trigger } : {}),
    };
  });
  return sortLedgerRowsNewestFirst(rows);
}
