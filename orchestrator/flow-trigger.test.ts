import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fireFlowTriggers, type FlowTriggerEvent } from './flow-trigger.ts';
import type { FlowTrigger } from './studio/types.ts';

function flow(triggers: FlowTrigger[]): { id: string; triggers: FlowTrigger[] } {
  return { id: 'forge-develop', triggers };
}

test('fires only the triggers whose `on` matches the event', async () => {
  const dispatched: Array<{ flow: string; event: FlowTriggerEvent }> = [];
  const fired = await fireFlowTriggers(
    flow([
      { on: 'merged', flow: 'forge-reflect' },
      { on: 'complete', flow: 'other-flow' },
    ]),
    'merged',
    { dispatch: (t, event) => { dispatched.push({ flow: t.flow, event }); } },
  );

  assert.deepEqual(fired, [{ on: 'merged', flow: 'forge-reflect' }]);
  assert.deepEqual(dispatched, [{ flow: 'forge-reflect', event: 'merged' }]);
});

test('no matching trigger → dispatch never called, returns []', async () => {
  let called = false;
  const fired = await fireFlowTriggers(
    flow([{ on: 'complete', flow: 'other-flow' }]),
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
    flow([
      { on: 'complete', flow: 'a' },
      { on: 'complete', flow: 'b' },
    ]),
    'complete',
    {
      dispatch: async (t) => {
        await Promise.resolve();
        order.push(t.flow);
      },
    },
  );
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(fired.length, 2);
});

test('onFire observability hook runs before each dispatch', async () => {
  const seen: string[] = [];
  await fireFlowTriggers(
    flow([{ on: 'merged', flow: 'forge-reflect' }]),
    'merged',
    {
      onFire: (t) => { seen.push(`fire:${t.flow}`); },
      dispatch: (t) => { seen.push(`dispatch:${t.flow}`); },
    },
  );
  assert.deepEqual(seen, ['fire:forge-reflect', 'dispatch:forge-reflect']);
});
