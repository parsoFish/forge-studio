/**
 * A TURN ABORTED BY THE STREAM-DEADLINE WITH NO ASSISTANT OUTPUT STAYS
 * UNENFORCEABLE — row 193, T1 ruling 1973fy, ruled against row 184 / item 76.
 *
 * MEASURED: row 6 run 6, story S10 beat 30. ACT 2's architect session
 * 2026-10-02T20-56-58-7c0d2d53 saw `system×12, rate_limit_event×1` and no
 * assistant message for 360s; `withIdleDeadline` aborted it and the product
 * wrote the row below. The story printed `reason=abort, tokens_out=unrecorded,
 * tokens_in=unrecorded, session=unknown` and stopped S10 as UNENFORCEABLE.
 *
 * THE QUESTION: should "aborted, and no assistant message ever arrived" read
 * as priced-at-zero? ONLY if the events prove nothing billable happened, and
 * they do not:
 *   - the twelve `system` rows' subtypes were never recorded (`withIdleDeadline`
 *     keeps only `type×count`), so whether a request was in flight at the
 *     abort — or completed into an `api_retry` — is not in the evidence;
 *   - an assistant message arrives per COMPLETED content block (sdk.d.ts
 *     `SDKAssistantMessage`), so a long block still streaming when the abort
 *     landed bills input and partial output with nothing to show for it;
 *   - auxiliary model calls never surface as assistant messages at all, and
 *     the only total — `result.total_cost_usd` — never arrives on an abort.
 * "No usage was reported" is the ABSENCE of a measurement, which is the exact
 * thing item 76 refused to read as zero. The red stays. What changes is that
 * the line says WHY it is blind, and names the session it can already see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endedUnpricedTurns, ceilingHaltVerdict, summariseRunSpend } from './spend.mjs';

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

/** The other shape: a stall AFTER the turn produced assistant messages, so the
 *  runner observed and recorded tokens before the abort. */
const ABORT_AFTER_OUTPUT_ROW = {
  ...S10_BEAT30_ABORT_ROW,
  event_id: 'EV_abort_after_output',
  tokens_in: 12_000,
  tokens_out: 340,
};

const dispatched = (rows: unknown[]) => summariseRunSpend({ realSpawn: true, events: [rows] } as never);

test('row 193 (a) the S10 beat-30 abort with NO assistant output still halts UNENFORCEABLE — absence of usage is not zero', () => {
  const stop = ceilingHaltVerdict({
    spend: dispatched([S10_BEAT30_ABORT_ROW]),
    ceilingUsd: 44,
    unpriced: endedUnpricedTurns([[S10_BEAT30_ABORT_ROW]]),
  });
  assert.equal(stop.halt, true);
  assert.equal(stop.kind, 'unenforceable');
  assert.match(stop.reason, /ceiling \$44\.00 UNENFORCEABLE/);
  assert.match(stop.reason, /reason=abort, tokens_out=unrecorded, tokens_in=unrecorded/);
  assert.match(
    stop.reason, /aborted by forge's own stream-deadline before ANY assistant message/,
    `the line must name the cause: ${stop.reason}`,
  );
  assert.match(stop.reason, /NOT proof of zero spend/, 'and say why that cause does not price it at $0');
});

test('row 193 (a) the session the row can already see is named — the row has no session_id, its cycle_id carries it', () => {
  const [t] = endedUnpricedTurns([[S10_BEAT30_ABORT_ROW]]);
  assert.equal(t!.sessionId, '_architect-2026-10-02T20-56-58-7c0d2d53', 'session=unknown hid a log dir the row names');
});

test('row 193 (b) an abort AFTER output halts too, with its tokens — and does not claim no output arrived', () => {
  const stop = ceilingHaltVerdict({
    spend: dispatched([ABORT_AFTER_OUTPUT_ROW]),
    ceilingUsd: 44,
    unpriced: endedUnpricedTurns([[ABORT_AFTER_OUTPUT_ROW]]),
  });
  assert.equal(stop.kind, 'unenforceable');
  assert.match(stop.reason, /reason=abort, tokens_out=340, tokens_in=12000/);
  assert.doesNotMatch(stop.reason, /before ANY assistant message/, stop.reason);
});

test('row 193: a `died` turn with no tokens gets no stream-deadline clause — the cause is named only when the row says abort', () => {
  const died = { ...S10_BEAT30_ABORT_ROW, event_id: 'EV_died', metadata: { unpriced_reason: 'died', priced: false } };
  const stop = ceilingHaltVerdict({ spend: dispatched([died]), ceilingUsd: 44, unpriced: endedUnpricedTurns([[died]]) });
  assert.equal(stop.kind, 'unenforceable');
  assert.doesNotMatch(stop.reason, /stream-deadline/, stop.reason);
});
