import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fireFlowTriggers,
  SHIPPED_TRIGGER_KIND_IDS,
  TRIGGER_KIND_IDS,
  TRIGGER_KINDS,
  type FlowTriggerEvent,
} from '../../flow-trigger.ts';
import type { FlowTrigger } from '@forge/contracts/studio/types.ts';

function flow(triggers: FlowTrigger[]): { id: string; triggers: FlowTrigger[] } {
  return { id: 'forge-develop', triggers };
}

function t(on: string, ref: string): FlowTrigger {
  return { on, target: { kind: 'flow', ref } };
}

test('fires only the triggers whose `on` matches the event', async () => {
  const dispatched: Array<{ ref: string; event: FlowTriggerEvent }> = [];
  const fired = await fireFlowTriggers(
    flow([t('merged', 'retro-flow'), t('flow-complete', 'other-flow')]),
    'merged',
    { dispatch: (tr, event) => { dispatched.push({ ref: tr.target.ref, event }); } },
  );

  assert.deepEqual(fired, [t('merged', 'retro-flow')]);
  assert.deepEqual(dispatched, [{ ref: 'retro-flow', event: 'merged' }]);
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
    flow([t('merged', 'retro-flow')]),
    'merged',
    {
      onFire: (tr) => { seen.push(`fire:${tr.target.ref}`); },
      dispatch: (tr) => { seen.push(`dispatch:${tr.target.ref}`); },
    },
  );
  assert.deepEqual(seen, ['fire:retro-flow', 'dispatch:retro-flow']);
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

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (forge-f9g fix, W8-A1) — the fire-time project-scope gate.
// `fireFlowTriggers` is the SAME function driving BOTH the flow-runner's
// `flow-complete` staging path AND finalize-merged's inline `on: merged`
// dispatch. Gating is opt-in via the PRESENCE of `eventProject` on the deps
// object (not its value) — a caller that never mentions the key gets today's
// unconditional-dispatch behaviour, unaffected. See flow-trigger.ts's
// `FireFlowTriggersDeps.eventProject` doc for the full rationale (the
// flow-runner's own `flow-complete` firing site deliberately never opts in,
// preserving T1's round-4 ruling pinned in flow-runner.test.ts).
// ---------------------------------------------------------------------------

function scopedTrigger(on: string, ref: string, projects: string[] | undefined): FlowTrigger {
  return { on, target: { kind: 'flow', ref }, ...(projects !== undefined ? { projects } : {}) } as FlowTrigger;
}

test('(RED) [forge-f9g] a scoped on:merged trigger fires when the event project is a declared member', async () => {
  const dispatched: string[] = [];
  const fired = await fireFlowTriggers(
    flow([scopedTrigger('merged', 'reflect', ['a'])]),
    'merged',
    { dispatch: (tr) => { dispatched.push(tr.target.ref); }, eventProject: 'a' },
  );
  assert.deepEqual(dispatched, ['reflect']);
  assert.equal(fired.length, 1);
});

test('(RED) [forge-f9g] a scoped on:merged trigger does NOT fire for an out-of-scope event project, and the skip is observable with a reason', async () => {
  const dispatched: string[] = [];
  const skips: Array<{ ref: string; reason: string }> = [];
  const fired = await fireFlowTriggers(
    flow([scopedTrigger('merged', 'reflect', ['a'])]),
    'merged',
    {
      dispatch: (tr) => { dispatched.push(tr.target.ref); },
      eventProject: 'b',
      onSkip: (tr, reason) => { skips.push({ ref: tr.target.ref, reason }); },
    },
  );
  assert.deepEqual(dispatched, [], 'out-of-scope trigger must not dispatch');
  assert.deepEqual(fired, [], 'out-of-scope trigger must not be pushed onto fired');
  assert.equal(skips.length, 1, 'the skip must be observable via onSkip');
  assert.equal(skips[0].ref, 'reflect');
  assert.ok(skips[0].reason.length > 0, 'the skip must carry a non-empty reason');
});

test('(RED) [forge-f9g] an unresolved event project against a declared scope fails closed (no dispatch)', async () => {
  const dispatched: string[] = [];
  const skips: string[] = [];
  await fireFlowTriggers(
    flow([scopedTrigger('merged', 'reflect', ['a'])]),
    'merged',
    {
      dispatch: (tr) => { dispatched.push(tr.target.ref); },
      eventProject: undefined,
      onSkip: (tr) => { skips.push(tr.target.ref); },
    },
  );
  assert.deepEqual(dispatched, [], 'an unresolved event project must never dispatch a declared scope');
  assert.deepEqual(skips, ['reflect']);
});

test('(RED) [forge-f9g] projects: [] never fires regardless of the event project', async () => {
  const dispatched: string[] = [];
  await fireFlowTriggers(
    flow([scopedTrigger('merged', 'reflect', [])]),
    'merged',
    { dispatch: (tr) => { dispatched.push(tr.target.ref); }, eventProject: 'a' },
  );
  assert.deepEqual(dispatched, [], 'projects: [] is a declared scope of nothing — must never dispatch');
});

test('(green-on-arrival) [forge-f9g] no projects: declared → dispatches regardless of eventProject (no-regression control)', async () => {
  const dispatched: string[] = [];
  await fireFlowTriggers(
    flow([scopedTrigger('merged', 'reflect', undefined)]),
    'merged',
    { dispatch: (tr) => { dispatched.push(tr.target.ref); }, eventProject: 'anything' },
  );
  assert.deepEqual(dispatched, ['reflect'], 'an unscoped trigger must dispatch regardless of the event project');
});

test('(green-on-arrival) [forge-f9g] a caller that never mentions eventProject gets NO fire-time gating — every matching trigger dispatches unconditionally, even a scoped one (the flow-runner flow-complete contract)', async () => {
  const dispatched: string[] = [];
  await fireFlowTriggers(
    flow([scopedTrigger('flow-complete', 'downstream', [])]),
    'flow-complete',
    { dispatch: (tr) => { dispatched.push(tr.target.ref); } },
  );
  assert.deepEqual(
    dispatched,
    ['downstream'],
    'omitting eventProject entirely must opt OUT of fire-time gating — this is the flow-runner\'s flow-complete contract (T1 round-4 ruling): scope is enforced only at drainFlowRunRequests for that path',
  );
});
