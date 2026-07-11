/**
 * Phase 4 step 6 — race regression coverage for the concurrent WI
 * dispatcher (`runConcurrentDispatch`).
 *
 * The 2026-07-10 false-total-failure race (closed by Step 3's
 * `settleWiOutcome` / `assertOutcomesSettled` completeness invariant, see
 * `developer-loop.outcomes-map.test.ts`) was a SERIAL bug: an aggregate
 * count read from a partial outcome snapshot. Step 6 reintroduces a NEW
 * surface for the same class of bug — concurrent dispatch — by running
 * multiple WIs' Ralph loops in parallel. These tests prove the scheduler
 * itself never lets an aggregate get derived before every dispatched item
 * has genuinely settled, regardless of completion order/timing, and that at
 * `cap: 1` it reproduces literal serial iteration exactly (the pre-step-6
 * behavior every other developer-loop test still exercises).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runConcurrentDispatch } from './wi-dispatch-scheduler.ts';
import { settleWiOutcome, assertOutcomesSettled, type WiOutcome } from './phases/developer-loop.ts';
import type { WorkItem } from './work-item.ts';

function wi(id: string, dependsOn: string[] = []): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-11-scheduler-fixture',
    status: 'pending',
    depends_on: dependsOn,
    acceptance_criteria: [],
    files_in_scope: [],
    estimated_iterations: 3,
    body: '',
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sequential reference: dispatch `items` one at a time (cap 1, by hand). */
async function runSerialReference<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  dispatch: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    await dispatch(item);
    void idOf; // identity unused — kept for signature symmetry with the scheduler
  }
}

test('runConcurrentDispatch: staggered race (2026-07-10 incident shape) — aggregate is only correct at full settlement', async () => {
  const items = [wi('WI-1'), wi('WI-2'), wi('WI-3')];
  const outcomes = new Map<string, WiOutcome>();
  // Snapshot of `outcomes.size` taken the instant WI-1 (the fast one)
  // settles, BEFORE WI-2/WI-3 (still in flight) have settled — proves the
  // staggering is real, not an artifact of accidental serialization.
  let sizeWhenWi1Settled = -1;

  await runConcurrentDispatch({
    items,
    idOf: (item) => item.work_item_id,
    dependsOn: (item) => item.depends_on,
    cap: 3,
    dispatch: async (item) => {
      if (item.work_item_id === 'WI-1') {
        await sleep(5);
        settleWiOutcome(outcomes, { id: item.work_item_id, status: 'complete', result: null });
        sizeWhenWi1Settled = outcomes.size;
        return;
      }
      // WI-2 / WI-3 are slower — still in flight when WI-1 concludes.
      await sleep(40);
      settleWiOutcome(outcomes, {
        id: item.work_item_id,
        status: item.work_item_id === 'WI-2' ? 'failed' : 'complete',
        result: null,
      });
    },
  });

  // The race shape: WI-1 alone had settled at its own settle time.
  assert.equal(sizeWhenWi1Settled, 1);

  // The aggregate is only ever read here, AFTER runConcurrentDispatch has
  // resolved — i.e. after every item has genuinely settled.
  assertOutcomesSettled(outcomes, items);
  const completeCount = [...outcomes.values()].filter((o) => o.status === 'complete').length;
  assert.equal(completeCount, 2);
  assert.equal(items.length - completeCount, 1);
});

test('runConcurrentDispatch: cap 1 reproduces literal serial dispatch order (byte-identical event sequence)', async () => {
  // A small DAG with siblings at multiple levels so a buggy scheduler could
  // plausibly reorder them: A, B roots; C depends on A; D depends on B, C.
  const items = [wi('A'), wi('B'), wi('C', ['A']), wi('D', ['B', 'C'])];
  const idOf = (item: WorkItem) => item.work_item_id;

  const concurrentEvents: string[] = [];
  const serialEvents: string[] = [];

  const makeDispatch = (sink: string[]) => async (item: WorkItem): Promise<void> => {
    sink.push(`${item.work_item_id}:start`);
    // Deliberately UNEQUAL delays — a resolve-order-driven (rather than
    // FIFO-slot-driven) implementation would reorder these under concurrency,
    // but at cap 1 only one item is ever in flight, so timing must not matter.
    await sleep(item.work_item_id === 'A' ? 15 : 5);
    sink.push(`${item.work_item_id}:end`);
  };

  await runConcurrentDispatch({
    items,
    idOf,
    dependsOn: (item) => item.depends_on,
    cap: 1,
    dispatch: makeDispatch(concurrentEvents),
  });
  await runSerialReference(items, idOf, makeDispatch(serialEvents));

  assert.deepEqual(concurrentEvents, serialEvents);
  assert.deepEqual(concurrentEvents, [
    'A:start', 'A:end',
    'B:start', 'B:end',
    'C:start', 'C:end',
    'D:start', 'D:end',
  ]);
});

