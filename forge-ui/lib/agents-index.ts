/**
 * Agents index route (`/agents`, T2 lane W6-IA-3) — the "recent agent
 * runs" section's data source.
 *
 * No aggregate "all agents' runs" bridge route exists (only the per-agent
 * `GET /api/agents/:slug/history`, R6-06 WI-1, `cli/ui-bridge.ts:1647`).
 * Adding one is out of scope for this lane (ground truth: "do NOT add
 * bridge/server endpoints in this lane") — see this lane's report for why a
 * dedicated aggregate route would be the better long-term home for this
 * join (the KNOWN LIMITATION note on `mergeRecentAgentRuns` below explains
 * exactly what a server-side join could do that this client-side one
 * cannot).
 *
 * Instead, this module fetches each agent's OWN already-resolved history
 * via the EXISTING `fetchAgentHistory` (`./agent-ledger.ts`) — which itself
 * already reuses `deriveAgentLedgerRows` (D2, no re-derivation here) — in
 * parallel, then merges the "found" rows across every agent, re-sorts the
 * WHOLE merged set newest-first (`sortLedgerRowsNewestFirst`, reused
 * unchanged, D2 — a per-agent list is only sorted within itself), and
 * bounds the result to `limit` rows so the section stays skimmable
 * regardless of how many agents/history rows exist.
 *
 * `not-found`/`unresolved` per-agent resolutions contribute nothing to the
 * merge (honest omission, never a fabricated row) — a transient failure
 * fetching ONE agent's history must not blank the whole section, and an
 * agent that has simply never run must not render a phantom entry.
 */
import { sortLedgerRowsNewestFirst, type LedgerRow } from './history-ledger';
import { fetchAgentHistory } from './agent-ledger';
import type { Agent } from './studio-client';

/**
 * Default cap on the merged "recent agent runs" section — a single named
 * constant rather than a literal repeated at every call site (global rule:
 * no hardcoded values scattered across call sites).
 */
export const RECENT_AGENT_RUNS_LIMIT = 20;

/**
 * Pure merge: flattens every agent's own resolved rows, re-sorts
 * newest-first across the WHOLE merged set, and bounds to `limit`.
 *
 * KNOWN LIMITATION (a client-side join, not this lane's to fix): a single
 * flow run with two nodes owned by two DIFFERENT agents (e.g. `dev` owned
 * by developer-ralph, `adversarial-review` owned by its own agent) appears
 * ONCE per owning agent here — same `row.id` (the run's own id), different
 * `row.href`/node. A server-side aggregate route could dedupe this cleanly
 * by (run, node) instead of by agent; this client-side merge cannot, since
 * each agent's history is resolved independently and in isolation from
 * every other agent's.
 */
export function mergeRecentAgentRuns(
  perAgentRows: LedgerRow[][],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
): LedgerRow[] {
  const merged = perAgentRows.flat();
  return sortLedgerRowsNewestFirst(merged).slice(0, Math.max(0, limit));
}

/**
 * Fetch + merge every agent's history in parallel. `agents` is the
 * already-loaded roster (the page's own roster fetch, `fetchStudioAgents`
 * — the SAME fetch `/library` already makes) — no separate roster fetch
 * lives here (D2, single source). A per-agent `'not-found'`/`'unresolved'`
 * resolution contributes an empty array — see the module header.
 */
export async function fetchRecentAgentRuns(
  agents: Agent[],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
): Promise<LedgerRow[]> {
  const resolutions = await Promise.all(agents.map((a) => fetchAgentHistory(a.id)));
  const perAgentRows = resolutions.map((r) => (r.kind === 'found' ? r.rows : []));
  return mergeRecentAgentRuns(perAgentRows, limit);
}
