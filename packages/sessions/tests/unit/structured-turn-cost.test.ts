/**
 * bead forge-8vfn.18 — the architect turn's spend is unmeasurable from artifacts.
 *
 * MEASURED TWICE, on two funded runs. G1 run 3's architect log
 * (`_logs/_architect-2026-09-04T15-24-18-c3590c12/events.jsonl`, 49,735 B) and
 * run 4b's both contain ZERO occurrences of `cost_usd`, so every reported figure
 * for those runs — $6.84 and $8.26 — is the stage-2/3 total with the architect
 * turn missing. Run 4's abort made it sharpest: that run's ENTIRE spend is
 * unmeasurable, because the architect was the only stage that ran.
 *
 * `runStructuredTurn` already consumes the SDK's `result` message — it reads
 * `structured_output` off it and breaks. `total_cost_usd` is on that same
 * message, and the sibling function 380 lines below in this very file reads it
 * (`interactive-session.ts:773`). It was simply dropped on the floor here.
 *
 * The consumer has existed all along too: `architect-session.ts:359` sums
 * `cost_usd` across the session's events. Nothing was ever emitted for it to sum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runStructuredTurn } from '../../interactive-session.ts';

/** A queryFn that replays a fixed SDK message stream. */
function replay(messages: unknown[]) {
  return () => (async function* () { for (const m of messages) yield m; })();
}

const SCHEMA = { type: 'object' };
const BASE = {
  prompt: 'p', schema: SCHEMA, model: 'claude-sonnet-5',
  allowedTools: ['Read'] as const,
};

test('the turn returns the SDK result message\'s total_cost_usd', async () => {
  const r = await runStructuredTurn<{ ok: boolean }>({
    ...BASE,
    queryFn: replay([{ type: 'result', structured_output: { ok: true }, total_cost_usd: 0.4213 }]) as never,
  });
  assert.deepEqual(r.output, { ok: true });
  assert.equal(r.costUsd, 0.4213,
    'the cost is on the same result message the structured output is read from — dropping it is why two funded runs are unpriced');
});

/**
 * AMENDED BY `forge-8vfn.7.6.73`, T1 ruling 993(c) — in place, with the reason,
 * rather than deleted.
 *
 * THIS DOOR USED TO ASSERT `costUsd === 0` here, reasoning: "a missing figure
 * must not poison a sum". The reasoning was right and the remedy was wrong. A
 * numeric zero does not protect the sum; it JOINS it. Both consumers read a
 * number as a measurement:
 *
 *   spend.mjs `endedUnpricedTurns`      skips any row carrying a numeric
 *                                       `cost_usd`, so a turn reported as 0 can
 *                                       never reach 7.6.71's halt
 *   event-cost.ts `deriveSessionCostUsd` returns null only when NO row carries a
 *                                       number, so ONE zero row turns "never
 *                                       priced" into "$0.00"
 *
 * So the old assertion pinned the conflation it was written to prevent: the
 * ceiling under-counts in silence instead of going blind, which is strictly
 * worse than the failure it was guarding against. Ruling 849 settled the
 * remedy — cost is OMITTED, never zeroed — and `runAgentTurn` has returned
 * `number | null` since 7.6.55. The structured side simply never got it.
 */
test('a result message with NO cost yields NULL, not 0 — "cost nothing" and "never priced" must not render alike', async () => {
  const r = await runStructuredTurn<{ ok: boolean }>({
    ...BASE,
    queryFn: replay([{ type: 'result', structured_output: { ok: true } }]) as never,
  });
  assert.equal(r.costUsd, null,
    'a zero here is read as a MEASURED zero by both consumers: endedUnpricedTurns skips numeric ' +
    'cost_usd rows and deriveSessionCostUsd treats one as "this session cost $0.00"');
});

test('a non-numeric total_cost_usd is ignored rather than propagated', async () => {
  const r = await runStructuredTurn<{ ok: boolean }>({
    ...BASE,
    queryFn: replay([{ type: 'result', structured_output: { ok: true }, total_cost_usd: 'lots' }]) as never,
  });
  assert.equal(r.costUsd, null,
    'a string cost must not reach a ceiling comparison — and the turn is UNPRICED, not free: the ' +
    'SDK sent a price this code could not read, which is exactly the case a 0 would have buried');
});

test('the cost survives a stream that also carries assistant blocks before the result', async () => {
  const r = await runStructuredTurn<{ ok: boolean }>({
    ...BASE,
    queryFn: replay([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } },
      { type: 'result', structured_output: { ok: true }, total_cost_usd: 1.5 },
    ]) as never,
  });
  assert.equal(r.costUsd, 1.5);
});
