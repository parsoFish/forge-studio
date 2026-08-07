/**
 * Acceptance tests for the AGENT-SCOPED ledger derivation (R6-06 Task 2) —
 * `forge-ui/lib/agent-ledger.ts`, a pure module that does not exist yet.
 * Every assertion below is a legitimate RED against a not-yet-created file.
 *
 * This is the SECOND caller of the shared engine in `./history-ledger.ts`
 * (`./flow-ledger.ts`, R6-05, was the first) — turning an agent's runs
 * across THREE execution paths (flow-node / standalone / session) into ONE
 * `LedgerRow[]`, reusing `renderNarrative`/`renderSegment`/
 * `sortLedgerRowsNewestFirst`/`formatWhen` unchanged (D2).
 *
 * ARCHITECTURE (my own design decision, since nothing existed to constrain
 * it — documented so the implementer and I agree on the seam): the SERVER
 * route (`cli/ui-bridge-agent-history.test.ts`, Task 1) already reduces
 * status/cost to the TARGET's own per-row fact (D3) before the wire — that
 * is where the "aggregate vs per-target" ambiguity is resolved, because only
 * the server has direct filesystem access to a node's `phaseMeta` / a
 * session's `status.json` / a standalone run's `events.jsonl`. This module
 * is the client-side counterpart: it takes richer, already-resolved
 * PER-PATH entries (a flow-node entry carries the FULL `Run` + its `nodeId`,
 * exactly like `flow-ledger.ts`'s existing `deriveFlowLedgerRows(runs: Run[])`
 * takes full `Run[]`, not a pre-flattened wire summary) and derives
 * narrative/href/linkKind/sort — the presentation-layer work `renderSegment`/
 * `renderNarrative` do, which the CLI/server side never imports (mirrors the
 * EXISTING split: `orchestrator/run-model.ts` knows nothing of
 * `LedgerSegment`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `./agent-ledger.ts` (none exist yet):
 *
 *   export type AgentFlowNodeRunEntry = { run: Run; nodeId: string; href: string };
 *   export type AgentStandaloneRunEntry = {
 *     id: string; href: string; when: string; what: string;
 *     status: 'running' | 'done' | 'failed' | 'suppressed' | 'budget-exceeded';
 *     costUsd: number | null;
 *     trigger?: { kind: string; source: string; scope: string | null };
 *   };
 *   export type AgentSessionRunEntry = {
 *     id: string; href: string; when: string; what: string;
 *     status: string; costUsd: number | null;
 *   };
 *
 *   export function deriveAgentNodeLedgerSegments(run: Run, nodeId: string): LedgerSegment[];
 *   export function deriveAgentLedgerRows(args: {
 *     flowNodeEntries: AgentFlowNodeRunEntry[];
 *     standaloneEntries: AgentStandaloneRunEntry[];
 *     sessionEntries: AgentSessionRunEntry[];
 *   }): LedgerRow[];  // sorted newest-first (D2's sortLedgerRowsNewestFirst, reused)
 *
 *   export type AgentHistoryResolution =
 *     | { kind: 'found'; rows: LedgerRow[] }
 *     | { kind: 'not-found' }
 *     | { kind: 'unresolved' };
 *   export function resolveAgentHistoryFromResponse(status: number, body: unknown): AgentHistoryResolution;
 *   export function fetchAgentHistory(slug: string): Promise<AgentHistoryResolution>;
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MEASUREMENT (discipline item 10 — before pinning ANY segment kind derived
 * from a `RunPhaseMeta` field, measure whether it is actually populated for
 * a REAL node): read directly off `orchestrator/run-model-derive.ts:142-204`
 * (`buildNodeMeta`) this round —
 *
 *   - `iter`/`iterBudget` (line 175, `computeIterations`): `if (nodeId !==
 *     'dev') return {};` — ONLY the dev node ever gets these. NEVER
 *     populated for 'architect'.
 *   - `delivered` (line 178): `nodeId === 'dev' ? findDelivered(events) :
 *     undefined` — dev-only. NEVER populated for 'architect'.
 *   - `gateChecks` (line 181): `nodeId === 'unifier' ...` — unifier-only, and
 *     the unifier phase is FULLY RETIRED (CLAUDE.md, R4-01-F4) — dead in the
 *     current roster for EVERY node, architect included.
 *   - `findings` (line 185): `nodeId === 'adversarial-review' ...` —
 *     review-only. NEVER populated for 'architect'.
 *   - `retries` (line 161-163): populated for EVERY node, but for anything
 *     other than 'dev' it counts `error`-typed events, NOT gate failures
 *     (D9's own carried-over rule — this campaign already pinned the D9
 *     trap for flow-ledger.ts; the SAME rule applies here, now with the
 *     nodeId passed in explicitly rather than implicitly assumed to be
 *     'dev').
 *   - `model`/`wedged`/`lastProgressAt`/`lastEventAt`/`costUsd`: populated
 *     for every node, but NONE of these map to any of the seven existing
 *     `LedgerSegment` kinds (they already surface elsewhere — the phase-hex
 *     tiles — and duplicating them into the narrative column would be a
 *     redundant, un-briefed kind, not sanctioned by the task brief).
 *
 *   ROUND-1 CONCLUSION (measured correctly, but INCOMPLETE — see ROUND 2
 *   below): for a generic node like 'architect' — never 'dev', never
 *   'adversarial-review' — NONE of the seven ORIGINAL `LedgerSegment` kinds
 *   have a legitimate source in that node's OWN `RunPhaseMeta`. Round 1
 *   therefore measured `deriveAgentNodeLedgerSegments(run, 'architect')` to
 *   ALWAYS return `[]`. The MEASUREMENT was right (none of the seven
 *   ORIGINAL kinds applies); the CONCLUSION that this means "nothing to say"
 *   was incomplete — it left the ledger's headline outcome column blank for
 *   exactly the rows an operator most wants summarised.
 *
 *   ROUND 2 — two MORE facts ARE honestly available from a flow-node row's
 *   OWN data, independent of which node it is (measured this round, see
 *   `history-ledger.test.ts`'s own corrected header for the render-level
 *   pins):
 *
 *   - `{kind:'in-flow', flowId}` — every flow-node row's own `run.flowId`
 *     (`Run.flowId: string`, NON-optional — `studio-client.ts:55`). This
 *     does NOT come from `phaseMeta` at all — it is a fact about the ROW
 *     (which run it belongs to), not about the node's own execution — so it
 *     is populated for EVERY flow-node row, unconditionally, regardless of
 *     `phaseMeta[nodeId]`'s presence or shape. Verified: `baseRun()`'s own
 *     default `flowId: 'forge-architect'` (line ~121) makes this trivial to
 *     measure against every existing fixture in this file.
 *   - `{kind:'node-errors', count}` — a NON-`dev` node's own `retries`
 *     (line 161-163: `error`-typed events for every node but `dev`), when
 *     > 0. Measured directly against round 1's OWN Fixture from the "D9
 *     TRAP" test below: `phaseMeta.architect.retries = 2` IS populated —
 *     round 1 measured this correctly but concluded (wrongly, on reflection)
 *     that because it isn't a GATE fact it therefore isn't ANY fact worth
 *     narrating. D9 forbids calling it "gate failed" (a false claim about
 *     what actually happened); it does not forbid calling it what it
 *     honestly is — a real, counted error total for that node's own
 *     execution. Explicitly, provably NEVER emitted for the `dev` node
 *     (`gate-fails` owns that number there) — the updated dev positive
 *     control below pins the two kinds as MUTUALLY EXCLUSIVE by node, an
 *     exact-array `toEqual` that would fail if BOTH were ever emitted
 *     together for `dev`.
 *
 *   Each new kind is proven POPULATED against real derivation output below
 *   (not merely asserted) — see the "MEASURED (CORRECTED)" and "R6-06 ROUND
 *   2" tests. `deriveAgentNodeLedgerSegments(run, 'architect')` is therefore
 *   measured to return `[{kind:'in-flow', flowId: run.flowId}]` — never `[]`
 *   — for a generic node with no error retries; narrative: null was NOT the
 *   honest outcome, narrative: 'in forge-architect' is. The tests below pin
 *   this correction, plus the positive-control dev/adversarial-review cases
 *   (proving gate-fails/review-findings stay REACHABLE and mutually
 *   exclusive with node-errors — R6-06 ships no new agent that runs as the
 *   dev/adversarial-review node, but the shared engine must not silently
 *   break for one that someday does).
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ROUND 5 (defect pinning, D1): `fetchAgentHistory` calls `resolveBridgeUrl()`
// (./bridge-client.ts) before ever reaching the pure resolver. Under this
// repo's `environment: 'node'` vitest config, the REAL `resolveBridgeUrl`
// always returns `''` (its own `typeof window !== 'undefined'` SSR guard at
// bridge-client.ts:93-94 trips with no `window` global) — so testing
// `fetchAgentHistory`'s actual `fetch()` call requires replacing
// `resolveBridgeUrl` with a fixed base URL. `vi.mock()` calls are hoisted by
// vitest to the top of the module regardless of textual position, so this is
// safe declared here, before the `./agent-ledger.ts` import below. Verified
// this mock actually intercepts the extension-less `from './bridge-client'`
// import inside agent-ledger.ts (Vite/vitest match by RESOLVED file path, not
// specifier text) via a throwaway scratch test before writing the real
// assertions below — confirmed the real `fetch()` call is reached, not the
// no-bridge sentinel short-circuit.
vi.mock('./bridge-client.ts', () => ({
  resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
}));

import {
  deriveAgentNodeLedgerSegments,
  deriveAgentLedgerRows,
  resolveAgentHistoryFromResponse,
  fetchAgentHistory,
  type AgentFlowNodeRunEntry,
  type AgentStandaloneRunEntry,
  type AgentSessionRunEntry,
} from './agent-ledger.ts';
import { HistoryLedger, type HistoryLedgerProps } from '@/components/studio/HistoryLedger';
import type { LedgerRow } from './history-ledger.ts';
import type { Run, RunPhaseMeta } from './studio-client.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function meta(over: Partial<RunPhaseMeta> = {}): RunPhaseMeta {
  return { costUsd: 0, retries: 0, ...over };
}

function baseRun(over: Partial<Run> = {}): Run {
  return {
    id: '2026-01-01T00-00-00_INIT-probe',
    flowId: 'forge-architect',
    initiativeId: 'INIT-probe',
    initiative: 'Ledger probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 12.25,
    startedAt: '2026-01-01T00:05:00Z',
    phases: { architect: 'complete', pm: 'failed' },
    phaseMeta: { architect: meta({ costUsd: 2.5 }), pm: meta({ costUsd: 9.75, retries: 1 }) },
    artifactsReady: {},
    workItems: [],
    flowLineage: ['forge-architect'],
    ...over,
  };
}

function withFindings(m: RunPhaseMeta, findings: { total: number; blocker: number; major: number; minor: number; info: number }): RunPhaseMeta {
  return { ...m, findings } as RunPhaseMeta & { findings: typeof findings };
}

// ---------------------------------------------------------------------------
// deriveAgentNodeLedgerSegments — D9: per-NODE, never the run-level aggregate
// ---------------------------------------------------------------------------

test("MEASURED (CORRECTED, ROUND 2): deriveAgentNodeLedgerSegments(run, 'architect') is [{kind:'in-flow', flowId}] — NEVER [] — for a node with no error retries. None of the SEVEN ORIGINAL LedgerSegment kinds has a legitimate source in a generic node's own phaseMeta (round 1's measurement, still correct), but 'in-flow' is a fact about the ROW, not phaseMeta, so it is always populated", () => {
  // KILLS (unchanged from round 1): an implementation that reuses
  // flow-ledger.ts's RUN-LEVEL segments (work-items/merged/gate-waiting/
  // failed/reflection-lost) for a node row — exactly the attributed-status
  // defect D9 exists to prevent. The run here is 'complete' (would render
  // {kind:'merged'} at the RUN level, per flow-ledger.ts) and has
  // workItems — if a wrong implementation fell back to run-level segments
  // for an unrecognised node, this would render 'merged' or 'dev N/M' for
  // architect, which never ran either fact — an exact-array `toEqual` (not
  // `toContainEqual`) catches EITHER a missing 'in-flow' OR an extra
  // fabricated run-level segment.
  // KILLS (NEW, round 2): an implementation that still returns `[]`
  // (round 1's own now-corrected conclusion) — 'in-flow' does not depend on
  // phaseMeta at all, so omitting it here is the "measurement was right,
  // conclusion was incomplete" defect this round exists to fix.
  const run = baseRun({ status: 'complete', workItems: [{ id: 'WI-1', status: 'complete' }] });
  expect(deriveAgentNodeLedgerSegments(run, 'architect')).toEqual([{ kind: 'in-flow', flowId: run.flowId }]);
});

test("D9 TRAP (restated per-node, CORRECTED round 2): the architect node's OWN retries (a real error count, not a gate signal) produce node-errors — NEVER gate-fails", () => {
  // KILLS: any derivation keyed off "the given node's retries > 0" that
  // produces `gate-fails` without checking nodeId === 'dev' — architect's
  // retries here (2) are real error-typed events (run-model-derive.ts:
  // 161-163), NOT gate failures, so the segment kind must be `node-errors`,
  // never `gate-fails` (round 1 correctly forbade the LATTER; round 2 says
  // what the fact IS, not just what it isn't — see the module header).
  // The exact-array `toEqual` also kills an implementation that emits BOTH
  // `node-errors` and a fabricated `gate-fails` for the same node.
  const run = baseRun({ phaseMeta: { architect: meta({ retries: 2 }) } });
  expect(deriveAgentNodeLedgerSegments(run, 'architect')).toEqual([
    { kind: 'in-flow', flowId: run.flowId },
    { kind: 'node-errors', count: 2 },
  ]);
});

test("R6-06 ROUND 2 MEASURED: node-errors is populated for ANY non-dev node, not just 'architect' — proven against a SECOND, different node ('pm') so the prior test can't be dismissed as an architect-specific special case", () => {
  const run = baseRun({ phaseMeta: { pm: meta({ retries: 5 }) } });
  expect(deriveAgentNodeLedgerSegments(run, 'pm')).toEqual([
    { kind: 'in-flow', flowId: run.flowId },
    { kind: 'node-errors', count: 5 },
  ]);
});

test('positive control: the dev node\'s own retries DO produce a gate-fails segment (proves the mechanism works when it legitimately applies) — and MUTUALLY EXCLUSIVE with node-errors, which the dev node never emits', () => {
  // KILLS (round 2 addition): an implementation that emits BOTH
  // `gate-fails` AND `node-errors` for the dev node (double-counting the
  // same retries fact under two names) — the exact-array `toEqual` fails if
  // a stray `{kind:'node-errors', count:3}` is also present. `gate-fails`
  // "owns" this number on the dev node (module header, ROUND 2).
  const run = baseRun({ phaseMeta: { dev: meta({ retries: 3 }) } });
  expect(deriveAgentNodeLedgerSegments(run, 'dev')).toEqual([
    { kind: 'in-flow', flowId: run.flowId },
    { kind: 'gate-fails', count: 3 },
  ]);
});

test('positive control: the adversarial-review node\'s own findings DO produce a review-findings segment', () => {
  const run = baseRun({ phaseMeta: { 'adversarial-review': withFindings(meta(), { total: 2, blocker: 0, major: 1, minor: 1, info: 0 }) } });
  expect(deriveAgentNodeLedgerSegments(run, 'adversarial-review')).toEqual([
    { kind: 'in-flow', flowId: run.flowId },
    { kind: 'review-findings', total: 2, blocker: 0, major: 1, minor: 1, info: 0 },
  ]);
});

test("R6-06 ROUND 2, CANONICAL ORDER: the adversarial-review node's OWN retries AND findings BOTH apply in the SAME run — node-errors precedes review-findings (retries are mid-execution error/retry attempts; findings are the node's completed OUTPUT, chronologically after). A REAL, non-fabricated combination — the SAME node's own phaseMeta legitimately carries both `retries` and `findings` independently (run-model-derive.ts:161-185)", () => {
  // KILLS an Object.keys(phaseMeta[nodeId])-order-walking implementation:
  // the fixture below is DELIBERATELY constructed with `findings` inserted
  // BEFORE `retries` in the object literal's own key order (mirrors
  // flow-ledger.test.ts's own "THE CANONICAL ORDER" precedent of sabotaging
  // insertion order to catch exactly this bug) — `Object.keys` would yield
  // [costUsd, findings, retries] for this fixture, so a walker keyed off
  // that order would emit review-findings BEFORE node-errors, the WRONG way
  // around. Only a derivation that reads named fields in CANONICAL order
  // (in-flow, then node-errors, then review-findings — never by iterating
  // the object's own keys) passes.
  const sabotaged: RunPhaseMeta = { costUsd: 0, findings: { total: 2, blocker: 0, major: 1, minor: 1, info: 0 }, retries: 1, wedged: false } as RunPhaseMeta;
  expect(Object.keys(sabotaged)).toEqual(['costUsd', 'findings', 'retries', 'wedged']); // sanity: insertion order really is sabotaged
  const run = baseRun({ phaseMeta: { 'adversarial-review': sabotaged } });
  expect(deriveAgentNodeLedgerSegments(run, 'adversarial-review')).toEqual([
    { kind: 'in-flow', flowId: run.flowId },
    { kind: 'node-errors', count: 1 },
    { kind: 'review-findings', total: 2, blocker: 0, major: 1, minor: 1, info: 0 },
  ]);
});

test("a node with NO phaseMeta entry at all still carries in-flow (a ROW fact, not a phaseMeta fact) but NO node-specific fact (never a fallback fact)", () => {
  // KILLS: an implementation that fabricates gate-fails/node-errors/
  // review-findings when phaseMeta[nodeId] is absent (there is nothing to
  // read, so nothing node-specific may be reported) — but ALSO kills an
  // implementation that drops `in-flow` when phaseMeta is empty, since
  // `in-flow` is sourced from `run.flowId`, never from `phaseMeta` at all.
  const run = baseRun({ phaseMeta: {} });
  expect(deriveAgentNodeLedgerSegments(run, 'architect')).toEqual([{ kind: 'in-flow', flowId: run.flowId }]);
});

// ---------------------------------------------------------------------------
// deriveAgentLedgerRows — flow-node entries: linkKind, href, status/cost
// from THE NODE, narrative from the SAME per-node derivation
// ---------------------------------------------------------------------------

test('deriveAgentLedgerRows: a flow-node entry produces linkKind "flow-node", the given href verbatim, and status/cost from phases[nodeId]/phaseMeta[nodeId] — never run.status/run.costUsd', () => {
  // KILLS: reading `run.status`/`run.costUsd` (12.25, 'complete' per
  // baseRun's own top-level fields) instead of the NODE's own
  // `phases.architect` ('complete' too, deliberately — see the NEXT test for
  // the case where they actually diverge) and `phaseMeta.architect.costUsd`
  // (2.5, NOT 12.25).
  const run = baseRun();
  const entries: AgentFlowNodeRunEntry[] = [{ run, nodeId: 'architect', href: '/flows/forge-architect/run/2026-01-01T00-00-00_INIT-probe' }];
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: entries, standaloneEntries: [], sessionEntries: [] });
  expect(row.costUsd).toBe(2.5);
  expect(row.href).toBe('/flows/forge-architect/run/2026-01-01T00-00-00_INIT-probe');
});

test('D9: when the node\'s own status DIVERGES from run.status, the row carries the NODE\'s status', () => {
  // KILLS: `row.status = run.status`. The run itself is 'failed' (pm's
  // fault) but the architect node's own phases entry is 'complete' — a wrong
  // implementation would misreport a node that actually succeeded as failed.
  const run = baseRun({ status: 'failed', phases: { architect: 'complete', pm: 'failed' } });
  const entries: AgentFlowNodeRunEntry[] = [{ run, nodeId: 'architect', href: '/flows/forge-architect/run/x' }];
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: entries, standaloneEntries: [], sessionEntries: [] });
  expect(row.status).toBe('complete');
});

test('R6-06 ROUND 2 CORRECTED: a flow-node row for architect (no gate-fails/review-findings/node-errors apply) carries narrative "in forge-architect", narrativeKinds: [\'in-flow\'] — NOT null/[] (round 1\'s conclusion, corrected: in-flow is always honestly available for a flow-node row, never filler)', () => {
  // KILLS: `narrative: null` / `narrativeKinds: []` for ANY flow-node row —
  // round 1's own (now-superseded) expectation. `in-flow` is sourced from
  // `run.flowId`, present on every real `Run`, so a flow-node row's
  // narrative is NEVER genuinely empty — it is at minimum "in <flowId>".
  const run = baseRun();
  const entries: AgentFlowNodeRunEntry[] = [{ run, nodeId: 'architect', href: '/flows/forge-architect/run/x' }];
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: entries, standaloneEntries: [], sessionEntries: [] });
  expect(row.narrative).toBe('in forge-architect');
  expect(row.narrativeKinds).toEqual(['in-flow']);
});

test('linkKind is never set on entries other than the path they belong to — a flow-node row is never accidentally "standalone" or "session"', () => {
  const run = baseRun();
  const entries: AgentFlowNodeRunEntry[] = [{ run, nodeId: 'architect', href: '/flows/forge-architect/run/x' }];
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: entries, standaloneEntries: [], sessionEntries: [] });
  expect(row.linkKind).toBe('flow-node');
});

// ---------------------------------------------------------------------------
// deriveAgentLedgerRows — standalone entries: D7 narrative, D4/D5 trust the
// caller-filtered entry list verbatim (this module does no filtering of its
// own — that already happened server-side, Task 1)
// ---------------------------------------------------------------------------

test('D7: every standalone entry carries the {kind:\'standalone\'} NARRATIVE segment — rendered text "standalone", not a bespoke badge', () => {
  // KILLS: an implementation that leaves narrative: null for a standalone
  // row (D7 says this is a NARRATIVE fact, not merely `linkKind` metadata —
  // the mockup puts STANDALONE in the row's free-text `sub`, and no view
  // file renders a badge for it, so the ONLY place this fact can surface in
  // the shared HistoryLedger.tsx component is the narrative column).
  const entry: AgentStandaloneRunEntry = {
    id: '_agent-solo-x', href: '/agents/solo/run/_agent-solo-x', when: '2026-01-01T00:00:00Z', what: 'solo',
    status: 'done', costUsd: 4.5,
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [entry], sessionEntries: [] });
  expect(row.narrative).toBe('standalone');
  expect(row.narrativeKinds).toEqual(['standalone']);
  expect(row.linkKind).toBe('standalone');
});

test('a standalone row carries its OWN status/cost/href verbatim, not re-derived', () => {
  const entry: AgentStandaloneRunEntry = {
    id: '_agent-solo-y', href: '/agents/solo/run/_agent-solo-y', when: '2026-02-01T00:00:00Z', what: 'solo',
    status: 'suppressed', costUsd: null,
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [entry], sessionEntries: [] });
  expect(row.status).toBe('suppressed');
  expect(row.costUsd).toBeNull();
  expect(row.href).toBe('/agents/solo/run/_agent-solo-y');
});

test("D12: a standalone status ('suppressed') is never coerced into a RunStatus/RunPhaseStatus literal — carried verbatim, not mapped", () => {
  // KILLS: a status-mapping table (`{suppressed: 'failed'}` or similar) — D12
  // is explicit that there is no honest RunStatus for 'suppressed'.
  const entry: AgentStandaloneRunEntry = {
    id: '_agent-x', href: '/agents/x/run/_agent-x', when: '2026-01-01T00:00:00Z', what: 'x',
    status: 'budget-exceeded', costUsd: 1,
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [entry], sessionEntries: [] });
  expect(row.status).toBe('budget-exceeded');
});

// ---------------------------------------------------------------------------
// deriveAgentLedgerRows — session entries
// ---------------------------------------------------------------------------

test('a session entry produces linkKind "session", carries its own href/status/cost verbatim, and narrative: null (no segment kind applies to a session)', () => {
  const entry: AgentSessionRunEntry = {
    id: 'sess-a', href: '/architect/sess-a', when: '2026-01-01T00:00:00Z', what: 'architect session',
    status: 'committed', costUsd: 3.33,
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [], sessionEntries: [entry] });
  expect(row.linkKind).toBe('session');
  expect(row.href).toBe('/architect/sess-a');
  expect(row.status).toBe('committed');
  expect(row.costUsd).toBe(3.33);
  expect(row.narrative).toBeNull();
});

test('a session entry with costUsd: null (no log dir yet) is passed through as null, never fabricated to 0', () => {
  const entry: AgentSessionRunEntry = {
    id: 'sess-b', href: '/architect/sess-b', when: '2026-01-01T00:00:00Z', what: 'architect session',
    status: 'interviewing', costUsd: null,
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [], sessionEntries: [entry] });
  expect(row.costUsd).toBeNull();
});

// ---------------------------------------------------------------------------
// deriveAgentLedgerRows — the three-path JOIN + sort
// ---------------------------------------------------------------------------

test('deriveAgentLedgerRows: rows from all three paths are joined into ONE ledger, newest-first, reusing sortLedgerRowsNewestFirst (D2)', () => {
  const flowRun = baseRun({ id: 'flow-run', startedAt: '2026-01-01T00:00:00Z' });
  const flowEntry: AgentFlowNodeRunEntry = { run: flowRun, nodeId: 'architect', href: '/flows/forge-architect/run/flow-run' };
  const standaloneEntry: AgentStandaloneRunEntry = {
    id: 'solo-run', href: '/agents/architect/run/solo-run', when: '2026-03-01T00:00:00Z', what: 'architect',
    status: 'done', costUsd: 1,
  };
  const sessionEntry: AgentSessionRunEntry = {
    id: 'sess-run', href: '/architect/sess-run', when: '2026-02-01T00:00:00Z', what: 'architect session',
    status: 'committed', costUsd: 1,
  };
  const rows = deriveAgentLedgerRows({ flowNodeEntries: [flowEntry], standaloneEntries: [standaloneEntry], sessionEntries: [sessionEntry] });
  expect(rows.map((r) => r.id)).toEqual(['solo-run', 'sess-run', 'flow-run']);
  expect(rows.map((r) => r.linkKind)).toEqual(['standalone', 'session', 'flow-node']);
});

test('deriveAgentLedgerRows: no entries on any path yields an empty ledger, never a fabricated placeholder row', () => {
  expect(deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [], sessionEntries: [] })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Trigger attachment (D8: BOTH ledgers gain optional trigger)
// ---------------------------------------------------------------------------

test('D8: a standalone entry\'s trigger, when present, is attached to the row verbatim', () => {
  const entry: AgentStandaloneRunEntry = {
    id: '_agent-t', href: '/agents/t/run/_agent-t', when: '2026-01-01T00:00:00Z', what: 't',
    status: 'done', costUsd: 1, trigger: { kind: 'schedule', source: 'cron:0 9 * * 1', scope: 'gitpulse' },
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [entry], sessionEntries: [] });
  expect(row.trigger).toEqual({ kind: 'schedule', source: 'cron:0 9 * * 1', scope: 'gitpulse' });
});

test('a standalone entry with no trigger produces a row with trigger left undefined, never a fabricated default', () => {
  const entry: AgentStandaloneRunEntry = {
    id: '_agent-nt', href: '/agents/nt/run/_agent-nt', when: '2026-01-01T00:00:00Z', what: 'nt',
    status: 'done', costUsd: 1,
  };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [], standaloneEntries: [entry], sessionEntries: [] });
  expect(row.trigger).toBeUndefined();
});

test('D8: a flow-node entry\'s run.trigger, when present, is attached to the row verbatim (the SAME field flow-ledger.ts now also carries — see flow-ledger.test.ts)', () => {
  const run = baseRun({ trigger: { kind: 'merged', source: 'flow:forge-develop', scope: null } });
  const entry: AgentFlowNodeRunEntry = { run, nodeId: 'architect', href: '/flows/forge-architect/run/x' };
  const [row] = deriveAgentLedgerRows({ flowNodeEntries: [entry], standaloneEntries: [], sessionEntries: [] });
  expect(row.trigger).toEqual({ kind: 'merged', source: 'flow:forge-develop', scope: null });
});

// ---------------------------------------------------------------------------
// D10 — the three-state fetch resolver (mirrors flow-run-detail-client.ts's
// resolveFlowRunDetailFromResponse exactly — see that file, this repo's own
// established pattern for exactly this problem)
// ---------------------------------------------------------------------------

test('D10: status 404 resolves to {kind: "not-found"} — REACHABILITY (honest): the Task-1 route as I specified it never actually emits 404 for an unknown slug (it 200s with empty rows instead, D5\'s "filter, not validation" design) — this branch is defined for consistency with the sibling resolver pattern and forward-compatibility, not currently wire-reachable. Pinned anyway per this campaign\'s own precedent for documenting an honest, currently-unreached-but-correct branch.', () => {
  const r = resolveAgentHistoryFromResponse(404, null);
  expect(r.kind).toBe('not-found');
});

test('D10: a 2xx with a parseable rows array resolves to {kind: "found", rows}', () => {
  const body = { rows: [] };
  const r = resolveAgentHistoryFromResponse(200, body);
  expect(r.kind).toBe('found');
  if (r.kind === 'found') expect(r.rows).toEqual([]);
});

test('D10: a 2xx with a MISSING/malformed rows key resolves to {kind: "unresolved"} — an anomaly, never silently degraded to "found, empty"', () => {
  // KILLS: a resolver that treats ANY 2xx as found regardless of body shape
  // — the server's own contract is "200 always carries {rows: [...]}" (Task
  // 1); a 2xx that doesn't is a genuine anomaly, not the same fact as "found,
  // zero rows".
  const r = resolveAgentHistoryFromResponse(200, { notRows: [] });
  expect(r.kind).toBe('unresolved');
});

test('D10 KILL: a two-state resolver ported from studio-client.ts\'s convention (any non-2xx including 5xx/network-failure collapses to the SAME value as 404) is distinguishable here — 500 is unresolved, NOT not-found', () => {
  // KILLS: `status !== 200 ? {kind:'not-found'} : {kind:'found', rows}` — the
  // exact two-state shape D10 names as "a known filed defect elsewhere in
  // this codebase" (run-view-client.ts's own convention). A transient bridge
  // 500 must never render as the authoritative negative fact "this agent
  // has no history" — see flow-run-detail-client.ts's own KILL 3 test for
  // the established precedent this mirrors.
  const notFound = resolveAgentHistoryFromResponse(404, null);
  const serverError = resolveAgentHistoryFromResponse(500, null);
  expect(serverError.kind).not.toBe('not-found');
  expect(serverError.kind).toBe('unresolved');
  expect(serverError.kind).not.toBe(notFound.kind);
});

test('D10: a 403 (a real client error, but not the literal 404 the server contract documents) resolves to "unresolved", NOT "not-found" — not-found is keyed to the exact status code, not a generic 4xx bucket', () => {
  const r = resolveAgentHistoryFromResponse(403, null);
  expect(r.kind).toBe('unresolved');
});

// ═══════════════════════════════════════════════════════════════════════
// ROUND 5, DEFECT 1 — the IMPURE WRAPPER (`fetchAgentHistory`) reads
// `res.json()` unconditionally, BEFORE inspecting `res.status`. The
// docstring above (agent-ledger.ts:216-218) promises "status decides FIRST,
// before body is ever inspected, in both directions — a 404 wins even over
// a plausible-looking body". True of the PURE resolver
// (`resolveAgentHistoryFromResponse`, already exhaustively pinned above);
// FALSE of this wrapper: a 404 with a non-JSON body (the ordinary shape of
// a real 404 — a framework HTML error page, e.g. Next.js's own default 404
// page) makes `res.json()` throw a `SyntaxError`, the outer `try/catch`
// swallows it, and the wrapper resolves via the sentinel
// `resolveAgentHistoryFromResponse(0, null)` — status `0` is neither `404`
// nor a 2xx, so the pure resolver (correctly, for ITS contract) returns
// `'unresolved'`. The caller then sees `'unresolved'` for what is actually
// the authoritative "this agent has no history" fact — the exact
// mis-resolution D10's own "a 404 wins even over a plausible-looking body"
// promise exists to prevent, now happening one layer up from where D10
// pinned it.
//
// Reproduced directly (not merely asserted) via a real `fetchAgentHistory`
// call with `resolveBridgeUrl` mocked to a fixed base and `fetch` stubbed —
// see the `vi.mock('./bridge-client.ts', ...)` above this file's imports.
// ═══════════════════════════════════════════════════════════════════════

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stub `global.fetch` for exactly one call, returning `{status, json}` —
 *  `json` may reject to simulate a non-JSON body (SyntaxError), matching
 *  what a real `res.json()` does against an HTML error page. */
