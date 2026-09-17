/**
 * `runAgentTurn` reports a turn that ends WITHOUT a price — the symmetric half
 * of `forge-8vfn.7.6.73`, authorised by T1 ruling 993(b).
 *
 * 7.6.55 gave `runAgentTurn` an unpriced report on the THROW path only. A
 * stream that ends cleanly with no priced `result` throws nothing, so that path
 * never saw it, and `interactive-agent-step` emits a cost row only when
 * `costUsd !== null` — so the log was left with NO terminal row at all: not
 * priced, not marked unpriced, invisible to `endedUnpricedTurns` and therefore
 * to 7.6.71's halt. 993 ruled a closed bead's function is not sealed: the
 * change is additive and leaving one primitive quiet is the shape this bead
 * closes.
 *
 * THIS FILE EXISTS BECAUSE THE MUTATION HARNESS SAID IT SHOULD. Disabling the
 * clean-end report in `runStructuredTurn` red-ed 3 doors; disabling the
 * IDENTICAL line in `runAgentTurn` red-ed NOTHING — `NOT-CAUGHT, 25 tests`. The
 * behaviour was shipped and unasserted, and no amount of reading the diff would
 * have said so, because the code looks symmetric. Only mutating both halves
 * separately showed that the doors were not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runAgentTurn, type UnpricedTurnInfo } from '../../interactive-session.ts';

function replay(messages: unknown[]) {
  return () => (async function* () { for (const m of messages) yield m; })();
}
function replayThenThrow(messages: unknown[], err: Error) {
  return () => (async function* () { for (const m of messages) yield m; throw err; })();
}

const BASE = {
  prompt: 'p', cwd: '/tmp', model: 'claude-sonnet-5',
  allowedTools: ['Read'] as const,
};

/** Two assistant messages: output sums, input is the LAST value. */
const TWO_TURNS = [
  { type: 'assistant', message: { usage: { input_tokens: 700, output_tokens: 30 }, content: [] } },
  { type: 'assistant', message: { usage: { input_tokens: 1100, output_tokens: 45 }, content: [] } },
];

describe('7.6.73 — runAgentTurn reports a clean end with no price', () => {
  test('a stream with no priced result fires `no-result` and returns costUsd null', async () => {
    const seen: UnpricedTurnInfo[] = [];
    const r = await runAgentTurn({
      ...BASE,
      queryFn: replay(TWO_TURNS) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, null, 'nothing failed and nothing was measured — that is not $0');
    assert.equal(seen.length, 1, `exactly one report, got ${JSON.stringify(seen)}`);
    assert.equal(seen[0]!.reason, 'no-result',
      'a try/catch can never see this case: the stream ended, it did not throw');
    assert.equal(seen[0]!.tokensOut, 75, 'output_tokens SUM (30 + 45)');
    assert.equal(seen[0]!.tokensIn, 1100,
      'input_tokens is the LAST message\'s — the whole conversation is re-sent, so summing would give 1800');
  });

  test('a result WITHOUT a price is still `no-result` — a terminal message is not a measurement', async () => {
    const seen: UnpricedTurnInfo[] = [];
    const r = await runAgentTurn({
      ...BASE,
      queryFn: replay([...TWO_TURNS, { type: 'result' }]) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.reason, 'no-result');
  });

  test('a DIED stream still reports `died`, not `no-result` — 7.6.55 unchanged', async () => {
    const seen: UnpricedTurnInfo[] = [];
    await assert.rejects(runAgentTurn({
      ...BASE,
      queryFn: replayThenThrow(TWO_TURNS, new Error('socket died')) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    }), /socket died/);
    assert.equal(seen.length, 1, 'and exactly once — the clean-end branch must not double-report after a throw');
    assert.equal(seen[0]!.reason, 'died');
  });

  test('A PRICED TURN NEVER REPORTS — the two rows stay mutually exclusive', async () => {
    const seen: UnpricedTurnInfo[] = [];
    const r = await runAgentTurn({
      ...BASE,
      queryFn: replay([...TWO_TURNS, { type: 'result', total_cost_usd: 0.77 }]) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, 0.77);
    assert.deepEqual(seen, [], 'a priced turn must not ALSO leave an unpriced row');
  });

  test('a genuinely free priced turn reports 0 and does not fire', async () => {
    const seen: UnpricedTurnInfo[] = [];
    const r = await runAgentTurn({
      ...BASE,
      queryFn: replay([{ type: 'result', total_cost_usd: 0 }]) as never,
      onTurnEndedUnpriced: (info) => seen.push(info),
    });
    assert.equal(r.costUsd, 0, 'the SDK said zero, so zero is a measurement');
    assert.deepEqual(seen, [], 'and it is NOT unpriced — the distinction the old `0` destroyed');
  });
});
