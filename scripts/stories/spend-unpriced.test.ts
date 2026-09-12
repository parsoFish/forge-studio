/**
 * AN ENFORCED CEILING MEETING A TURN THAT HAS ENDED UNPRICED HALTS THE RUN —
 * bead `forge-8vfn.7.6.71`, T1 ruling 849 option (d).
 *
 * WHAT THIS IS ABOUT. 7.6.51 made `budget_usd` real at every beat boundary,
 * and 7.6.55 gave a turn that dies a terminal row instead of silence. Between
 * them sat the case neither covers: the run knows a turn has ENDED, knows
 * nobody priced it, and carried on comparing the remaining figure to a ceiling
 * that could no longer mean anything. D's S7 run 4 printed `spend UNMEASURED
 * against ceiling $25.00` twenty-three times while spending an unknown amount.
 * The honest fix for blindness is to stop on blindness.
 *
 * IN FLIGHT IS NOT ENDED (823), and that distinction is the whole design. A
 * dispatched turn with no price and no terminal row may still price itself on
 * its own `end`; halting on it would kill healthy runs at every beat. The
 * second test below is the one that keeps this honest.
 *
 * THE FIXTURE IS CAPTURED, NOT DESCRIBED (§15.497). The row in
 * `CAPTURED_UNPRICED_ROW` was produced by driving the product's own
 * `runInteractiveTurn` with a query function that dies mid-stream, and copying
 * the line it wrote to `events.jsonl`. It is not typed from the emitter's
 * source. This campaign has already paid for a fixture written from a
 * sentence: a dedupe rule that passed its test and disagreed with the real
 * logs by $5.06, because the sentence and the fixture encoded the same wrong
 * model twice.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endedUnpricedTurns, ceilingHaltVerdict, summariseRunSpend } from './spend.mjs';
import { spendSoFar } from './run-observe.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** Captured from a real `runInteractiveTurn` whose turn died mid-stream —
 *  `tokens_out` summed across two assistant messages, `tokens_in` the last
 *  call's, and NO `cost_usd` at all, which is 7.6.55's own rule. */
const CAPTURED_UNPRICED_ROW = {
  event_id: 'EV_mtyd41yt_7cb7zp8q',
  cycle_id: '_unpricedkind-2026-09-12T00-00-00-died',
  started_at: '2026-09-12T12:29:32.021Z',
  initiative_id: 'interactive-unpricedkind-2026-09-12T00-00-00-died',
  phase: 'orchestrator',
  skill: 'interactive-runner',
  event_type: 'end',
  input_refs: [],
  output_refs: [],
  tokens_in: 700,
  tokens_out: 175,
  cache_read_tokens: 90,
  message: 'interactive.turn-ended-unpriced',
  metadata: {
    session_id: '2026-09-12T00-00-00-died',
    session_kind: 'unpricedkind',
    unpriced_reason: 'died',
    priced: false,
  },
};

/** A priced row from a real architect session — the run that DID measure. */
const CAPTURED_PRICED_ROW = {
  event_id: 'EV_mtwnijie_xmiyxnoc',
  cycle_id: '_architect-2026-09-11T07-44-18-503beae4',
  phase: 'architect',
  skill: 'architect',
  event_type: 'end',
  cost_usd: 0.6000446500000001,
  message: 'architect.turn-cost',
};

/** The shape of a dispatch that has STARTED and not finished: one `start` line
 *  and nothing else, which is §15.458's (b)-arm discriminator. */
const IN_FLIGHT_START_ROW = {
  event_id: 'EV_mtyd3u4b_q0uzafiy',
  cycle_id: '_unpricedkind-2026-09-12T00-00-00-died',
  phase: 'orchestrator',
  skill: 'interactive-runner',
  event_type: 'start',
  message: 'interactive turn (kind=unpricedkind, phase=analyzing, step=agent)',
  metadata: { session_id: '2026-09-12T00-00-00-died', session_kind: 'unpricedkind' },
};

describe('endedUnpricedTurns: which turns have ENDED with nobody pricing them', () => {
  test('7.6.71: the captured terminal row is read — reason, tokens and session, from the row itself', () => {
    const found = endedUnpricedTurns([[CAPTURED_UNPRICED_ROW]]);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.reason, 'died');
    assert.equal(found[0]!.tokensOut, 175, 'outputs sum across the turn\'s calls');
    assert.equal(found[0]!.tokensIn, 700, 'inputs are the last call, never a sum');
    assert.equal(found[0]!.sessionId, '2026-09-12T00-00-00-died');
  });

  test('7.6.71 (823): a turn IN FLIGHT is not one of these — a start line and nothing else', () => {
    assert.deepEqual(endedUnpricedTurns([[IN_FLIGHT_START_ROW]]), []);
  });

  test('7.6.71: a row that carries a price is not unpriced, whatever its metadata claims', () => {
    const priced = { ...CAPTURED_UNPRICED_ROW, cost_usd: 0.42 };
    assert.deepEqual(endedUnpricedTurns([[priced]]), [], 'the evidence wins over the label');
  });

  test('7.6.71: `metadata.priced === false` is read too, so a renamed message cannot blind this', () => {
    const renamed = { ...CAPTURED_UNPRICED_ROW, message: 'interactive.turn-finished-without-a-price' };
    assert.equal(endedUnpricedTurns([[renamed]]).length, 1);
  });

  test('7.6.71: one turn re-logged by a cycle channel is one turn, not two', () => {
    const found = endedUnpricedTurns([[CAPTURED_UNPRICED_ROW], [{ ...CAPTURED_UNPRICED_ROW }]]);
    assert.equal(found.length, 1, 'deduped by event_id, as summariseRunSpend already does');
  });

  test('7.6.71: the emitter still writes the message this guard reads', () => {
    const src = readFileSync(join(REPO, 'packages', 'sessions', 'interactive-runner.ts'), 'utf8');
    assert.match(
      src, /interactive\.turn-ended-unpriced/,
      'if this row is renamed, the story runner\'s ceiling goes blind again and nothing else would say so',
    );
  });
});

