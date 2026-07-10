/**
 * Tests for forge-ui/lib/monitor-layout.ts — the pure run-model → monitor
 * topology mapping (M7-1, ADR-031).
 *
 * Pure synchronous function: no DOM, no React. Runs under the forge-ui
 * Vitest runner (vitest.config.ts include: lib/**\/*.test.ts), matching its
 * four sibling lib tests.
 *
 * Asserts the contract the Studio flow monitor + the e2e harness depend on:
 *  - per-WI identity (hexKind='wi' + wiId) on fanOut-expanded hexes
 *  - a deterministic per-PHASE node set (hexKind='phase', deduplicated by nodeId)
 *  - per-phase cost carried from run.phaseMeta[nodeId].costUsd (0 when absent)
 *  - fanOut reroutes the dev pulse onto the WI hexes following the dependency
 *    DAG: PM→root WIs, leaf WIs→unifier (resolve by wiId, then nodeId); the deps
 *    themselves ride on the WI hex as data-wi-deps, not cross-stack edges (#11)
 */

import { test, expect } from 'vitest';

import { buildMonitorLayout } from './monitor-layout';
import type { Flow, Run } from './studio-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A forge-cycle-shaped flow: architect → pm → dev (fanOut) → unifier → review → reflect. */
function makeFlow(): Flow {
  return {
    id: 'forge-cycle',
    name: 'Forge Cycle',
    goal: 'autonomous cycle',
    nodes: [
      { id: 'architect', agent: 'architect' },
      { id: 'pm', agent: 'project-manager' },
      { id: 'dev', agent: 'developer-loop', fanOut: 'work-items' },
      { id: 'unifier', agent: 'unifier' },
      { id: 'review', agent: 'review-loop' },
      { id: 'reflect', agent: 'reflector' },
    ],
    edges: [
      { from: 'architect', to: 'pm', artifact: 'plan' },
      { from: 'pm', to: 'dev', artifact: 'work-items' },
      { from: 'dev', to: 'unifier', artifact: 'branch' },
      { from: 'unifier', to: 'review', artifact: 'pr' },
      { from: 'review', to: 'reflect', artifact: 'verdict' },
    ],
    triggers: [],
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'cycle-1',
    flowId: 'forge-cycle',
    initiativeId: 'INIT-x',
    initiative: 'x',
    status: 'active',
    origin: 'architect',
    costUsd: 1.85,
    phases: {
      architect: 'complete',
      pm: 'complete',
      dev: 'active',
      unifier: 'pending',
      review: 'pending',
      reflect: 'pending',
    },
    phaseMeta: {
      architect: { costUsd: 0.46, retries: 0 },
      pm: { costUsd: 0.31, retries: 0 },
      dev: { costUsd: 0.92, retries: 0 },
      unifier: { costUsd: 0.18, retries: 0 },
    },
    artifactsReady: {},
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'active' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hexKind + WI identity
// ---------------------------------------------------------------------------

test('buildMonitorLayout: fanOut WI hexes carry hexKind="wi" + wiId', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  const wiHexes = layout.topologyHexes.filter((h) => h.hexKind === 'wi');
  expect(wiHexes.length).toBe(2);
  expect(wiHexes.map((h) => h.wiId).sort()).toEqual(['WI-1', 'WI-2']);
  // each wi hex carries the WI's own status, not the phase status
  const wi1 = wiHexes.find((h) => h.wiId === 'WI-1');
  const wi2 = wiHexes.find((h) => h.wiId === 'WI-2');
  expect(wi1?.status).toBe('complete');
  expect(wi2?.status).toBe('active');
  // wi hexes still reference the fanOut node id for edge resolution
  expect(wiHexes.every((h) => h.nodeId === 'dev')).toBeTruthy();
});

test('buildMonitorLayout: phase hexes carry hexKind="phase" and no wiId', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  const phaseHexes = layout.topologyHexes.filter((h) => h.hexKind === 'phase');
  expect(phaseHexes.every((h) => h.wiId === undefined)).toBeTruthy();
  // architect, pm, dev(collapsed... no — dev fanned out), unifier, review, reflect
  const ids = phaseHexes.map((h) => h.nodeId).sort();
  expect(ids).toEqual(['architect', 'pm', 'reflect', 'review', 'unifier'].sort());
});

// ---------------------------------------------------------------------------
// deterministic per-phase node set
// ---------------------------------------------------------------------------

