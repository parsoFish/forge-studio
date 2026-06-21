/**
 * Tests for forge-ui/lib/spine-monitor.ts — rendering a threaded spine run as the
 * full lifecycle topology. Runs under the forge-ui Vitest runner.
 *
 * The architect→develop hand-off repoints the manifest flow_id to forge-develop, so
 * the completed threaded run surfaces under /flows/forge-develop. These tests pin
 * that effectiveMonitorFlow then expands the develop flow into the full spine
 * (architect…reflect, with the dev node fanning out into WI hexes), while a plain
 * single-flow run is left untouched.
 */
import { test, expect } from 'vitest';

import { effectiveMonitorFlow, isThreadedSpineRun } from './spine-monitor';
import { buildMonitorLayout } from './monitor-layout';
import type { Flow, Run } from './studio-client';

const developFlow: Flow = {
  id: 'forge-develop',
  name: 'Forge Develop',
  goal: 'build → review → merge',
  nodes: [
    { id: 'dev', agent: 'developer-ralph' },
    { id: 'unifier', agent: 'developer-unifier' },
    { id: 'review', gate: 'verdict' },
  ],
  edges: [
    { from: 'dev', to: 'unifier', artifact: 'wi-branches' },
    { from: 'unifier', to: 'review', artifact: 'pr' },
  ],
  triggers: [],
};

function run(phases: Record<string, string>, workItems?: Run['workItems']): Run {
  return {
    id: 'cid', flowId: 'forge-develop', initiativeId: 'INIT-x', initiative: 'x',
    status: 'complete', origin: 'architect', costUsd: 20, phases: phases as Run['phases'],
    phaseMeta: {}, artifactsReady: {}, workItems,
  };
}

const THREADED = {
  architect: 'complete', pm: 'complete', dev: 'complete',
  unifier: 'complete', review: 'complete', reflect: 'complete',
};

test('isThreadedSpineRun: a develop run that also ran architect/pm/reflect is threaded', () => {
  expect(isThreadedSpineRun(developFlow, run(THREADED))).toBe(true);
});

test('isThreadedSpineRun: a run with only the develop flow phases is NOT threaded', () => {
  expect(isThreadedSpineRun(developFlow, run({ dev: 'complete', unifier: 'complete', review: 'complete' }))).toBe(false);
});

test('isThreadedSpineRun: no run → not threaded', () => {
  expect(isThreadedSpineRun(developFlow, null)).toBe(false);
});

test('effectiveMonitorFlow: a threaded run expands the develop flow into the full spine lifecycle', () => {
  const eff = effectiveMonitorFlow(developFlow, run(THREADED));
  expect(eff.id).toBe('forge-spine');
  expect(eff.nodes.map((n) => n.id)).toEqual(['architect', 'pm', 'dev', 'unifier', 'review', 'reflect']);
  // the dev node fans out (render-time WI hexes), edges chain the lifecycle.
  expect(eff.nodes.find((n) => n.id === 'dev')?.fanOut).toBe('work-items');
  expect(eff.edges).toEqual([
    { from: 'architect', to: 'pm', artifact: 'plan' },
    { from: 'pm', to: 'dev', artifact: 'work-items' },
    { from: 'dev', to: 'unifier', artifact: 'wi-branches' },
    { from: 'unifier', to: 'review', artifact: 'pr' },
    { from: 'review', to: 'reflect', artifact: 'verdict' },
  ]);
});

test('effectiveMonitorFlow: release-bearing run includes the release-finalize hex in order', () => {
  const eff = effectiveMonitorFlow(developFlow, run({ ...THREADED, 'release-finalize': 'complete' }));
  expect(eff.nodes.map((n) => n.id)).toEqual(['architect', 'pm', 'dev', 'unifier', 'review', 'release-finalize', 'reflect']);
});

test('effectiveMonitorFlow: a non-threaded run is returned unchanged', () => {
  const single = run({ dev: 'active' });
  const eff = effectiveMonitorFlow(developFlow, single);
  expect(eff).toBe(developFlow);
});

test('the expanded spine + run.workItems materialises per-WI hexes (the regression the screenshot showed)', () => {
  const wis = [
    { id: 'WI-1', status: 'complete' as const },
    { id: 'WI-2', status: 'complete' as const },
    { id: 'WI-3', status: 'complete' as const },
    { id: 'WI-4', status: 'complete' as const },
  ];
  const eff = effectiveMonitorFlow(developFlow, run(THREADED, wis));
  const layout = buildMonitorLayout(eff, run(THREADED, wis));
  const phaseHexes = layout.topologyHexes.filter((h) => h.hexKind === 'phase').map((h) => h.nodeId);
  const wiHexes = layout.topologyHexes.filter((h) => h.hexKind === 'wi').map((h) => h.wiId);
  // architect, pm, unifier, review, reflect render as phase hexes; dev fans out → its
  // phase hex is replaced by 4 WI hexes (fanOutAggregate carries dev's status/cost).
  expect(phaseHexes).toEqual(['architect', 'pm', 'unifier', 'review', 'reflect']);
  expect(wiHexes).toEqual(['WI-1', 'WI-2', 'WI-3', 'WI-4']);
  expect(layout.fanOutAggregate?.nodeId).toBe('dev');
});
