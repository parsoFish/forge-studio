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
 *
 * (ROUND 2, D10 — merged) `run.status === 'complete'` implies a
 *   CONFIRMED remote PR merge — traced this round to `_queue/merged/` and
 *   `_queue/done/`'s single production writer chain
 *   (`orchestrator/phases/closure.ts:334`'s `terminalMove(..., 'merged')`,
 *   gated on `confirmPrMerged` — `orchestrator/pr.ts:778`, fails closed —
 *   `promoteMergedToDone`'s two callers are equally gated); `run-model.ts`'s
 *   `QUEUE_STATE_TO_RUN_STATUS` maps both dirs to `'complete'`. See
 *   `history-ledger.test.ts`'s D10 header note for the full trail.
 *
 * (ROUND 2, D10 — work-items) `run.workItems` (already on the client `Run`
 *   type, already carried verbatim by `parseRun`) feeds a `done`/`total`
 *   count — `done` is the count of `status === 'complete'` entries, `total`
 *   is `.length`. Measured non-fabricated: `orchestrator/run-model.test.ts`'s
 *   real-fixture test (a genuine archived cycle's 501-line event log)
 *   asserts `run.workItems?.length === 5`, and passes.
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
  // status: 'active' (round 2, D10) — deliberately NOT the baseRun() default
  // 'complete': this test's own point is isolated to D9 (retries never
  // masquerade as gate-fails/findings), and the strict `toEqual([])` below
  // would otherwise also have to account for the new `merged` segment
  // (round 2 adds it whenever status === 'complete') — an unrelated concern
  // that has its own dedicated coverage below.
  const run = baseRun({ status: 'active', phaseMeta: { 'adversarial-review': meta({ retries: 4 }) } });
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

test('deriveFlowLedgerSegments: an ordinary NOT-YET-COMPLETE run (no gate/fail/reflection-loss/retries/findings/merge) produces an EMPTY segment list, not a placeholder', () => {
  // status: 'active' — the "nothing true to say yet" case (D3's null-is-
  // honest rule stays reachable). A 'complete' run is covered by the very
  // next test — see that test's header for why 'complete' is no longer
  // empty as of round 2 (D10).
  const run = baseRun({ status: 'active' });
  expect(deriveFlowLedgerSegments(run)).toEqual([]);
});

test("deriveFlowLedgerSegments ROUND 2 (D10) HEADLINE FIX: a cleanly COMPLETE run (no gate/fail/reflection-loss/retries/findings, no workItems) now produces {kind:'merged'} — round 1 rendered this exact case as an empty narrative, the initiative's own headline column blank for the runs an operator most wants summarised", () => {
  // KILLS: an implementation that still treats 'complete' as just another
  // "nothing exceptional happened" status (round 1's shape, now a defect —
  // see history-ledger.test.ts's D10 note for the confirmPrMerged trace
  // proving status 'complete' ⟹ a confirmed remote PR merge, so 'merged' is
  // a grounded fact, not decoration).
  const run = baseRun({ status: 'complete' });
  expect(deriveFlowLedgerSegments(run)).toEqual([{ kind: 'merged' }]);
});

test('deriveFlowLedgerSegments: a NOT-complete run (gated/active/planned/failed) never carries a merged segment — merged is earned by status, not fabricated for an in-flight or failed run', () => {
  // KILLS: an implementation that emits `merged` unconditionally, or keys it
  // off something OTHER than the run's own status field (e.g. "any run with
  // no failNote").
  for (const status of ['planned', 'active', 'gated', 'failed'] as const) {
    const run = baseRun({ status });
    expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'merged')).toBeUndefined();
  }
});

// ---------------------------------------------------------------------------
// deriveFlowLedgerSegments — ROUND 2 (D10): work-items, the mockup's own
// opening beat. Sourced from run.workItems (already client-visible, already
// carried verbatim by parseRun) — done/total are COUNTED (a status tally,
// not a dollar re-summation, so this is a different act from D8's rule),
// never fabricated when workItems is empty/absent.
// ---------------------------------------------------------------------------

test('deriveFlowLedgerSegments: a populated workItems array feeds a work-items segment — done counts ONLY status===\'complete\', total is .length', () => {
  const run = baseRun({
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'complete' },
      { id: 'WI-3', status: 'retrying' },
    ],
  });
  expect(deriveFlowLedgerSegments(run)).toContainEqual({ kind: 'work-items', done: 2, total: 3 });
});

