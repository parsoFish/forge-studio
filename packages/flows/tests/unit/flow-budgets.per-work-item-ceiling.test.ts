/**
 * Spec §5 item 7, ruling 257 — the per-WI check CONSUMES `spentByWorkItem`,
 * and the architect's spend is in the cycle total.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per test. Before this
 * file, `spentByWorkItem` was computed, documented in nine comment lines and
 * exposed as a public getter with ZERO production readers, while
 * `stopReasonBeforeNextWorkItem()` tested only the cycle total — declared data
 * enforced nowhere, the campaign's recurring shape. Each direction of ruling
 * 257 gets its own pin: a WI over its ceiling while the cycle is under stops,
 * and the cycle over while the WI is under stops.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECT_SPEND_KEY, CostTracker, PER_WORK_ITEM_CEILING_SHARE } from '../../flow-budgets.ts';

function stubLogger() {
  const emitted: any[] = [];
  return { emitted, cycleId: 'test', emit(p: any) { emitted.push(p); return { ...p, event_id: `e${emitted.length}` }; } };
}

/** One authoritative cost-bearing event for `wi`, on a phase that never latches. */
function wiCost(wi: string, costUsd: number) {
  return {
    event_id: `x-${wi}-${costUsd}`,
    initiative_id: 'i',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'iteration',
    message: 'ralph.iteration',
    cost_usd: costUsd,
    metadata: { work_item_id: wi },
  } as any;
}

// A $10 cycle ceiling: the per-WI ceiling is the declared SHARE of it, so the
// two limits are exercised independently rather than one implying the other.
const CYCLE = 10;
const PER_WI = PER_WORK_ITEM_CEILING_SHARE * CYCLE;

test('kills "the per-WI ceiling is the cycle ceiling": a WI over ITS ceiling stops while the cycle is still under', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: CYCLE, initiativeId: 'i', logger: logger as any });
  t.noteEvent(wiCost('WI-1', PER_WI + 0.01));

  assert.ok(t.totalSpentUsd < CYCLE, 'precondition: the CYCLE ceiling is not breached');
  const reason = t.stopReasonBeforeNextWorkItem('WI-1');
  assert.ok(reason && /cost-ceiling/.test(reason), `WI-1 is over its own ceiling and must be stopped, got ${reason}`);
  assert.ok(/WI-1/.test(reason!), 'the reason must name the work item whose ceiling fired');
  const stop = logger.emitted.find((e) => e.message === 'flow.cost-ceiling-stop');
  assert.ok(stop, 'the breach must be evented where it is detected');
  assert.equal(stop.metadata.limit, 'work-item');
  assert.equal(stop.metadata.work_item_id, 'WI-1');
});

test('kills "one WI over its ceiling stops the whole run": a sibling under its own ceiling is still dispatched', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: CYCLE, initiativeId: 'i', logger: logger as any });
  t.noteEvent(wiCost('WI-1', PER_WI + 0.01));

  assert.ok(t.stopReasonBeforeNextWorkItem('WI-1'), 'precondition: WI-1 is stopped');
  assert.equal(t.stopReasonBeforeNextWorkItem('WI-2'), null, 'WI-2 has spent nothing and the cycle is under its ceiling');
});

test('kills "only the per-WI ceiling is checked": the cycle over its ceiling stops a WI that is under its own', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: CYCLE, initiativeId: 'i', logger: logger as any });
  // Three WIs, each comfortably under the per-WI ceiling, summing over the cycle's.
  t.noteEvent(wiCost('WI-1', PER_WI - 0.5));
  t.noteEvent(wiCost('WI-2', PER_WI - 0.5));
  t.noteEvent(wiCost('WI-3', PER_WI - 0.5));

  assert.ok(t.totalSpentUsd >= CYCLE, 'precondition: the CYCLE ceiling is breached');
  assert.ok((t.spentByWorkItem.get('WI-4') ?? 0) < PER_WI, 'precondition: WI-4 is under its own ceiling');
  const reason = t.stopReasonBeforeNextWorkItem('WI-4');
  assert.ok(reason && /cost-ceiling/.test(reason), `the cycle ceiling must still stop a fresh WI, got ${reason}`);
  const stop = logger.emitted.find((e) => e.message === 'flow.cost-ceiling-stop');
  assert.equal(stop.metadata.limit, 'cycle');
});

test('kills "the stop event floods": each limit events once however many times it is consulted', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: CYCLE, initiativeId: 'i', logger: logger as any });
  t.noteEvent(wiCost('WI-1', PER_WI + 0.01));
  for (let n = 0; n < 4; n += 1) t.stopReasonBeforeNextWorkItem('WI-1');
  assert.equal(logger.emitted.filter((e) => e.message === 'flow.cost-ceiling-stop').length, 1);
});

test('kills "no ceiling means no accounting": with enforcement off, nothing stops and nothing events', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: 0, initiativeId: 'i', logger: logger as any });
  t.noteEvent(wiCost('WI-1', 999));
  assert.equal(t.stopReasonBeforeNextWorkItem('WI-1'), null);
  assert.equal(logger.emitted.filter((e) => e.message === 'flow.cost-ceiling-stop').length, 0);
});

// --------------------------------------------------------------------------
// The architect's spend (ruling 257's greenfield half)
// --------------------------------------------------------------------------

/** The `architect.end` `emitSyntheticArchitectEvents` already emits. */
function architectEnd(costUsd: number) {
  return {
    event_id: 'a-end',
    initiative_id: 'i',
    phase: 'architect',
    skill: 'architect',
    event_type: 'end',
    message: 'architect.end',
    cost_usd: costUsd,
    metadata: {},
  } as any;
}

test('kills "the architect ran for free": its authoritative end lands in the cycle total under the reserved key', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: CYCLE, initiativeId: 'i', logger: logger as any });
  t.noteEvent(architectEnd(2.5));

  assert.equal(t.totalSpentUsd, 2.5, 'the architect is part of what the cycle spent');
  assert.equal(t.spentByWorkItem.get(ARCHITECT_SPEND_KEY), 2.5);
  assert.ok(!t.spentByWorkItem.has(''), 'a pre-WI event must never create an empty-key bucket');
});

test('kills "the architect is a work item": its spend can breach the per-WI ceiling without stopping any WI', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: CYCLE, initiativeId: 'i', logger: logger as any });
  t.noteEvent(architectEnd(PER_WI + 0.01));

  assert.ok((t.spentByWorkItem.get(ARCHITECT_SPEND_KEY) ?? 0) > PER_WI, 'precondition: over what a WI would be allowed');
  assert.ok(t.totalSpentUsd < CYCLE, 'precondition: the cycle is still under its ceiling');
  assert.equal(t.stopReasonBeforeNextWorkItem('WI-1'), null, 'the architect is pre-WI: it is judged by the cycle ceiling alone');
  assert.equal(t.stopReasonBeforeNextWorkItem(ARCHITECT_SPEND_KEY), null, 'the reserved key is not a dispatchable work item');
});

test('kills "the reserved key collides with a real work item id": it cannot be parsed as one', () => {
  assert.ok(!/^WI-\d+$/.test(ARCHITECT_SPEND_KEY), `${ARCHITECT_SPEND_KEY} must not look like a work-item id`);
});
