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

  // C's finding on 7.6.73's own consequence, and the door that keeps it fixed.
  //
  // `endedUnpricedTurns` carries TWO markers so either alone suffices (§15.504).
  // Its message arm was exact equality against `interactive.turn-ended-unpriced`
  // — one literal — and 7.6.73 added three emitters that each name themselves
  // correctly and match none of it. The belt became the braces' shadow: three of
  // four emitters held by `priced === false` alone, and a future emitter written
  // to the obvious convention without the marker would be invisible while
  // looking right. The arm now matches the SUFFIX, so the convention enforces
  // itself.
  //
  // These cases assert each arm ALONE, because an arm that is only ever
  // exercised alongside the other is not independent, it is decorative.
  for (const message of [
    'interactive.turn-ended-unpriced',                       // the runner
    'architect.turn-ended-unpriced',                          // 7.6.73
    'architect.completeness-critic.turn-ended-unpriced',      // 7.6.73
    'instructions.draft.turn-ended-unpriced',                 // 7.6.73
  ]) {
    test(`MESSAGE ARM ALONE: "${message}" with NO priced key is still caught`, () => {
      const rows = roundTrip((logger) => {
        logger.emit({
          initiative_id: CRITIC.initiativeId, phase: CRITIC.phase, skill: CRITIC.skill,
          event_type: 'end', input_refs: [], output_refs: [],
          tokens_in: 1100, tokens_out: 75,
          message,
          metadata: { unpriced_reason: 'died' },
        });
      });
      assert.equal(endedUnpricedTurns([rows]).length, 1,
        `before the suffix form this passed for the runner's literal and FAILED for the other three — ` +
        `each named correctly for its caller and matching none of one hardcoded string`);
      const spend = summariseRunSpend({ realSpawn: true, events: [rows] });
      assert.equal(ceilingHaltVerdict({ spend, ceilingUsd: 9, unpriced: endedUnpricedTurns([rows]) }).halt, true);
    });
  }

  // C's adversarial forms, added after they probed the regex against cases I
  // had not: these are exactly where a SUFFIX match degrades into a SUBSTRING
  // match, and both directions are wrong. Over-matching would make the halt
  // fire on any log line that happened to discuss it.
  for (const message of [
    'foo.not-a-turn-ended-unpriced',   // a hyphen is not a boundary
    'turn-ended-unpriced-later',       // the end anchor must hold
    'interactive.turn-ended',          // a sibling message, not this one
  ]) {
    test(`NOT a marker: "${message}" must not match the message arm`, () => {
      const rows = roundTrip((logger) => {
        logger.emit({
          initiative_id: CRITIC.initiativeId, phase: CRITIC.phase, skill: CRITIC.skill,
          event_type: 'end', input_refs: [], output_refs: [],
          message, metadata: { unpriced_reason: 'died' },
        });
      });
      assert.deepEqual(endedUnpricedTurns([rows]), [],
        'a suffix match must not become a substring match — a marker contract reads a name, not English');
    });
  }

  test('the BARE name is a marker — an emitter with no prefix still counts', () => {
    const rows = roundTrip((logger) => {
      logger.emit({
        initiative_id: CRITIC.initiativeId, phase: CRITIC.phase, skill: CRITIC.skill,
        event_type: 'end', input_refs: [], output_refs: [],
        message: 'turn-ended-unpriced', metadata: { unpriced_reason: 'died' },
      });
    });
    assert.equal(endedUnpricedTurns([rows]).length, 1, 'the `(^|\\.)` alternation covers a bare name');
  });

  test('METADATA ARM ALONE: an unconventional message with `priced: false` is caught', () => {
    // The complement. Neither arm may depend on the other.
    const rows = roundTrip((logger) => {
      logger.emit({
        initiative_id: CRITIC.initiativeId, phase: CRITIC.phase, skill: CRITIC.skill,
        event_type: 'end', input_refs: [], output_refs: [],
        message: 'some.future.caller.gave-up',
        metadata: { unpriced_reason: 'died', priced: false },
      });
    });
    assert.equal(endedUnpricedTurns([rows]).length, 1);
  });

  test('NEITHER MARKER: the row is invisible, and that is still the trap', () => {
    // The failure is SILENT — nothing errors, the run simply continues
    // under-counted. The suffix form shrinks this hole to rows that are neither
    // named by the convention nor marked; it does not remove it, and a row that
    // says "unpriced" only in PROSE is exactly such a row.
    const rows = roundTrip((logger) => {
      logger.emit({
        initiative_id: CRITIC.initiativeId, phase: CRITIC.phase, skill: CRITIC.skill,
        event_type: 'end', input_refs: [], output_refs: [],
        tokens_in: 1100, tokens_out: 75,
        message: 'the turn ended unpriced, sadly',
        metadata: { unpriced_reason: 'died' },
      });
    });
    assert.deepEqual(endedUnpricedTurns([rows]), [],
      'proving the TRAP, not the desired behaviour: prose is not a marker. This is why ' +
      'emitTurnEndedUnpricedRow sets `priced: false` itself rather than trusting four callers, ' +
      'and why the message arm matches a SUFFIX rather than reading English.');
    const spend = summariseRunSpend({ realSpawn: true, events: [rows] });
    assert.equal(ceilingHaltVerdict({ spend, ceilingUsd: 9, unpriced: [] }).halt, false,
      'and the run sails on — which is why this had to be doored through the verdict, not the emitter');
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
