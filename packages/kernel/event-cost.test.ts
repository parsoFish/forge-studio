/**
 * Tests for orchestrator/event-cost.ts — the shared cost-summation rule
 * (plan item 1.8). Guards the iteration-vs-restatement distinction so no
 * consumer (metrics aggregate, run-model, node meta, per-WI attribution)
 * ever re-introduces the double/triple-count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phasesWithIterationEvents,
  isAuthoritativeCostEvent,
  sumAuthoritativeCostUsd,
} from './event-cost.ts';
import type { EventLogEntry, Phase } from './logging.ts';

let seq = 0;
function ev(
  phase: string,
  event_type: string,
  opts: { cost_usd?: number; message?: string; work_item_id?: string } = {},
): EventLogEntry {
  seq += 1;
  return {
    event_id: `e-${seq}`,
    cycle_id: 'CYCLE-test',
    initiative_id: 'INIT-test',
    phase: phase as Phase,
    skill: phase,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at: new Date().toISOString(),
    ...(opts.cost_usd !== undefined ? { cost_usd: opts.cost_usd } : {}),
    ...(opts.message !== undefined ? { message: opts.message } : {}),
    ...(opts.work_item_id !== undefined ? { metadata: { work_item_id: opts.work_item_id } } : {}),
  } as EventLogEntry;
}

test('phasesWithIterationEvents: collects only phases that actually iterated', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.5 }),
    ev('developer-loop', 'iteration', { cost_usd: 1.0 }),
    ev('unifier', 'iteration', { cost_usd: 0.2 }),
    ev('reflection', 'end', { cost_usd: 0.1 }),
  ];
  const set = phasesWithIterationEvents(events);
  assert.deepEqual([...set].sort(), ['developer-loop', 'unifier']);
});

test('sumAuthoritativeCostUsd: iteration-loop phase counts only iteration events', () => {
  const events = [
    ev('developer-loop', 'iteration', { cost_usd: 1.0, work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.0, message: 'ralph.end', work_item_id: 'WI-1' }),
    ev('developer-loop', 'end', { cost_usd: 1.0 }), // phase rollup
  ];
  assert.ok(Math.abs(sumAuthoritativeCostUsd(events) - 1.0) < 0.000001);
});

test('sumAuthoritativeCostUsd: non-loop phase counts every event (end + terminal error)', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.5 }),
    ev('architect', 'error', { cost_usd: 0.2 }),
  ];
  assert.ok(Math.abs(sumAuthoritativeCostUsd(events) - 0.7) < 0.000001);
});

test('sumAuthoritativeCostUsd: mixed stream applies the rule per phase', () => {
  const events = [
    ev('project-manager', 'end', { cost_usd: 0.5 }),
    ev('developer-loop', 'iteration', { cost_usd: 1.0 }),
    ev('developer-loop', 'end', { cost_usd: 1.0 }),
    ev('unifier', 'iteration', { cost_usd: 0.25 }),
    ev('unifier', 'end', { cost_usd: 0.25 }),
  ];
  assert.ok(Math.abs(sumAuthoritativeCostUsd(events) - 1.75) < 0.000001);
});

test('isAuthoritativeCostEvent: honors an externally supplied iteration-phase set', () => {
  // A sub-bucket (e.g. one WI's events) may hold no iteration events itself;
  // the caller passes the cycle-wide set so restated 'end' cost stays excluded.
  const iterPhases = new Set(['developer-loop']);
  const restatedEnd = ev('developer-loop', 'end', { cost_usd: 0.2, message: 'ralph.end', work_item_id: 'WI-2' });
  assert.equal(isAuthoritativeCostEvent(restatedEnd, iterPhases), false);
  assert.ok(sumAuthoritativeCostUsd([restatedEnd], iterPhases) === 0);
  // ...while a phase outside the set keeps its end cost.
  const pmEnd = ev('project-manager', 'end', { cost_usd: 0.4 });
  assert.equal(isAuthoritativeCostEvent(pmEnd, iterPhases), true);
});
