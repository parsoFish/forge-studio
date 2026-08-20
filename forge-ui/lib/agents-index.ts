/**
 * Agents index route (`/agents`) — the "recent agent runs" section's data
 * source.
 *
 * ⚑ W7-B5 (agents-03 / agents-04 / agents-39) REPLACES the client-side
 * fan-out join: this module used to fire one `GET /api/agents/:slug/history`
 * per roster agent (13 requests / 1.33 MB to render 20 rows), then dedupe
 * by `row.id` — publishing whichever agent's copy of a shared run happened
 * to flatten first ($0.00 "complete" for a run that really cost $4.79 and
 * failed), with no agent name anywhere. The server-side aggregate
 * `GET /api/agents/runs/recent` (cli/ui-bridge.ts) now does the join ONCE:
 * one bounded request; each row carries the RUN-level status/cost plus the
 * participating agent slug(s), which this module maps onto the shared
 * `LedgerRow` shape (`agent` = the new optional attribution field
 * `HistoryLedger` renders as a chip).
 *
 * Home (`app/page.tsx`) and `/agents` both call
 * `fetchRecentAgentRunsWithMeta` — its signature and `{rows, unresolved,
 * total}` result shape are UNCHANGED so neither page file moves; only the
 * transport underneath did. On a failed aggregate read, `unresolved ===
 * total` (an honest "nothing could be read", never an empty ledger passing
 * as a fleet that has never run — the A1-09 rule, preserved).
 */
import { sortLedgerRowsNewestFirst, type LedgerRow } from './history-ledger';
import { fetchRecentAgentRunsAggregate, type Agent } from './studio-client';

/**
 * Default cap on the "recent agent runs" section — a single named constant
 * rather than a literal repeated at every call site (global rule: no
 * hardcoded values scattered across call sites). Mirrors the server route's
 * own default.
 */
export const RECENT_AGENT_RUNS_LIMIT = 20;

/** The expanded bound behind the section's "show more" affordance
 *  (agents-40) — the server route's own hard cap. */
export const RECENT_AGENT_RUNS_EXPANDED_LIMIT = 100;

/**
 * Pure merge: flattens row lists, DEDUPES by `row.id` (first-seen after a
 * stable newest-first sort wins), and bounds to `limit`. W7-B5 note: the
 * /agents section no longer calls this (the SERVER aggregate does the join
 * now), but `home-view.ts`'s `buildHomeLedgerRows` still reuses it UNCHANGED
 * as a generic flatten+sort+dedupe+bound merge (its documented D2 seam) —
 * the dedupe stays REQUIRED there because `HistoryLedger` keys rows on
 * `row.id`.
 */
export function mergeRecentAgentRuns(
  perAgentRows: LedgerRow[][],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
): LedgerRow[] {
  const merged = perAgentRows.flat();
  const sorted = sortLedgerRowsNewestFirst(merged);
  const seenIds = new Set<string>();
  const deduped: LedgerRow[] = [];
  for (const row of sorted) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    deduped.push(row);
  }
  return deduped.slice(0, Math.max(0, limit));
}

/** Map one aggregate wire row onto the shared `LedgerRow` shape. A 'flow'
 *  row keeps `linkKind` ABSENT (the flow-ledger convention: an absent
 *  linkKind means "a flow-run row" — `ledgerRowKind` buckets it 'flow');
 *  a standalone row carries `linkKind: 'standalone'` exactly as the
 *  per-agent ledger does. `agent` is the attribution chip (agents-04). */
export function recentRunRowToLedgerRow(row: Awaited<ReturnType<typeof fetchRecentAgentRunsAggregate>>[number]): LedgerRow {
  return {
    id: row.id,
    when: row.when,
    what: row.what,
    // The aggregate is a cross-agent index — the narrative slot stays null
    // (nothing per-node to narrate at run level here); the failure reason,
    // when the run recorded one, is the one honest string worth carrying.
    narrative: row.errorText ?? null,
    narrativeKinds: [],
    status: row.status,
    costUsd: row.costUsd,
    href: row.href,
    ...(row.linkKind === 'standalone' ? { linkKind: 'standalone' as const } : {}),
    ...(row.agents.length > 0 ? { agent: row.agents.join(', ') } : {}),
  };
}

export type RecentAgentRunsResult = {
  rows: LedgerRow[];
  /** How many reads failed. Pre-B5 this counted per-agent history fetches;
   *  with ONE aggregate read it is `0` (read ok) or `total` (read failed —
   *  every agent's recent history is equally unreadable). */
  unresolved: number;
  /** Denominator for the honest notice (`agents.length`, or 1 when the
   *  roster itself is empty/unknown — the one aggregate read). */
  total: number;
};

export async function fetchRecentAgentRunsWithMeta(
  agents: Agent[],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
  kind: 'flow' | 'standalone' | 'all' = 'all',
): Promise<RecentAgentRunsResult> {
  const total = Math.max(1, agents.length);
  try {
    const rows = await fetchRecentAgentRunsAggregate(limit, kind);
    return { rows: rows.map(recentRunRowToLedgerRow), unresolved: 0, total };
  } catch {
    // Fail-closed honesty (A1-09): a failed aggregate read is "no agent's
    // history could be read", never an empty ledger.
    return { rows: [], unresolved: total, total };
  }
}

export async function fetchRecentAgentRuns(
  agents: Agent[],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
  kind: 'flow' | 'standalone' | 'all' = 'all',
): Promise<LedgerRow[]> {
  return (await fetchRecentAgentRunsWithMeta(agents, limit, kind)).rows;
}
