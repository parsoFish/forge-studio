/**
 * Acceptance tests for `./agents-index.ts` — ⚑ REWRITTEN by W7-B5
 * (agents-03 / agents-04 / agents-39): the module no longer fans one
 * `GET /api/agents/:slug/history` out per roster agent and client-side-
 * dedupes (the join that published an arbitrary node's $0.00 "complete" for
 * a $4.79 failed run, with no agent name). It now makes ONE call to the
 * server-side aggregate (`fetchRecentAgentRunsAggregate`, studio-client →
 * `GET /api/agents/runs/recent`) and maps its rows onto the shared
 * `LedgerRow` shape. These tests pin:
 *   - exactly ONE aggregate call regardless of roster size (agents-39);
 *   - run-level status/cost carried verbatim (agents-03);
 *   - the `agent` attribution field populated from `agents[]` (agents-04);
 *   - 'flow' rows keep `linkKind` ABSENT (flow-ledger convention) while
 *     'standalone' rows carry it;
 *   - a failed aggregate read → `unresolved === total`, rows `[]` — never
 *     an empty ledger passing as "never ran" (A1-09 preserved).
 */
import { test, expect, vi, beforeEach } from 'vitest';
import type { Agent, RecentAgentRunWireRow } from './studio-client';
import type { LedgerRow } from './history-ledger';

// `vi.mock()` calls are hoisted above imports by vitest — the mock factory
// below must not reference outer-scope variables.
vi.mock('./studio-client', () => ({
  fetchRecentAgentRunsAggregate: vi.fn(),
}));

import {
  fetchRecentAgentRuns,
  fetchRecentAgentRunsWithMeta,
  recentRunRowToLedgerRow,
  RECENT_AGENT_RUNS_LIMIT,
  RECENT_AGENT_RUNS_EXPANDED_LIMIT,
  mergeRecentAgentRuns,
} from './agents-index';
import { fetchRecentAgentRunsAggregate } from './studio-client';

function wireRow(over: Partial<RecentAgentRunWireRow> = {}): RecentAgentRunWireRow {
  return {
    id: '2026-08-01T00-00-00_INIT-x',
    when: '2026-08-01T00:00:00.000Z',
    what: 'Ship the ledger',
    agents: ['architect', 'project-manager'],
    status: 'failed',
    costUsd: 4.79,
    href: '/flows/forge-develop/run/2026-08-01T00-00-00_INIT-x',
    linkKind: 'flow',
    ...over,
  };
}

function agent(id: string): Agent {
  return { id, name: id, purpose: '', skills: [], tools: [], mcps: [], guards: [], hooks: [] } as unknown as Agent;
}

beforeEach(() => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockReset();
});

// ---------------------------------------------------------------------------
// recentRunRowToLedgerRow — pure mapping
// ---------------------------------------------------------------------------

test('a flow row carries RUN-level status/cost verbatim, the agent attribution, and NO linkKind (agents-03/04)', () => {
  const row = recentRunRowToLedgerRow(wireRow());
  expect(row.status).toBe('failed');
  expect(row.costUsd).toBe(4.79);
  expect(row.agent).toBe('architect, project-manager');
  expect(row.linkKind).toBeUndefined();
  expect(row.href).toBe('/flows/forge-develop/run/2026-08-01T00-00-00_INIT-x');
});

test('a standalone row keeps linkKind "standalone", its own slug attribution, and surfaces errorText as the narrative', () => {
  const row = recentRunRowToLedgerRow(wireRow({
    id: '_agent-contract-check-2026-08-02T00-00-00-000-abcd',
    agents: ['contract-check'],
    status: 'failed',
    costUsd: null,
    href: '/agents/contract-check/run/_agent-contract-check-2026-08-02T00-00-00-000-abcd',
    linkKind: 'standalone',
    errorText: 'spawn ENOENT',
  }));
  expect(row.linkKind).toBe('standalone');
  expect(row.agent).toBe('contract-check');
  expect(row.costUsd).toBeNull();
  expect(row.narrative).toBe('spawn ENOENT');
});

test('a row with no attributable agents omits the agent field entirely (never an empty-string chip)', () => {
  const row = recentRunRowToLedgerRow(wireRow({ agents: [] }));
  expect(row.agent).toBeUndefined();
});

// ---------------------------------------------------------------------------
// fetchRecentAgentRunsWithMeta — one aggregate call
// ---------------------------------------------------------------------------

test('makes exactly ONE aggregate request regardless of roster size (agents-39 — no per-agent fan-out)', async () => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockResolvedValue([wireRow()]);
  const agents = Array.from({ length: 13 }, (_, i) => agent(`a${i}`));
  const { rows, unresolved, total } = await fetchRecentAgentRunsWithMeta(agents);
  expect(fetchRecentAgentRunsAggregate).toHaveBeenCalledTimes(1);
  expect(fetchRecentAgentRunsAggregate).toHaveBeenCalledWith(RECENT_AGENT_RUNS_LIMIT, 'all');
  expect(rows).toHaveLength(1);
  expect(unresolved).toBe(0);
  expect(total).toBe(13);
});

