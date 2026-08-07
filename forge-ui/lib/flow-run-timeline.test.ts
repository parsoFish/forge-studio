/**
 * Acceptance tests for the flow run-detail TIMELINE DERIVATION (R6-01 WI-2 /
 * F4) — `forge-ui/lib/flow-run-timeline.ts`, a pure module that does not
 * exist yet. Every assertion below is a legitimate RED against a
 * not-yet-created file.
 *
 * WHY A PURE MODULE, NOT THE PAGE: there is no jsdom in this repo, so no
 * test can exercise a React effect or a click. The precedent is
 * `./run-view-client.ts` + `./run-panel-view.ts` (R6-04 WI-4) — route
 * `/flows/[id]/run/[runId]` is a thin `'use client'` shell that fetches and
 * hands resolved props to a pure presentational component (pinned in
 * `./flow-run-detail-render.test.ts`); ALL the judgement lives here, where
 * it can be tested.
 *
 * ADR-008 posture: nothing new is stored. Every row is derived from the flow
 * definition (`Flow.nodes`) plus the already-derived run model
 * (`Run.phases` / `Run.phaseMeta`), both of which the bridge already serves.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `./flow-run-timeline.ts` (none exist yet):
 *
 *   export type FlowRunTimelineRow = {
 *     nodeId: string;
 *     agent: string | null;        // null for a gate-only node
 *     status: RunPhaseStatus;      // 'pending' when the run has no entry
 *     costUsd: number;             // EXACTLY run.phaseMeta[nodeId].costUsd
 *     note: string | null;         // derived from THIS node's phaseMeta
 *     artifacts: string[];         // always [] — see (b) below
 *   };
 *
 *   export function deriveFlowRunTimeline(
 *     flow: Flow,
 *     run: Run | null,
 *   ): FlowRunTimelineRow[];
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MEASURED GROUNDS (not invented — every number below was produced by
 * driving the REAL orchestrator code, see the task report):
 *
 * (COST) `orchestrator/run-model-derive.ts::buildNodeMeta` sets
 *   `phaseMeta[node].costUsd = sumAuthoritativeCostUsd(node's own events)`.
 *   `orchestrator/event-cost.ts`'s header documents the twice-repeated
 *   defect this closes: a phase that emitted ≥1 `iteration` event RESTATES
 *   the same dollars on its per-WI `end` AND its phase-level rollup `end`,
 *   so a naive re-sum inflates 2-3x. Driving the real `listRuns` over a
 *   `_queue/done/` manifest whose dev node emitted
 *     iteration 2.0 · iteration 1.5 · end 3.5 (a restatement) · start 0
 *   produced THREE DISTINCT NUMBERS:
 *     naive re-sum over the node's events .......... 7.0   ← the defect
 *     run-level `run.costUsd` ...................... 4.1   ← attribution
 *     authoritative `phaseMeta.dev.costUsd` ........ 3.5   ← the ONE truth
 *   The fixtures below use exactly those numbers so a wrong implementation
 *   lands on a different one and the assertion names which mistake it made.
 *
 * (b) PER-NODE ARTIFACTS DO NOT EXIST. Measured:
 *   `forge-ui/components/studio/PhaseDrawer.tsx` line 307 reads
 *   `const artifactsReady = run.artifactsReady;` — the RUN-LEVEL map, keyed
 *   by artifact TYPE, rendered UNCHANGED for whichever node the drawer is
 *   open on. There is no per-node artifact data anywhere in the run model.
 *   So `row.artifacts` is an HONEST EMPTY, and the test below proves a run
 *   with a fully-populated `artifactsReady` still yields empty rows —
 *   copying the run's artifacts onto each node would be exactly the
 *   "run-level data attributed to a node" defect.
 *
 * (f) NODE ORDER comes from the flow definition's `nodes` array.
 *   `orchestrator/studio/registry.ts:467` builds it with an order-preserving
 *   `rawNodes.map(...)` over flow.yaml, and `studio/flows/forge-develop/
 *   flow.yaml` declares `dev → demo → adversarial-review → review`. That is
 *   the authoritative order; a timeline in any other order is a defect.
 */

import { test, expect } from 'vitest';

import { deriveFlowRunTimeline, type FlowRunTimelineRow } from './flow-run-timeline.ts';
import type { Flow, Run, RunPhaseMeta } from './studio-client.ts';

// ---------------------------------------------------------------------------
// Fixtures — mirroring the REAL seed flow `forge-develop` (studio/flows/
// forge-develop/flow.yaml), including its gate-only `review` node.
// ---------------------------------------------------------------------------

