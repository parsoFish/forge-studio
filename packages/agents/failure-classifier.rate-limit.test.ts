/**
 * forge-rofi — the rate/usage-limit scan is scoped to `log` events.
 *
 * A SEPARATE FILE, and the reason is the ceiling. `failure-classifier.test.ts`
 * sits at 1,235 lines against an exact-size `check-file-size` baseline, and an
 * exemption is a ceiling, not a licence: adding these four controls there grew
 * it to 1,317 and the guard refused. They are a self-contained cluster about
 * one rule, so they get their own file rather than a raised baseline — which
 * also starts exit row 5's split of that file from the end that has a reason
 * to move, instead of an arbitrary cut.
 *
 * THE DEFECT. `matchesRateLimitSignature` was applied to EVERY event type. A
 * `tool_use` message is agent-authored by construction, so an agent writing
 * rate-limit handling code could stamp its own cycle "rate-limited" — and a
 * cycle classified transient is RETRIED rather than surfaced, so a real
 * terminal failure disappears behind a retry loop.
 *
 * THE MEASUREMENT THAT CHOSE THE FIX. Before a line changed, the whole
 * archived corpus was scanned: `/home/parso/forge/_logs`, 356 `events.jsonl`,
 * 1,126,655 events. The four signatures appear FOURTEEN times and every one is
 * `event_type: 'log'`. Nothing else has ever carried one — not 36,578
 * `tool_use`, not 6,117 `file_change`, not 1,024,605 `agent_heartbeat`.
 *
 * THE RESIDUAL, stated because it is the honest limit of this fix: all
 * fourteen hits are `log` + `metadata.kind: 'reasoning'`. The CLI echoes its
 * limit line into the same channel the agent thinks aloud in, so event-type
 * scoping narrows the reachable surface by ~95% but cannot separate those two.
 * Doing so means tightening the SIGNATURES to their machine shapes, which
 * changes retry behaviour and is a ruling, not a refactor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCycleFailure } from './failure-classifier.ts';
import type { EventLogEntry } from '@forge/kernel';

/** The sibling suite's fixture builder, duplicated rather than exported: a
 *  `.test.ts` that exports a helper becomes an import target for other tests
 *  and starts constraining what it may assert. Twelve lines is the cheaper
 *  side of that trade. */
function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-x',
    started_at: '2026-06-07T00:00:00.000Z',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

/** Verbatim from the corpus — one of only three distinct real hit texts. */
const HIT_YOUR_LIMIT = "You've hit your limit · resets 12:10am (Australia/Brisbane)";

test('forge-rofi: a tool_use event whose message carries a limit signature does NOT classify the cycle rate-limited — an agent writing rate-limit handling code cannot mask a terminal failure', () => {
  const events = [
    ev({ event_type: 'start' }),
    // The agent is WRITING rate-limit handling: the literal appears in a
    // tool_use message, which is agent-authored content by construction.
    ev({ event_type: 'tool_use', message: `Edit retry.ts: if (err.type === 'rate_limit_error') backoff()` }),
    // …and the cycle then dies of something real and terminal.
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'developer-loop: 0/3 work items completed — total failure',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'terminal');
  assert.doesNotMatch(c.reason, /rate.?limit/i);
});

test('forge-rofi: the REAL shape still classifies — the CLI limit line in a log/reasoning event, verbatim from the corpus', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({ event_type: 'log', message: HIT_YOUR_LIMIT, metadata: { kind: 'reasoning' } }),
    ev({
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      message: 'developer-loop: 0/3 work items completed — total failure',
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /rate.?limit/i);
});

test('forge-rofi: the OTHER real shape still classifies — a raw 529 API error blob echoed into reasoning, verbatim from the corpus', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'log',
      metadata: { kind: 'reasoning' },
      message:
        'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011Ccg1XRQPZQ7Xx4YzfqvLg"}',
    }),
    ev({ phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: 'developer-loop: 0/3 work items completed — total failure' }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /rate.?limit/i);
});

test('forge-rofi: the structured rate_limited flag is NOT scoped by event type — it still fires on a ralph.end (an `end` event)', () => {
  const events = [
    ev({ event_type: 'start' }),
    ev({
      event_type: 'end',
      message: 'ralph.end',
      metadata: { work_item_id: 'WI-1', status: 'failed', rate_limited: true },
    }),
    ev({ phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: 'developer-loop: 0/1 work items completed — total failure' }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /rate.?limit/i);
});