test('deriveFlowLedgerSegments: an empty workItems array produces NO work-items segment — never a fabricated "dev 0/0"', () => {
  const run = baseRun({ workItems: [] });
  expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'work-items')).toBeUndefined();
});

test('deriveFlowLedgerSegments: workItems left undefined (never even fetched) produces NO work-items segment', () => {
  const run = baseRun({ workItems: undefined });
  expect(deriveFlowLedgerSegments(run).find((s) => s.kind === 'work-items')).toBeUndefined();
});

test('deriveFlowLedgerSegments: work-items "done" only counts \'complete\' — pending/active/retrying/failed WIs all count toward total but NOT done', () => {
  // KILLS: a derivation that counts anything-not-'pending' as done (would
  // wrongly credit a 'retrying'/'failed' WI), or that counts total from
  // something other than the array's own length.
  const run = baseRun({
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'active' },
      { id: 'WI-3', status: 'pending' },
      { id: 'WI-4', status: 'failed' },
    ],
  });
  expect(deriveFlowLedgerSegments(run)).toContainEqual({ kind: 'work-items', done: 1, total: 4 });
});

test('deriveFlowLedgerSegments: THE HEADLINE ARC — populated workItems + a completed run renders work-items BEFORE merged (the mockup\'s own worked example opens on the dev fan-out, closes on merged)', () => {
  const run = baseRun({
    status: 'complete',
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'complete' },
      { id: 'WI-3', status: 'complete' },
    ],
  });
  expect(deriveFlowLedgerSegments(run)).toEqual([
    { kind: 'work-items', done: 3, total: 3 },
    { kind: 'merged' },
  ]);
});

test('deriveFlowLedgerSegments: a merged run whose reflection was lost carries BOTH segments, merged BEFORE reflection-lost (mirrors the real event order — closure.ts moves merged/->done/ THEN reflection runs and can crash, R4-11-F1)', () => {
  const run = baseRun({ reflectionLost: 'crash' } as Partial<Run>); // status stays 'complete' (baseRun default)
  expect(deriveFlowLedgerSegments(run)).toEqual([
    { kind: 'merged' },
    { kind: 'reflection-lost', cause: 'crash' },
  ]);
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
  //
  // ROUND 2 (D10) UPDATE: both fixtures below default to `status: 'complete'`
  // (baseRun()'s own default, unchanged) — round 1 pinned rowB's narrative as
  // `null` here, which is EXACTLY the defect this round's headline fix
  // closes (a merged run's narrative was empty). rowA now ALSO carries
  // 'merged' (it was never gated away from status 'complete' either) — the
  // row-isolation point this test exists for is unchanged: rowA's
  // gate-fails still never leaks onto rowB.
  const gatedFails = baseRun({ id: 'a', phaseMeta: { dev: meta({ retries: 2 }) }, startedAt: '2026-01-01T00:00:00Z' });
  const clean = baseRun({ id: 'b', startedAt: '2026-01-02T00:00:00Z' });
  const rows = deriveFlowLedgerRows([gatedFails, clean]);

  const rowA = rows.find((r) => r.id === 'a');
  const rowB = rows.find((r) => r.id === 'b');
  expect(rowA?.narrative).toBe('gate failed ×2 → merged');
  expect(rowB?.narrative).toBe('merged');
});

test('deriveFlowLedgerRows: an in-flight (not-yet-complete) run still renders narrative: null — the null branch stays reachable, never filler', () => {
  // KILLS: an implementation that, having grown the 'merged' segment,
  // accidentally makes SOME segment fire for every run regardless of status
  // — collapsing renderNarrative's honest-null branch to unreachable code
  // (D3's "nothing true to say -> null, never filler" rule would then be
  // untestable, exactly the risk round 2's own task brief calls out).
  const run = baseRun({ id: 'in-flight', status: 'active' });
  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.narrative).toBeNull();
});

// ---------------------------------------------------------------------------
// ROUND 3 (D11) — narrativeKinds: the MACHINE surface companion to
// `narrative`, populated HERE (the row-assembly layer) from the SAME
// `deriveFlowLedgerSegments(run)` call that already produces `narrative` —
// never a second, independently-derived list that could drift from it.
// ---------------------------------------------------------------------------