test('buildMonitorLayout: phase-node count is deterministic regardless of WI count', () => {
  const flow = makeFlow();
  // 0 WIs → dev renders as a phase hex (6 phase nodes)
  const noWi = buildMonitorLayout(flow, makeRun({ workItems: [] }));
  const noWiPhases = noWi.topologyHexes.filter((h) => h.hexKind === 'phase');
  expect(noWiPhases.length).toBe(6);

  // 5 WIs → dev fans out; the 5 OTHER phase nodes remain (architect,pm,unifier,review,reflect)
  const manyWi = buildMonitorLayout(
    flow,
    makeRun({
      workItems: [
        { id: 'WI-1', status: 'complete' },
        { id: 'WI-2', status: 'complete' },
        { id: 'WI-3', status: 'complete' },
        { id: 'WI-4', status: 'active' },
        { id: 'WI-5', status: 'pending' },
      ],
    }),
  );
  const manyWiPhases = manyWi.topologyHexes.filter((h) => h.hexKind === 'phase');
  expect(manyWiPhases.length).toBe(5);
  const manyWiWis = manyWi.topologyHexes.filter((h) => h.hexKind === 'wi');
  expect(manyWiWis.length).toBe(5);
  // harness needs >=5 phase nodes AND >=2 WI nodes simultaneously
  expect(manyWiPhases.length >= 5).toBeTruthy();
  expect(manyWiWis.length >= 2).toBeTruthy();
});

test('buildMonitorLayout: topologyHexes deduplicates phase nodes by nodeId', () => {
  const flow = makeFlow();
  const layout = buildMonitorLayout(flow, makeRun({ workItems: [] }));
  const phaseIds = layout.topologyHexes
    .filter((h) => h.hexKind === 'phase')
    .map((h) => h.nodeId);
  const uniq = new Set(phaseIds);
  expect(phaseIds.length).toBe(uniq.size);
});

// ---------------------------------------------------------------------------
// per-phase cost
// ---------------------------------------------------------------------------

test('buildMonitorLayout: phase hexes carry per-phase cost from phaseMeta', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  const architect = layout.topologyHexes.find((h) => h.nodeId === 'architect');
  expect(architect?.costUsd).toBe(0.46);
  const unifier = layout.topologyHexes.find((h) => h.nodeId === 'unifier');
  expect(unifier?.costUsd).toBe(0.18);
  // at least one phase hex has cost > 0 (the harness expectPhaseCost invariant)
  expect(
    layout.topologyHexes.some((h) => h.hexKind === 'phase' && h.costUsd > 0),
  ).toBeTruthy();
});

// ---------------------------------------------------------------------------
// per-WI cost (plan item 1.4 — data-wi-cost-usd source)
// ---------------------------------------------------------------------------

test('buildMonitorLayout: WI hexes carry per-WI cost from run.workItems[].costUsd', () => {
  const run = makeRun({
    workItems: [
      { id: 'WI-1', status: 'complete', costUsd: 0.62 },
      { id: 'WI-2', status: 'active', costUsd: 0.31 },
    ],
  });
  const layout = buildMonitorLayout(makeFlow(), run);
  const wi1 = layout.topologyHexes.find((h) => h.wiId === 'WI-1');
  const wi2 = layout.topologyHexes.find((h) => h.wiId === 'WI-2');
  expect(wi1?.wiCostUsd).toBeCloseTo(0.62);
  expect(wi2?.wiCostUsd).toBeCloseTo(0.31);
  // phase hexes never carry wiCostUsd; WI hexes keep costUsd=0 (phase semantics)
  expect(
    layout.topologyHexes
      .filter((h) => h.hexKind === 'phase')
      .every((h) => h.wiCostUsd === undefined),
  ).toBeTruthy();
  expect(wi1?.costUsd).toBe(0);
});

test('buildMonitorLayout: WI without a costUsd defaults wiCostUsd to 0', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  const wiHexes = layout.topologyHexes.filter((h) => h.hexKind === 'wi');
  expect(wiHexes.length).toBe(2);
  expect(wiHexes.every((h) => h.wiCostUsd === 0)).toBeTruthy();
});

test('buildMonitorLayout: missing phaseMeta entry → costUsd defaults to 0', () => {
  const run = makeRun({ phaseMeta: {} });
  const layout = buildMonitorLayout(makeFlow(), run);
  expect(
    layout.topologyHexes
      .filter((h) => h.hexKind === 'phase')
      .every((h) => h.costUsd === 0),
  ).toBeTruthy();
});

test('buildMonitorLayout: WI hexes always carry costUsd 0 (per-WI cost untracked)', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  expect(
    layout.topologyHexes.filter((h) => h.hexKind === 'wi').every((h) => h.costUsd === 0),
  ).toBeTruthy();
});

// ---------------------------------------------------------------------------
// fanOut aggregate (dev-loop status + cost remain assertable when WIs present)
// ---------------------------------------------------------------------------

test('buildMonitorLayout: fanOutAggregate carries dev status + cost when WIs present', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  // dev fanned out → no 'phase' hex for it in the render set …
  expect(
    layout.topologyHexes.some((h) => h.nodeId === 'dev' && h.hexKind === 'phase'),
  ).toBe(false);
  // … but its aggregate status + cost are surfaced separately.
  expect(layout.fanOutAggregate).toEqual({
    nodeId: 'dev',
    status: 'active',
    costUsd: 0.92,
  });
});

