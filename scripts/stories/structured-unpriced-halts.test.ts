/**
 * The row a structured turn leaves when it ends unpriced ACTUALLY HALTS a
 * funded run — `forge-8vfn.7.6.73`, T1 ruling 993(d), which required this door
 * specifically and required it as a composition.
 *
 * WHY READING THE EMITTER WOULD NOT DO. `ceilingHaltVerdict` stops a run when a
 * turn ends unpriced, because a ceiling above an unmeasured turn is a ceiling
 * over an unknown. It recognises such a row two ways and only two —
 * `message === 'interactive.turn-ended-unpriced'` OR `metadata.priced === false`
 * — and it SKIPS any row carrying a numeric `cost_usd`. Every new caller in
 * 7.6.73 emits a row with its own message (`architect.turn-ended-unpriced`,
 * `architect.completeness-critic.turn-ended-unpriced`,
 * `instructions.draft.turn-ended-unpriced`), so not one of them matches the
 * message arm. They are recognised solely by the metadata arm, and a test that
 * asserted "the emitter sets priced: false" would pass while proving nothing
 * about whether the halt fires.
 *
 * So this drives the REAL chain end to end: the real emitter writes through the
 * real logger to a real events.jsonl, the file is read back, and the parsed
 * rows go through the real `endedUnpricedTurns` into the real
 * `ceilingHaltVerdict`. The assertion is that the RUN STOPS.
 *
 * THE FAILURE THIS GUARDS IS THE QUIET ONE. If the markers were wrong, nothing
 * would error — the run would sail past its ceiling reporting a smaller number,
 * which is precisely what S1 run 11 did: $5.2497 reported, exactly reconciling
 * the nine rows it recorded, with two completeness-critic turns absent from it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import { emitTurnCostRow, emitTurnEndedUnpricedRow } from '@forge/sessions/turn-cost-rows.ts';

import { summariseRunSpend, endedUnpricedTurns, ceilingHaltVerdict } from './spend.mjs';

/** Emit through the REAL logger and read the rows back off disk. */
function roundTrip(emit: (logger: ReturnType<typeof createLogger>) => void): Record<string, unknown>[] {
  const root = mkdtempSync(join(tmpdir(), 'unpriced-halts-'));
  try {
    const logger = createLogger('c1', root);
    emit(logger);
    const text = readFileSync(join(root, 'c1', 'events.jsonl'), 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The identity an architect-side caller uses — deliberately NOT the runner's
 *  `interactive.turn-ended-unpriced`, because the message arm must not be what
 *  is doing the work here. */
const CRITIC = {
  initiativeId: 'architect-session-s1',
  phase: 'architect' as const,
  skill: 'architect-completeness-critic',
  message: 'architect.completeness-critic.turn-ended-unpriced',
};

describe('7.6.73(d) — a structured unpriced row reaches the halt', () => {
  for (const reason of ['abort', 'died', 'no-result'] as const) {
    test(`reason "${reason}" HALTS a run under a ceiling`, () => {
      const rows = roundTrip((logger) => {
        emitTurnCostRow(logger, { ...CRITIC, message: 'architect.turn-cost' }, 1.25);
        emitTurnEndedUnpricedRow(logger, CRITIC, { reason, tokensIn: 1100, tokensOut: 75 });
      });

      const unpriced = endedUnpricedTurns([rows]);
      assert.equal(unpriced.length, 1,
        `the row must be recognised by ceilingHaltVerdict's metadata arm — its message is the caller's own, ` +
        `so the message arm cannot be what finds it:\n${JSON.stringify(rows, null, 2)}`);
      assert.equal(unpriced[0]!.reason, reason, 'the reason must survive to the operator, verbatim');
      assert.equal(unpriced[0]!.tokensIn, 1100, 'and the tokens with it — an unpriced turn is not an unmeasured one');
      assert.equal(unpriced[0]!.tokensOut, 75);

      const spend = summariseRunSpend({ realSpawn: true, events: [rows] });
      const stop = ceilingHaltVerdict({ spend, ceilingUsd: 9, unpriced });
      assert.equal(stop.halt, true,
        `$1.25 of $9 is nowhere near the ceiling, so the ONLY thing that can stop this run is the ` +
        `unpriced turn — which is the whole point: the ceiling above an unmeasured turn is a ceiling ` +
        `over an unknown:\n${JSON.stringify(stop, null, 2)}`);
    });
  }

  test('THE MUTATION THAT WOULD PASS A WEAKER DOOR: drop `priced: false` and the halt goes silent', () => {
    // Hand-built to be exactly the emitter's row MINUS the metadata marker —
    // the shape the code would have if someone "tidied" the metadata or if a
    // caller emitted its own row without going through the shared renderer.
    // Nothing errors. The run simply continues, under-counted.
    const rows = roundTrip((logger) => {
      logger.emit({
        initiative_id: CRITIC.initiativeId, phase: CRITIC.phase, skill: CRITIC.skill,
        event_type: 'end', input_refs: [], output_refs: [],
        tokens_in: 1100, tokens_out: 75,
        message: CRITIC.message,
        metadata: { unpriced_reason: 'died' },
      });
    });
    const unpriced = endedUnpricedTurns([rows]);
    assert.deepEqual(unpriced, [],
      'proving the TRAP, not the desired behaviour: without `priced: false` this row is invisible to the ' +
      'halt even though its message says "unpriced" in plain English. That is why emitTurnEndedUnpricedRow ' +
      'sets the marker itself rather than trusting four callers to remember it.');
    const spend = summariseRunSpend({ realSpawn: true, events: [rows] });
    assert.equal(ceilingHaltVerdict({ spend, ceilingUsd: 9, unpriced }).halt, false,
      'and the run sails on — the failure is SILENT, which is why this had to be doored through the verdict');
  });

  test('a PRICED row never halts — the two rows stay distinguishable through the whole chain', () => {
    const rows = roundTrip((logger) => {
      emitTurnCostRow(logger, { ...CRITIC, message: 'architect.completeness-critic.turn-cost' }, 0);
    });
    const unpriced = endedUnpricedTurns([rows]);
    assert.deepEqual(unpriced, [],
      'a turn the SDK priced at $0 is MEASURED at zero, not unpriced — the distinction the old ' +
      '`costUsd = 0` collapsed, asserted here at the far end of the chain');
    const spend = summariseRunSpend({ realSpawn: true, events: [rows] });
    assert.equal(ceilingHaltVerdict({ spend, ceilingUsd: 9, unpriced }).halt, false);
  });
});