test('deriveFlowLedgerRows: narrativeKinds mirrors the row\'s own segments\' kinds, in the SAME order as narrative — one derivation, two views of it', () => {
  // KILLS: an implementation that derives `narrativeKinds` from a SEPARATE
  // call/re-derivation of segments (which could disagree with the one that
  // produced `narrative` — e.g. after a mid-flight D9 status change) instead
  // of the same `deriveFlowLedgerSegments(run)` array already computed for
  // this row. Reuses the D10 headline arc's own fixture (work-items then
  // merged) so the expected order is independently pinned by an EXISTING
  // test (`deriveFlowLedgerSegments: THE HEADLINE ARC`, above) rather than
  // invented fresh here.
  const run = baseRun({
    status: 'complete',
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'complete' },
      { id: 'WI-3', status: 'complete' },
    ],
  });
  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.narrative).toBe('dev 3/3 → merged');
  expect(rowOut.narrativeKinds).toEqual(['work-items', 'merged']);
});

test('deriveFlowLedgerRows: an empty segment list (narrative: null) pairs with narrativeKinds: [] — never a non-empty kinds list beside a null narrative, or vice versa', () => {
  // KILLS: an implementation that leaves narrativeKinds populated (or
  // partially populated) when narrative itself fell through to the honest-
  // null branch — the two fields must never disagree about whether there is
  // anything to report.
  const run = baseRun({ id: 'in-flight', status: 'active' });
  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.narrative).toBeNull();
  expect(rowOut.narrativeKinds).toEqual([]);
});

test('deriveFlowLedgerRows: each row carries its OWN narrativeKinds — a neighbour\'s kinds never bleed across rows (same isolation guarantee as narrative, above)', () => {
  const gatedFails = baseRun({ id: 'a', phaseMeta: { dev: meta({ retries: 2 }) }, startedAt: '2026-01-01T00:00:00Z' });
  const clean = baseRun({ id: 'b', startedAt: '2026-01-02T00:00:00Z' });
  const rows = deriveFlowLedgerRows([gatedFails, clean]);

  const rowA = rows.find((r) => r.id === 'a');
  const rowB = rows.find((r) => r.id === 'b');
  expect(rowA?.narrativeKinds).toEqual(['gate-fails', 'merged']);
  expect(rowB?.narrativeKinds).toEqual(['merged']);
});

// ---------------------------------------------------------------------------
// ROUND 4 — THE CANONICAL SEGMENT ORDER. Round 3 honestly left this hole
// open: no test pinned the ORDER `deriveFlowLedgerSegments` emits segments
// in (the journey beat deliberately asserts kind MEMBERSHIP as a set). An
// implementation keyed off event-arrival order instead of the flow's own
// topology could render "dev 3/3 → merged → 3 findings (1 blocker, 1
// major)" — a finding appearing AFTER the merge, chronologically impossible
// — and it would still pass every test above.
//
// SANITY-CHECKED against the real flow definition before pinning anything
// (studio/flows/forge-develop/flow.yaml, read this round): nodes
// `dev -> demo -> adversarial-review -> review(gate:verdict)`, plus the
// async `on: merged -> reflector` trigger (finalize-merged.ts dispatches the
// reflect agent post-merge, outside the flow run itself). That is EXACTLY
// the order this initiative's task brief specified:
//   1. work-items      (dev node's fan-out)
//   2. gate-fails       (dev node's own quality-gate retries — D9)
//   3. review-findings  (adversarial-review node)
//   4. gate-waiting/failed (the run's terminal-ish state at/around the
//                           `review` verdict gate)
//   5. merged           (confirmed remote PR merge)
//   6. reflection-lost  (async, post-merge reflect crash/budget/kill)
// No contradiction found — the flow's own declared node sequence agrees
// with the brief's order, so nothing needed correcting.
//
// ONE COMBINATION IN THE BRIEF CANNOT ACTUALLY OCCUR, and is deliberately
// NOT fabricated here: `gate-waiting` and `failed` both derive from
// `run.status` (`'gated'` and `'failed'` respectively — see the segments
// tests above, `deriveFlowLedgerSegments: gateNote/failNote/reflectionLost
// feed their own segments verbatim, each independently`), and `merged`
// ALSO derives from `run.status` (`'complete'`, D10). `Run.status` is a
// single scalar (`RunStatus`, studio-client.ts) — a run cannot simultaneously
// BE `'gated'`/`'failed'` AND `'complete'`. The existing pinned test above
// ("a NOT-complete run ... never carries a merged segment") already proves
// this for every non-complete status. So a run that reaches `merged` can
// NEVER also carry `gate-waiting` or `failed` — slot 4 of the canonical
// order is only ever populated on a run that does NOT reach slot 5. The
// maximal REALISTIC "all applicable kinds at once" fixture is therefore the
// five kinds that CAN co-occur on one `'complete'` run: work-items,
// gate-fails, review-findings, merged, reflection-lost (a merged run can
// have had dev retries, a review with findings the operator accepted at
// verdict, and a reflection that later crashed — every one of those is an
// independently-established real co-occurrence above). Fabricating a sixth/
// seventh segment into this fixture (`gate-waiting` or `failed` alongside
// `merged`) would teach an implementer a contract that can never be
// exercised by a real run — exactly the "fixture that could never exist"
// the task brief warns against.
// ---------------------------------------------------------------------------