function developFlow(): Flow {
  return {
    id: 'forge-develop',
    name: 'Develop',
    goal: 'Build the initiative.',
    nodes: [
      { id: 'dev', agent: 'developer-ralph' },
      { id: 'demo', agent: 'demo-agent', resumable: true },
      { id: 'adversarial-review', agent: 'adversarial-review' },
      { id: 'review', gate: 'verdict' }, // gate-only: NO agent
    ],
    edges: [
      { from: 'dev', to: 'demo', artifact: 'diff' },
      { from: 'demo', to: 'adversarial-review', artifact: 'demo' },
      { from: 'adversarial-review', to: 'review', artifact: 'review-findings' },
    ],
    triggers: [],
  };
}

function meta(over: Partial<RunPhaseMeta> = {}): RunPhaseMeta {
  return { costUsd: 0, retries: 0, ...over };
}

/**
 * A COMPLETED (archived) run, shaped exactly as the real `listRuns` produced
 * it for a `_queue/done/` manifest in the measurement probe: run-level
 * `costUsd` 4.1, dev's own authoritative cost 3.5.
 */
function archivedRun(over: Partial<Run> = {}): Run {
  return {
    id: '2026-01-01T00-00-00_INIT-done-2',
    flowId: 'forge-develop',
    initiativeId: 'INIT-done-2',
    initiative: 'Archived probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 4.1, // run-level — MUST NOT appear on any row
    startedAt: '2026-01-01T00:05:00Z',
    phases: { dev: 'complete' },
    phaseMeta: {
      dev: meta({
        costUsd: 3.5, // the ONE authoritative per-node value
        retries: 0,
        wedged: false,
        delivered: { files: 4, insertions: 120, commits: 2 },
      }),
    },
    artifactsReady: {},
    workItems: [],
    flowLineage: ['forge-develop'],
    ...over,
  };
}

function rowFor(rows: FlowRunTimelineRow[], nodeId: string): FlowRunTimelineRow {
  const r = rows.find((x) => x.nodeId === nodeId);
  if (!r) throw new Error(`no timeline row for node "${nodeId}" — rows: ${rows.map((x) => x.nodeId).join(', ')}`);
  return r;
}

// ---------------------------------------------------------------------------
// COST — the twice-repeated re-summation defect
// ---------------------------------------------------------------------------

test("a node's cost is EXACTLY phaseMeta[node].costUsd — never a re-sum, never the run's total", () => {
  // KILLS: (1) any implementation that re-sums the node's cost from events
  //   (measured naive value 7.0 — the documented 2-3x inflation in
  //   orchestrator/event-cost.ts's header); (2) any implementation that
  //   attributes the RUN's costUsd (4.1) to a node.
  const rows = deriveFlowRunTimeline(developFlow(), archivedRun());

  expect(rowFor(rows, 'dev').costUsd).toBe(3.5);
  expect(rowFor(rows, 'dev').costUsd).not.toBe(7.0); // the naive re-sum
  expect(rowFor(rows, 'dev').costUsd).not.toBe(4.1); // the run-level total
});

test('a node with NO phaseMeta entry costs 0 — the run total is never borrowed', () => {
  // KILLS: `costUsd: run.phaseMeta[id]?.costUsd ?? run.costUsd` and any other
  // fallback that reaches for run-level spend when a node has none of its own.
  // The standing "real, not attributed-from-a-blind-scan" lesson, applied to
  // three nodes that genuinely never ran on this archived run.
  const run = archivedRun();
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(run.costUsd).toBe(4.1); // precondition: the run DOES have a nonzero total
  for (const id of ['demo', 'adversarial-review', 'review']) {
    expect(rowFor(rows, id).costUsd).toBe(0);
  }
});

test("every row's cost is sourced from its OWN phaseMeta entry, not a neighbour's", () => {
  // KILLS: an off-by-one / index-shifted zip of flow.nodes against
  // Object.values(phaseMeta) — a wrong implementation that lines rows up
  // positionally rather than keying by node id. Two nodes carry DISTINCT,
  // non-zero, non-equal costs so a shift lands on the wrong number.
  const run = archivedRun({
    phases: { dev: 'complete', demo: 'complete' },
    phaseMeta: {
      dev: meta({ costUsd: 3.5 }),
      demo: meta({ costUsd: 0.25 }),
    },
  });
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(rowFor(rows, 'dev').costUsd).toBe(3.5);
  expect(rowFor(rows, 'demo').costUsd).toBe(0.25);
});

// ---------------------------------------------------------------------------
// STATUS — per-node, never the run's
// ---------------------------------------------------------------------------

