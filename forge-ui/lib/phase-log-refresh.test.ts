/**
 * Acceptance tests (R6-01 WI-1, F1: "the hex drawer's log must be genuinely
 * live") for a NEW pure module, `./phase-log-refresh.ts`, that does not
 * exist yet — every import below is a legitimate RED (module not found)
 * until the implementer creates it with the exact export this file names.
 *
 * AMENDED (round 2) — the FIRST version of this file attributed a
 * `tailEvents` entry to a node via `event.phase === nodeId`, a naive
 * client-side re-derivation of the attribution the codebase's OWN
 * authoritative resolver (`eventToNodeId`, `orchestrator/
 * run-model-derive.ts`) does NOT do. Measured against the live flow set
 * (`buildNodeMapping`/`buildAgentSlugToNodeId` over `studio/flows/`): only
 * 4 of 12 real phase strings equal their node id (architect, demo, review,
 * unifier) — `developer-loop -> dev` (the busiest node of every real
 * cycle), `project-manager -> pm`, `review-loop -> review`, `reflector ->
 * reflect` all differ. An implementer conforming exactly to the old tests
 * would have shipped F1 non-functional for exactly the nodes operators
 * watch most, with a fully green suite — client-side re-implementation of
 * an attribution that already has one correct, server-side implementation
 * is the wrong fix (the SAME trap that inflated per-node cost 2-3x in this
 * codebase before it was fixed, per `orchestrator/run-model-derive.ts`'s
 * own `sumAuthoritativeCostUsd` comment).
 *
 * THE FIX moves attribution server-side: `RunPhaseMeta` gains an additive
 * `lastEventAt?: string`, computed over EVERY event `eventToNodeId`
 * attributes to a node (not filtered to `PROGRESS_EVENT_TYPES`, unlike its
 * sibling `lastProgressAt`) — pinned at the server/derivation layer by
 * `orchestrator/run-model-last-event-at.test.ts` (a NEW sibling file, this
 * same amendment). This file's job shrinks to match: `tailEvents` is
 * DROPPED from the signature entirely — the function reads the
 * already-server-attributed `run.phaseMeta[nodeId]?.lastEventAt`, no
 * client-side event scanning at all.
 *
 * `refreshActiveRun` (`forge-ui/app/flows/[id]/page.tsx`) already re-fetches
 * the full `Run` on every WebSocket `event` message for the active run (see
 * that file's `onMessage` handler: `if (currentRun && msg.cycleId ===
 * currentRun.id) { ...; void refreshActiveRun(signal, currentRun.id); }`)
 * — confirmed by reading the file directly, not assumed. So a
 * server-attributed `lastEventAt` becomes fresh on the page's existing
 * `activeRun` state with NO new fetch, poll, or emission path: the drawer
 * just needs to key its refresh effect on this new field instead of
 * `lastProgressAt`.
 *
 * ASSUMED EXPORT from `./phase-log-refresh.ts`:
 *
 *   export function phaseLogRefreshSignal(run: Run, nodeId: string): string
 *
 * CONTRACT pinned below (the implementer may pick any internal shape that
 * satisfies these observable behaviours):
 *
 *   1. The returned string CHANGES when `run.phaseMeta[nodeId].lastEventAt`
 *      changes — even when `lastProgressAt` does NOT change (that is
 *      exactly the gap this field exists to close). A signal still keyed
 *      on `lastProgressAt` is the wrong implementation this kills.
 *   2. The returned string does NOT change when a DIFFERENT node's
 *      `lastEventAt` changes — a signal that reads the whole `phaseMeta`
 *      record indiscriminately would cause every open drawer to refetch on
 *      every other node's tick (a refetch storm); this is the wrong
 *      implementation this kills.
 *   3. The returned string is STABLE across two calls with an equal `run`/
 *      `nodeId` and no change — kills a signal seeded with `Date.now()` /
 *      `Math.random()` / object identity.
 *   4. A node with NO `lastEventAt` (absent from `phaseMeta`, or present
 *      but the field itself undefined) still returns a stable, non-
 *      throwing string across repeat calls — kills a crash/`undefined`
 *      return on a phase that hasn't emitted anything attributable yet
 *      (e.g. a `pending` node).
 *   5. An unknown `nodeId` (not a key of `run.phaseMeta` at all) does not
 *      throw — kills an implementation that assumes `phaseMeta[nodeId]` is
 *      always present.
 *
 * RUN: npx vitest run lib/phase-log-refresh.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import type { Run, RunPhaseMeta } from './studio-client.ts';
import { phaseLogRefreshSignal } from './phase-log-refresh.ts';

function makeRun(phaseMeta: Record<string, RunPhaseMeta> = {}): Run {
  return {
    id: 'CYCLE-1',
    flowId: 'forge-develop',
    initiativeId: 'INIT-1',
    initiative: 'Test initiative',
    status: 'active',
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta,
    artifactsReady: {},
  };
}

function meta(overrides: Partial<RunPhaseMeta> = {}): RunPhaseMeta {
  return { costUsd: 0, retries: 0, ...overrides };
}

test('the signal changes when lastEventAt changes for the selected node, even though lastProgressAt does NOT change — kills a signal still keyed on lastProgressAt (the exact gap lastEventAt exists to close: a "log"/"error"-only node whose lastProgressAt never moves)', () => {
  const before = phaseLogRefreshSignal(
    makeRun({ dev: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }) }),
    'dev',
  );
  const after = phaseLogRefreshSignal(
    makeRun({ dev: meta({ lastEventAt: '2026-08-07T00:00:02.000Z' }) }), // lastProgressAt absent in BOTH calls
    'dev',
  );
  expect(after).not.toBe(before);
});

test('the signal does NOT change when a DIFFERENT node\'s lastEventAt changes — kills a signal derived from the whole phaseMeta record indiscriminately, which would refetch every open drawer on every other node\'s tick', () => {
  const before = phaseLogRefreshSignal(
    makeRun({
      dev: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }),
      pm: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }),
    }),
    'dev',
  );
  const after = phaseLogRefreshSignal(
    makeRun({
      dev: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }), // dev's own meta UNCHANGED
      pm: meta({ lastEventAt: '2026-08-07T00:05:00.000Z' }),  // only pm's changed
    }),
    'dev',
  );
  expect(after).toBe(before);
});

test('the signal is stable across two calls with equal run/nodeId and no change — kills a signal seeded with Date.now()/Math.random()/object identity, which would refetch on every render regardless of whether anything new arrived', () => {
  const run = makeRun({ dev: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }) });
  const first = phaseLogRefreshSignal(run, 'dev');
  const second = phaseLogRefreshSignal(makeRun({ dev: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }) }), 'dev'); // fresh object, equal content
  expect(second).toBe(first);
});

test('a node with no lastEventAt at all (present in phaseMeta but the field is undefined) returns a stable, non-throwing string across repeat calls — kills a crash or an undefined return for a phase that has not emitted anything attributable yet', () => {
  const run = makeRun({ dev: meta() }); // no lastEventAt
  const first = phaseLogRefreshSignal(run, 'dev');
  const second = phaseLogRefreshSignal(run, 'dev');
  expect(typeof first).toBe('string');
  expect(second).toBe(first);
});

test('an unknown nodeId (absent from phaseMeta entirely) does not throw and returns a string — kills an implementation that assumes phaseMeta[nodeId] is always present', () => {
  const run = makeRun({ dev: meta({ lastEventAt: '2026-08-07T00:00:01.000Z' }) });
  expect(() => phaseLogRefreshSignal(run, 'nonexistent-node')).not.toThrow();
  expect(typeof phaseLogRefreshSignal(run, 'nonexistent-node')).toBe('string');
});
