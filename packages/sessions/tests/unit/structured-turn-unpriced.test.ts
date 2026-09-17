/**
 * A structured turn that ends WITHOUT a price leaves a terminal row —
 * `forge-8vfn.7.6.73`, T1 ruling 993.
 *
 * WHAT WAS BROKEN, AND HOW IT WAS FOUND. `runStructuredTurn` priced only on the
 * SDK's terminal `result` and recorded no usage at all, so a turn that died mid
 * stream reported nothing: not a cost, not a token count, not a marker. That is
 * `forge-8vfn.7.6.55`'s defect in the sibling primitive, which 849 had scoped
 * out of that fix.
 *
 * MEASURED ON A FUNDED RUN rather than reasoned about. S1 run 11's architect log
 * holds six `architect.turn-cost` rows totalling $2.9702; the completeness
 * critic ran TWICE in that same log and left none. The run reported $5.2497 and
 * that figure is the EXACT sum of the nine priced rows across every log the run
 * wrote. The total reconciled perfectly against an incomplete record — which is
 * why nobody noticed, and why this file exists.
 *
 * THE THREE UNPRICED EXITS, and only the first was ever reachable by a throw:
 *   abort      our own idle deadline (StreamDeadlineError)
 *   died       the stream threw anything else
 *   no-result  NOTHING FAILED AND NOTHING WAS PRICED — the stream ended without
 *              a priced `result`. A try/catch can never see this one.
 *
 * The last is the case the old `costUsd = 0` hid, and `runCompletenessCritic` is
 * where it bites hardest: that function CATCHES every error and returns
 * `{crashed: true}` as advisory infra, so a died critic turn raises nothing for
 * anyone to see. The callback is the only path its tokens have.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runStructuredTurn, type UnpricedTurnInfo } from '../../interactive-session.ts';

function replay(messages: unknown[]) {
  return () => (async function* () { for (const m of messages) yield m; })();
}

/** A stream that yields some messages and then throws — a died turn. */
function replayThenThrow(messages: unknown[], err: Error) {
  return () => (async function* () { for (const m of messages) yield m; throw err; })();
}

const BASE = {
  prompt: 'p', schema: { type: 'object' }, model: 'claude-sonnet-5',
  allowedTools: ['Read'] as const,
};

/** Two assistant messages whose usage is DIFFERENT in the two directions that
 *  matter: `output_tokens` sums (each call generated its own), `input_tokens`
 *  is the whole conversation re-sent and must be taken from the LAST message.
 *  Summing input here would give 700+1100 = 1800 instead of 1100 — the trap
 *  7.6.55's own door was built around. */
const TWO_TURNS = [
  { type: 'assistant', message: { usage: { input_tokens: 700, output_tokens: 30 }, content: [{ type: 'text', text: 'one' }] } },
  { type: 'assistant', message: { usage: { input_tokens: 1100, output_tokens: 45, cache_read_input_tokens: 900 }, content: [{ type: 'text', text: 'two' }] } },
];

describe('7.6.73 — a structured turn reports when it ends unpriced', () => {
  test('a DIED stream fires the callback once with the tokens it consumed, then rethrows', async () => {
    const seen: UnpricedTurnInfo[] = [];
    await assert.rejects(
      runStructuredTurn<{ ok: boolean }>({
        ...BASE,
        queryFn: replayThenThrow(TWO_TURNS, new Error('socket died')) as never,
        onTurnEndedUnpriced: (info) => seen.push(info),
      }),
      /socket died/,
      'the report happens BEFORE the rethrow, never instead of it — every caller\'s error handling is unchanged',
    );
    assert.equal(seen.length, 1, `exactly one report, got ${JSON.stringify(seen)}`);
    assert.equal(seen[0]!.reason, 'died');
    assert.equal(seen[0]!.tokensOut, 75, 'output_tokens SUM across the two assistant messages (30 + 45)');
    assert.equal(seen[0]!.tokensIn, 1100,
      'input_tokens is the LAST message\'s, not the sum: the whole conversation is re-sent each call, so ' +
      'summing multiplies the context by the turn count (1800 here instead of 1100)');
    assert.equal(seen[0]!.cacheReadTokens, 900);
  });

  test('a stream that showed NO usage still reports, with no token fields invented', async () => {
    const seen: UnpricedTurnInfo[] = [];
    await assert.rejects(runStructuredTurn<{ ok: boolean }>({
      ...BASE,
      queryFn: replayThenThrow([], new Error('died before a single message')) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    }), /died before/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.tokensIn, undefined, 'absent, never 0 — an unmeasured turn must not read as a measured empty one');
    assert.equal(seen[0]!.tokensOut, undefined);
  });

  test('THE CLEAN END: a stream with no priced result reports `no-result` and returns costUsd null', async () => {
    // The case a throw can never cover, and the one the old `costUsd = 0` hid.
    const seen: UnpricedTurnInfo[] = [];
    const r = await runStructuredTurn<{ ok: boolean }>({
      ...BASE,
      queryFn: replay(TWO_TURNS) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, null, 'nothing failed and nothing was measured — that is not $0');
    assert.equal(seen.length, 1, `exactly one report, got ${JSON.stringify(seen)}`);
    assert.equal(seen[0]!.reason, 'no-result');
    assert.equal(seen[0]!.tokensOut, 75, 'the tokens are known even though the price is not');
  });

  test('a result that arrives WITHOUT a price is still `no-result` — a terminal message is not a measurement', async () => {
    const seen: UnpricedTurnInfo[] = [];
    const r = await runStructuredTurn<{ ok: boolean }>({
      ...BASE,
      queryFn: replay([...TWO_TURNS, { type: 'result', structured_output: { ok: true } }]) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.deepEqual(r.output, { ok: true }, 'the structured output still arrives — this is not an error path');
    assert.equal(r.costUsd, null);
    assert.equal(seen.length, 1, 'a turn can produce a perfectly good answer and still be unpriced');
  });

  test('A PRICED TURN NEVER REPORTS — the two rows are mutually exclusive by construction', async () => {
    // This is what lets every caller use the mechanical rule "emit a priced row
    // iff costUsd !== null, wire the unpriced row to the callback" without
    // risking two terminal rows for one turn.
    const seen: UnpricedTurnInfo[] = [];
    const r = await runStructuredTurn<{ ok: boolean }>({
      ...BASE,
      queryFn: replay([...TWO_TURNS, { type: 'result', structured_output: { ok: true }, total_cost_usd: 0.42 }]) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, 0.42);
    assert.deepEqual(seen, [], 'a priced turn must not ALSO leave an unpriced row');
  });

  test('a genuinely free priced turn reports 0 and still does not fire — $0 measured is not $0 unknown', async () => {
    const seen: UnpricedTurnInfo[] = [];
    const r = await runStructuredTurn<{ ok: boolean }>({
      ...BASE,
      queryFn: replay([{ type: 'result', structured_output: { ok: true }, total_cost_usd: 0 }]) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, 0, 'the SDK said zero, so zero is a measurement and belongs in the sum');
    assert.deepEqual(seen, [], 'and it is NOT an unpriced turn — this is the distinction the old `0` destroyed');
  });

  test('a callback that throws does not become the turn\'s error, nor manufacture one', async () => {
    const r = await runStructuredTurn<{ ok: boolean }>({
      ...BASE,
      queryFn: replay(TWO_TURNS) as never,
      onTurnEndedUnpriced: () => { throw new Error('the logger exploded'); },
    });
    assert.equal(r.costUsd, null, 'the clean path stays clean: a reporting failure must not invent a turn failure');
  });
});