test("deriveFlowLedgerSegments: THE CANONICAL ORDER — a single run exhibiting every REALISTICALLY co-occurring segment kind (work-items, gate-fails, review-findings, merged, reflection-lost) emits them in the flow's own chronology, not event-arrival order", () => {
  // KILLS: (1) an implementation that checks `run.status` FIRST and appends
  // `merged` ahead of the dev/review derivation (e.g. `if (status ===
  // 'complete') segments.push({kind:'merged'})` at the top of the function,
  // before walking `phaseMeta`) — would emit `merged` first, chronologically
  // impossible (a PR cannot merge before its own dev fan-out or review ran).
  // (2) an implementation that assembles segments by iterating
  // `Object.keys(run.phaseMeta)` in whatever order those keys were inserted
  // — insertion order tracks EVENT ARRIVAL in the source log (a spawn-retry
  // event on 'adversarial-review' can be logged before the final 'dev'
  // gate-fail event), NOT the flow's declared topology, so it could put
  // `review-findings` ahead of `gate-fails` even though `dev` genuinely ran
  // first. This is the realistic way this class of bug arrives (per the
  // task brief), not a contrived one — `phaseMeta` is a plain object built
  // up incrementally as events stream in, and `Object.keys` iteration order
  // for string keys is insertion order, not any topological guarantee.
  const run = baseRun({
    status: 'complete',
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'complete' },
      { id: 'WI-3', status: 'complete' },
    ],
    phaseMeta: {
      // Deliberately inserted OUT of topological order (adversarial-review
      // before dev) so a derivation that trusted insertion order instead of
      // the flow's own node sequence would be caught red-handed.
      'adversarial-review': withFindings(meta(), { total: 3, blocker: 1, major: 1, minor: 1, info: 0 }),
      dev: meta({ retries: 2 }),
    },
    reflectionLost: 'crash',
  } as Partial<Run>);

  expect(deriveFlowLedgerSegments(run)).toEqual([
    { kind: 'work-items', done: 3, total: 3 },
    { kind: 'gate-fails', count: 2 },
    { kind: 'review-findings', total: 3, blocker: 1, major: 1, minor: 1, info: 0 },
    { kind: 'merged' },
    { kind: 'reflection-lost', cause: 'crash' },
  ]);
});

test("deriveFlowLedgerRows: THE CANONICAL ORDER, companion — narrative and narrativeKinds are derived from the SAME row for the fixture above, so the human-readable string and the machine surface cannot disagree about the arc's sequence", () => {
  // KILLS: a `narrativeKinds` implementation that re-derives segments with a
  // SEPARATE call (which could reorder independently of `narrative`'s own
  // `renderNarrative(segments)` call — e.g. one path walks `phaseMeta` via
  // `Object.keys` while the other walks a topologically-ordered list) —
  // reading BOTH fields off one `rowOut` proves they came from the one
  // `deriveFlowLedgerSegments(run)` call D11 requires (see this file's
  // header + the ROUND 3 section above). Reuses the exact fixture (and its
  // independently-pinned segment order) from the `deriveFlowLedgerSegments`
  // test immediately above, the same citation pattern the ROUND 3
  // `narrativeKinds mirrors...` test already established for the D10
  // headline arc.
  const run = baseRun({
    status: 'complete',
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'complete' },
      { id: 'WI-3', status: 'complete' },
    ],
    phaseMeta: {
      'adversarial-review': withFindings(meta(), { total: 3, blocker: 1, major: 1, minor: 1, info: 0 }),
      dev: meta({ retries: 2 }),
    },
    reflectionLost: 'crash',
  } as Partial<Run>);

  const [rowOut] = deriveFlowLedgerRows([run]);
  expect(rowOut.narrative).toBe('dev 3/3 → gate failed ×2 → 3 findings (1 blocker, 1 major) → merged → reflection lost: crash');
  expect(rowOut.narrativeKinds).toEqual(['work-items', 'gate-fails', 'review-findings', 'merged', 'reflection-lost']);
});
