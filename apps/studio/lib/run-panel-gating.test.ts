/**
 * run-panel-gating.test.ts — W7-D1 (the Wave D gate's signal 1).
 *
 * THE DEFECT THIS PINS, reproduced live before a line was written:
 *
 *   `RunPanel` mounts -> `fetchLatestStandaloneRun(slug)` (W7-B5 agents-26,
 *   which deliberately stopped filtering on `status === 'running'`) adopts the
 *   agent's most recent standalone run id -> `runState = status?.state ??
 *   (runId ? 'running' : 'idle')` fabricates 'running' for the whole pre-poll
 *   window -> `controlsDisabled = ... || runningNow` disabled the ENTIRE run
 *   form. Every leftover `_logs/_agent-<slug>-<stamp>` dispatch that died
 *   without a terminal marker derives `state: "running"` FOREVER (one `log`
 *   event, no end event), and `pollAgentRun`'s `onTimeout` deliberately KEEPS
 *   that last real state and only adds `pollExhausted` — so the lock never
 *   lifted. An agent whose last standalone run died could never be run again
 *   from the UI, and the disabled `<select>`/`<textarea>`/ceiling carried no
 *   `data-disabled-reason` at all.
 *
 * THE THREE RULINGS PINNED HERE:
 *
 *   1. The FORM (project / inputs / ceiling / materials) and the RUN CONTROL
 *      are gated separately. agents-29's own words are "the *Run control*
 *      stays disabled while the DISPATCHED run itself is still running" —
 *      editing the next run's project while one is in flight harms nothing,
 *      and disabling it is what actually bricks the surface.
 *   2. `pollExhausted` ends the "in flight" claim. The panel already renders
 *      a 'timed-out' chip from that flag; a surface cannot simultaneously say
 *      "timed out" and "a run is already in flight". We block a second
 *      dispatch only while we are ACTIVELY observing a running run.
 *   3. Every disabled thing names WHY (`data-disabled-reason`, C3's
 *      convention + `scripts/check-disabled-reason.mjs`) — inputs included,
 *      not just CTAs.
 *
 * RUN: cd forge-ui && npx vitest run lib/run-panel-gating.test.ts
 */

import { expect, test } from 'vitest';
import { deriveRunGating, type RunGatingInput } from './run-panel-gating';

const SAVE_HINT = 'Save the agent (no unsaved changes) to run it';
const IN_FLIGHT = 'A run is already in flight';

