/**
 * Acceptance tests (R6-01 WI-1, F1: "the hex drawer's log must be genuinely
 * live") for a NEW pure module, `./phase-log-refresh.ts`, that does not
 * exist yet — every import below is a legitimate RED (module not found)
 * until the implementer creates it with the exact export this file names.
 *
 * BACKGROUND (measured, not assumed — see the task's evidence trail):
 *
 *   `PhaseDrawer.tsx`'s live-refresh effect (DrawerBody, Effect 2,
 *   `components/studio/PhaseDrawer.tsx:256-267`) re-fetches the phase log
 *   ONLY when `meta.lastProgressAt` changes. `lastProgressAt` is derived by
 *   `orchestrator/run-model-derive.ts`'s `PROGRESS_EVENT_TYPES`:
 *
 *     PROGRESS_EVENT_TYPES = new Set(['tool_use', 'file_change', 'test_run', 'iteration'])
 *
 *   ...verified by reading that file verbatim (line 31). `orchestrator/
 *   logging.ts`'s real `EventType` union has 11 members; the 7 NOT in that
 *   set — start / end / log / error / phase_transition / agent_heartbeat /
 *   brain-query — never move `lastProgressAt`, so a node that emits (say) a
 *   `log`-typed line (the reasoning-stream / narration channel —
 *   `cli/bridge-studio.ts`'s `classifyEvent` routes `event_type:'log'` +
 *   `metadata.kind:'reasoning'` to the `reasoning` display kind) or an
 *   `error`-typed line NEVER triggers Effect 2. Confirmed by execution
 *   (`GET /api/runs/<id>/phases/<node>/log` DOES return every one of the 11
 *   event types with nothing dropped server-side — see the WI-1 report's
 *   [exec] (a) — so this is purely a client-side staleness bug: new lines
 *   exist and are servable, the drawer just never asks for them again).
 *
 * `phaseLogRefreshSignal` is the new pure derivation the drawer's Effect 2
 * will key on INSTEAD OF (or alongside) `lastProgressAt`, computed from data
 * the page already holds — `tailEvents`, the rolling last-100 array every
 * flow-monitor page already receives over the existing WebSocket
 * (`app/flows/[id]/page.tsx:160-183`) — no new emission path, per the task
 * brief's explicit constraint.
 *
 * ASSUMED EXPORT from `./phase-log-refresh.ts`:
 *
 *   export function phaseLogRefreshSignal(
 *     run: Run,
 *     nodeId: string,
 *     tailEvents: EventLogEntry[],
 *   ): string
 *
 * CONTRACT pinned below (the implementer may pick any internal shape that
 * satisfies these three observable behaviours):
 *
 *   1. The returned string CHANGES when `tailEvents` gains a new event
 *      whose `phase === nodeId` and whose `event_type` is OUTSIDE
 *      PROGRESS_EVENT_TYPES (e.g. 'log' or 'error') — this is the exact gap
 *      above; a signal that ignores such an event is the wrong
 *      implementation this test class kills.
 *   2. The returned string does NOT change when the only new event in
 *      `tailEvents` belongs to a DIFFERENT node (`phase !== nodeId`) — a
 *      signal that changes on ANY new event system-wide would cause a
 *      refetch storm (every open drawer re-fetching on every other node's
 *      tick); this is the wrong implementation this test class kills.
 *   3. The returned string is STABLE (identical) across two calls with
 *      equal `run`/`nodeId`/`tailEvents` and no new qualifying event — a
 *      signal seeded with `Date.now()`/`Math.random()`/array identity would
 *      cause the drawer to refetch on every render regardless of whether
 *      anything new arrived; that is the wrong implementation this test
 *      class kills.
 *
 * RUN: npx vitest run lib/phase-log-refresh.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import type { EventLogEntry } from './bridge-client.ts';
import type { Run } from './studio-client.ts';
import { phaseLogRefreshSignal } from './phase-log-refresh.ts';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'CYCLE-1',
    flowId: 'forge-develop',
    initiativeId: 'INIT-1',
    initiative: 'Test initiative',
    status: 'active',
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    ...overrides,
  };
}

function ev(overrides: Partial<EventLogEntry> & { phase: string; event_type: string }): EventLogEntry {
  return {
    event_id: `EV-${Math.random().toString(36).slice(2)}`,
    initiative_id: 'INIT-1',
    started_at: '2026-08-07T00:00:00.000Z',
    skill: overrides.phase,
    ...overrides,
  } as EventLogEntry;
}

test('a new "log"-typed event for the selected node changes the signal — kills a signal that only reacts to PROGRESS_EVENT_TYPES (tool_use/file_change/test_run/iteration), reproducing the exact stale-pane defect this feature exists to fix', () => {
  const run = makeRun();
  const before = phaseLogRefreshSignal(run, 'demo', []);
  const logEvent = ev({ phase: 'demo', event_type: 'log', message: 'demo.working-on-ac-2', event_id: 'EV-LOG-1' });
  const after = phaseLogRefreshSignal(run, 'demo', [logEvent]);
  expect(after).not.toBe(before);
});

test('a new "error"-typed event for the selected node ALSO changes the signal — kills a hardcoded single-type check (e.g. `=== "log"`) that happens to catch the "log" case above but not "error"', () => {
  const run = makeRun();
  const before = phaseLogRefreshSignal(run, 'demo', []);
  const errorEvent = ev({ phase: 'demo', event_type: 'error', message: 'Transient tool failure', event_id: 'EV-ERR-1' });
  const after = phaseLogRefreshSignal(run, 'demo', [errorEvent]);
  expect(after).not.toBe(before);
});

test('a new event for a DIFFERENT node does not change the signal for the selected node — kills a signal derived from tailEvents.length (or any other node-blind aggregate), which would refetch every open drawer on every event system-wide', () => {
  const run = makeRun();
  const before = phaseLogRefreshSignal(run, 'demo', []);
  const otherNodeEvent = ev({ phase: 'adversarial-review', event_type: 'log', message: 'review.findings.authored', event_id: 'EV-OTHER-1' });
  const after = phaseLogRefreshSignal(run, 'demo', [otherNodeEvent]);
  expect(after).toBe(before);
});

test('the signal is stable across two calls with equal inputs and no new qualifying event — kills a signal seeded with Date.now()/Math.random()/array identity, which would refetch on every render regardless of whether anything new arrived', () => {
  const run = makeRun();
  const tailEvents = [
    ev({ phase: 'demo', event_type: 'tool_use', message: 'Read', event_id: 'EV-TOOL-1' }),
  ];
  const first = phaseLogRefreshSignal(run, 'demo', tailEvents);
  const second = phaseLogRefreshSignal(run, 'demo', [...tailEvents]); // fresh array, equal content
  expect(second).toBe(first);
});

test('the return type is a string — kills an implementation returning a non-string (object/number) that would break a useEffect dependency-array comparison the drawer relies on', () => {
  const run = makeRun();
  const result = phaseLogRefreshSignal(run, 'demo', []);
  expect(typeof result).toBe('string');
});
