/**
 * Tests for `resolveFlowViewState` — the flow-switch staleness guard.
 *
 * Bug: /flows/[id]/page.tsx keys its data-loading effect on the route `id`,
 * but `flow`/`runs`/`activeRun`/`ready` are plain useState values updated
 * asynchronously by `loadData()`. Between the route `id` changing and that
 * async call resolving, the page would render the PREVIOUS flow's run-model
 * state (stale hex statuses, wrong node set) under the NEW flow's identity —
 * the reported flicker. `resolveFlowViewState` is the pure derivation the
 * page calls on every render so the mismatched window renders a clean
 * loading state instead of stale data.
 */
import { test, expect } from 'vitest';
import { resolveFlowViewState, type FlowViewState } from './flow-view-state.ts';
import type { Flow, Run } from './studio-client.ts';

function makeFlow(id: string): Flow {
  return { id, name: id, goal: '', nodes: [], edges: [], triggers: [] };
}

function makeRun(id: string, flowId: string): Run {
  return {
    id,
    flowId,
    initiativeId: id,
    initiative: id,
    status: 'active',
    origin: 'architect',
    costUsd: 0,
    phases: { dev: 'active' },
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: [flowId],
  };
}

const LOADING: FlowViewState = { flow: null, runs: [], activeRun: null, ready: false };

test('no flow loaded yet (initial mount) — passes state through unchanged', () => {
  const result = resolveFlowViewState('forge-develop', LOADING);
  expect(result).toEqual(LOADING);
});

test('loaded flow matches the requested id — passes state through unchanged', () => {
  const flow = makeFlow('forge-develop');
  const run = makeRun('cycle-1', 'forge-develop');
  const state: FlowViewState = { flow, runs: [run], activeRun: run, ready: true };

  const result = resolveFlowViewState('forge-develop', state);

  expect(result).toEqual(state);
  expect(result.activeRun).toBe(run); // same reference — no unnecessary copy
});

test('flow switch in flight — stale flow/runs/activeRun reset instead of flashing', () => {
  // Operator was on forge-architect (loaded, with an active run) and just
  // navigated to forge-develop; the new loadData() has not resolved yet.
  const staleFlow = makeFlow('forge-architect');
  const staleRun = makeRun('cycle-old', 'forge-architect');
  const state: FlowViewState = {
    flow: staleFlow,
    runs: [staleRun],
    activeRun: staleRun,
    ready: true,
  };

  const result = resolveFlowViewState('forge-develop', state);

  expect(result).toEqual(LOADING);
  expect(result.flow).toBeNull();
  expect(result.activeRun).toBeNull();
  expect(result.runs).toEqual([]);
  expect(result.ready).toBe(false);
});

test('flow switch reset does not mutate the input state object', () => {
  const staleFlow = makeFlow('forge-architect');
  const staleRun = makeRun('cycle-old', 'forge-architect');
  const state: FlowViewState = {
    flow: staleFlow,
    runs: [staleRun],
    activeRun: staleRun,
    ready: true,
  };
  const snapshot = { ...state };

  resolveFlowViewState('forge-develop', state);

  expect(state).toEqual(snapshot);
});

test('flow becomes "not found" for a different id after a switch — no stale runs carried over', () => {
  // Loaded flow A with runs, navigate to an id with no matching flow at all.
  const staleFlow = makeFlow('forge-architect');
  const staleRun = makeRun('cycle-old', 'forge-architect');
  const state: FlowViewState = {
    flow: staleFlow,
    runs: [staleRun],
    activeRun: staleRun,
    ready: true,
  };

  const result = resolveFlowViewState('does-not-exist', state);

  expect(result.runs).toEqual([]);
  expect(result.activeRun).toBeNull();
});