test("a node's status comes from run.phases[node], never from the run's own status", () => {
  // KILLS: `status: run.status` (or any mapping of it) onto rows. This
  // archived run's status is 'complete', but three of its four nodes never
  // ran — stamping them 'complete' would claim work that never happened.
  const run = archivedRun();
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(run.status).toBe('complete'); // precondition
  expect(rowFor(rows, 'dev').status).toBe('complete');
  expect(rowFor(rows, 'demo').status).toBe('pending');
  expect(rowFor(rows, 'adversarial-review').status).toBe('pending');
  expect(rowFor(rows, 'review').status).toBe('pending');
});

test('a node the run knows as failed keeps its OWN failed status on a run that is still active', () => {
  // KILLS: any implementation that derives node status from the run's status
  // in either direction. Here the run reads 'active' while one node is
  // 'failed' and another 'retrying' — three different values at once.
  const run = archivedRun({
    status: 'active',
    phases: { dev: 'failed', demo: 'retrying' },
    phaseMeta: { dev: meta({ costUsd: 3.5 }), demo: meta({ costUsd: 0.25 }) },
  });
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(rowFor(rows, 'dev').status).toBe('failed');
  expect(rowFor(rows, 'demo').status).toBe('retrying');
  expect(rowFor(rows, 'adversarial-review').status).toBe('pending');
});

// ---------------------------------------------------------------------------
// ORDER + COMPLETENESS — rows follow the flow definition
// ---------------------------------------------------------------------------

test('rows follow the FLOW DEFINITION order, and a node with no events still appears', () => {
  // KILLS: deriving rows from the events/phaseMeta that happen to be present
  // (which would yield ['dev'] alone, silently vanishing three nodes), and
  // any ordering by cost / status / insertion order of phaseMeta.
  // Order measured from studio/flows/forge-develop/flow.yaml.
  const rows = deriveFlowRunTimeline(developFlow(), archivedRun());

  expect(rows.map((r) => r.nodeId)).toEqual(['dev', 'demo', 'adversarial-review', 'review']);
});

test('a flow whose node order is NOT alphabetical is preserved verbatim', () => {
  // KILLS: an implementation that sorts node ids (alphabetical order here
  // would be ['adversarial-review','demo','dev','review'] — a different
  // sequence from the flow's declared one, so a sort is caught).
  const rows = deriveFlowRunTimeline(developFlow(), archivedRun());
  const ids = rows.map((r) => r.nodeId);

  expect(ids).not.toEqual([...ids].sort());
  expect(ids[0]).toBe('dev');
});

test('a gate-only node carries a null agent rather than being dropped or given a fake one', () => {
  // KILLS: filtering `flow.nodes` to `n.agent` (dropping the `review` gate
  // node from the timeline entirely) and inventing a placeholder agent name.
  const rows = deriveFlowRunTimeline(developFlow(), archivedRun());

  expect(rowFor(rows, 'review').agent).toBeNull();
  expect(rowFor(rows, 'dev').agent).toBe('developer-ralph');
});

test('a run that does not exist yields NO rows — never a fabricated all-pending timeline', () => {
  // KILLS: rendering a full pending timeline for a runId that never existed.
  // R6-04 closed exactly this class once already for agent runs (404 rather
  // than fabricating a `running` state); a flow timeline claiming four
  // pending nodes for a non-existent run is the same lie in table form.
  expect(deriveFlowRunTimeline(developFlow(), null)).toEqual([]);
});

// ---------------------------------------------------------------------------
// NOTE — derived, never authored
// ---------------------------------------------------------------------------

test("a node with nothing to report gets an HONEST EMPTY note, not invented prose", () => {
  // KILLS: a free-typed or agent-authored narrative string ("Waiting to
  // start…", "This node has not run yet"). `demo` has no phaseMeta entry at
  // all; `adversarial-review` has an entry carrying only the two mandatory
  // fields at their zero values. Neither has anything true to say.
  const run = archivedRun({
    phaseMeta: {
      dev: meta({ costUsd: 3.5, delivered: { files: 4, insertions: 120, commits: 2 } }),
      'adversarial-review': meta({ costUsd: 0, retries: 0, wedged: false }),
    },
  });
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(rowFor(rows, 'demo').note).toBeNull();
  expect(rowFor(rows, 'adversarial-review').note).toBeNull();
});

test("the note is derived from THIS node's own phaseMeta fields, verbatim", () => {
  // KILLS: prose that is not a function of the node's own measured data.
  // `delivered` is the real field buildNodeMeta populates for the dev node
  // (from the `dev-loop.delivered` event); the measured probe produced
  // exactly {files:4, insertions:120, commits:2}. The rendered note must be
  // those numbers and nothing else.
  const rows = deriveFlowRunTimeline(developFlow(), archivedRun());
  const note = rowFor(rows, 'dev').note;

  expect(note).toBe('4 files · +120 · 2 commits');
});

