/**
 * Acceptance tests for the ONE aggregate derivation behind `/monitor` and
 * Home's summary strip (W8-B1).
 *
 * The defect these pin shut: Home rendered "Active status — 0 live" directly
 * above its own recent-activity ledger listing ten in-flight rows, because
 * the headline came from the constellation hexes and the list came from the
 * merged ledger. Two derivations of "what is running", nothing re-checking
 * one against the other.
 *
 * Each test names the wrong implementation it kills.
 *
 * RUN: npx vitest run lib/monitor-view.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import {
  buildMonitorSummary,
  buildMonitorSummaryTiles,
  isSessionLive,
  MONITOR_LIVE_ROW_STATUSES,
  MONITOR_FAILED_ROW_STATUSES,
} from './monitor-view';
import { buildConstellation } from './home-view';
import type { LedgerRow } from './history-ledger';
import type { Run, SessionIndexRow } from './studio-client';

function row(over: Partial<LedgerRow> & { id: string; status: string }): LedgerRow {
  return {
    when: '2026-08-24T00:00:00.000Z',
    what: 'a run',
    narrative: null,
    narrativeKinds: [],
    costUsd: null,
    href: '/flows/f/run/r',
    ...over,
  } as LedgerRow;
}

function session(over: Partial<SessionIndexRow> & { sessionId: string }): SessionIndexRow {
  return {
    kind: 'architect',
    project: 'demo',
    phase: 'drafting',
    terminal: false,
    needsYou: false,
    state: 'working',
    error: null,
    idleMs: null,
    modelTier: null,
    updatedAt: '2026-08-24T00:00:00.000Z',
    href: '/sessions/architect/s1',
    ...over,
  } as SessionIndexRow;
}

function run(over: Partial<Run> & { id: string; status: Run['status'] }): Run {
  return { flowId: 'forge-develop', startedAt: '2026-08-24T00:00:00.000Z', phases: {}, phaseMeta: {}, ...over } as Run;
}

// ── the headline is derived FROM the rows it summarises ──

test('live is counted from the SAME ledger rows the surface renders, not from the constellation', () => {
  // Kills the shipped defect verbatim: ten running rows, an EMPTY object
  // roster (so every hex-based derivation yields zero), and a summary that
  // still has to say ten. A `live` sourced from buildConstellation cannot
  // pass this.
  const rows = Array.from({ length: 10 }, (_, i) => row({ id: `r${i}`, status: 'running' }));
  const hexes = buildConstellation({ flows: [], agents: [], projects: [], kbs: [], runs: [], attention: [], sessions: [] });
  expect(hexes.filter((h) => h.status === 'active').length).toBe(0); // the OLD source of the number

  const summary = buildMonitorSummary({ ledgerRows: rows, runs: [], sessions: [], attentionCount: 0 });
  expect(summary.live).toBe(10);
  expect(summary.runsLive).toBe(10);
  expect(summary.total).toBe(10);
});

test('every live-status token in the closed set counts, and nothing else does', () => {
  // Kills a hardcoded `status === 'active'` check that silently drops the
  // 'running' vocabulary the standalone-agent rows actually use (and the
  // 'retrying' a mid-retry flow phase carries).
  // W8-F4 review round 2: `linkKind: 'standalone'` is on this list on purpose.
  // It is the literal value `collectRecentAgentRuns` (apps/forge/ui-bridge.ts) stamps
  // on EVERY real standalone agent run — the only agent-sourced linkKind that
  // actually reaches Home's and Monitor's ledger (`use-everything-ledger.ts`
  // asks for `kind: 'standalone'`) — and no fixture in this file used it, so
  // rewriting the session filter's PREDICATE (`linkKind !== 'session'` ->
  // `linkKind === undefined`) silently dropped every standalone run from the
  // run counts and left all 12 tests green. Deleting the guard was pinned;
  // inverting it was not.
  const rows = [
    row({ id: 'a', status: 'active' }),
    row({ id: 'b', status: 'running', linkKind: 'standalone' }),
    row({ id: 'c', status: 'retrying' }),
    row({ id: 'd', status: 'complete' }),
    row({ id: 'e', status: 'planned' }),
    row({ id: 'f', status: 'some-future-token' }),
  ];
  const summary = buildMonitorSummary({ ledgerRows: rows, runs: [], sessions: [], attentionCount: 0 });
  expect(summary.runsLive).toBe(3);
  expect([...MONITOR_LIVE_ROW_STATUSES].sort()).toEqual(['active', 'retrying', 'running']);
});

test('an unknown status token is counted as neither live nor failed', () => {
  // Kills a "not complete means running" or "not running means failed"
  // shortcut. LedgerRowStatus is deliberately open; guessing is the defect.
  const summary = buildMonitorSummary({
    ledgerRows: [row({ id: 'x', status: 'a-runner-phase-nobody-has-mapped' })],
    runs: [], sessions: [], attentionCount: 0,
  });
  expect(summary.runsLive).toBe(0);
  expect(summary.failed).toBe(0);
  expect(summary.total).toBe(1);
});

test('a budget-stopped run counts as failed, not as quietly finished', () => {
  // Kills `status === 'failed'` alone: a ceiling stop did not do the work.
  const summary = buildMonitorSummary({
    ledgerRows: [row({ id: 'x', status: 'budget-exceeded' }), row({ id: 'y', status: 'failed' })],
    runs: [], sessions: [], attentionCount: 0,
  });
  expect(summary.failed).toBe(2);
  expect([...MONITOR_FAILED_ROW_STATUSES].sort()).toEqual(['budget-exceeded', 'failed']);
});

// ── sessions are counted from the session index, never from ledger rows ──

test('session rows in the ledger are NOT counted as runs (no double count, no phase mis-read)', () => {
  // W8-F4: this test previously used a session row with phase 'drafting' —
  // the ONE status value at which the guarded and unguarded derivations
  // agree, so DELETING the `linkKind !== 'session'` filter left it green.
  // The C4 refuter measured it: `m_no_session_filter` -> 15/15 passed. A gate
  // that cannot fail is not a gate.
  //
  // The fixture now uses the phase a REAL in-flight session carries: the
  // onboarding kind's in-flight phase is literally `running`
  // (studio/session-kinds.yaml), carried verbatim onto `LedgerRow.status` by
  // agent-ledger.ts's `deriveSessionRow`. 'running' IS in
  // MONITOR_LIVE_ROW_STATUSES, so guarded and unguarded now diverge (1 vs 2
  // runsLive, 2 vs 3 live) and removing the filter turns this RED.
  const rows = [
    row({ id: 's1', status: 'running', linkKind: 'session' }),
    row({ id: 'r1', status: 'running' }),
    // review round 2: the third kind the surface really carries. The filter
    // must EXCLUDE 'session' specifically, not "keep only flow rows" — a
    // standalone agent run is a run and must be counted as one.
    row({ id: 'a1', status: 'running', linkKind: 'standalone' }),
  ];
  const summary = buildMonitorSummary({
    ledgerRows: rows,
    runs: [],
    sessions: [session({ sessionId: 's1', phase: 'running' })],
    attentionCount: 0,
  });
  expect(summary.runsLive).toBe(2);   // the flow run + the standalone run — NOT the session row
  expect(summary.sessionsLive).toBe(1);
  expect(summary.live).toBe(3);       // 4 without the guard: the session counted twice
  expect(summary.total).toBe(3);      // all three rows are still ON the surface
});

test('a session row that failed is not counted in the FAILED headline either', () => {
  // Same guard, the other headline. `m_failed_all_rows` (failed computed over
  // input.ledgerRows instead of runRows) survived the shipped suite because no
  // fixture ever carried a session row with a failed-vocabulary status —
  // yet `failed` is a REAL terminal phase of the onboarding session kind, so
  // the shape is not hypothetical.
  const rows = [
    row({ id: 's1', status: 'failed', linkKind: 'session' }),
    row({ id: 'r1', status: 'failed' }),
    row({ id: 'r2', status: 'budget-exceeded', linkKind: 'standalone' }),
  ];
  const summary = buildMonitorSummary({
    ledgerRows: rows,
    runs: [],
    sessions: [session({ sessionId: 's1', phase: 'failed', terminal: true })],
    attentionCount: 0,
  });
  expect(summary.failed).toBe(2);   // 3 without the guard
  expect(summary.total).toBe(3);
});

test('session liveness uses the bridge\'s own terminal verdict, never a re-derived one', () => {
  // Kills a client-side "phase looks finished to me" guess.
  expect(isSessionLive(session({ sessionId: 'a', terminal: false, phase: 'committed' }))).toBe(true);
  expect(isSessionLive(session({ sessionId: 'b', terminal: true, phase: 'drafting' }))).toBe(false);
  const summary = buildMonitorSummary({
    ledgerRows: [],
    runs: [],
    sessions: [session({ sessionId: 'a', terminal: false }), session({ sessionId: 'b', terminal: true })],
    attentionCount: 0,
  });
  expect(summary.sessionsLive).toBe(1);
});

// ── the three "waiting on a human" queues stay separately readable ──

test('needsYou sums the three real queues and each part stays readable', () => {
  // Kills a single opaque number a surface would have to re-derive to break
  // back out — and kills counting gated runs twice (once as gated, once as
  // attention).
  const summary = buildMonitorSummary({
    ledgerRows: [],
    runs: [run({ id: 'g1', status: 'gated' }), run({ id: 'g2', status: 'gated' }), run({ id: 'p1', status: 'planned' })],
    sessions: [session({ sessionId: 's1', needsYou: true }), session({ sessionId: 's2', needsYou: false })],
    attentionCount: 3,
  });
  expect(summary.gatedRuns).toBe(2);
  expect(summary.sessionsNeedingYou).toBe(1);
  expect(summary.attention).toBe(3);
  expect(summary.needsYou).toBe(6);
  expect(summary.queued).toBe(1);
});

test('a negative or fractional attention count cannot poison the headline', () => {
  // Kills trusting a caller-supplied number verbatim into a rendered count.
  const summary = buildMonitorSummary({ ledgerRows: [], runs: [], sessions: [], attentionCount: -4 });
  expect(summary.attention).toBe(0);
  expect(summary.needsYou).toBe(0);
  const fractional = buildMonitorSummary({ ledgerRows: [], runs: [], sessions: [], attentionCount: 2.7 });
  expect(fractional.attention).toBe(2);
});

// ── the strip is a projection of the summary, never a second count ──

test('the Home strip tiles are a projection of the summary, tile-for-count', () => {
  // Kills a strip that recomputes its own numbers from a different input.
  const summary = buildMonitorSummary({
    ledgerRows: [row({ id: 'a', status: 'running' }), row({ id: 'b', status: 'failed' })],
    runs: [run({ id: 'p', status: 'planned' })],
    sessions: [session({ sessionId: 's', needsYou: true })],
    attentionCount: 1,
  });
  const tiles = buildMonitorSummaryTiles(summary);
  expect(tiles.map((t) => t.id)).toEqual(['live', 'needs-you', 'failed', 'queued']);
  expect(tiles.map((t) => t.count)).toEqual([summary.live, summary.needsYou, summary.failed, summary.queued]);
  for (const tile of tiles) expect(tile.href).toBe('/monitor');
});

test('every tile renders at zero — an absent row is indistinguishable from a broken strip', () => {
  const tiles = buildMonitorSummaryTiles(buildMonitorSummary({ ledgerRows: [], runs: [], sessions: [], attentionCount: 0 }));
  expect(tiles).toHaveLength(4);
  expect(tiles.every((t) => t.count === 0)).toBe(true);
});

// ── the identity that makes the contradiction inexpressible ──

test('summary.total always equals the row count the surface renders', () => {
  // Kills a summary computed over a DIFFERENT (capped, filtered, stale) list
  // than the one on screen — the shape the original defect took.
  //
  // W8-F4: the fixture now INCLUDES a session row. Without one, `total:
  // input.ledgerRows.length` and `total: runRows.length` are the same
  // expression, and the C4 verifier's mutant m4 (`total <- runRows.length`)
  // passed the whole suite. `total` is the denominator the surface renders
  // (`data-monitor-total`, and the journey's MONITOR.3 total-vs-ledger
  // identity), so it must count EVERY row on screen, session rows included —
  // the run-vocabulary filter applies to `runsLive`/`failed`, never to the
  // denominator.
  const rows = [
    ...Array.from({ length: 37 }, (_, i) => row({ id: `r${i}`, status: i % 3 === 0 ? 'running' : 'complete' })),
    row({ id: 's1', status: 'running', linkKind: 'session' }),
    row({ id: 'a1', status: 'running', linkKind: 'standalone' }),
  ];
  const summary = buildMonitorSummary({ ledgerRows: rows, runs: [], sessions: [], attentionCount: 0 });
  expect(summary.total).toBe(rows.length);          // 39 — the denominator is every row on screen
  expect(summary.runsLive).toBe(rows.filter((r) => r.status === 'running' && r.linkKind !== 'session').length);
});

/**
 * EXPIRY CONDITION for the three assertions above (immutable-gates: a pin
 * whose input is not reachable today must say so).
 *
 * `useEverythingLedger` — the ONLY producer of the row list Home and Monitor
 * hand to `buildMonitorSummary` — merges flow rows with
 * `fetchRecentAgentRunsWithMeta(agents, undefined, 'standalone')`, so a
 * `linkKind: 'session'` row does not reach this derivation from those two
 * surfaces today. It IS produced elsewhere in the codebase (`agent-ledger.ts`
 * `deriveSessionRow`, behind `GET /api/agents/:slug/history`, which
 * `/agents/[id]` renders), and `buildMonitorSummary`'s input type is the
 * shared `LedgerRow[]`, so the filter at monitor-view.ts is the contract that
 * makes merging that list in SAFE rather than a double count. These pins exist
 * so the guard cannot be deleted as "dead"; delete them only together with the
 * filter, and only once no producer of a session-kind LedgerRow remains.
 */
