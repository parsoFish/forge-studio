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

test('ADR-041 registry: nine kinds, reserved rows have no runtime, merged is an OOTB row', () => {
  // T1 ruling (R2-08-F2 pin review, reapplied for R2-08-F3): this exact-array
  // assertion pins the CURRENT full kind enumeration. T1 explicitly ruled that
  // the T3 test-writer amends this ONE pre-existing test itself (the
  // implementer must not — see this WI's immutable-gates contract) each time
  // a new registry row lands. R2-08-F3 adds 'pr-merged'/'issue-raised' —
  // pinned immediately after 'merged' (grouping the OOTB domain-event rows
  // together, mirroring how 'merged' itself already sits after the two
  // platform lifecycle rows). This exact insertion point is a REASONABLE
  // forward pin, not a load-bearing design fact — renegotiate with T1 if the
  // implementer lands them elsewhere in TRIGGER_KINDS.
  assert.deepEqual(
    [...TRIGGER_KIND_IDS],
    ['flow-complete', 'agent-complete', 'merged', 'pr-merged', 'issue-raised', 'manual', 'cron', 'webhook', 'feed'],
  );
  assert.deepEqual(
    [...SHIPPED_TRIGGER_KIND_IDS],
    ['flow-complete', 'agent-complete', 'merged', 'pr-merged', 'issue-raised', 'cron', 'webhook'],
  );
  const merged = TRIGGER_KINDS.find((k) => k.id === 'merged');
  assert.equal(merged?.origin, 'ootb', 'merged is a domain-event row the OOTB suite contributes, not a platform literal');
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (T3, R2-08-F3 #1) — pr-merged / issue-raised flip
// reserved → shipped, origin ootb (project-event kinds over the existing
// webhook receiver). Mirrors the F2 pin for agent-complete immediately below.
// ---------------------------------------------------------------------------

test('(RED) [F3 #1] pr-merged and issue-raised TRIGGER_KINDS rows are shipped, origin ootb — kills leaving them registry-only stubs', () => {
  for (const id of ['pr-merged', 'issue-raised']) {
    const row = TRIGGER_KINDS.find((k) => k.id === id);
    assert.ok(row, `expected a "${id}" row in TRIGGER_KINDS`);
    assert.equal(
      row!.status,
      'shipped',
      `expected "${id}"'s status to be "shipped" (ADR-027's R2-08-F3: project-event kinds over the existing webhook receiver) — got "${row!.status}"`,
    );
    assert.equal(
      row!.origin,
      'ootb',
      `expected "${id}"'s origin to be "ootb" — a domain event the OOTB suite contributes, like "merged", never a platform literal — got "${row!.origin}"`,
    );
  }
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
