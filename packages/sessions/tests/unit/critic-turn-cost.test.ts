/**
 * The completeness critic's spend reaches the log — `forge-8vfn.7.6.73`,
 * T1 ruling 993(a).
 *
 * MEASURED, NOT SUSPECTED. S1 run 11's architect log
 * (`_architect-2026-09-12T16-45-13-7156ec87/events.jsonl`) contains two
 * `architect.completeness-critic.start` rows, two `.end (findings=4)` rows and
 * eight `.finding` rows — and ZERO rows carrying `cost_usd` for either turn.
 * The cause was one character of destructuring: `const { output } = await
 * runStructuredTurn(...)` threw the cost away on the SUCCESS path. The critic
 * runs on `claude-sonnet-4-6` with the full PLAN and every manifest in its
 * prompt; that is real money, and it was invisible.
 *
 * WHY IT STAYED INVISIBLE, which is the part worth keeping: run 11 reported
 * $5.2497, and that is the EXACT sum of the nine priced rows across every log
 * the run wrote. A total that reconciles perfectly against an incomplete record
 * looks more trustworthy than one that does not.
 *
 * AND WHY THE UNPRICED HALF MATTERS MORE HERE THAN ANYWHERE ELSE:
 * `runCompletenessCritic` CATCHES every error and returns `{crashed: true}`,
 * deliberately — it is advisory infra that must never strand a session. So a
 * critic turn that dies raises nothing, logs no failure anyone bills against,
 * and the unpriced callback is the ONLY path its consumed tokens have.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runCompletenessCritic, type RunCompletenessCriticInput } from '../../kinds/architect-critic.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

/** A logger that KEEPS what it is given, so the assertions are about rows. */
function capturingLogger(): { logger: EventLogger; rows: EventLogEntry[] } {
  const rows: EventLogEntry[] = [];
  const logger: EventLogger = {
    emit: (entry) => {
      const row = { event_id: `e${rows.length}`, cycle_id: 'c', started_at: '1970-01-01T00:00:00.000Z', ...entry } as EventLogEntry;
      rows.push(row);
      return row;
    },
    cycleId: 'c',
    logFilePath: '',
  };
  return { logger, rows };
}

function replay(messages: unknown[]) {
  return () => (async function* () { for (const m of messages) yield m; })();
}

function baseInput(logger: EventLogger, queryFn: unknown): RunCompletenessCriticInput {
  return {
    idea: 'Migrate every resource to the plugin framework.',
    interviewSummary: '1. Q: scope?\n   A: all of it.',
    planMarkdown: '# PLAN\n\nMigrate all resources.',
    manifestsSummary: '- INIT-1: migrate release_definition\n',
    queryFn: queryFn as RunCompletenessCriticInput['queryFn'],
    logger,
    initiativeId: 'architect-session-s1',
  };
}

const PRICED_RESULT = {
  type: 'result',
  structured_output: { findings: [{ severity: 'high', gap: 'nothing is specified', initiativeId: 'INIT-1' }] },
  total_cost_usd: 0.3174,
};

describe('7.6.73 — the completeness critic prices its own turn', () => {
  test('a successful critic turn emits its cost — the row run 11 never had', async () => {
    const { logger, rows } = capturingLogger();
    const r = await runCompletenessCritic(baseInput(logger, replay([PRICED_RESULT])));
    assert.equal(r.crashed, false);

    const priced = rows.filter((e) => typeof (e as { cost_usd?: unknown }).cost_usd === 'number');
    assert.equal(priced.length, 1,
      `exactly one priced row for one turn:\n${JSON.stringify(rows, null, 2)}`);
    assert.equal((priced[0] as { cost_usd?: number }).cost_usd, 0.3174);
    assert.equal(priced[0]!.phase, 'architect',
      'phase must be `architect` or the row is not authoritative under event-cost.ts and stops counting');
    assert.match(String(priced[0]!.message), /completeness-critic/,
      'named as the critic\'s own so an operator can tell it from the architect turns beside it');
  });

  test('a DIED critic turn leaves an unpriced row even though the crash is swallowed', async () => {
    const { logger, rows } = capturingLogger();
    const dying = () => (async function* () {
      yield { type: 'assistant', message: { usage: { input_tokens: 900, output_tokens: 40 }, content: [] } };
      throw new Error('critic stream died');
    })();
    const r = await runCompletenessCritic(baseInput(logger, dying));

    assert.equal(r.crashed, true, 'the advisory contract is unchanged — the session is never stranded');
    const unpriced = rows.filter((e) => (e.metadata as Record<string, unknown> | undefined)?.['priced'] === false);
    assert.equal(unpriced.length, 1,
      `the swallowed crash must still leave a terminal row — it is the ONLY trace this turn spent ` +
      `anything:\n${JSON.stringify(rows, null, 2)}`);
    assert.equal((unpriced[0]!.metadata as Record<string, unknown>)['unpriced_reason'], 'died');
    assert.equal((unpriced[0] as { tokens_out?: number }).tokens_out, 40);
    assert.equal((unpriced[0] as { cost_usd?: unknown }).cost_usd, undefined,
      'cost is OMITTED, never zeroed (849) — a zero here is skipped by endedUnpricedTurns as priced');
  });

  test('a resultless critic turn is `no-result`, not a $0 turn', async () => {
    const { logger, rows } = capturingLogger();
    await runCompletenessCritic(baseInput(logger, replay([
      { type: 'assistant', message: { usage: { input_tokens: 900, output_tokens: 40 }, content: [] } },
    ])));
    const unpriced = rows.filter((e) => (e.metadata as Record<string, unknown> | undefined)?.['priced'] === false);
    assert.equal(unpriced.length, 1, `one terminal row:\n${JSON.stringify(rows, null, 2)}`);
    assert.equal((unpriced[0]!.metadata as Record<string, unknown>)['unpriced_reason'], 'no-result');
  });

  test('ONE terminal row per turn, never two — priced and unpriced are exclusive', async () => {
    const { logger, rows } = capturingLogger();
    await runCompletenessCritic(baseInput(logger, replay([PRICED_RESULT])));
    const terminal = rows.filter((e) =>
      typeof (e as { cost_usd?: unknown }).cost_usd === 'number' ||
      (e.metadata as Record<string, unknown> | undefined)?.['priced'] === false);
    assert.equal(terminal.length, 1,
      `a turn that leaves two terminal rows double-counts or contradicts itself:\n${JSON.stringify(terminal, null, 2)}`);
  });
});