test('threads a caller limit through to the aggregate (the show-more affordance, agents-40)', async () => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockResolvedValue([]);
  await fetchRecentAgentRunsWithMeta([agent('a')], RECENT_AGENT_RUNS_EXPANDED_LIMIT);
  expect(fetchRecentAgentRunsAggregate).toHaveBeenCalledWith(RECENT_AGENT_RUNS_EXPANDED_LIMIT, 'all');
});

test('a FAILED aggregate read → rows [] with unresolved === total — never an empty ledger passing as "never ran" (A1-09)', async () => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockRejectedValue(new Error('bridge unreachable'));
  const { rows, unresolved, total } = await fetchRecentAgentRunsWithMeta([agent('a'), agent('b'), agent('c')]);
  expect(rows).toEqual([]);
  expect(unresolved).toBe(3);
  expect(total).toBe(3);
});

test('an EMPTY roster still reports total 1 on a failed read (the one aggregate read is the denominator)', async () => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockRejectedValue(new Error('down'));
  const { unresolved, total } = await fetchRecentAgentRunsWithMeta([]);
  expect(unresolved).toBe(1);
  expect(total).toBe(1);
});

test('fetchRecentAgentRunsWithMeta threads a `kind` through to the aggregate — review round 1 (Home asks for the standalone half only, since it already renders its own flow rows and dedupes the aggregate\'s away)', async () => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockResolvedValue([]);
  await fetchRecentAgentRunsWithMeta([agent('a')], 7, 'standalone');
  expect(fetchRecentAgentRunsAggregate).toHaveBeenCalledWith(7, 'standalone');
});

test('fetchRecentAgentRuns (rows-only wrapper) resolves the mapped rows', async () => {
  vi.mocked(fetchRecentAgentRunsAggregate).mockResolvedValue([wireRow()]);
  const rows = await fetchRecentAgentRuns([agent('a')]);
  expect(rows).toHaveLength(1);
  expect(rows[0].agent).toBe('architect, project-manager');
});


// ---------------------------------------------------------------------------
// mergeRecentAgentRuns — STILL LIVE, restored coverage (review round 1)
// ---------------------------------------------------------------------------

/**
 * W7-B5 replaced this module's per-agent fan-out with one aggregate route,
 * and the fan-out's own unit pins went with it — but `mergeRecentAgentRuns`
 * did NOT: `lib/home-view.ts`'s `buildHomeLedgerRows` still calls it to fold
 * Home's flow rows together with the agent rows. Deleting the pins left a
 * live, load-bearing pure function with no direct coverage at all. These are
 * its four contracts, pinned against the function as it is used TODAY.
 */
function ledgerRow(id: string, when: string): LedgerRow {
  return {
    id,
    when,
    what: id,
    narrative: null,
    narrativeKinds: [],
    status: 'done',
    costUsd: null,
    href: `/x/${id}`,
  } as unknown as LedgerRow;
}

test('mergeRecentAgentRuns: flattens every source list into one ledger', () => {
  const merged = mergeRecentAgentRuns([
    [ledgerRow('a', '2026-01-01T00:00:00.000Z')],
    [ledgerRow('b', '2026-01-02T00:00:00.000Z')],
  ]);
  expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
});

test('mergeRecentAgentRuns: re-sorts the WHOLE merged set newest-first, not per source', () => {
  const merged = mergeRecentAgentRuns([
    [ledgerRow('older', '2026-01-01T00:00:00.000Z'), ledgerRow('newest', '2026-03-01T00:00:00.000Z')],
    [ledgerRow('middle', '2026-02-01T00:00:00.000Z')],
  ]);
  expect(merged.map((r) => r.id)).toEqual(['newest', 'middle', 'older']);
});

test('mergeRecentAgentRuns: dedupes by row.id, FIRST-seen wins — HistoryLedger renders key={row.id}, so a duplicate id is a React key collision, not merely a double listing', () => {
  const homeFlowRow = { ...ledgerRow('same-run', '2026-01-01T00:00:00.000Z'), what: 'home-owned' };
  const agentRow = { ...ledgerRow('same-run', '2026-01-01T00:00:00.000Z'), what: 'agent-owned' };
  // Home passes its own flow rows FIRST precisely so they win this dedupe.
  const merged = mergeRecentAgentRuns([[homeFlowRow], [agentRow]]);
  expect(merged).toHaveLength(1);
  expect(merged[0].what).toBe('home-owned');
});

test('mergeRecentAgentRuns: bounds the result to `limit`, and a non-positive limit yields an empty ledger rather than throwing', () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ledgerRow(`r${n}`, `2026-01-0${n}T00:00:00.000Z`));
  expect(mergeRecentAgentRuns([rows], 2)).toHaveLength(2);
  expect(mergeRecentAgentRuns([rows], 0)).toHaveLength(0);
  expect(mergeRecentAgentRuns([rows], -3)).toHaveLength(0);
});
