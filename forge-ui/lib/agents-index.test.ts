/**
 * Acceptance tests for `./agents-index.ts` — the `/agents` index route's
 * "recent agent runs" merge (T2 lane W6-IA-3), a pure module that does not
 * exist yet at test-authoring time. Every assertion below is a legitimate
 * RED against a not-yet-created file.
 *
 * `mergeRecentAgentRuns` is pure and tested directly (no mocking). `fetchRecentAgentRuns`
 * fans out to `./agent-ledger.ts`'s `fetchAgentHistory` per agent — mocked
 * here exactly like `./agent-ledger.test.ts` mocks `./bridge-client.ts`,
 * so this suite never touches a real network / bridge process.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import type { LedgerRow } from './history-ledger';
import type { Agent } from './studio-client';
import type { AgentHistoryResolution } from './agent-ledger';

// `vi.mock()` calls are hoisted above imports by vitest — the mock factory
// below must not reference outer-scope variables (mirrors ./agent-ledger.
// test.ts's own `vi.mock('./bridge-client.ts', ...)` precedent).
vi.mock('./agent-ledger.ts', () => ({
  fetchAgentHistory: vi.fn(),
}));

import { mergeRecentAgentRuns, fetchRecentAgentRuns, RECENT_AGENT_RUNS_LIMIT, AGENT_HISTORY_FAN_OUT_BATCH_SIZE } from './agents-index';
import { fetchAgentHistory } from './agent-ledger';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'RUN-a',
    when: '2026-01-01T00:00:00Z',
    what: 'Ship the ledger',
    narrative: null,
    narrativeKinds: [],
    status: 'complete',
    costUsd: 1.5,
    href: '/agents/architect/run/RUN-a',
    ...over,
  };
}

function agent(id: string): Agent {
  return { id, name: id, purpose: '', skills: [], tools: [], mcps: [], guards: [], hooks: [] };
}

// `fetchAgentHistory`'s call history (not its implementation) is reset
// before every test — several tests below assert exact call counts
// (`toHaveBeenCalledTimes`), which would otherwise accumulate across tests
// sharing this one module-level mock.
beforeEach(() => {
  vi.mocked(fetchAgentHistory).mockClear();
});

// ---------------------------------------------------------------------------
// mergeRecentAgentRuns — pure
// ---------------------------------------------------------------------------

test('mergeRecentAgentRuns: flattens every agent list into one merged array', () => {
  const merged = mergeRecentAgentRuns([
    [row({ id: 'a', when: '2026-01-01T00:00:00Z' })],
    [row({ id: 'b', when: '2026-01-02T00:00:00Z' })],
  ]);
  expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
});

test('mergeRecentAgentRuns: re-sorts newest-first ACROSS agents, not just within one agent\'s own list', () => {
  // KILLS a naive concat that trusts each per-agent list's own order without
  // re-sorting the merged whole — agent B's newest row here is chronologically
  // between agent A's two rows, so a per-agent-then-concat implementation
  // would misorder it.
  const merged = mergeRecentAgentRuns([
    [row({ id: 'a-newest', when: '2026-03-01T00:00:00Z' }), row({ id: 'a-oldest', when: '2026-01-01T00:00:00Z' })],
    [row({ id: 'b-mid', when: '2026-02-01T00:00:00Z' })],
  ]);
  expect(merged.map((r) => r.id)).toEqual(['a-newest', 'b-mid', 'a-oldest']);
});

test('mergeRecentAgentRuns: bounds the merged result to the given limit', () => {
  const perAgent = Array.from({ length: 5 }, (_, i) => [row({ id: `r${i}`, when: `2026-01-0${i + 1}T00:00:00Z` })]);
  const merged = mergeRecentAgentRuns(perAgent, 3);
  expect(merged).toHaveLength(3);
  // Newest three (r4, r3, r2 by date) survive the bound.
  expect(merged.map((r) => r.id)).toEqual(['r4', 'r3', 'r2']);
});

test('mergeRecentAgentRuns: defaults the limit to RECENT_AGENT_RUNS_LIMIT when not given', () => {
  const perAgent = [Array.from({ length: RECENT_AGENT_RUNS_LIMIT + 5 }, (_, i) => row({ id: `r${i}` }))];
  const merged = mergeRecentAgentRuns(perAgent);
  expect(merged).toHaveLength(RECENT_AGENT_RUNS_LIMIT);
});

test('mergeRecentAgentRuns: no agents / no rows at all -> an honest empty array, never a fabricated placeholder row', () => {
  expect(mergeRecentAgentRuns([])).toEqual([]);
  expect(mergeRecentAgentRuns([[], []])).toEqual([]);
});

// ---------------------------------------------------------------------------
// DEDUPE — HistoryLedger.tsx keys rendered rows on row.id (key={row.id});
// two agents whose per-agent histories both carry a row for the SAME run
// (a flow run with two nodes owned by two different agents) must merge to
// ONE row, not a React key collision.
// ---------------------------------------------------------------------------

test('mergeRecentAgentRuns: two agents whose histories share a run id (a flow run with two nodes owned by two different agents) merge to EXACTLY ONE row', () => {
  // KILLS a naive flatten+sort with no dedupe step — HistoryLedger.tsx
  // renders `key={row.id}` per row, so two surviving rows sharing an id is
  // a duplicate React key, not merely a cosmetic double-listing.
  const sharedId = 'RUN-shared-flow';
  const merged = mergeRecentAgentRuns([
    [row({ id: sharedId, when: '2026-01-01T00:00:00Z', href: '/flows/develop/run/RUN-shared-flow', what: 'owned by dev node' })],
    [row({ id: sharedId, when: '2026-01-01T00:00:00Z', href: '/flows/develop/run/RUN-shared-flow', what: 'owned by review node' })],
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].id).toBe(sharedId);
});

test('mergeRecentAgentRuns: a colliding id keeps the NEWEST occurrence (ties broken by stable-sort first-seen order), never silently dropping the whole run', () => {
  const sharedId = 'RUN-shared';
  const merged = mergeRecentAgentRuns([
    [row({ id: 'other', when: '2026-01-01T00:00:00Z' }), row({ id: sharedId, when: '2026-06-01T00:00:00Z', what: 'first-seen' })],
    [row({ id: sharedId, when: '2026-01-15T00:00:00Z', what: 'older-duplicate' })],
  ]);
  const survivor = merged.find((r) => r.id === sharedId);
  expect(survivor).toBeDefined();
  expect(survivor?.what).toBe('first-seen');
  expect(merged.filter((r) => r.id === sharedId)).toHaveLength(1);
});

test('mergeRecentAgentRuns: deduping never drops an UNRELATED id that happens to collide only by coincidence of test data — every other row still survives', () => {
  const merged = mergeRecentAgentRuns([
    [row({ id: 'shared', when: '2026-01-01T00:00:00Z' }), row({ id: 'unique-a', when: '2026-01-02T00:00:00Z' })],
    [row({ id: 'shared', when: '2026-01-01T00:00:00Z' }), row({ id: 'unique-b', when: '2026-01-03T00:00:00Z' })],
  ]);
  expect(merged.map((r) => r.id).sort()).toEqual(['shared', 'unique-a', 'unique-b']);
});

test("fetchRecentAgentRuns: two agents' histories sharing a run id merge to EXACTLY ONE row end to end", async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  const sharedId = 'RUN-cross-agent';
  mocked.mockImplementation(async (slug: string) => {
    if (slug === 'dev-node-owner') {
      return { kind: 'found', rows: [row({ id: sharedId, href: '/flows/develop/run/RUN-cross-agent#dev' })] };
    }
    return { kind: 'found', rows: [row({ id: sharedId, href: '/flows/develop/run/RUN-cross-agent#review' })] };
  });

  const rows = await fetchRecentAgentRuns([agent('dev-node-owner'), agent('review-node-owner')]);
  expect(rows.filter((r) => r.id === sharedId)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// fetchRecentAgentRuns — fans out to fetchAgentHistory per agent
// ---------------------------------------------------------------------------

test('fetchRecentAgentRuns: calls fetchAgentHistory once per agent in the roster, by id', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockResolvedValue({ kind: 'not-found' } as AgentHistoryResolution);

  await fetchRecentAgentRuns([agent('architect'), agent('developer-ralph')]);

  expect(mocked).toHaveBeenCalledTimes(2);
  expect(mocked).toHaveBeenCalledWith('architect');
  expect(mocked).toHaveBeenCalledWith('developer-ralph');
});

test('fetchRecentAgentRuns: merges "found" rows across agents, newest-first', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockImplementation(async (slug: string) => {
    if (slug === 'architect') {
      return { kind: 'found', rows: [row({ id: 'arch-1', when: '2026-01-01T00:00:00Z' })] };
    }
    return { kind: 'found', rows: [row({ id: 'dev-1', when: '2026-02-01T00:00:00Z' })] };
  });

  const rows = await fetchRecentAgentRuns([agent('architect'), agent('developer-ralph')]);
  expect(rows.map((r) => r.id)).toEqual(['dev-1', 'arch-1']);
});

test("fetchRecentAgentRuns: a per-agent 'not-found' or 'unresolved' resolution contributes NOTHING to the merge — one agent's bad fetch never blanks or crashes the whole section", async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockImplementation(async (slug: string) => {
    if (slug === 'ok-agent') return { kind: 'found', rows: [row({ id: 'ok-1' })] };
    if (slug === 'never-run') return { kind: 'not-found' };
    return { kind: 'unresolved' };
  });

  const rows = await fetchRecentAgentRuns([agent('ok-agent'), agent('never-run'), agent('flaky-agent')]);
  expect(rows.map((r) => r.id)).toEqual(['ok-1']);
});

test('fetchRecentAgentRuns: an empty agent roster resolves to an empty array without calling fetchAgentHistory at all', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockClear();

  const rows = await fetchRecentAgentRuns([]);
  expect(rows).toEqual([]);
  expect(mocked).not.toHaveBeenCalled();
});

test('fetchRecentAgentRuns: honours a custom limit, passed straight through to the merge', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockResolvedValue({
    kind: 'found',
    rows: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })],
  } as AgentHistoryResolution);

  const rows = await fetchRecentAgentRuns([agent('solo')], 2);
  expect(rows).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// BOUNDED CONCURRENCY — a large roster must not fan out one simultaneous
// bridge request per agent.
// ---------------------------------------------------------------------------

test('fetchRecentAgentRuns: never has more than AGENT_HISTORY_FAN_OUT_BATCH_SIZE fetchAgentHistory calls in flight at once', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  let inFlight = 0;
  let maxInFlight = 0;
  mocked.mockImplementation(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield a couple of microtask turns so overlapping calls actually overlap
    // (a synchronous resolve would never let concurrent calls coexist, which
    // would make this assertion vacuously true regardless of batching).
    await Promise.resolve();
    await Promise.resolve();
    inFlight--;
    return { kind: 'not-found' } as AgentHistoryResolution;
  });

  const roster = Array.from({ length: AGENT_HISTORY_FAN_OUT_BATCH_SIZE * 3 + 2 }, (_, i) => agent(`agent-${i}`));
  await fetchRecentAgentRuns(roster);

  expect(maxInFlight).toBeLessThanOrEqual(AGENT_HISTORY_FAN_OUT_BATCH_SIZE);
  // KILLS a fully-serial (batch size 1) implementation masquerading as
  // "bounded concurrency" — a real batch actually overlaps calls.
  expect(maxInFlight).toBeGreaterThan(1);
});

test('fetchRecentAgentRuns: a roster smaller than one batch still resolves correctly (no off-by-one on the chunk boundary)', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockResolvedValue({ kind: 'found', rows: [row({ id: 'x' })] } as AgentHistoryResolution);

  const roster = Array.from({ length: AGENT_HISTORY_FAN_OUT_BATCH_SIZE - 1 }, (_, i) => agent(`agent-${i}`));
  const rows = await fetchRecentAgentRuns(roster);

  expect(mocked).toHaveBeenCalledTimes(AGENT_HISTORY_FAN_OUT_BATCH_SIZE - 1);
  expect(rows).toHaveLength(1); // every agent reports the same run id 'x' — deduped to one
});

test('fetchRecentAgentRuns: a roster that is an exact multiple of the batch size still calls every agent exactly once', async () => {
  const mocked = vi.mocked(fetchAgentHistory);
  mocked.mockResolvedValue({ kind: 'not-found' } as AgentHistoryResolution);

  const roster = Array.from({ length: AGENT_HISTORY_FAN_OUT_BATCH_SIZE * 2 }, (_, i) => agent(`agent-${i}`));
  await fetchRecentAgentRuns(roster);

  expect(mocked).toHaveBeenCalledTimes(AGENT_HISTORY_FAN_OUT_BATCH_SIZE * 2);
});
