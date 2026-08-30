/**
 * ACCEPTANCE TESTS (T3, R6-01 WI-3 / F5) — the pure client-side derivation
 * from a flow node's RAW per-node event response (`cli/bridge-studio-phase-
 * log-raw.test.ts`'s new `GET /api/runs/<id>/phases/<node>/log?raw=1`
 * contract) to `RunLogLine[]`, the shared vocabulary `RunLog.tsx` already
 * renders.
 *
 * `./flow-node-log.ts` does not exist yet — every import below is a
 * legitimate RED until the implementer adds it. This mirrors the SAME
 * pure-resolver precedent `./run-view-client.ts`'s `resolveRunDetailFromResponse`
 * already established for R6-04 (pinned in `./run-view-client.test.ts`):
 * the real `fetch()` + `resolveBridgeUrl()` wiring is a KNOWN GAP (no
 * jsdom/mocked-fetch harness in this repo — same documented pattern as every
 * other client fetch wrapper here), so the fetch wrapper itself
 * (`fetchNodeLog`) is verified by `tsc` + the journey beat only. This file
 * pins the PURE function that wrapper must call.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED NEW EXPORT from `./flow-node-log.ts` (none exist yet):
 *
 *   export function resolveNodeLogFromResponse(status: number, body: unknown): RunLogLine[]
 *   export function fetchNodeLog(runId: string, nodeId: string): Promise<RunLogLine[]>  (untested, KNOWN GAP)
 *
 * `resolveNodeLogFromResponse` degrades honestly on any non-2xx status or
 * malformed body (empty array, never a throw) — mirroring
 * `resolveRunDetailFromResponse`'s own convention — then maps `body.lines`
 * (the RAW per-node event records the new `?raw=1` mode serves) through the
 * EXISTING, unmodified `deriveLogLine` (`./run-log-line.ts`) — the shared
 * think|tool|out mapper. This file does NOT reimplement that classification;
 * a test asserting `kind` values here is really asserting that
 * `deriveLogLine` was actually called, not a second, divergent classifier.
 *
 * MEASURED GROUNDS (task report has the full trace):
 *   - the raw endpoint's line shape carries `event_type`/`message`/`skill`/
 *     `cost_usd`/`metadata` — the same fields `deriveLogLine` reads
 *     (`cli/bridge-studio-phase-log-raw.test.ts`, tests 1-2).
 *   - `deriveLogLine`'s own 11-member `EventType` -> 3-kind mapping is NOT
 *     re-derived here — reused verbatim (`run-log-line.ts:58-65`).
 *
 * RUN: npx vitest run lib/flow-node-log.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { resolveNodeLogFromResponse } from './flow-node-log.ts';

test('a real 200 body maps raw lines through the SHARED deriveLogLine, not a second classifier — kills a hand-rolled kind switch that drifts from run-log-line.ts', () => {
  // NOTE: `deriveLogLine`'s `textFor` ignores `message` entirely for
  // `start`/`end` (formats `skill`(+cost) only) — the 'start · architect'
  // text below comes from `skill`, not from the seeded `message`. This
  // fixture is deliberately built from the SAME shape
  // `cli/bridge-studio-phase-log-raw.test.ts` proves the raw endpoint
  // serves, so a passing test here is grounded in the real wire contract.
  const lines = resolveNodeLogFromResponse(200, {
    lines: [
      { event_type: 'start', message: 'architect.start', skill: 'architect' },
      { event_type: 'tool_use', message: 'reading file', skill: 'architect', metadata: { tool_name: 'Read' } },
      { event_type: 'iteration', skill: 'developer-loop' },
    ],
  });
  expect(lines).toEqual([
    { kind: 'out', text: 'start · architect', eventType: 'start' },
    { kind: 'tool', text: 'reading file', eventType: 'tool_use' },
    { kind: 'think', text: 'iteration (developer-loop)', eventType: 'iteration' },
  ]);
});

test('order is preserved exactly — kills sorting/reversing/deduping the node\'s own event order', () => {
  // 'log' is used for all three lines (deriveLogLine's `default` textFor
  // branch renders `message` verbatim) so distinctness comes from the
  // MESSAGE content, not from event-type-specific formatting — isolating
  // this test to ordering alone. (`start`/`end` each ignore `message`
  // entirely — see the previous test's own note.)
  const lines = resolveNodeLogFromResponse(200, {
    lines: [
      { event_type: 'log', skill: 'dev', message: 'FIRST' },
      { event_type: 'log', skill: 'dev', message: 'SECOND' },
      { event_type: 'log', skill: 'dev', message: 'THIRD' },
    ],
  });
  expect(lines.map((l) => l.text)).toEqual(['FIRST', 'SECOND', 'THIRD']);
});

test('a 404 (or any non-2xx) status degrades to an empty array, never a fabricated line — kills reading body.lines before checking status', () => {
  expect(resolveNodeLogFromResponse(404, {
    lines: [{ event_type: 'start', skill: 'dev', message: 'should never surface' }],
  })).toEqual([]);
  expect(resolveNodeLogFromResponse(500, { error: 'internal error' })).toEqual([]);
});

test('a 200 with an empty lines array yields an empty array, honestly — never invented filler', () => {
  expect(resolveNodeLogFromResponse(200, { lines: [] })).toEqual([]);
});

test('a malformed/missing 200 body degrades to empty rather than throwing — kills a crash on an unexpected shape taking the whole page load down', () => {
  expect(() => resolveNodeLogFromResponse(200, null)).not.toThrow();
  expect(resolveNodeLogFromResponse(200, null)).toEqual([]);
  expect(resolveNodeLogFromResponse(200, 'not an object')).toEqual([]);
  expect(resolveNodeLogFromResponse(200, {})).toEqual([]);
});

test('the REAL failure message is preserved verbatim for an error-kind line — kills a generic "an error occurred" placeholder', () => {
  const lines = resolveNodeLogFromResponse(200, {
    lines: [{ event_type: 'error', skill: 'architect', message: 'ARCHITECT-ONLY-ERROR-MARKER' }],
  });
  expect(lines).toEqual([{ kind: 'out', text: 'error: ARCHITECT-ONLY-ERROR-MARKER', eventType: 'error' }]);
});

test('an unrecognised event_type (outside the 11-member union) still produces a line, never crashes or vanishes — matches deriveLogLine\'s own documented fallback', () => {
  const lines = resolveNodeLogFromResponse(200, {
    lines: [{ event_type: 'some-future-type', skill: 'dev', message: 'from the future' }],
  });
  expect(lines).toEqual([{ kind: 'out', text: 'from the future', eventType: 'some-future-type' }]);
});
