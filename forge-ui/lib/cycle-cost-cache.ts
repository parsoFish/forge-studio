/**
 * Cycle-cost fetch planning (W7-B6 review F5) — the pure decision behind the
 * project page's per-cycle cost column (`fetchCycleCostMap`,
 * app/projects/[id]/page.tsx).
 *
 * The naive shape fired one `GET /api/cost/<cycleId>` per project cycle on
 * EVERY cycles refresh — and `refreshRoadmap` runs after every plan / start /
 * flow-run dispatch and every save, so a project with 80 cycles re-derived 80
 * cost summaries from their events.jsonl server-side each time. A cycle in a
 * terminal status cannot gain spend, so a cost already RESOLVED for a
 * terminal cycle is reused; only live cycles (and terminal ones whose cost is
 * still unknown — first sight, or a failed fetch recorded as `null`) are
 * fetched again.
 */

/** Statuses after which a cycle can gain no further spend. `merged` is the
 *  transient closure pass-through (→ `done` in the same sweep) — the run is
 *  over either way. `ready-for-review` is deliberately NOT here: the verdict
 *  approve path still runs finalize/merge work that can cost. */
export const COST_TERMINAL_CYCLE_STATUSES: ReadonlySet<string> = new Set(['merged', 'done', 'failed']);

export type CycleCostFetchPlan = {
  /** Costs carried over without a fetch (terminal cycle, resolved cost). */
  reused: Record<string, number | null>;
  /** cycleIds that genuinely need a `GET /api/cost/<id>` this round. */
  toFetch: string[];
};

export function planCycleCostFetch(
  cycles: readonly { cycleId: string; status: string }[],
  prev: Readonly<Record<string, number | null>>,
): CycleCostFetchPlan {
  const reused: Record<string, number | null> = {};
  const toFetch: string[] = [];
  for (const c of cycles) {
    const cached = prev[c.cycleId];
    if (typeof cached === 'number' && COST_TERMINAL_CYCLE_STATUSES.has(c.status)) {
      reused[c.cycleId] = cached;
    } else {
      toFetch.push(c.cycleId);
    }
  }
  return { reused, toFetch };
}