test('buildMonitorLayout: fanOutAggregate is null when the fanOut node has no WIs', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun({ workItems: [] }));
  // no fanOut → dev renders as an ordinary phase hex; no separate aggregate.
  expect(layout.fanOutAggregate).toBe(null);
  expect(
    layout.topologyHexes.some((h) => h.nodeId === 'dev' && h.hexKind === 'phase'),
  ).toBe(true);
});

test('buildMonitorLayout: fanOutAggregate cost defaults to 0 when phaseMeta missing', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun({ phaseMeta: {} }));
  expect(layout.fanOutAggregate?.costUsd).toBe(0);
  expect(layout.fanOutAggregate?.nodeId).toBe('dev');
});

// ---------------------------------------------------------------------------
// edges — fanOut reroutes the dev pulse onto the WI hexes (#11)
// ---------------------------------------------------------------------------

test('buildMonitorLayout: no fanOut WIs → flow edges pass through unchanged, resolve by nodeId', () => {
  const flow = makeFlow();
  const layout = buildMonitorLayout(flow, makeRun({ workItems: [] }));
  expect(layout.edges).toEqual(flow.edges);
  for (const e of layout.edges) {
    expect(layout.hexes.some((h) => h.nodeId === e.from)).toBeTruthy();
    expect(layout.hexes.some((h) => h.nodeId === e.to)).toBeTruthy();
  }
});

test('buildMonitorLayout: independent WIs → PM pulse fans to each WI; each WI feeds the unifier (#11)', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun()); // WI-1, WI-2, no deps
  // no edge points at the collapsed fanOut node …
  expect(layout.edges.some((e) => e.from === 'dev' || e.to === 'dev')).toBeFalsy();
  // … the PM pulse fans into each root WI …
  expect(layout.edges.some((e) => e.from === 'pm' && e.to === 'WI-1')).toBeTruthy();
  expect(layout.edges.some((e) => e.from === 'pm' && e.to === 'WI-2')).toBeTruthy();
  // … and each leaf WI feeds the unifier.
  expect(layout.edges.some((e) => e.from === 'WI-1' && e.to === 'unifier')).toBeTruthy();
  expect(layout.edges.some((e) => e.from === 'WI-2' && e.to === 'unifier')).toBeTruthy();
  // every edge endpoint resolves to a hex by wiId or nodeId
  for (const e of layout.edges) {
    expect(layout.hexes.some((h) => h.wiId === e.from || h.nodeId === e.from)).toBeTruthy();
    expect(layout.hexes.some((h) => h.wiId === e.to || h.nodeId === e.to)).toBeTruthy();
  }
});

test('buildMonitorLayout: WI deps are carried on the hex (data-wi-deps); pulse follows the DAG (#11)', () => {
  const run = makeRun({
    workItems: [
      { id: 'WI-1', status: 'complete' },
      { id: 'WI-2', status: 'active', dependsOn: ['WI-1'] },
    ],
  });
  const layout = buildMonitorLayout(makeFlow(), run);
  // dependency is surfaced on the WI hex (rendered as data-wi-deps), not as a
  // cross-stack edge between the same-column WI hexes
  const wi2 = layout.hexes.find((h) => h.wiId === 'WI-2');
  expect(wi2?.dependsOn).toEqual(['WI-1']);
  expect(layout.edges.some((e) => e.from === 'WI-1' && e.to === 'WI-2')).toBeFalsy();
  // pulse follows the DAG: root WI-1 takes the PM pulse; WI-2 (has a dep) does NOT
  expect(layout.edges.some((e) => e.from === 'pm' && e.to === 'WI-1')).toBeTruthy();
  expect(layout.edges.some((e) => e.from === 'pm' && e.to === 'WI-2')).toBeFalsy();
  // leaf WI-2 feeds the unifier; WI-1 (has a dependent) does NOT
  expect(layout.edges.some((e) => e.from === 'WI-2' && e.to === 'unifier')).toBeTruthy();
  expect(layout.edges.some((e) => e.from === 'WI-1' && e.to === 'unifier')).toBeFalsy();
});

// ---------------------------------------------------------------------------
// hexBounds — tight bounding box over topologyHexes (fix 1)
// ---------------------------------------------------------------------------

test('buildMonitorLayout: hexBounds wraps topologyHexes tightly', () => {
  const layout = buildMonitorLayout(makeFlow(), makeRun());
  const { hexBounds, topologyHexes } = layout;
  expect(hexBounds).toBeDefined();

  const xs = topologyHexes.map((h) => h.x);
  const ys = topologyHexes.map((h) => h.y);
  expect(hexBounds.minX).toBe(Math.min(...xs));
  expect(hexBounds.maxX).toBe(Math.max(...xs));
  expect(hexBounds.minY).toBe(Math.min(...ys));
  expect(hexBounds.maxY).toBe(Math.max(...ys));
});

