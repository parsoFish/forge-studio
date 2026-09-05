/**
 * Bead forge-8vfn.6.10.22 — the architect is counted ONCE.
 *
 * `runCycle` was entered twice for one `cycle_id` (the claim, then a second
 * serve pass) and each entry emitted a fresh synthetic `architect.end`
 * restating the architect's whole spend. `isAuthoritativeCostEvent` cannot see
 * it: that rule drops a rollup only for a phase that emitted an `iteration`
 * event, and the architect never emits one — it runs out-of-cycle and its
 * dollars reach the cycle log only as this synthetic pair. So every reader that
 * sums the log agreed with the log and was wrong together: Studio's run cost,
 * the cycle report, and the harness's gate figure.
 *
 * The duplicate is a property of the STREAM, not of any single event, so the
 * per-event `isAuthoritativeCostEvent` keeps its narrow meaning and the new
 * fact is built once per stream. `countsTowardCost` composes the two, and
 * every summing caller uses it.
 *
 * Fixture: G2's own two logs (`test-fixtures/g2-restatement/`, see its README
 * for exactly what was trimmed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  costStreamFacts,
  countsTowardCost,
  isAuthoritativeCostEvent,
  restatedSyntheticEventIds,
  sumAuthoritativeCostUsd,
} from './event-cost.ts';
import type { EventLogEntry } from './logging.ts';

const FIXTURES = join(import.meta.dirname, 'test-fixtures', 'g2-restatement');
const read = (name: string): EventLogEntry[] =>
  readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);

const CYCLE = read('g2-cycle-events.jsonl');
const SESSION = read('g2-architect-session-events.jsonl');

/** The run's real deduplicated spend, ruling 279's method, to the cent. */
const G2_TRUTH_USD = 23.9721;
/** What the architect actually cost, from its own session log. */
const G2_ARCHITECT_USD = 2.3327;

test('the fixture is the real run: two architect.end rows, one session, the same dollars — the shape the defect makes', () => {
  const architectEnds = CYCLE.filter((e) => e.phase === 'architect' && e.event_type === 'end');
  assert.equal(architectEnds.length, 2, 'G2 emitted the synthetic pair twice');
  assert.equal(new Set(architectEnds.map((e) => e.event_id)).size, 2, 'distinct event_ids — a naive id dedup would not have caught it');
  assert.equal(new Set(architectEnds.map((e) => (e.metadata as { session_id?: string })?.session_id)).size, 1, 'one architect session');
  assert.equal(architectEnds[0]?.cost_usd, architectEnds[1]?.cost_usd, 'each restates the whole amount');
  assert.equal(
    Number(sumAuthoritativeCostUsd(SESSION).toFixed(4)),
    G2_ARCHITECT_USD,
    'the session log is the architect\'s truth',
  );
});

test('kills "the iteration rule already covers this": isAuthoritativeCostEvent calls BOTH restatements authoritative', () => {
  const facts = costStreamFacts(CYCLE);
  const architectEnds = CYCLE.filter((e) => e.phase === 'architect' && e.event_type === 'end');
  for (const e of architectEnds) {
    assert.equal(
      isAuthoritativeCostEvent(e, facts.iterationPhases),
      true,
      'the architect emits no iteration event, so the rollup rule has nothing to latch on — this is why the defect survived',
    );
  }
});

test('kills "count the first, drop the rest" being applied to the wrong row: only the SECOND restatement is dropped', () => {
  const restated = restatedSyntheticEventIds(CYCLE);
  const architectEnds = CYCLE.filter((e) => e.phase === 'architect' && e.event_type === 'end');
  assert.equal(restated.size, 1, 'exactly one row is a restatement of a session already counted');
  assert.equal(restated.has(architectEnds[0]!.event_id), false, 'the first is the spend');
  assert.equal(restated.has(architectEnds[1]!.event_id), true, 'the second restates it');
  assert.equal(countsTowardCost(architectEnds[0]!, costStreamFacts(CYCLE)), true);
  assert.equal(countsTowardCost(architectEnds[1]!, costStreamFacts(CYCLE)), false);
});

test('kills "the dedup also eats real spend": every non-architect cost row still counts, and a single architect.end is untouched', () => {
  const firstEndId = CYCLE.find((e) => e.phase === 'architect' && e.event_type === 'end')!.event_id;
  const single = CYCLE.filter((e) => e.phase !== 'architect' || e.event_id === firstEndId);
  const restated = restatedSyntheticEventIds(single);
  assert.equal(restated.size, 0, 'a log with one architect emission has nothing to drop');
  const facts = costStreamFacts(CYCLE);
  for (const e of CYCLE) {
    if (e.phase === 'architect') continue;
    assert.equal(
      countsTowardCost(e, facts),
      isAuthoritativeCostEvent(e, facts.iterationPhases),
      `${e.phase}/${e.message ?? e.event_type} must be decided by the unchanged rule`,
    );
  }
});

test('THE PIN: G2\'s cycle log sums to $23.9721 — row 6\'s figure — not the $26.3048 it summed to', () => {
  assert.equal(Number(sumAuthoritativeCostUsd(CYCLE).toFixed(4)), G2_TRUTH_USD);
});

test('kills "the fix only works on the whole stream": a SUB-BUCKET summed with the stream\'s facts drops the same row', () => {
  // `run-model-derive.ts` sums per-node buckets against the whole cycle's
  // facts. A bucket holding both architect rows must reach the same answer as
  // the whole log does for that phase, or a per-node figure disagrees with the
  // total it rolls into.
  const facts = costStreamFacts(CYCLE);
  const architectOnly = CYCLE.filter((e) => e.phase === 'architect');
  assert.equal(Number(sumAuthoritativeCostUsd(architectOnly, facts).toFixed(4)), G2_ARCHITECT_USD);
});
