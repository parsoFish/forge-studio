/**
 * Agents index route (`/agents`, T2 lane W6-IA-3) — the "recent agent
 * runs" section's data source.
 *
 * No aggregate "all agents' runs" bridge route exists (only the per-agent
 * `GET /api/agents/:slug/history`, R6-06 WI-1, `cli/ui-bridge.ts:1647`).
 * Adding one is out of scope for this lane (ground truth: "do NOT add
 * bridge/server endpoints in this lane") — see this lane's report for why a
 * dedicated aggregate route would be the better long-term home for this
 * join (the `mergeRecentAgentRuns` header below explains exactly what a
 * server-side join could still do that this client-side one cannot).
 *
 * Instead, this module fetches each agent's OWN already-resolved history
 * via the EXISTING `fetchAgentHistory` (`./agent-ledger.ts`) — which itself
 * already reuses `deriveAgentLedgerRows` (D2, no re-derivation here) — in
 * bounded-concurrency batches, then merges the "found" rows across every
 * agent, DEDUPES by `row.id` (see `mergeRecentAgentRuns`'s header — a
 * REQUIRED step, not an optimisation), re-sorts the WHOLE merged set
 * newest-first (`sortLedgerRowsNewestFirst`, reused unchanged, D2 — a
 * per-agent list is only sorted within itself), and bounds the result to
 * `limit` rows so the section stays skimmable regardless of how many
 * agents/history rows exist.
 *
 * `not-found`/`unresolved` per-agent resolutions contribute nothing to the
 * merge (honest omission, never a fabricated row) — a transient failure
 * fetching ONE agent's history must not blank the whole section, and an
 * agent that has simply never run must not render a phantom entry. The
 * `unresolved` COUNT is surfaced beside the rows (`fetchRecentAgentRunsWithMeta`,
 * W7-FIX-A1 A1-09) so a section whose reads all failed is never mistaken for
 * a fleet that has never run.
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
 * How many agents' `GET /api/agents/:slug/history` requests
 * `fetchRecentAgentRuns` fires at once. Plain chunking, no new dependency —
 * a roster of dozens of agents must not fan out one simultaneous bridge
 * request per agent (a 50-agent roster would otherwise fire 50 at once).
 */
export const AGENT_HISTORY_FAN_OUT_BATCH_SIZE = 6;

/**
 * Pure merge: flattens every agent's own resolved rows, DEDUPES by
 * `row.id`, re-sorts newest-first across the WHOLE merged set, and bounds
 * to `limit`.
 *
 * DEDUPE IS REQUIRED, NOT COSMETIC: `HistoryLedger.tsx` (the shared
 * component this section reuses unchanged, D2) keys each rendered row on
 * `row.id` (`key={row.id}`) — that is an IMPLICIT contract every consumer
 * of `HistoryLedger` must uphold, not merely a React-internals detail.
 * A single flow run with two nodes owned by two DIFFERENT agents (e.g.
 * `dev` owned by developer-ralph, `adversarial-review` owned by its own
 * agent) resolves to TWO rows sharing the SAME `row.id` (the run's own id,
 * different `row.href`/node) once both agents' histories are merged here —
 * without a dedupe step, that is a duplicate React key, not just a
 * cosmetic double-listing. The fix lives HERE, before the merged rows ever
 * reach `HistoryLedger`: dedupe-before-render is the only place this
 * client-side join CAN enforce it, since `HistoryLedger` itself must stay
 * unchanged (D2) and has no way to know a row came from two different
 * per-agent fetches.
 *
 * Semantic: one run is one ledger row — the per-agent attribution some
 * duplicates might have carried is still visible via the surviving row's
 * own content (`what`/`href`), so nothing is lost, only the duplicate
 * listing. Rows are sorted newest-first BEFORE deduping, and the FIRST
 * occurrence of each id survives (stable sort preserves each duplicate's
 * original per-agent insertion order for genuine same-`when` ties) — so
 * "keep the newest" and "keep the first-seen" agree by construction.
 *
 * KNOWN LIMITATION (a client-side join, not this lane's to fix): which
 * SPECIFIC node's `href` survives for a deduped id is whichever agent's
 * fetch happened to flatten first — arbitrary from the caller's
 * perspective, not derived from "the more important node". A server-side
 * aggregate route could dedupe by (run, node) with real knowledge of the
 * flow topology instead of this incidental ordering; this client-side
 * merge cannot.
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

/**
 * Fetch + merge every agent's history, in bounded-concurrency batches of
 * `AGENT_HISTORY_FAN_OUT_BATCH_SIZE` (plain chunking — no new dependency).
 * `agents` is the already-loaded roster (the page's own roster fetch,
 * `fetchStudioAgents` — the SAME fetch `/library` already makes) — no
 * separate roster fetch lives here (D2, single source). A per-agent
 * `'not-found'`/`'unresolved'` resolution contributes an empty array — see
 * the module header.
 */
export async function fetchRecentAgentRuns(
  agents: Agent[],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
): Promise<LedgerRow[]> {
  return (await fetchRecentAgentRunsWithMeta(agents, limit)).rows;
}

/**
 * W7-FIX-A1 (A1-09): the merged rows PLUS how many per-agent history reads
 * came back `'unresolved'` (a failed/unreachable read — neither "ran" nor
 * "never ran"). Before this, that count was parsed and DISCARDED: a total
 * outage rendered the same empty ledger as a fleet that has never run. The
 * section renders an honest "N of M histories could not be read" notice off
 * `unresolved` (components/studio/UnresolvedHistoriesNotice.tsx) — the rows
 * are still whatever WAS read, never fabricated.
 */
export type RecentAgentRunsResult = {
  rows: LedgerRow[];
  /** Per-agent reads that resolved `'unresolved'` (failed / unreachable). */
  unresolved: number;
  /** Agents fanned out to (`agents.length`). */
  total: number;
};

export async function fetchRecentAgentRunsWithMeta(
  agents: Agent[],
  limit: number = RECENT_AGENT_RUNS_LIMIT,
): Promise<RecentAgentRunsResult> {
  const resolutions: Awaited<ReturnType<typeof fetchAgentHistory>>[] = [];
  for (let i = 0; i < agents.length; i += AGENT_HISTORY_FAN_OUT_BATCH_SIZE) {
    const batch = agents.slice(i, i + AGENT_HISTORY_FAN_OUT_BATCH_SIZE);
    const batchResolutions = await Promise.all(batch.map((a) => fetchAgentHistory(a.id)));
    resolutions.push(...batchResolutions);
  }
  const perAgentRows = resolutions.map((r) => (r.kind === 'found' ? r.rows : []));
  const unresolved = resolutions.filter((r) => r.kind === 'unresolved').length;
  return { rows: mergeRecentAgentRuns(perAgentRows, limit), unresolved, total: agents.length };
}
