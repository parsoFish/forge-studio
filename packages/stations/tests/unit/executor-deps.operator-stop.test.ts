/**
 * M7 row 150 (bead forge-8vfn.8.1.39, rulings 1771 + 1774) — ADR 028's
 * amendment: `raceWithWedge` now also polls the operator-stop flag from the
 * SAME 100ms interval the wedge-kill timer already runs, aborting the SAME
 * shared `AbortController` — never a second poller thread.
 *
 * This is the exact seam that becomes `externalSignal` for a live Ralph
 * turn: `createClaudeAgent`'s own test
 * (`packages/agents/tests/integration/claude-agent.sidecars.test.ts`, "R2-03-F4
 * — externalSignal (wedge-kill) chains into the iteration abort controller")
 * already proves that ANY abort on that signal cancels a live iteration,
 * regardless of which cause fired it — so this file proves the NEW half:
 * that an operator stop fires the SAME `AbortController.abort()` a wedge-kill
 * would, through the SAME race, using a fake "turn" exactly the way
 * `flow-runner.test.ts`'s own wedge-kill tests do (a promise that resolves on
 * the signal's `abort` event — no real SDK/subprocess involved).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { raceWithWedge } from '../../phases/executor-deps.ts';
import { WedgeDetector, WedgeKillError, OperatorStopError } from '@forge/flows';

/** A wedge detector that is ACTIVE but will never itself fire — no heartbeat
 *  is ever recorded, so `check()` stays false forever (WedgeDetector.check:
 *  "no heartbeats yet" → false). Isolates the operator-stop path from the
 *  wedge-kill path within the SAME race. */
function inertActiveDetector(): WedgeDetector {
  return new WedgeDetector({ wedgeKillMs: 50, nodeId: 'dev' });
}

test(
  'row 150: an operator stop aborts the SAME AbortController a live turn holds, and ' +
    'rejects with OperatorStopError',
  async () => {
  let sawAbort = false;
  const fakeTurn = (signal: AbortSignal): Promise<never> =>
    new Promise((_resolve, reject) => {
      // The "fake SDK turn": waits on the SAME signal externalSignal chaining
      // hands a live Ralph iteration (packages/agents/ralph/claude-agent.ts).
      signal.addEventListener('abort', () => {
        sawAbort = true;
        reject(new Error('turn cancelled by abort — this is what a real CLI subprocess kill looks like'));
      }, { once: true });
    });

  let stopNotified = false;
  let killNotified = false;

  await assert.rejects(
    () => raceWithWedge(
      fakeTurn,
      inertActiveDetector(),
      () => { killNotified = true; },
      () => true, // the stop flag is present on every poll tick
      (err) => { stopNotified = true; assert.ok(err instanceof OperatorStopError); },
    ),
    (err: unknown) => err instanceof OperatorStopError,
  );

  assert.ok(
    sawAbort,
    'the executor\'s signal must have been aborted — this IS externalSignal cancelling a live turn',
  );
  assert.ok(stopNotified, 'onOperatorStop must fire');
  assert.ok(!killNotified, 'onKill (wedge) must NOT fire — this was an operator stop, not a wedge timeout');
});

test(
  'row 150: with no operator stop requested and no wedge, the executor\'s own result wins ' +
    'the race',
  async () => {
  const result = await raceWithWedge(
    async () => 'done',
    inertActiveDetector(),
    () => { throw new Error('onKill must not fire'); },
    () => false, // never requested
    () => { throw new Error('onOperatorStop must not fire'); },
  );
  assert.equal(result, 'done');
});

test(
  'row 150: a wedge-kill still wins over a stop flag that is not yet set — the two causes ' +
    'stay independent',
  async () => {
  const detector = new WedgeDetector({ wedgeKillMs: 10, nodeId: 'dev' });
  // Seed a heartbeat far enough in the past that `check()` trips on the first
  // poll tick, before any operator-stop flag exists.
  detector.onHeartbeat(Date.now() - 1000);

  let killNotified = false;
  await assert.rejects(
    () => raceWithWedge(
      (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
      detector,
      (err) => { killNotified = true; assert.ok(err instanceof WedgeKillError); },
      () => false,
      () => { throw new Error('onOperatorStop must not fire — this is a wedge-kill'); },
    ),
    (err: unknown) => err instanceof WedgeKillError,
  );
  assert.ok(killNotified);
});
