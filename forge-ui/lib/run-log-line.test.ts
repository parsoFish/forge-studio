/**
 * Acceptance tests for the shared log-line renderer's PURE mapping half
 * (R6-04 WI-4 item 2) — turning one real orchestrator event (the
 * `EventLogEntry` shape mirrored client-side in `./bridge-client.ts`, the
 * SAME type `EventTail.tsx` already imports — see that file's own
 * `import type { EventLogEntry } from '@/lib/bridge-client';`) into a typed,
 * renderable `RunLogLine`. `./run-log-line.ts` does not exist yet — it is a
 * NEW pure file this test pins into existence; every import below is a
 * legitimate RED (module not found) until the implementer creates it with
 * the exact exports named here.
 *
 * WHY THREE KINDS, NOT ELEVEN: `orchestrator/logging.ts`'s `EventType`
 * union has 11 members (start / end / log / error / tool_use / iteration /
 * file_change / test_run / phase_transition / agent_heartbeat /
 * brain-query). `mockups/studio-endstate-v2/data.jsx`'s `NODE_LOGS` /
 * `AGENT_RUN.log` fixtures establish the DISPLAY vocabulary as exactly
 * three kinds — think / tool / out — so `RunLogLine.kind` is a mapping FROM
 * the 11 real types ONTO those 3 display buckets, never a new event-type
 * vocabulary of its own (task brief, explicit: "Do NOT invent new event
 * types" — 'start'/'end' ARE the real terminals; the mockup's
 * "SessionStart …" text is PRESENTATION of those, not a fourth type).
 *
 * Deliberately NOT pinned here (left to the implementer, genuinely
 * ambiguous given only 3 display buckets for 11 real types): the exact
 * `kind` chosen for 'error' / 'phase_transition' / 'agent_heartbeat' /
 * 'brain-query' / 'file_change' / 'test_run'. What IS pinned for 'error' is
 * that its real `message` detail is never discarded (see the test below) —
 * an unambiguous, meaningful acceptance criterion regardless of which of
 * the 3 kinds it lands in.
 *
 * ASSUMED EXPORTS from `./run-log-line.ts`:
 *
 *   export type RunLogLine = {
 *     kind: 'think' | 'tool' | 'out';
 *     text: string;
 *     eventType: string;   // the RAW event_type this line was derived from
 *   };
 *   export function deriveLogLine(event: EventLogEntry): RunLogLine
 *
 * RUN: npx vitest run lib/run-log-line.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import type { EventLogEntry } from './bridge-client.ts';
import { deriveLogLine } from './run-log-line.ts';

function ev(overrides: Partial<EventLogEntry> & { event_type: string }): EventLogEntry {
  return {
    event_id: 'EV_1',
    initiative_id: 'init-1',
    started_at: '2026-08-07T00:00:00.000Z',
    phase: 'orchestrator',
    skill: 'issue-triage',
    ...overrides,
  } as EventLogEntry;
}

test('tool_use -> kind "tool" — kills a mapper that routes every event to "out"', () => {
  const line = deriveLogLine(ev({ event_type: 'tool_use', message: 'Bash · npm test' }));
  expect(line.kind).toBe('tool');
});

test('iteration -> kind "think" — the closest real analogue to the mockup\'s reasoning-step entries — kills a mapper with only two live buckets (tool/out) that never produces "think" at all', () => {
  const line = deriveLogLine(ev({ event_type: 'iteration', message: 'iteration 2' }));
  expect(line.kind).toBe('think');
});

test('start -> kind "out", and the text surfaces the REAL skill field rather than a hardcoded generic string — kills "SessionStart" (or any fixed literal) rendered verbatim regardless of which agent actually ran', () => {
  const lineA = deriveLogLine(ev({ event_type: 'start', skill: 'issue-triage' }));
  const lineB = deriveLogLine(ev({ event_type: 'start', skill: 'developer' }));
  expect(lineA.kind).toBe('out');
  expect(lineA.text).toContain('issue-triage');
  expect(lineB.text).toContain('developer');
  expect(lineA.text).not.toBe(lineB.text);
});

test('end -> kind "out" with non-empty text — kills "kind out but text empty/undefined"', () => {
  const line = deriveLogLine(ev({ event_type: 'end', skill: 'issue-triage', cost_usd: 0.34 }));
  expect(line.kind).toBe('out');
  expect(line.text.length).toBeGreaterThan(0);
});

test('error: the event\'s own `message` is preserved VERBATIM in the rendered text, never replaced by a generic "an error occurred" — kills a mapper that discards the real failure detail', () => {
  const line = deriveLogLine(ev({ event_type: 'error', message: 'ENOENT: brain-query.md not found' }));
  expect(line.text).toContain('ENOENT: brain-query.md not found');
});

test('an event_type OUTSIDE the real 11-member EventType union does not crash the mapper AND does not silently vanish — the raw type stays visible, both structurally and in the text — kills BOTH "throws, taking the whole log render down with it" AND "swallows unknown types into an empty/undefined line"', () => {
  const line = deriveLogLine(ev({ event_type: 'made_up_future_event_type' }));
  expect(['think', 'tool', 'out']).toContain(line.kind);
  expect(line.eventType).toBe('made_up_future_event_type');
  expect(line.text).toContain('made_up_future_event_type');
});

test('a materials-staged `log` event is NOT filtered out of the mapped stream — kills "the renderer special-cases materials elsewhere and drops this event_type from the scrolling log entirely"', () => {
  const line = deriveLogLine(
    ev({
      event_type: 'log',
      message: 'agent-run.materials-staged',
      metadata: { materials: [{ path: 'materials/x.png', kind: 'images' }] },
    }),
  );
  expect(line.text.length).toBeGreaterThan(0);
  expect(['think', 'tool', 'out']).toContain(line.kind);
});
