/**
 * W7-B6 review F5 — cycle-cost fetch-plan pins.
 *
 * Killed implementation: a fetchCycleCostMap that fired one
 * GET /api/cost/<cycleId> per project cycle on EVERY cycles refresh
 * (refreshRoadmap runs after each dispatch and save — 80 cycles meant 80
 * simultaneous bridge requests, each re-deriving a summary from events.jsonl,
 * for totals that cannot change once a cycle is terminal).
 *
 * RUN: npx vitest run lib/cycle-cost-cache.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';

import { planCycleCostFetch, COST_TERMINAL_CYCLE_STATUSES } from './cycle-cost-cache';

const c = (cycleId: string, status: string) => ({ cycleId, status });

test('planCycleCostFetch: resolved TERMINAL costs are reused; live cycles always refetch', () => {
  const prev = { 'cyc-done': 1.25, 'cyc-live': 0.4 };
  const plan = planCycleCostFetch([c('cyc-done', 'done'), c('cyc-live', 'in-flight')], prev);
  expect(plan.reused).toEqual({ 'cyc-done': 1.25 });
  expect(plan.toFetch).toEqual(['cyc-live']);
});

test('planCycleCostFetch: an UNRESOLVED terminal cost (first sight, or a prior failed fetch recorded as null) is fetched — null is not a cacheable answer', () => {
  const plan = planCycleCostFetch(
    [c('cyc-new', 'done'), c('cyc-nullcost', 'failed')],
    { 'cyc-nullcost': null },
  );
  expect(plan.reused).toEqual({});
  expect(plan.toFetch).toEqual(['cyc-new', 'cyc-nullcost']);
});

test('planCycleCostFetch: ready-for-review is NOT terminal (verdict-approve finalize/merge can still spend); merged/done/failed are', () => {
  expect(COST_TERMINAL_CYCLE_STATUSES.has('ready-for-review')).toBe(false);
  expect(COST_TERMINAL_CYCLE_STATUSES.has('pending')).toBe(false);
  expect(COST_TERMINAL_CYCLE_STATUSES.has('in-flight')).toBe(false);
  for (const s of ['merged', 'done', 'failed']) expect(COST_TERMINAL_CYCLE_STATUSES.has(s)).toBe(true);
  const plan = planCycleCostFetch([c('cyc-rfr', 'ready-for-review')], { 'cyc-rfr': 2.0 });
  expect(plan.toFetch).toEqual(['cyc-rfr']);
});

test('planCycleCostFetch: a full second pass over an all-terminal, all-resolved ledger fetches NOTHING', () => {
  const cycles = [c('a', 'done'), c('b', 'merged'), c('e', 'failed')];
  const prev = { a: 1, b: 2, e: 3 };
  const plan = planCycleCostFetch(cycles, prev);
  expect(plan.toFetch).toEqual([]);
  expect(plan.reused).toEqual(prev);
});