test('note segments compose deterministically from the node\'s own fields, in a fixed order', () => {
  // KILLS: a note whose content varies with anything other than this node's
  // phaseMeta (ordering by object-key iteration, locale, or a random/LLM
  // source). Same input twice ⇒ byte-identical output.
  //
  // The note's field list is a FIXED, DELIBERATE SUBSET of what
  // `buildNodeMeta` can populate, in this order: delivered · iterations ·
  // retries · wedged. Two other real fields are measured to exist and are
  // DELIBERATELY EXCLUDED, not forgotten: `model` and `brainReads`
  // (populated conditionally by buildNodeMeta,
  // orchestrator/run-model-derive.ts:189,192) carry no note segment —
  // widening the note to include them is a product decision this test does
  // not make.
  //
  // A third field, `gateChecks`, is excluded for a DIFFERENT reason: it is
  // UNREACHABLE, not merely omitted. `buildNodeMeta` populates `gateChecks`
  // only when `nodeId === 'unifier'` (run-model-derive.ts:181), but no seed
  // flow declares a `unifier` node — `studio/flows/forge-develop/flow.yaml`'s
  // own header records the monolithic unifier node's retirement (R4-10-F1,
  // ADR-039/040): the live flow is `dev → demo → adversarial-review →
  // review`. Since `deriveFlowRunTimeline` sources its rows from
  // `flow.nodes`, no row with `nodeId === 'unifier'` can ever exist, for any
  // run including archived ones — so a gate-checks segment could never be
  // exercised by this derivation. Do not restore it without a seed flow that
  // actually declares a `unifier` node.
  const run = archivedRun({
    phaseMeta: {
      dev: meta({
        costUsd: 3.5,
        retries: 2,
        wedged: true,
        iter: 3,
        iterBudget: 10,
        delivered: { files: 4, insertions: 120, commits: 2 },
      }),
    },
  });
  const flow = developFlow();
  const first = deriveFlowRunTimeline(flow, run);
  const second = deriveFlowRunTimeline(flow, run);

  expect(rowFor(first, 'dev').note).toBe('4 files · +120 · 2 commits · iter 3/10 · 2 retries · wedged');
  expect(rowFor(second, 'dev').note).toBe(rowFor(first, 'dev').note);
});

test('a clean node omits the retry and wedged segments rather than reporting zeroes', () => {
  // KILLS: an unconditional template that always emits "0 retries" / "not
  // wedged" — noise dressed as evidence. Only true, non-default facts show.
  const rows = deriveFlowRunTimeline(developFlow(), archivedRun());
  const note = rowFor(rows, 'dev').note ?? '';

  expect(note).not.toContain('retries');
  expect(note).not.toContain('wedged');
});

test("a node's note never reports a NEIGHBOUR's delivered numbers", () => {
  // KILLS: reading `delivered` off the run, off the first phaseMeta entry, or
  // off whichever node happens to have one. Two nodes carry DIFFERENT
  // delivered counts; each note must report its own.
  const run = archivedRun({
    phaseMeta: {
      dev: meta({ costUsd: 3.5, delivered: { files: 4, insertions: 120, commits: 2 } }),
      demo: meta({ costUsd: 0.25, delivered: { files: 1, insertions: 7, commits: 1 } }),
    },
  });
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(rowFor(rows, 'dev').note).toBe('4 files · +120 · 2 commits');
  expect(rowFor(rows, 'demo').note).toBe('1 files · +7 · 1 commits');
});

// ---------------------------------------------------------------------------
// ARTIFACTS — the honest empty (measurement (b))
// ---------------------------------------------------------------------------

test('per-node artifacts stay EMPTY even when the run has artifacts ready — they are run-level', () => {
  // KILLS: copying `run.artifactsReady` (run-level, keyed by artifact TYPE —
  // measured at PhaseDrawer.tsx:307, which renders that same run-level map
  // for whichever node is open) onto each node's row. There is no per-node
  // artifact data in the run model; inventing a node→artifact mapping would
  // attribute run-level data to a node, the exact standing defect class.
  const run = archivedRun({
    artifactsReady: { plan: 'view', pr: 'view', demo: 'view', verdict: 'gate' },
  });
  const rows = deriveFlowRunTimeline(developFlow(), run);

  expect(Object.keys(run.artifactsReady).length).toBe(4); // precondition
  for (const row of rows) {
    expect(row.artifacts).toEqual([]);
  }
});
