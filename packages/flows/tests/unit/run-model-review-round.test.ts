/**
 * `findReviewRound` — bead `forge-8vfn.8.1.23`, T1 rulings 1577/1579, S10 run 30.
 *
 * A send-back CONTINUES the same cycle (DEC-2): its events.jsonl is one
 * growing log across every round, so `deriveNodeStatuses`' `review` node
 * status answers "is the review station done" and stays `complete` from the
 * FIRST round onward — it cannot say WHICH round. Run 30 measured the cost of
 * that gap: a beat asserting only `node-id: 'review', status: 'complete'`
 * went green 0.7 s after the send-back press, on round 1's own terminal
 * state, because nothing on the page distinguished "reviewed once" from
 * "reviewed again".
 *
 * `findReviewRound` counts COMPLETED `adversarial-review` passes — `end`
 * events only, never `start` — so a round in progress never counts as done.
 * The event shape below (`phase: 'orchestrator', skill: 'adversarial-review',
 * event_type: 'end'`) is copied verbatim from run 30's own
 * `_logs/<cycle>/events.jsonl`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReviewRound } from '../../run-model-derive.ts';
import type { EventLogEntry, Phase } from '@forge/kernel';

let seq = 0;
function ev(
  skill: string,
  event_type: 'start' | 'end' | 'log',
  opts: { phase?: Phase | string } = {},
): EventLogEntry {
  seq += 1;
  return {
    event_id: `e-${seq}`,
    cycle_id: 'CYCLE-test',
    initiative_id: 'INIT-test',
    phase: (opts.phase ?? 'orchestrator') as Phase,
    skill,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at: new Date(1700000000000 + seq * 1000).toISOString(),
  } as EventLogEntry;
}

test('findReviewRound: zero before any adversarial-review pass has finished', () => {
  assert.equal(findReviewRound([]), 0);
  assert.equal(findReviewRound([ev('adversarial-review', 'start')]), 0);
});

test('findReviewRound: one after the FIRST pass ends, exactly run 30\'s round-1 shape', () => {
  const events = [
    ev('demo-agent', 'start'),
    ev('demo-agent', 'end'),
    ev('adversarial-review', 'start'),
    ev('adversarial-review', 'end'),
  ];
  assert.equal(findReviewRound(events), 1);
});

test('findReviewRound: still one WHILE the second pass is running — a round in progress is not a round done', () => {
  const events = [
    ev('adversarial-review', 'start'),
    ev('adversarial-review', 'end'),
    // the send-back, and the continuation's own dev/demo work, land in the
    // SAME log (DEC-2) — none of it is an adversarial-review end.
    ev('review-verdict', 'log'),
    ev('demo-agent', 'start'),
    ev('demo-agent', 'end'),
    ev('adversarial-review', 'start'),
  ];
  assert.equal(findReviewRound(events), 1);
});

test('findReviewRound: two once the SECOND pass ends, run 30\'s re-review shape', () => {
  const events = [
    ev('adversarial-review', 'start'),
    ev('adversarial-review', 'end'),
    ev('review-verdict', 'log'),
    ev('adversarial-review', 'start'),
    ev('adversarial-review', 'end'),
  ];
  assert.equal(findReviewRound(events), 2);
});

test('findReviewRound: only THIS skill counts — an end event on a different phase/skill is not a review pass', () => {
  const events = [
    ev('adversarial-review', 'end'),
    ev('cycle', 'end', { phase: 'orchestrator' }),
    ev('review-router', 'end', { phase: 'review-loop' }),
  ];
  assert.equal(findReviewRound(events), 1);
});