function stubFetchOnce(response: { status: number; json: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn(async () => response));
}

test('DEFECT 1 RED: fetchAgentHistory — a 404 with a NON-JSON body (res.json() throws, the ordinary shape of a real 404 HTML error page) must still resolve to {kind:"not-found"} — status decides FIRST, per the docstring\'s own promise, not "whichever branch survives res.json()"', async () => {
  // KILLS: `const body = await res.json(); return resolveAgentHistoryFromResponse(res.status, body);`
  // (the current implementation, agent-ledger.ts:250-252) — `res.json()`
  // throws before `res.status` (404) is ever consulted, the throw is caught
  // by the OUTER catch (agent-ledger.ts:253), and the wrapper falls through
  // to the sentinel `resolveAgentHistoryFromResponse(0, null)` ->
  // `{kind:'unresolved'}`. Reproduced by execution: the current
  // implementation returns `{kind:'unresolved'}` here, not `{kind:'not-found'}`.
  stubFetchOnce({ status: 404, json: () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); } });
  const result = await fetchAgentHistory('some-agent');
  expect(result).toEqual({ kind: 'not-found' });
});

test('DEFECT 1 REGRESSION LOCK: fetchAgentHistory — 404 with a VALID JSON body still resolves to not-found (this control already passes today; a fix must not break it)', async () => {
  stubFetchOnce({ status: 404, json: async () => ({ error: 'not found' }) });
  const result = await fetchAgentHistory('some-agent');
  expect(result).toEqual({ kind: 'not-found' });
});

