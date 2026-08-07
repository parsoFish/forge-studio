/**
 * Acceptance tests for the FLOW-SPECIFIC ledger derivation (R6-05 Task 3) —
 * `forge-ui/lib/flow-ledger.ts`, a pure module that does not exist yet.
 * Every assertion below is a legitimate RED against a not-yet-created file.
 *
 * This is the FIRST caller of the shared engine in `./history-ledger.ts`
 * (`./history-ledger.test.ts` pins that engine's own contract in isolation);
 * this file pins how a FLOW's `Run[]` becomes `LedgerRow[]` — which real
 * `Run`/`RunPhaseMeta` fields feed each segment, D9's dev-only gate-fails
 * rule applied against a REAL non-dev retry trap, and the href seam (D2).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `./flow-ledger.ts` (none exist yet):
 *
 *   export function deriveFlowLedgerSegments(run: Run): LedgerSegment[];
 *   export function deriveFlowLedgerRows(runs: Run[]): LedgerRow[];  // sorted newest-first
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MEASURED GROUNDS:
 *
 * (dev retries) `orchestrator/run-model-derive.ts:161-163`: `retries` is
 *   `countGateFails` (message === 'gate.fail') ONLY for `nodeId === 'dev'`;
 *   every OTHER node's `retries` is a count of ANY `error`-typed event
 *   (spawn errors, budget exhaustion, scope violations — NOT gate failures
 *   at all). Treating a non-dev node's `retries` as "gate failed" would be
 *   factually wrong, not just a style choice — this is D9's whole point.
 *
 * (findings) `RunPhaseMeta.findings` (R6-05 Task 1, `orchestrator/
 *   run-model-findings.test.ts`) is additive/optional, populated ONLY on
 *   the `adversarial-review` node, ONLY when a `review.findings.authored`
 *   event fired. Read verbatim here — never recomputed from anything else
 *   (the standing 2-3x re-summation defect class, D8's sibling rule applied
 *   to counts instead of dollars).
 *
 * (href) Mirrors `components/studio/RunRail.tsx:320` verbatim:
 *   `href={\`/flows/\${encodeURIComponent(run.flowId)}/run/\${encodeURIComponent(run.id)}\`}`
 *   — the SAME already-shipped "Run detail →" link target, so a ledger row
 *   and the run-rail card that already exists point at the identical URL
 *   for the identical run.
 *
 * (gate/fail/reflection notes) `run.gateNote`, `run.failNote`,
 *   `run.reflectionLost` are already-derived, already-consumed-elsewhere
 *   fields (RunRail.tsx:239-248 gateNote, :276-287 failNote, :293-306
 *   reflectionLost/reflectionLostNote) — read here verbatim, not re-derived.
 */
import { test, expect } from 'vitest';

import { deriveFlowLedgerSegments, deriveFlowLedgerRows } from './flow-ledger.ts';
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
    flowId: 'forge-develop',
    initiativeId: 'INIT-probe',
    initiative: 'Ledger probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 4.1,
    startedAt: '2026-01-01T00:05:00Z',
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    workItems: [],
    flowLineage: ['forge-develop'],
    ...over,
  };
}

/** `RunPhaseMeta.findings` doesn't exist on the TYPE yet (Task 1) — same
 *  cast-to-add-a-field trick `flow-run-detail-render.test.ts:309` already
 *  uses for `run.trigger` before ITS type existed. */
function withFindings(m: RunPhaseMeta, findings: { total: number; blocker: number; major: number; minor: number; info: number }): RunPhaseMeta {
  return { ...m, findings } as RunPhaseMeta & { findings: typeof findings };
}

// ---------------------------------------------------------------------------
// deriveFlowLedgerSegments — D9: dev-only gate-fails
// ---------------------------------------------------------------------------

test('deriveFlowLedgerSegments: dev retries produce a gate-fails segment', () => {
  const run = baseRun({ phaseMeta: { dev: meta({ retries: 3 }) } });
  expect(deriveFlowLedgerSegments(run)).toContainEqual({ kind: 'gate-fails', count: 3 });
});