test('buildMonitorLayout: hexBounds is zeroed when there are no hexes', () => {
  const emptyFlow = {
    id: 'empty',
    name: 'Empty',
    goal: '',
    nodes: [],
    edges: [],
    triggers: [],
  } as unknown as Flow;
  const layout = buildMonitorLayout(emptyFlow, null);
  expect(layout.hexBounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
});

// ---------------------------------------------------------------------------
// null run + empty flow
// ---------------------------------------------------------------------------

test('buildMonitorLayout: null run → all phase hexes pending, cost 0', () => {
  const layout = buildMonitorLayout(makeFlow(), null);
  const phaseHexes = layout.topologyHexes.filter((h) => h.hexKind === 'phase');
  expect(phaseHexes.length).toBe(6);
  expect(phaseHexes.every((h) => h.status === 'pending')).toBeTruthy();
  expect(phaseHexes.every((h) => h.costUsd === 0)).toBeTruthy();
});

test('buildMonitorLayout: gated/failed node flags propagate to the phase hex', () => {
  const run = makeRun({ gate: 'review', failedAt: 'unifier', workItems: [] });
  const layout = buildMonitorLayout(makeFlow(), run);
  const review = layout.topologyHexes.find((h) => h.nodeId === 'review');
  const unifier = layout.topologyHexes.find((h) => h.nodeId === 'unifier');
  expect(review?.isGated).toBe(true);
  expect(unifier?.isFailed).toBe(true);
});

// ---------------------------------------------------------------------------
// S9: run-driven WI fan-out (the forge-develop dev node carries no fanOut flag)
// ---------------------------------------------------------------------------

test('buildMonitorLayout: the dev node fans out RUN-DRIVEN when it has no fanOut flag (S9 develop slice)', () => {
  // The forge-develop `dev` node is the flow's entry node, so the lint rule forbids
  // an authoring `fanOut` flag — but the dev-loop still fanned out at runtime. The
  // monitor identifies the dev-loop node by its agent (developer-ralph) and expands
  // it from run.workItems.
  const developFlow: Flow = {
    id: 'forge-develop', name: 'Forge Develop', goal: 'build',
    nodes: [
      { id: 'dev', agent: 'developer-ralph' }, // NO fanOut flag
      { id: 'unifier', agent: 'developer-unifier' },
      { id: 'review', gate: 'verdict' },
    ],
    edges: [
      { from: 'dev', to: 'unifier', artifact: 'wi-branches' },
      { from: 'unifier', to: 'review', artifact: 'pr' },
    ],
    triggers: [],
  };
  const run = makeRun({
    flowId: 'forge-develop',
    phases: { dev: 'complete', unifier: 'complete', review: 'complete' },
    workItems: [
      { id: 'WI-1', status: 'complete' }, { id: 'WI-2', status: 'complete' },
      { id: 'WI-3', status: 'complete' }, { id: 'WI-4', status: 'complete' },
    ],
  });
  const layout = buildMonitorLayout(developFlow, run);
  expect(layout.topologyHexes.filter((h) => h.hexKind === 'wi').map((h) => h.wiId)).toEqual(['WI-1', 'WI-2', 'WI-3', 'WI-4']);
  expect(layout.topologyHexes.filter((h) => h.hexKind === 'phase').map((h) => h.nodeId)).toEqual(['unifier', 'review']);
  expect(layout.fanOutAggregate?.nodeId).toBe('dev');
});

test('buildMonitorLayout: a flow with no dev-loop node never fans out, even with run.workItems (S9 architect slice)', () => {
  // /flows/forge-architect renders the SAME threaded run (via lineage), but its nodes
  // are architect+pm — no dev-loop node, so no WI fan-out here.
  const architectFlow: Flow = {
    id: 'forge-architect', name: 'Forge Architect', goal: 'decompose',
    nodes: [ { id: 'architect', agent: 'architect' }, { id: 'pm', agent: 'project-manager' } ],
    edges: [ { from: 'architect', to: 'pm', artifact: 'plan' } ],
    triggers: [],
  };
  const run = makeRun({ phases: { architect: 'complete', pm: 'complete' }, workItems: [ { id: 'WI-1', status: 'complete' } ] });
  const layout = buildMonitorLayout(architectFlow, run);
  expect(layout.topologyHexes.filter((h) => h.hexKind === 'wi')).toHaveLength(0);
  expect(layout.topologyHexes.map((h) => h.nodeId)).toEqual(['architect', 'pm']);
});
