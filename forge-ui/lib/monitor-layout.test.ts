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
 *  - edges unaffected by fanOut expansion (resolve by nodeId)
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
// edges unaffected by fanOut expansion
// ---------------------------------------------------------------------------

test('buildMonitorLayout: edges pass through unchanged and resolve by nodeId', () => {
  const flow = makeFlow();
  const layout = buildMonitorLayout(flow, makeRun());
  expect(layout.edges).toEqual(flow.edges);
  // every edge endpoint resolves to at least one hex (fanOut expands to multiple)
  for (const e of layout.edges) {
    expect(layout.hexes.some((h) => h.nodeId === e.from)).toBeTruthy();
    expect(layout.hexes.some((h) => h.nodeId === e.to)).toBeTruthy();
  }
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
