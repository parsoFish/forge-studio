/**
 * W7-B7 (flows-14) — the PhaseDrawer's header meta row, as pure data.
 *
 * The defect: in WI mode the drawer read `run.phaseMeta[nodeId]` — nodeId is
 * `dev` for EVERY WI hex — so all four work items reported the dev PHASE
 * total ("COST $3.21" on each) while the hexes themselves carried the true
 * per-WI figures (data-wi-cost-usd 0.63/0.42/1.14/1.02). MODEL and RETRIES
 * were likewise phase-level facts silently attributed to one WI.
 *
 * Rule: a WI drawer shows the WI's OWN cost (run.workItems[].costUsd — the
 * same value its hex renders) and OMITS model/retries rather than claiming
 * the pooled phase values for one work item. A phase drawer is unchanged.
 */

export type DrawerHeaderMeta = {
  /** Model chip value, or null to omit the chip. */
  model: string | null;
  /** Rendered cost text (e.g. "$0.63"), or "—" when unknown. */
  cost: string;
  /** Rendered retries text, or null to omit the row. */
  retries: string | null;
};

export function drawerHeaderMeta(input: {
  isWi: boolean;
  /** The clicked WI's own cost (run.workItems[].costUsd), when in WI mode. */
  wiCostUsd?: number;
  /** The node-level meta (run.phaseMeta[nodeId]), when present. */
  phaseMeta: { costUsd: number; retries: number; model?: string } | null;
}): DrawerHeaderMeta {
  if (input.isWi) {
    return {
      model: null,
      cost: typeof input.wiCostUsd === 'number' ? `$${input.wiCostUsd.toFixed(2)}` : '—',
      retries: null,
    };
  }
  return {
    model: input.phaseMeta?.model ?? null,
    cost: input.phaseMeta ? `$${input.phaseMeta.costUsd.toFixed(2)}` : '—',
    retries: input.phaseMeta ? String(input.phaseMeta.retries) : '0',
  };
}
