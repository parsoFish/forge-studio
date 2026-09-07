/**
 * S9 beat 8 — "cost recorded" — and exit row 2 of the M6-A brief: a session's
 * spend is derived from its own `events.jsonl` through the ONE kernel
 * `event-cost` rule, never a second computation.
 *
 * There IS a second computation today: `readSessionLogFacts`
 * (`packages/agents/bridge-agents-history-rows.ts:340`) naive-sums every
 * `cost_usd` it finds. Naive summing overcounts — measured 2.35x on M5-A —
 * because a phase that emits `iteration` events RESTATES the same dollars on
 * its per-item and rollup `end` rows. The first test below is written so that
 * a naive sum gives a DIFFERENT number from the right one: if the two agreed,
 * the test would pass over the defect it exists to catch.
 *
 * Honest-absent, not a fabricated zero: a session whose log carries no
 * `cost_usd` on any row has no figure, and `null` is the answer. That is the
 * same convention `HistoryLedger` already keeps (`data-ledger-cost-usd` is
 * omitted, never zeroed, when a cost genuinely does not exist) and the reason
 * S9 run 4 could report `spend: UNMEASURED` rather than `$0.00`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveSessionCostUsd, sumAuthoritativeCostUsd, type EventLogEntry } from '@forge/kernel';
import { readSessionCostUsd, sessionLogDirName } from '@forge/sessions';

/** One event-log row, in the shape a session's `events.jsonl` holds. */
function ev(over: Partial<EventLogEntry> & { event_id: string }): EventLogEntry {
  return {
    cycle_id: '_authoring-2026-09-07T00-00-00-abcdef',
    initiative_id: 'interactive-authoring-2026-09-07T00-00-00-abcdef',
    started_at: '2026-09-07T00:00:00.000Z',
    phase: 'developer',
    skill: 'creation-agent',
    event_type: 'end',
    input_refs: [],
    output_refs: [],
    ...over,
  } as EventLogEntry;
}

/**
 * Two priced turns and one restatement of the second: an `iteration` phase
 * carries its authoritative spend on the `iteration` rows, and the phase's
 * rollup `end` restates dollars already counted.
 *
 * naive sum = 1.00 + 2.00 + 3.00 = 6.00
 * the rule   = 1.00 + 2.00        = 3.00
 */
const TWO_TURNS_AND_A_RESTATEMENT: EventLogEntry[] = [
  ev({ event_id: 'e1', event_type: 'iteration', iteration: 1, cost_usd: 1.0 }),
  ev({ event_id: 'e2', event_type: 'iteration', iteration: 2, cost_usd: 2.0 }),
  ev({ event_id: 'e3', event_type: 'end', cost_usd: 3.0 }),
];

test('a session\'s cost is the kernel rule\'s figure, not the naive sum', () => {
  const naive = TWO_TURNS_AND_A_RESTATEMENT.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
  assert.equal(naive, 6.0, 'fixture guard: the naive sum must differ, or this test proves nothing');

  const derived = deriveSessionCostUsd(TWO_TURNS_AND_A_RESTATEMENT as unknown as Record<string, unknown>[]);

  assert.equal(derived, sumAuthoritativeCostUsd(TWO_TURNS_AND_A_RESTATEMENT));
  assert.equal(derived, 3.0);
  assert.notEqual(derived, naive);
});

test('a log with no priced row has no figure — null, never a fabricated 0', () => {
  const unpriced = [ev({ event_id: 'e1', event_type: 'start' }), ev({ event_id: 'e2', event_type: 'log' })];
  assert.equal(deriveSessionCostUsd(unpriced as unknown as Record<string, unknown>[]), null);
});

test('a priced log that genuinely totals zero is 0, not null', () => {
  const zero = [ev({ event_id: 'e1', event_type: 'end', cost_usd: 0 })];
  assert.equal(deriveSessionCostUsd(zero as unknown as Record<string, unknown>[]), 0);
});

test('readSessionCostUsd reads the session\'s own guarded log dir by kind + id', () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'session-cost-'));
  const kind = 'authoring';
  const sessionId = '2026-09-07T00-00-00-abcdef';
  const dir = join(logsRoot, sessionLogDirName(kind, sessionId));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'events.jsonl'),
    TWO_TURNS_AND_A_RESTATEMENT.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );

  assert.equal(readSessionCostUsd({ logsRoot, kind, sessionId }), 3.0);
});

test('a session with no log dir at all has no figure', () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'session-cost-'));
  assert.equal(readSessionCostUsd({ logsRoot, kind: 'authoring', sessionId: 'never-ran' }), null);
});