test("D9 TRAP: a NON-dev node's retries (a real error count, e.g. adversarial-review) never produce a gate-fails segment — 'review N gate fails' is exactly the forbidden defect", () => {
  // KILLS: any derivation keyed off "any node's retries" instead of
  // specifically `phaseMeta['dev']`. This adversarial-review node's
  // `retries: 4` is a REAL, measured count (spawn/budget/scope error
  // events — run-model-derive.ts:161-163), but it is NOT a gate failure;
  // rendering "gate failed ×4" for it would misreport what actually
  // happened. The task brief names this exact defect verbatim: "A test that
  // lets 'review N gate fails' pass is a defect."
  const run = baseRun({ phaseMeta: { 'adversarial-review': meta({ retries: 4 }) } });
  const segments = deriveFlowLedgerSegments(run);

  expect(segments.find((s) => s.kind === 'gate-fails')).toBeUndefined();
  // D9's "or nothing" branch: no OTHER segment kind stands in for it either
  // — this initiative's design choice is "nothing", never invented prose.
  for (const s of segments) {
    if (s.kind === 'gate-waiting' || s.kind === 'failed' || s.kind === 'reflection-lost') continue;
    expect(s.kind).not.toBe('review-findings'); // retries never masquerade as findings either
  }
  expect(segments).toEqual([]);
});

test('deriveFlowLedgerSegments: dev retries of exactly 0 produce NO gate-fails segment (zero is not a fact worth reporting)', () => {
  // KILLS: an unconditional `{kind:'gate-fails', count: 0}` — mirrors
  // buildNote's own "a clean node omits the retry ... segment rather than
  // reporting zeroes" precedent (flow-run-timeline.test.ts:345-353).
  const run = baseRun({ phaseMeta: { dev: meta({ retries: 0 }) } });
  expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'gate-fails')).toBeUndefined();
});

test('deriveFlowLedgerSegments: a run with no dev phaseMeta entry at all produces no gate-fails segment (never a fallback to 0 that then gets reported)', () => {
  const run = baseRun({ phaseMeta: {} });
  expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'gate-fails')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// deriveFlowLedgerSegments — review-findings, read verbatim (D8's sibling rule)
// ---------------------------------------------------------------------------

test('deriveFlowLedgerSegments: adversarial-review findings feed a review-findings segment, verbatim from phaseMeta', () => {
  const run = baseRun({ phaseMeta: { 'adversarial-review': withFindings(meta(), { total: 3, blocker: 1, major: 1, minor: 1, info: 0 }) } });
  expect(deriveFlowLedgerSegments(run)).toContainEqual({ kind: 'review-findings', total: 3, blocker: 1, major: 1, minor: 1, info: 0 });
});

test('deriveFlowLedgerSegments: a clean-pass review (findings.total === 0) produces NO segment — nothing notable to report in the terse narrative', () => {
  // Design decision, documented: unlike Task 1's `phaseMeta.findings` (which
  // keeps a real zero because the EVENT fired), the terse one-line ledger
  // narrative omits an all-zero finding count the same way buildNote omits
  // zero retries — a design choice, not a bug, and distinct from Task 1's
  // own "clean pass still populates findings" rule at the phaseMeta layer.
  const run = baseRun({ phaseMeta: { 'adversarial-review': withFindings(meta(), { total: 0, blocker: 0, major: 0, minor: 0, info: 0 }) } });
  expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'review-findings')).toBeUndefined();
});

test('deriveFlowLedgerSegments: no adversarial-review phaseMeta entry at all -> no review-findings segment (never fabricated)', () => {
  const run = baseRun({ phaseMeta: { dev: meta() } });
  expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'review-findings')).toBeUndefined();
});

test('deriveFlowLedgerSegments: review-findings counts are NEVER recomputed — a deliberately-inconsistent fixture proves verbatim passthrough', () => {
  // KILLS: any derivation that recomputes `total` from
  // `blocker+major+minor+info` (or vice versa) instead of trusting the
  // already-derived phaseMeta field. blocker+major+minor+info here sums to
  // 2, but total is deliberately set to 9 (a value that could only appear
  // in the output if it were read straight through, unmodified).
  const run = baseRun({ phaseMeta: { 'adversarial-review': withFindings(meta(), { total: 9, blocker: 1, major: 0, minor: 1, info: 0 }) } });
  expect(deriveFlowLedgerSegments(run)).toContainEqual({ kind: 'review-findings', total: 9, blocker: 1, major: 0, minor: 1, info: 0 });
});

// ---------------------------------------------------------------------------
// deriveFlowLedgerSegments — run-level notes, verbatim passthrough
// ---------------------------------------------------------------------------