test('runConcurrentDispatch: cap 3 diamond (A -> B,C -> D) runs B/C concurrently, D sees a tip containing both', async () => {
  const items = [wi('A'), wi('B', ['A']), wi('C', ['A']), wi('D', ['B', 'C'])];
  const timings: Record<string, { start: number; end: number }> = {};
  // Simulates the cycle branch tip: each item appends its own id once its
  // "merge" lands. A dependent must see every prerequisite already on the
  // tip when it starts — Phase 4 step 5's merge-back ordering, generalized
  // to concurrent dispatch (item 2 of the step 6 plan).
  const tip: string[] = [];

  await runConcurrentDispatch({
    items,
    idOf: (item) => item.work_item_id,
    dependsOn: (item) => item.depends_on,
    cap: 3,
    dispatch: async (item) => {
      const start = Date.now();
      if (item.work_item_id === 'D') {
        // D must only ever be dispatched once both prerequisites are merged.
        assert.ok(tip.includes('B'), 'D dispatched before B reached the tip');
        assert.ok(tip.includes('C'), 'D dispatched before C reached the tip');
      }
      await sleep(item.work_item_id === 'A' ? 5 : item.work_item_id === 'D' ? 5 : 30);
      const end = Date.now();
      timings[item.work_item_id] = { start, end };
      tip.push(item.work_item_id);
    },
  });

  assert.deepEqual(tip.slice(0, 1), ['A']); // A always lands first (sole root)
  assert.deepEqual(new Set(tip.slice(1, 3)), new Set(['B', 'C']));
  assert.equal(tip[3], 'D');

  // B and C genuinely overlapped in wall-clock time (classic interval
  // overlap check) — proves cap 3 actually ran them concurrently, not
  // accidentally serially.
  const b = timings['B']!;
  const c = timings['C']!;
  assert.ok(b.start < c.end && c.start < b.end, `expected B/C to overlap, got B=${JSON.stringify(b)} C=${JSON.stringify(c)}`);
});

test('runConcurrentDispatch: deadlock guard names the stuck items', async () => {
  // A genuine cycle (X <-> Y), both ids present in the item set — never
  // reachable in production (validateWorkItemSet/topologicalOrder catch this
  // upstream), but the scheduler must fail loudly rather than hang if it
  // ever is.
  const items = [wi('X', ['Y']), wi('Y', ['X'])];

  await assert.rejects(
    runConcurrentDispatch({
      items,
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap: 2,
      dispatch: async () => {
        /* unreachable */
      },
    }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /deadlock/i);
      assert.match(err.message, /X/);
      assert.match(err.message, /Y/);
      return true;
    },
  );
});

test('runConcurrentDispatch: double-settle guard survives concurrency (settleWiOutcome never fires twice for the same id)', async () => {
  // Six independent items at cap 4 with deliberately staggered/overlapping
  // delays, so the scheduler's slot-refill logic gets genuinely exercised
  // (multiple concurrent settles racing through Promise.race repeatedly).
  const items = [wi('WI-1'), wi('WI-2'), wi('WI-3'), wi('WI-4'), wi('WI-5'), wi('WI-6')];
  const delays: Record<string, number> = {
    'WI-1': 5, 'WI-2': 25, 'WI-3': 10, 'WI-4': 5, 'WI-5': 20, 'WI-6': 5,
  };
  const outcomes = new Map<string, WiOutcome>();

  await runConcurrentDispatch({
    items,
    idOf: (item) => item.work_item_id,
    dependsOn: (item) => item.depends_on,
    cap: 4,
    dispatch: async (item) => {
      await sleep(delays[item.work_item_id]!);
      // settleWiOutcome hard-throws on a double-settle for the same id — if
      // the scheduler ever dispatched an id twice, this would throw and the
      // whole runConcurrentDispatch call would reject.
      settleWiOutcome(outcomes, { id: item.work_item_id, status: 'complete', result: null });
    },
  });

  assertOutcomesSettled(outcomes, items);
  assert.equal(outcomes.size, items.length);

  // Sanity: the guard itself is still live — a genuine second settle for an
  // already-settled id still throws.
  assert.throws(
    () => settleWiOutcome(outcomes, { id: 'WI-1', status: 'complete', result: null }),
    /settled twice|double-settle/i,
  );
});

test('runConcurrentDispatch: rejects a non-positive/non-finite cap', async () => {
  await assert.rejects(
    runConcurrentDispatch({
      items: [wi('WI-1')],
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap: 0,
      dispatch: async () => {},
    }),
    /cap must be a finite number >= 1/,
  );
});

test('runConcurrentDispatch: a fatal dispatch rejection waits for other in-flight siblings to settle before propagating', async () => {
  // Regression for a review finding on Step 6: a rejecting `dispatch` used
  // to reject `Promise.race` immediately, leaving any OTHER in-flight
  // dispatch promise unawaited — at cap>1 that orphans a genuinely-running
  // sibling task (still mutating whatever shared state its `dispatch`
  // callback touches) with nobody left listening for how it finishes. The
  // fix: on a fatal rejection, `Promise.allSettled` every still in-flight
  // dispatch before re-throwing, so the caller only ever regains control
  // once every dispatched item has genuinely concluded.
  const items = [wi('SLOW'), wi('FATAL')];
  const order: string[] = [];
  let resolveSlow: (() => void) | undefined;
  const slowGate = new Promise<void>((resolve) => {
    resolveSlow = resolve;
  });

  const runPromise = runConcurrentDispatch({
    items,
    idOf: (item) => item.work_item_id,
    dependsOn: (item) => item.depends_on,
    cap: 2,
    dispatch: async (item) => {
      if (item.work_item_id === 'SLOW') {
        await slowGate;
        order.push('SLOW:settled');
        return;
      }
      order.push('FATAL:rejected');
      throw new Error('boom');
    },
  });

  let settled = false;
  runPromise.catch(() => undefined).then(() => {
    settled = true;
  });

  // FATAL rejects almost immediately; SLOW stays gated open. Flush enough
  // microtasks for FATAL's rejection to land without ever resolving SLOW.
  for (let i = 0; i < 5; i++) await Promise.resolve();

  assert.deepEqual(order, ['FATAL:rejected']);
  assert.equal(settled, false, 'must not propagate the fatal rejection while SLOW is still in flight');

  resolveSlow?.();
  await assert.rejects(runPromise, /boom/);
  assert.deepEqual(order, ['FATAL:rejected', 'SLOW:settled']);
});
