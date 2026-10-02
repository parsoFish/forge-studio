/**
 * AN UNPRICED TURN THAT RAN UNDER A CAP IS CHARGED THE CAP — row 193b, bead
 * forge-8vfn.8.5.38, T1 ruling 1973gq: "unpriced" is honest only when no bound
 * exists.
 *
 * MEASURED: row 6 run 6, story S10 beat 30 — the same abort row
 * `spend-stall-abort.test.ts` pins, copied verbatim. #1066 added a once-retry,
 * but the stalled attempt still writes its unpriced row and the story still
 * halted UNENFORCEABLE. The product now runs every session turn under the SDK's
 * `maxBudgetUsd` when a ceiling exists and records that cap on the unpriced row
 * as `metadata.upper_bound_usd`. A row carrying it has a bound: the ceiling
 * CHARGES the bound and the story continues while it stays under the ceiling.
 * A row WITHOUT it is the row #1066 judged, and stays UNENFORCEABLE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spendSoFar } from './run-observe.mjs';
import { endedUnpricedTurns, ceilingHaltVerdict, summariseRunSpend, chargeBoundedTurns } from './spend.mjs';

/** Copied verbatim from the capture's `events.jsonl` (third line). */
const S10_BEAT30_ABORT_ROW = {
  event_id: 'EV_murg964l_9dffxaj8',
  cycle_id: '_architect-2026-10-02T20-56-58-7c0d2d53',
  started_at: '2026-10-02T21:02:48.645Z',
  initiative_id: 'architect-session-2026-10-02T20-56-58-7c0d2d53',
  phase: 'architect',
  skill: 'architect',
  event_type: 'end',
  input_refs: [],
  output_refs: [],
  message: 'architect.turn-ended-unpriced',
  metadata: { unpriced_reason: 'abort', priced: false },
};

/** The same row as the product now writes it: the cap the turn ran under. */
const BOUNDED_ABORT_ROW = {
  ...S10_BEAT30_ABORT_ROW,
  metadata: { ...S10_BEAT30_ABORT_ROW.metadata, upper_bound_usd: 6.5 },
};

/** A priced sibling turn in the same session, so the charge ADDS to a measurement. */
const PRICED_ROW = {
  ...S10_BEAT30_ABORT_ROW,
  event_id: 'EV_priced_sibling',
  message: 'architect.turn-cost',
  cost_usd: 2.25,
  metadata: { priced: true },
};

const dispatched = (rows: unknown[]) => summariseRunSpend({ realSpawn: true, events: [rows] } as never);

test('row 193b (a) the S10 abort row WITH upper_bound_usd is charged its bound and the story continues under $44', () => {
  const rows = [PRICED_ROW, BOUNDED_ABORT_ROW];
  const stop = ceilingHaltVerdict({
    spend: dispatched(rows),
    ceilingUsd: 44,
    unpriced: endedUnpricedTurns([rows]),
  });
  assert.equal(stop.halt, false, `a bounded abort must not halt the story: ${stop.reason}`);
  assert.equal(stop.kind, null);
  assert.match(stop.reason, /\$8\.7500 of \$44\.00/, `the ceiling compares priced $2.25 + charged bound $6.50: ${stop.reason}`);
  assert.match(stop.reason, /1 turn\(s\) ended unpriced UNDER A CAP and were charged \$6\.50 at their bound/, stop.reason);
});

test('row 193b (a) the bound reaches the turn list — and the charged spend reads as measured even with nothing else priced', () => {
  const [t] = endedUnpricedTurns([[BOUNDED_ABORT_ROW]]);
  assert.equal(t!.upperBoundUsd, 6.5);
  const charged = chargeBoundedTurns(dispatched([BOUNDED_ABORT_ROW]), endedUnpricedTurns([[BOUNDED_ABORT_ROW]]));
  assert.equal(charged.measured, true);
  assert.equal(charged.usd, 6.5);
});

test('row 193b (a) a charged bound that crosses the ceiling is a BREACH, on the number', () => {
  const rows = [PRICED_ROW, BOUNDED_ABORT_ROW];
  const stop = ceilingHaltVerdict({ spend: dispatched(rows), ceilingUsd: 8, unpriced: endedUnpricedTurns([rows]) });
  assert.equal(stop.halt, true);
  assert.equal(stop.kind, 'breach');
  assert.match(stop.reason, /ceiling \$8\.00 EXCEEDED at \$8\.7500/);
});

test('row 193b (a) the SAME row WITHOUT upper_bound_usd still halts UNENFORCEABLE, exactly as #1066 merged it', () => {
  const rows = [PRICED_ROW, S10_BEAT30_ABORT_ROW];
  const stop = ceilingHaltVerdict({ spend: dispatched(rows), ceilingUsd: 44, unpriced: endedUnpricedTurns([rows]) });
  assert.equal(stop.halt, true);
  assert.equal(stop.kind, 'unenforceable');
  assert.match(stop.reason, /ceiling \$44\.00 UNENFORCEABLE: 1 turn\(s\) ended unpriced/);
  assert.equal(endedUnpricedTurns([[S10_BEAT30_ABORT_ROW]])[0]!.upperBoundUsd, null);
});

test('row 193b (a) one bounded and one unbounded: the unbounded one still blinds the ceiling', () => {
  const unbounded = { ...S10_BEAT30_ABORT_ROW, event_id: 'EV_unbounded' };
  const rows = [BOUNDED_ABORT_ROW, unbounded];
  const stop = ceilingHaltVerdict({ spend: dispatched(rows), ceilingUsd: 44, unpriced: endedUnpricedTurns([rows]) });
  assert.equal(stop.kind, 'unenforceable');
  assert.match(stop.reason, /1 turn\(s\) ended unpriced/, 'only the unbounded turn is counted as blind');
});

test('row 193b (a) a malformed bound is NOT a bound — zero, negative, or a string stays unenforceable', () => {
  for (const bad of [0, -1, '6.5', Number.NaN]) {
    const row = { ...S10_BEAT30_ABORT_ROW, metadata: { ...S10_BEAT30_ABORT_ROW.metadata, upper_bound_usd: bad } };
    const stop = ceilingHaltVerdict({ spend: dispatched([row]), ceilingUsd: 44, unpriced: endedUnpricedTurns([[row]]) });
    assert.equal(stop.kind, 'unenforceable', `upper_bound_usd=${String(bad)} must not read as a bound`);
  }
});

test('row 193b (a) the beat transcript says the turn was BOUNDED and charged — read off a real logs dir through spendSoFar', () => {
  const root = mkdtempSync(join(tmpdir(), 'bounded-abort-'));
  try {
    const dir = join(root, '_logs', S10_BEAT30_ABORT_ROW.cycle_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify(PRICED_ROW)}\n${JSON.stringify(BOUNDED_ABORT_ROW)}\n`);
    const r = spendSoFar({ root, startedMs: 0, realSpawn: true, ceilingUsd: 44, label: 'after beat 30' });
    assert.equal(r.stop.halt, false, r.stop.reason);
    assert.ok(r.lines.some((l) => /spend after beat 30: \$8\.7500 of \$44\.00/.test(l)), r.lines.join(' | '));
    assert.ok(
      r.lines.some((l) => /ENDED UNPRICED — reason=abort.*BOUNDED: ran under a \$6\.50 cap, charged at that bound/.test(l)),
      r.lines.join(' | '),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
