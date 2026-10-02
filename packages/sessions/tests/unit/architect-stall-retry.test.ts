/**
 * Row 193 (T1 ruling 1973fy) — the architect's structured turn honours the
 * stream-deadline's own "transient; routes to auto-retry" with ONE bounded
 * re-run of the same turn.
 *
 * MEASURED, NOT ASSUMED: row 6 run 6, story S10 beat 30. ACT 2's architect
 * session 2026-10-02T20-56-58-7c0d2d53 saw `system×12, rate_limit_event×1`
 * and not one assistant message for 360s, threw `StreamDeadlineError` out of
 * `runStructuredTurn` (stderr.log stack: withIdleDeadline → runStructuredTurn
 * → runStructured → runInterviewStep), and the session went `failed`.
 * Nothing re-dispatched it: the retry the message promises lives in the
 * CYCLE paths (`developer-loop.ts` F-44/G3 crash retry, `scheduler-dispatch.ts`
 * F-27) and in `verify-cycle.mjs`'s harness (`scripts/lib/architect-retry.mjs`)
 * — never in the interactive architect session kind the Studio drives.
 *
 * The first stream below is that capture's shape replayed message-for-message;
 * the pins advance the real 6-minute window with mocked timers, at $0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runStructured } from '../../kinds/architect-structured-turn.ts';

const SIX_MINUTES_MS = 360_000;

/** The S10 beat-30 capture: 12 `system` rows and one `rate_limit_event`, no
 *  assistant message, then silence that never ends. */
function capturedStall(): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 12; i += 1) yield { type: 'system', subtype: i === 0 ? 'init' : 'api_retry' };
      yield { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } };
      await new Promise<never>(() => {});
    },
  };
}

function pricedResult(): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'result', structured_output: { done: true, questions: [] }, total_cost_usd: 0.42 };
    },
  };
}

type Row = { event_type?: string; message?: string; cost_usd?: number; metadata?: Record<string, unknown> };

function harness(streams: Array<() => AsyncIterable<unknown>>) {
  const rows: Row[] = [];
  let calls = 0;
  const logger = { emit: (e: Row) => { rows.push(e); return { ...e, event_id: `EV_${rows.length}` }; } };
  const queryFn = () => {
    const make = streams[Math.min(calls, streams.length - 1)];
    calls += 1;
    return make();
  };
  const turn = runStructured<{ done?: boolean }>({
    queryFn: queryFn as never,
    prompt: 'interview',
    schema: { type: 'object' },
    logger: logger as never,
    initiativeId: 'architect-session-sess-1',
    cwd: process.cwd(),
  });
  const settled: { rejected?: unknown; resolved?: { output: { done?: boolean } | null } } = {};
  void turn.then((v) => { settled.resolved = v; }, (e) => { settled.rejected = e; });
  return { rows, settled, calls: () => calls };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

test('row 193 (a) the S10 beat-30 stall re-runs the SAME turn once, and the retry\'s result is the turn\'s result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = harness([capturedStall, pricedResult]);
    await drain();
    t.mock.timers.tick(SIX_MINUTES_MS + 1_000);
    await drain();

    assert.equal(h.settled.rejected, undefined, `the stall must not fail the turn: ${String(h.settled.rejected)}`);
    assert.deepEqual(h.settled.resolved?.output, { done: true, questions: [] });
    assert.equal(h.calls(), 2, 'exactly one re-run of the turn');

    const retry = h.rows.find((r) => r.message === 'architect.turn-stall-retry');
    assert.ok(retry, `a retry must leave a row naming itself — rows: ${h.rows.map((r) => r.message).join(', ')}`);
    assert.equal(retry.event_type, 'log');
    assert.equal(retry.metadata?.['crash_class'], 'transient', 'classifyCrash\'s own verdict, recorded');
    assert.equal(retry.metadata?.['non_progress'], 'system×12, rate_limit_event×1', 'the capture\'s summary, carried verbatim');

    // The stalled attempt is STILL an unpriced row — the retry does not erase
    // it, because nothing priced that attempt (row 184 / item 76).
    const unpriced = h.rows.filter((r) => r.message === 'architect.turn-ended-unpriced');
    assert.equal(unpriced.length, 1);
    assert.equal(unpriced[0].metadata?.['unpriced_reason'], 'abort');
    const priced = h.rows.filter((r) => r.message === 'architect.turn-cost');
    assert.equal(priced.length, 1);
    assert.equal(priced[0].cost_usd, 0.42);
  } finally {
    t.mock.timers.reset();
  }
});

test('row 193 (b) a second stall is NOT retried again — bounded to one re-run, and the deadline error surfaces', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = harness([capturedStall, capturedStall, pricedResult]);
    await drain();
    t.mock.timers.tick(SIX_MINUTES_MS + 1_000);
    await drain();
    t.mock.timers.tick(SIX_MINUTES_MS + 1_000);
    await drain();

    const err = h.settled.rejected as Error | undefined;
    assert.equal(err?.name, 'StreamDeadlineError', `expected the second stall to fail the turn, got ${String(err)}`);
    assert.equal(h.calls(), 2, 'a third attempt must never start');
    assert.equal(h.rows.filter((r) => r.message === 'architect.turn-stall-retry').length, 1);
    assert.equal(h.rows.filter((r) => r.message === 'architect.turn-ended-unpriced').length, 2,
      'each stalled attempt leaves its own unpriced row');
  } finally {
    t.mock.timers.reset();
  }
});

test('row 193 (c) a turn that dies of anything else is NOT retried', async () => {
  const boom = (): AsyncIterable<unknown> => ({
    async *[Symbol.asyncIterator]() { throw new Error('rate_limit_error: 429'); },
  });
  const h = harness([boom, pricedResult]);
  await drain();
  const err = h.settled.rejected as Error | undefined;
  assert.match(String(err?.message), /429/);
  assert.equal(h.calls(), 1, 'only the stream-deadline stall the message names is retried here');
  assert.equal(h.rows.filter((r) => r.message === 'architect.turn-stall-retry').length, 0);
});
