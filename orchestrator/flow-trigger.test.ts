import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fireFlowTriggers,
  SHIPPED_TRIGGER_KIND_IDS,
  TRIGGER_KIND_IDS,
  TRIGGER_KINDS,
  type FlowTriggerEvent,
} from './flow-trigger.ts';
import type { FlowTrigger } from './studio/types.ts';

function flow(triggers: FlowTrigger[]): { id: string; triggers: FlowTrigger[] } {
  return { id: 'forge-develop', triggers };
}

function t(on: string, ref: string): FlowTrigger {
  return { on, target: { kind: 'flow', ref } };
}

test('fires only the triggers whose `on` matches the event', async () => {
  const dispatched: Array<{ ref: string; event: FlowTriggerEvent }> = [];
  const fired = await fireFlowTriggers(
    flow([t('merged', 'forge-reflect'), t('flow-complete', 'other-flow')]),
    'merged',
    { dispatch: (tr, event) => { dispatched.push({ ref: tr.target.ref, event }); } },
  );

  assert.deepEqual(fired, [t('merged', 'forge-reflect')]);
  assert.deepEqual(dispatched, [{ ref: 'forge-reflect', event: 'merged' }]);
});

test('no matching trigger → dispatch never called, returns []', async () => {
  let called = false;
  const fired = await fireFlowTriggers(
    flow([t('flow-complete', 'other-flow')]),
    'merged',
    { dispatch: () => { called = true; } },
  );
  assert.equal(called, false);
  assert.deepEqual(fired, []);
});

test('empty triggers → returns [] (the common case)', async () => {
  const fired = await fireFlowTriggers(flow([]), 'merged', { dispatch: () => {} });
  assert.deepEqual(fired, []);
});

test('dispatches every matching trigger in declaration order and awaits async dispatch', async () => {
  const order: string[] = [];
  const fired = await fireFlowTriggers(
    flow([t('flow-complete', 'a'), t('flow-complete', 'b')]),
    'flow-complete',
    {
      dispatch: async (tr) => {
        await Promise.resolve();
        order.push(tr.target.ref);
      },
    },
  );
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(fired.length, 2);
});

test('onFire observability hook runs before each dispatch', async () => {
  const seen: string[] = [];
  await fireFlowTriggers(
    flow([t('merged', 'forge-reflect')]),
    'merged',
    {
      onFire: (tr) => { seen.push(`fire:${tr.target.ref}`); },
      dispatch: (tr) => { seen.push(`dispatch:${tr.target.ref}`); },
    },
  );
  assert.deepEqual(seen, ['fire:forge-reflect', 'dispatch:forge-reflect']);
});

test('ADR-041 registry: seven kinds, reserved rows have no runtime, merged is an OOTB row', () => {
  assert.deepEqual(
    [...TRIGGER_KIND_IDS],
    ['flow-complete', 'agent-complete', 'merged', 'manual', 'cron', 'webhook', 'feed'],
  );
  // T1 ruling (R2-08-F2 pin review): this exact-array assertion originally
  // pinned the pre-F2 shipped set (without 'agent-complete'). T1 explicitly
  // ruled that the T3 test-writer amends this ONE pre-existing test itself
  // (the implementer must not — see this WI's immutable-gates contract) —
  // 'agent-complete' is inserted after 'flow-complete', matching TRIGGER_KINDS'
  // own declaration order, making this RED until F2's registry row ships.
  assert.deepEqual([...SHIPPED_TRIGGER_KIND_IDS], ['flow-complete', 'agent-complete', 'merged', 'cron', 'webhook']);
  const merged = TRIGGER_KINDS.find((k) => k.id === 'merged');
  assert.equal(merged?.origin, 'ootb', 'merged is a domain-event row the OOTB suite contributes, not a platform literal');
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TEST (T3, R2-08-F2) — agent-complete flips reserved → shipped.
// The exact-array assertion above (amended per T1's ruling) already pins
// membership in SHIPPED_TRIGGER_KIND_IDS; this test pins the underlying
// `status` field the array is derived from, a distinct fact.
// ---------------------------------------------------------------------------

test('(RED) [F2 #10] agent-complete TRIGGER_KINDS row is shipped, not reserved', () => {
  const row = TRIGGER_KINDS.find((k) => k.id === 'agent-complete');
  assert.ok(row, 'expected an agent-complete row in TRIGGER_KINDS');
  assert.equal(
    row!.status,
    'shipped',
    `expected agent-complete's status to be "shipped" (ADR-027's R2-08 amendment: "agent-complete (R2-08-F2) likewise flips status: reserved → shipped") — got "${row!.status}"`,
  );
});
