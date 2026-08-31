/**
 * Kills: (a) a tracker that sums every cost-bearing event (today's
 * wrapLoggerForCost → $84.08 whole-trace / $80.83 dev-loop-only);
 * (b) a tracker that hard-codes "count iteration events only" (project-manager
 * carries its spend on `error`/`end` and must still be counted);
 * (c) a per-WI attribution that credits the rollup `end` to a work item;
 * (d) a ceiling that can only be consulted at a node boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CostTracker } from './flow-budgets.ts';

const FIXTURE = join(import.meta.dirname, '..', '..', 'orchestrator', 'test-fixtures', 'betterado-2026-08-18-cost-events.jsonl');
const events = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Collects emitted events; returns the same shape EventLogger.emit does. */
function stubLogger() {
  const emitted: any[] = [];
  return { emitted, cycleId: 'test', emit(p: any) { emitted.push(p); return { ...p, event_id: `e${emitted.length}` }; } };
}

test('the real 2026-08-18 betterado trace reports $30.19 authoritative spend, not the $80.83 that stopped the cycle', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: 52, initiativeId: 'INIT-2026-08-14-betterado-gap-registry', logger: logger as any });
  for (const e of events) t.noteEvent(e);
  assert.equal(Number(t.totalSpentUsd.toFixed(4)), 30.1937);
  assert.ok(t.totalSpentUsd < 52, 'the run was under its $52.00 ceiling — the live stop at $80.83 was the triple-count');
  assert.equal(Number(t.remainingUsd.toFixed(4)), Number((52 - 30.1937).toFixed(4)));
});

test('a phase that never emits an iteration event still has every cost-bearing event counted', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: 100, initiativeId: 'i', logger: logger as any });
  for (const e of events.filter((e: any) => e.phase === 'project-manager')) t.noteEvent(e);
  // 3 `error` + 1 `end` = 2.4042 + 0.8454
  assert.equal(Number(t.totalSpentUsd.toFixed(4)), 3.2496);
});

test('per-WI attribution counts only authoritative events and never the phase rollup end', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: 52, initiativeId: 'i', logger: logger as any });
  for (const e of events) t.noteEvent(e);
  const byWi = t.spentByWorkItem;
  const summed = [...byWi.values()].reduce((a, b) => a + b, 0);
  assert.ok(byWi.size >= 5, `expected per-WI attribution for the run's work items, got ${byWi.size}`);
  assert.ok(summed <= Number(t.totalSpentUsd.toFixed(4)) + 1e-9, 'per-WI spend cannot exceed authoritative total');
  assert.ok(!byWi.has(''), 'the rollup end (no work_item_id) must not create an empty-key bucket');
});

test('the ceiling is reportable at a work-item boundary, not only at a node boundary', () => {
  const logger = stubLogger();
  const t = new CostTracker({ ceilingUsd: 5, initiativeId: 'i', logger: logger as any });
  assert.equal(t.stopReasonBeforeNextWorkItem(), null);
  for (const e of events) t.noteEvent(e);
  const reason = t.stopReasonBeforeNextWorkItem();
  assert.ok(reason && /cost-ceiling/.test(reason), `expected a cost-ceiling stop reason, got ${reason}`);
  assert.ok(logger.emitted.some((e) => e.message === 'flow.cost-ceiling-stop'), 'the breach must be evented where it is detected');
});