function input(overrides: Partial<RunGatingInput> = {}): RunGatingInput {
  return {
    canRun: true,
    blockedMessage: '',
    standaloneBlockedReason: null,
    dispatching: false,
    runState: 'idle',
    pollExhausted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The happy path stays exactly as it was.
// ---------------------------------------------------------------------------

test('a saved, unblocked, idle agent: nothing is disabled and no reason is invented', () => {
  const g = deriveRunGating(input());
  expect(g.formDisabled).toBe(false);
  expect(g.formDisabledReason).toBeNull();
  expect(g.runDisabled).toBe(false);
  expect(g.runDisabledReason).toBeNull();
});

// ---------------------------------------------------------------------------
// RULING 1 — form vs run control.
// ---------------------------------------------------------------------------

test('THE DEFECT: an actively-running run disables the RUN CONTROL only — the form stays editable', () => {
  const g = deriveRunGating(input({ runState: 'running' }));
  expect(g.runDisabled).toBe(true);
  expect(g.runDisabledReason).toBe(IN_FLIGHT);
  // The whole point: the project select / inputs / ceiling remain usable.
  expect(g.formDisabled).toBe(false);
  expect(g.formDisabledReason).toBeNull();
});

test('a reason that is about the AGENT (not about a run) disables BOTH — there is nothing to edit toward', () => {
  for (const reason of ['blockedMessage', 'standaloneBlockedReason'] as const) {
    const g = deriveRunGating(input(
      reason === 'blockedMessage'
        ? { blockedMessage: 'connection "git" is not ready' }
        : { standaloneBlockedReason: 'ralph loops run inside the develop flow' },
    ));
    expect(g.formDisabled, reason).toBe(true);
    expect(g.runDisabled, reason).toBe(true);
    expect(g.formDisabledReason, reason).toBe(g.runDisabledReason);
    expect(g.formDisabledReason, reason).toMatch(reason === 'blockedMessage' ? /connection "git"/ : /ralph/);
  }
});

test('an unsaved/new agent disables both, naming the save hint', () => {
  const g = deriveRunGating(input({ canRun: false }));
  expect(g.formDisabled).toBe(true);
  expect(g.formDisabledReason).toBe(SAVE_HINT);
  expect(g.runDisabled).toBe(true);
  expect(g.runDisabledReason).toBe(SAVE_HINT);
});

test('an in-flight POST (dispatching) disables both — the form must not change under a request already on the wire', () => {
  const g = deriveRunGating(input({ dispatching: true }));
  expect(g.formDisabled).toBe(true);
  expect(g.formDisabledReason).toBe('Dispatching…');
  expect(g.runDisabled).toBe(true);
  expect(g.runDisabledReason).toBe('Dispatching…');
});

test('precedence: a standalone block outranks a connection block outranks the save hint', () => {
  const g = deriveRunGating(input({
    canRun: false,
    blockedMessage: 'connection "git" is not ready',
    standaloneBlockedReason: 'ralph loops run inside the develop flow',
  }));
  expect(g.formDisabledReason).toMatch(/ralph/);
  const g2 = deriveRunGating(input({ canRun: false, blockedMessage: 'connection "git" is not ready' }));
  expect(g2.formDisabledReason).toMatch(/connection "git"/);
});

// ---------------------------------------------------------------------------
// RULING 2 — pollExhausted ends the "in flight" claim. This is the half that
// unbricks an agent whose last run died without a terminal marker.
// ---------------------------------------------------------------------------

test('THE BRICK: a run last seen running whose WATCH has been exhausted no longer blocks a new dispatch', () => {
  const g = deriveRunGating(input({ runState: 'running', pollExhausted: true }));
  expect(g.runDisabled).toBe(false);
  expect(g.runDisabledReason).toBeNull();
  expect(g.formDisabled).toBe(false);
});

test('a still-watched running run DOES block — the double-click orphan agents-29 closed stays closed', () => {
  expect(deriveRunGating(input({ runState: 'running', pollExhausted: false })).runDisabled).toBe(true);
});

test('pollExhausted never RE-ENABLES something blocked for an agent-level reason', () => {
  const g = deriveRunGating(input({ canRun: false, runState: 'running', pollExhausted: true }));
  expect(g.formDisabled).toBe(true);
  expect(g.runDisabled).toBe(true);
  expect(g.runDisabledReason).toBe(SAVE_HINT);
});

// ---------------------------------------------------------------------------
// Terminal states are not "in flight".
// ---------------------------------------------------------------------------

test('every terminal run state leaves BOTH controls live — a finished run is history, not a lock', () => {
  for (const state of ['done', 'failed', 'suppressed', 'budget-exceeded', 'timed-out', 'unknown', 'idle']) {
    const g = deriveRunGating(input({ runState: state }));
    expect(g.runDisabled, state).toBe(false);
    expect(g.formDisabled, state).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// RULING 3 — a disabled thing always names why. This is the invariant
// `scripts/check-disabled-reason.mjs` enforces at the DOM layer; pinned here
// at the derivation so the two can never drift.
// ---------------------------------------------------------------------------

test('INVARIANT: disabled implies a non-empty reason, and enabled implies none — for both gates, across the whole input space', () => {
  const bools = [false, true];
  const states = ['idle', 'running', 'done', 'failed', 'timed-out'];
  for (const canRun of bools) {
    for (const dispatching of bools) {
      for (const pollExhausted of bools) {
        for (const blockedMessage of ['', 'connection "git" is not ready']) {
          for (const standaloneBlockedReason of [null, 'ralph loops run inside the develop flow']) {
            for (const runState of states) {
              const g = deriveRunGating({ canRun, dispatching, pollExhausted, blockedMessage, standaloneBlockedReason, runState });
              const label = JSON.stringify({ canRun, dispatching, pollExhausted, blockedMessage, standaloneBlockedReason, runState });
              expect(g.formDisabled ? (g.formDisabledReason ?? '').length > 0 : g.formDisabledReason === null, label).toBe(true);
              expect(g.runDisabled ? (g.runDisabledReason ?? '').length > 0 : g.runDisabledReason === null, label).toBe(true);
              // The run control is never MORE permissive than the form.
              if (g.formDisabled) expect(g.runDisabled, label).toBe(true);
            }
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The reattach half: a run id adopted from history must not be reported as
// 'running' on the strength of its own existence.
// ---------------------------------------------------------------------------

test('deriveRunState: a DISPATCHED run with no status yet is honestly still being watched (W6-B14, unchanged)', () => {
  expect(deriveRunGating.runStateOf({ status: null, runId: 'r1', reattachedStatus: null })).toBe('running');
});

test('THE FABRICATION: a REATTACHED run id reports the ledger status it was reattached FROM, never a guessed "running"', () => {
  expect(deriveRunGating.runStateOf({ status: null, runId: 'r1', reattachedStatus: 'done' })).toBe('done');
  expect(deriveRunGating.runStateOf({ status: null, runId: 'r1', reattachedStatus: 'failed' })).toBe('failed');
  // A genuinely running reattached run still reads running — from the row, not from a guess.
  expect(deriveRunGating.runStateOf({ status: null, runId: 'r1', reattachedStatus: 'running' })).toBe('running');
});

test('deriveRunState: a real polled status always wins over both', () => {
  expect(deriveRunGating.runStateOf({ status: { state: 'done' }, runId: 'r1', reattachedStatus: 'running' })).toBe('done');
});

test('deriveRunState: no run at all is idle', () => {
  expect(deriveRunGating.runStateOf({ status: null, runId: null, reattachedStatus: null })).toBe('idle');
  // A reattach that resolved to nothing must not conjure a state either.
  expect(deriveRunGating.runStateOf({ status: null, runId: null, reattachedStatus: 'done' })).toBe('idle');
});