test('deriveFlowLedgerSegments: gateNote/failNote/reflectionLost feed their own segments verbatim, each independently', () => {
  const gated = baseRun({ status: 'gated', gateNote: 'needs you' });
  const failed = baseRun({ status: 'failed', failNote: 'CI red on merge' });
  const lostReflection = baseRun({ reflectionLost: 'crash' } as Partial<Run>);

  expect(deriveFlowLedgerSegments(gated)).toContainEqual({ kind: 'gate-waiting', note: 'needs you' });
  expect(deriveFlowLedgerSegments(failed)).toContainEqual({ kind: 'failed', note: 'CI red on merge' });
  expect(deriveFlowLedgerSegments(lostReflection)).toContainEqual({ kind: 'reflection-lost', cause: 'crash' });
});

test('deriveFlowLedgerSegments: an ordinary run (no gate/fail/reflection-loss/retries/findings) produces an EMPTY segment list, not a placeholder', () => {
  const run = baseRun();
  expect(deriveFlowLedgerSegments(run)).toEqual([]);
});

// ---------------------------------------------------------------------------
// deriveFlowLedgerRows — the row assembly: when/what/status/cost/href + sort
// ---------------------------------------------------------------------------

test('deriveFlowLedgerRows: what/status/cost are copied verbatim from the run, never re-derived', () => {
  // KILLS: re-deriving status from phases (which the timeline module
  // already legitimately does for PER-NODE status — but a ROW's status is
  // the RUN's own status, D4), or re-summing cost from phaseMeta (D8, the
  // standing 2-3x defect class).
  const run = baseRun({ initiative: 'Ship the ledger', status: 'gated', costUsd: 7.25 });
  const [rowOut] = deriveFlowLedgerRows([run]);

  expect(rowOut.what).toBe('Ship the ledger');
  expect(rowOut.status).toBe('gated');
  expect(rowOut.costUsd).toBe(7.25);
});

test('deriveFlowLedgerRows: `when` carries the raw ISO startedAt verbatim — no formatting applied at derivation time', () => {
  // KILLS: pre-formatting `when` into "3h ago" text at derivation time
  // (D7 requires the RAW ISO on the row; formatting is a presentation-time
  // concern taking an explicit nowMs, never baked in here).
  const run = baseRun({ startedAt: '2026-03-04T05:06:07Z' });
  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.when).toBe('2026-03-04T05:06:07Z');
});

test('deriveFlowLedgerRows: a run with no startedAt gets `when: ""`, never "undefined" or a fabricated timestamp', () => {
  const run = baseRun({ startedAt: undefined });
  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.when).toBe('');
  expect(rowOut.when).not.toBe('undefined');
});

test('deriveFlowLedgerRows: href mirrors RunRail.tsx\'s OWN existing "Run detail →" link target verbatim (the D2 reuse seam)', () => {
  // KILLS: constructing a different URL shape than the one ALREADY shipped
  // on the run-rail card for the exact same run (RunRail.tsx:320) — two
  // different link targets for the same run would be a real navigation bug,
  // not just an inconsistency.
  const run = baseRun({ id: '2026-05-06T07-08-09_INIT-x', flowId: 'forge-architect' });
  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.href).toBe('/flows/forge-architect/run/2026-05-06T07-08-09_INIT-x');
});

test('deriveFlowLedgerRows: rows come back newest-first', () => {
  const older = baseRun({ id: 'older', startedAt: '2026-01-01T00:00:00Z' });
  const newer = baseRun({ id: 'newer', startedAt: '2026-06-01T00:00:00Z' });
  const rows = deriveFlowLedgerRows([older, newer]);
  expect(rows.map((r) => r.id)).toEqual(['newer', 'older']);
});

test('deriveFlowLedgerRows: an empty run list yields an empty row list, never a fabricated placeholder row', () => {
  expect(deriveFlowLedgerRows([])).toEqual([]);
});

test('deriveFlowLedgerRows: each row carries its OWN run\'s narrative — a neighbour\'s gate-fails never bleeds across rows', () => {
  // KILLS: a shared/hoisted segment computation that accidentally reuses
  // the previous row's segments (e.g. a loop variable capture bug).
  const gatedFails = baseRun({ id: 'a', phaseMeta: { dev: meta({ retries: 2 }) }, startedAt: '2026-01-01T00:00:00Z' });
  const clean = baseRun({ id: 'b', startedAt: '2026-01-02T00:00:00Z' });
  const rows = deriveFlowLedgerRows([gatedFails, clean]);

  const rowA = rows.find((r) => r.id === 'a');
  const rowB = rows.find((r) => r.id === 'b');
  expect(rowA?.narrative).toBe('gate failed ×2');
  expect(rowB?.narrative).toBeNull();
});