test('DEFECT 1 REGRESSION LOCK: fetchAgentHistory — 500 with an HTML body (res.json() throws) resolves to unresolved (already correct today; a fix must not break it)', async () => {
  stubFetchOnce({ status: 500, json: () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); } });
  const result = await fetchAgentHistory('some-agent');
  expect(result).toEqual({ kind: 'unresolved' });
});

test('DEFECT 1 REGRESSION LOCK: fetchAgentHistory — a thrown fetch() (network failure) resolves to unresolved (already correct today; a fix must not break it)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
  const result = await fetchAgentHistory('some-agent');
  expect(result).toEqual({ kind: 'unresolved' });
});

test('DEFECT 1 REGRESSION LOCK: fetchAgentHistory — 200 with malformed (unparseable) JSON resolves to unresolved (already correct today; a fix must not break it)', async () => {
  stubFetchOnce({ status: 200, json: () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  const result = await fetchAgentHistory('some-agent');
  expect(result).toEqual({ kind: 'unresolved' });
});

test('DEFECT 1 REGRESSION LOCK: fetchAgentHistory — 200 with well-formed JSON of the WRONG shape (no rows array) resolves to unresolved (already correct today; a fix must not break it)', async () => {
  stubFetchOnce({ status: 200, json: async () => ({ notRows: [] }) });
  const result = await fetchAgentHistory('some-agent');
  expect(result).toEqual({ kind: 'unresolved' });
});

// ═══════════════════════════════════════════════════════════════════════
// ROUND 5, DEFECT 2 — the resolver does ZERO per-row shape validation.
// `resolveAgentHistoryFromResponse`'s 2xx branch checks only
// `Array.isArray(rows)`, then does a bare `rows as LedgerRow[]` — any
// element shape is accepted as `'found'`. Reproduced by the reviewer
// feeding resolver-accepted rows into the REAL `HistoryLedger` component:
//   - `costUsd: "5.00"` (a string) -> render throws (`row.costUsd.toFixed is
//     not a function`, HistoryLedger.tsx:150/117 both call `.toFixed(2)`
//     unconditionally once `row.costUsd !== null`)
//   - `costUsd` absent/`undefined` -> the component's own `!== null` guard
//     does not catch `undefined` -> render throws the same way
//   - a row of just `{status: 'complete'}` -> accepted as `found` with no
//     complaint at all
//
// CHOSEN BEHAVIOUR (pinned below, per this round's brief): a response
// carrying ANY structurally invalid row is rejected WHOLESALE as
// `{kind:'unresolved'}` — never a silently shortened "drop the bad ones,
// keep the good ones" list. A silently shortened list is its own kind of
// lie (an agent's history looking shorter than it really is, with no signal
// that anything was dropped), and this codebase's standing rule (CLAUDE.md)
// is to fail fast and never silently swallow. `'unresolved'` is also
// already the exact bucket this resolver uses for every other "the 2xx
// contract wasn't honoured" anomaly (a missing `rows` key, a non-array
// `rows`) — a malformed ROW is the same class of anomaly one level deeper,
// not a new third thing.
//
// VALIDATION RULES pinned below (per this round's brief):
//   - every row's `id`/`when`/`what`/`href` must be a `string`
//   - `narrative` must be `string | null`; `narrativeKinds` a `string[]`
//   - `costUsd` must be `number | null` — NEVER a string, NEVER `undefined`
//     (this is the exact field the reviewer's two crashing repros hit)
//   - `status` vocabulary is CLOSED per `linkKind`, per the module's own
//     documented per-path contract: `linkKind:'flow-node'` -> RunPhaseStatus
//     (`pending|active|complete|retrying|failed`); `linkKind:'standalone'`
//     -> `running|done|failed|suppressed|budget-exceeded`. `linkKind:
//     'session'` is deliberately OPEN (any string) — session `phase` is
//     closed per runner but open across the four-and-growing runners this
//     module aggregates, so a closed union there would be dishonest, per
//     this round's own measured ruling; a fix must NOT start rejecting a
//     legitimate novel session phase string.
// ═══════════════════════════════════════════════════════════════════════

const NOW_MS = new Date('2026-01-01T03:00:00Z').getTime();

function validFlowNodeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'flow-row', when: '2026-01-01T00:00:00Z', what: 'Ship the ledger',
    narrative: 'in forge-architect', narrativeKinds: ['in-flow'],
    status: 'complete', costUsd: 2.5, href: '/flows/forge-architect/run/flow-row',
    linkKind: 'flow-node',
    ...over,
  };
}

function validStandaloneRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'solo-row', when: '2026-01-01T00:00:00Z', what: 'solo dispatch',
    narrative: 'standalone', narrativeKinds: ['standalone'],
    status: 'done', costUsd: 1, href: '/agents/solo/run/solo-row',
    linkKind: 'standalone',
    ...over,
  };
}

function validSessionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sess-row', when: '2026-01-01T00:00:00Z', what: 'architect session',
    narrative: null, narrativeKinds: [],
    status: 'interviewing', costUsd: null, href: '/architect/sess-row',
    linkKind: 'session',
    ...over,
  };
}

test('DEFECT 2 RED: a row with costUsd as a STRING ("5.00") — the reviewer\'s first repro — must NOT be accepted as found', () => {
  // KILLS: `Array.isArray(rows) ? {kind:'found', rows} : {kind:'unresolved'}`
  // (the current implementation) — it has no per-row check at all, so this
  // structurally-invalid row sails through as `'found'`. Rendered through
  // the REAL component (proven below, DEFECT 2 EVIDENCE), this row throws.
  const body = { rows: [validFlowNodeRow({ costUsd: '5.00' })] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('unresolved');
});

test('DEFECT 2 RED: a row with costUsd MISSING (undefined) — the reviewer\'s second repro; the component\'s own `!== null` guard does not catch this — must NOT be accepted as found', () => {
  const badRow = validFlowNodeRow();
  delete badRow.costUsd;
  const body = { rows: [badRow] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('unresolved');
});

test('DEFECT 2 RED: a row of just {status: "complete"} — the reviewer\'s third repro, every other required field absent — must NOT be accepted as found', () => {
  const body = { rows: [{ status: 'complete' }] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('unresolved');
});

test('DEFECT 2 RED, CHOSEN BEHAVIOUR: ONE invalid row among otherwise-valid rows rejects the WHOLE response as unresolved — never a silently shortened "drop the bad one, keep the rest" list', () => {
  // KILLS both the current (no validation at all) implementation AND a
  // plausible alternative fix that filters rows instead of rejecting the
  // response — that alternative would return `{kind:'found', rows:[the one
  // valid row]}` here, which this exact-kind assertion also catches (a
  // `'found'` result would fail this `.toBe('unresolved')`).
  const body = { rows: [validFlowNodeRow(), validStandaloneRow({ costUsd: '3.00' })] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('unresolved');
});

test('DEFECT 2 RED, STATUS VOCAB: a flow-node row with a status OUTSIDE RunPhaseStatus\'s closed set (e.g. "bogus") is rejected — the per-path status vocabulary is enforced, not just presence/type', () => {
  const body = { rows: [validFlowNodeRow({ status: 'bogus' })] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('unresolved');
});

test('DEFECT 2 RED, STATUS VOCAB: a standalone row with a status OUTSIDE its own closed set (e.g. "queued", not one of running|done|failed|suppressed|budget-exceeded) is rejected', () => {
  const body = { rows: [validStandaloneRow({ status: 'queued' })] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('unresolved');
});

test('DEFECT 2 REGRESSION LOCK (openness must survive the fix): a SESSION row\'s status is a deliberately-open, non-forge-controlled string ("interviewing") and must still be accepted as found — session status is NOT a closed vocabulary', () => {
  // KILLS an over-eager fix that closes the session status vocabulary too
  // (e.g. reusing the standalone or RunPhaseStatus set for every linkKind) —
  // this module's own header (D12) and this round's brief are both explicit
  // that session `status` is carried verbatim, never coerced/validated
  // against a closed set, because it is genuinely open across a growing set
  // of runners.
  const body = { rows: [validSessionRow({ status: 'some-brand-new-runner-phase' })] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('found');
  if (result.kind === 'found') expect(result.rows[0].status).toBe('some-brand-new-runner-phase');
});

test('DEFECT 2 REGRESSION LOCK: fully valid rows across all three linkKinds (flow-node/standalone/session) are still accepted as found, verbatim — the new validation must not reject legitimate data', () => {
  const body = { rows: [validFlowNodeRow(), validStandaloneRow(), validSessionRow()] };
  const result = resolveAgentHistoryFromResponse(200, body);
  expect(result.kind).toBe('found');
  if (result.kind === 'found') {
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.linkKind)).toEqual(['flow-node', 'standalone', 'session']);
  }
});

// ---------------------------------------------------------------------------
// DEFECT 2 EVIDENCE + INTEGRATION — the REAL HistoryLedger component, not
// just the resolver's return value. Proves WHY the rejections above matter
// (the component genuinely crashes on these shapes today) and closes the
// loop the task brief requires: "a caller must never receive a `found` row
// that crashes the component."
// ---------------------------------------------------------------------------

function renderRows(rows: LedgerRow[]): string {
  const props: HistoryLedgerProps = { rows, nowMs: NOW_MS };
  return renderToStaticMarkup(React.createElement(HistoryLedger as never, props as never));
}

test('DEFECT 2 EVIDENCE: the REAL HistoryLedger component throws when given a row with costUsd as a string — reproduces the reviewer\'s "row.costUsd.toFixed is not a function" crash directly, bypassing the resolver entirely. This is WHY defect 2\'s rejection above is required, not optional', () => {
  const crashingRow = validFlowNodeRow({ costUsd: '5.00' }) as unknown as LedgerRow;
  expect(() => renderRows([crashingRow])).toThrow(/toFixed/);
});

test('DEFECT 2 EVIDENCE: the REAL HistoryLedger component throws when given a row with costUsd undefined — the component\'s `row.costUsd !== null` guard does not catch `undefined`, so it still calls `.toFixed` on it', () => {
  const crashingRow = validFlowNodeRow() as unknown as LedgerRow;
  delete (crashingRow as unknown as Record<string, unknown>).costUsd;
  expect(() => renderRows([crashingRow])).toThrow(/toFixed/);
});

test('DEFECT 2 INTEGRATION: whatever rows resolveAgentHistoryFromResponse hands back as "found", rendering them through the REAL HistoryLedger component must never throw — run against all three of the reviewer\'s reproduced malformed shapes plus the mixed-valid-and-invalid body', () => {
  // KILLS the current implementation: it marks every one of these `'found'`
  // today, and — proven by the EVIDENCE tests just above — at least one of
  // these exact shapes genuinely crashes the real component when rendered,
  // so the `not.toThrow()` branch below fails against the CURRENT resolver.
  // A correct fix makes every one of these `'unresolved'` instead, so the
  // `found`/`renderRows` branch is never reached for bad data at all — but
  // the `not.toThrow()` assertion is kept live here (rather than asserting
  // only `unresolved`) as the general safety net the brief requires: ANY
  // future malformed shape this list doesn't yet anticipate still can't
  // slip a crashing row past this test, because rendering whatever the
  // resolver DOES call "found" is always exercised, unconditionally.
  const malformedBodies: unknown[] = [
    { rows: [validFlowNodeRow({ costUsd: '5.00' })] },
    { rows: [(() => { const r = validFlowNodeRow(); delete r.costUsd; return r; })()] },
    { rows: [{ status: 'complete' }] },
    { rows: [validFlowNodeRow(), validStandaloneRow({ costUsd: '3.00' })] },
  ];
  for (const body of malformedBodies) {
    const result = resolveAgentHistoryFromResponse(200, body);
    if (result.kind === 'found') {
      expect(() => renderRows(result.rows)).not.toThrow();
    } else {
      expect(result.kind).toBe('unresolved');
    }
  }
});