describe('ceilingHaltVerdict: green, red, and UNKNOWN — and UNKNOWN stops', () => {
  const dispatched = (rows: unknown[]) => summariseRunSpend({ realSpawn: true, events: [rows] } as never);

  test('7.6.71: an enforced ceiling meeting an ENDED unpriced turn halts, naming reason and tokens', () => {
    const stop = ceilingHaltVerdict({
      spend: dispatched([CAPTURED_PRICED_ROW, CAPTURED_UNPRICED_ROW]),
      ceilingUsd: 35,
      unpriced: endedUnpricedTurns([[CAPTURED_UNPRICED_ROW]]),
    });
    assert.equal(stop.halt, true);
    assert.equal(stop.kind, 'unenforceable');
    assert.match(stop.reason, /ceiling \$35\.00 UNENFORCEABLE/);
    assert.match(stop.reason, /reason=died/);
    assert.match(stop.reason, /tokens_out=175/);
  });

  test('7.6.71 (823): the same ceiling over a turn still IN FLIGHT does not halt', () => {
    const stop = ceilingHaltVerdict({
      spend: dispatched([IN_FLIGHT_START_ROW]),
      ceilingUsd: 35,
      unpriced: endedUnpricedTurns([[IN_FLIGHT_START_ROW]]),
    });
    assert.equal(stop.halt, false, `unmeasured-in-flight is a live state, not a halt: ${stop.reason}`);
    assert.match(stop.reason, /UNMEASURED/, 'and it still says the ceiling cannot be compared yet');
  });

  test('7.6.71: a BREACH outranks an unenforceable ceiling — the number we have beats the one we lost', () => {
    const stop = ceilingHaltVerdict({
      spend: dispatched([CAPTURED_PRICED_ROW, CAPTURED_UNPRICED_ROW]),
      ceilingUsd: 0.5,
      unpriced: endedUnpricedTurns([[CAPTURED_UNPRICED_ROW]]),
    });
    assert.equal(stop.kind, 'breach');
    assert.match(stop.reason, /EXCEEDED at \$0\.6000/);
  });

  test('7.6.71: with NO usable ceiling there is nothing to make unenforceable, so this does not halt', () => {
    const stop = ceilingHaltVerdict({
      spend: dispatched([CAPTURED_UNPRICED_ROW]),
      ceilingUsd: Number.NaN,
      unpriced: endedUnpricedTurns([[CAPTURED_UNPRICED_ROW]]),
    });
    assert.equal(stop.halt, false, 'an UNBOUNDED run is effectiveCeiling\'s finding and prints as one');
  });

  test('7.6.71: everything priced and under — no halt, and the note is empty', () => {
    const stop = ceilingHaltVerdict({
      spend: dispatched([CAPTURED_PRICED_ROW]), ceilingUsd: 35, unpriced: [],
    });
    assert.equal(stop.halt, false);
    assert.equal(stop.kind, null);
    assert.match(stop.reason, /\$0\.6000 of \$35\.00/);
  });
});

describe('the beat boundary reads the halt, not a sentence', () => {
  /** A worktree whose `_logs` holds one dispatch that ENDED unpriced. */
  function rootWithEndedUnpricedTurn(): string {
    const root = mkdtempSync(join(tmpdir(), 'ended-unpriced-'));
    const dir = join(root, '_logs', '_unpricedkind-2026-09-12T00-00-00-died');
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/events.jsonl', `${JSON.stringify(IN_FLIGHT_START_ROW)}\n${JSON.stringify(CAPTURED_UNPRICED_ROW)}\n`);
    return root;
  }

  test('7.6.71: spendSoFar returns the halt as a VALUE the run loop can branch on', () => {
    const r = spendSoFar({
      root: rootWithEndedUnpricedTurn(), startedMs: 0, realSpawn: true,
      ceilingUsd: 35, label: 'after beat 8',
    });
    assert.equal(r.stop.halt, true, r.stop.reason);
    assert.equal(r.stop.kind, 'unenforceable');
    assert.equal(r.unpriced.length, 1);
    // EVERY FIELD `run.mjs` READS OFF THIS OBJECT, checked here because the
    // beat loop drives a browser and nothing else can check them. It reads
    // `stop.halt` and `stop.headline`/`stop.reason` at the boundary (:504-505)
    // and `spendHalt.note` in the final verdict (:744); a dropped `headline`
    // prints the word `undefined` into a red and no other door would see it.
    for (const field of ['halt', 'kind', 'headline', 'reason', 'note']) {
      assert.ok(Object.hasOwn(r.stop, field), `run.mjs reads stop.${field} and it is not there`);
    }
    assert.equal(typeof r.stop.headline, 'string', 'the console line interpolates this');
    assert.match(r.stop.note, /ceiling went blind/, 'the final verdict says WHY this was not a breach');
    assert.ok(
      r.lines.some((l) => /ENDED UNPRICED/.test(l)),
      `the running commentary says it too, every beat: ${r.lines.join(' | ')}`,
    );
  });
});
