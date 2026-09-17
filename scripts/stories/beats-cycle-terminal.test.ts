/**
 * The CYCLE-TERMINAL door — `forge-8vfn.7.6.118`, T1 ruling 1086, §15.559.
 *
 * WHAT RUN 17 MEASURED. S10 beat 8 failed at 22:44:59 with
 * `data-initiative-status: expected "ready-for-review", got "in-flight"` and
 * `gave up at the agent wait (declared 360000 ms)`. The cycle it was watching
 * reached `ready-for-review` with ERRORS RECORDED 0 at 22:46:55 — 116 seconds
 * LATER. The product succeeded; the story's declared window was too short.
 *
 * SAID IN MONEY, which is the form that shows why a bigger literal is the wrong
 * repair: at the cycle's measured burn of $3.99 over 476 s, the 360000 ms
 * window afforded **$3.02** and the cycle spent **$3.99**. The beat funded a
 * quarter less than the work it was waiting on. 360000 was a literal chosen
 * when no S10 run had ever completed a cycle, so it was derived from nothing —
 * §15.559's reason, and the third distinct beat-8 blocker in three runs after
 * the ADR 037 quarantine and the unwired wait anchor.
 *
 * WHY THE EXISTING DOOR COULD NOT CATCH IT. `makeAgentChannelDoor` reads the
 * same terminal state, and correctly did not fire here: it asks only after
 * `STALL_CEILING_MS` of SILENCE, and run 17's channel was writing continuously
 * right up to 22:46:55. A door that requires silence cannot see a cycle that
 * finishes while still talking. That is not a defect in that door — silence is
 * the question it was built to answer (`forge-flvq`) — it is a different
 * question, so it gets a different door.
 *
 * THE DIFFERENCE, AND THE WHOLE POINT: THIS DOOR NEVER WAITS FOR QUIET. It
 * reads what the product PUBLISHED, so it can end a wait the instant the cycle
 * terminates, whether the channel is still writing or not.
 *
 * AND AN UNREADABLE CHECK IS NEVER `done`. §15.504 — green, red and UNKNOWN are
 * three states, and UNKNOWN never resolves toward proceeding. A door that
 * cannot read the queue returns null (keep waiting, the bound still governs),
 * never a verdict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeCycleTerminalDoor, STALL_CEILING_MS } from './beats-agent-proc.mjs';

function realDoor(): { root: string; logs: string; door: (runId: string | null, sinceMs: number, want: string) => { done: boolean; state: string; detail: string } | null } {
  const root = mkdtempSync(join(tmpdir(), 'story-cycle-terminal-'));
  const logs = join(root, '_logs');
  mkdirSync(logs, { recursive: true });
  return { root, logs, door: makeCycleTerminalDoor(root)! };
}
/** A dispatch dir that is ACTIVELY WRITING — mtime now, not aged. */
function liveDispatch(logs: string, name: string): string {
  const dispatch = join(logs, name);
  mkdirSync(dispatch, { recursive: true });
  writeFileSync(join(dispatch, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"phase"}\n');
  return dispatch;
}
function queueFile(root: string, state: string, initiative: string): void {
  mkdirSync(join(root, '_queue', state), { recursive: true });
  writeFileSync(join(root, '_queue', state, `${initiative}.md`), '# an initiative\n');
}

test('7.6.118: run 17\'s exact shape — a cycle that reaches the wanted state while STILL WRITING ends the wait', () => {
  // The door that did not exist on run 17. The channel is live (mtime now, far
  // inside STALL_CEILING_MS) and the product has published `ready-for-review`.
  const { root, logs, door } = realDoor();
  const initiative = 'INIT-2026-09-17-init-2026-09-17-exclude-author-flag';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);

  const seen = door(null, Date.now() - 476_000, 'ready-for-review');
  assert.notEqual(seen, null, 'a terminated cycle must end the wait, not burn the bound');
  assert.equal(seen!.done, true, `the product published the state the beat is waiting for: ${seen?.detail}`);
  assert.equal(seen!.state, 'ready-for-review');
  assert.match(seen!.detail, /_queue\/ready-for-review\//, 'the verdict names the product\'s own word');
});

test('7.6.118: the door does NOT require silence — that is the entire difference from the stall door', () => {
  // Stated as its own door because it is the property run 17 turned on. If this
  // ever starts requiring quiet, the fix silently reverts to the behaviour that
  // let a finished cycle read as a timeout, and every other test here would
  // still pass on aged fixtures.
  const { root, logs, door } = realDoor();
  const initiative = 'INIT-live-and-finished';
  const dispatch = liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);
  // Written THIS INSTANT: idle time is ~0, nowhere near the stall ceiling.
  writeFileSync(join(dispatch, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"still-writing"}\n');

  const seen = door(null, Date.now() - 10_000, 'ready-for-review');
  assert.equal(seen?.done, true, `a live channel that has terminated must still be seen after ~0s idle, not after ${STALL_CEILING_MS}ms`);
});

test('7.6.118: a cycle that terminates into a DIFFERENT state reds NOW, with the product\'s word', () => {
  // Run 15's shape, reached through the new door: the beat must not sit out the
  // rest of its bound waiting for a state the product has already ruled out.
  const { root, logs, door } = realDoor();
  const initiative = 'INIT-2026-09-12-exclude-author-flag';
  liveDispatch(logs, `_dev-2026-09-12T07-28-42_${initiative}`);
  queueFile(root, 'failed', initiative);

  const seen = door(null, Date.now() - 300_000, 'ready-for-review');
  assert.notEqual(seen, null, 'the wait ends — a cycle in _queue/failed/ is never going to reach ready-for-review');
  assert.equal(seen!.done, false, 'but it is NOT a pass');
  assert.equal(seen!.state, 'failed');
  assert.match(seen!.detail, /_queue\/failed\//);
});

test('7.6.118: a cycle still in flight keeps the wait open', () => {
  const { root, logs, door } = realDoor();
  const initiative = 'INIT-still-running';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'in-flight', initiative);

  assert.equal(door(null, Date.now() - 60_000, 'ready-for-review'), null, 'in-flight is not terminal; the declared bound still governs');
});

test('7.6.118: an UNREADABLE queue is never `done` — §15.504', () => {
  // No _queue/ at all and no dispatch dir: the door could not read the product's
  // verdict, so it has NO verdict. The one answer it must never give is "done".
  const { root, door } = realDoor();
  const seen = door(null, Date.now() - 60_000, 'ready-for-review');
  assert.equal(seen, null, 'a check that did not happen is not a cycle that finished');
});

test('7.6.118: a channel whose terminal state is UNREADABLE is never `done` — the aimed §15.504 door', () => {
  // THE DOOR ABOVE DID NOT COVER THIS, and a mutation proved it: deleting the
  // `terminal.unknown === true` guard changed nothing, because that test has no
  // dispatch dir at all and returns at `dir === null` long before the guard.
  // NOT-AIMED — the mutation changed the file but not what the door pinned.
  //
  // This one reaches the guard: the dispatch dir EXISTS and is found, and
  // neither `_queue/` nor `events.jsonl` can be read, which is exactly when
  // `channelTerminalState` reports `unknown` rather than open. The one answer
  // this must never give is `done`, in either direction — a check that did not
  // happen is neither a finished cycle nor a failed one.
  const { logs, door } = realDoor();
  const dispatch = join(logs, '_dev-2026-09-17T22-38-55_INIT-unreadable-one');
  mkdirSync(dispatch, { recursive: true });
  // A heartbeat so the channel is FOUND, and no events.jsonl so its state
  // cannot be read. No `_queue/` is created at all.
  writeFileSync(join(dispatch, '.heartbeat'), '2026-09-17T22:38:55Z\n');

  const seen = door(null, Date.now() - 60_000, 'ready-for-review');
  assert.equal(seen, null, `UNKNOWN must not resolve toward proceeding, and must not red either: ${JSON.stringify(seen)}`);
});

test('7.6.118: the door reports the state it found even when the beat wants something else', () => {
  // So the verdict can say WHAT the cycle became. A door that only answered
  // yes/no would turn "the cycle was abandoned" into "the cycle is not
  // ready-for-review", which is the class of loss 664(ii) already legislated
  // against: a verdict that cannot be checked.
  const { root, logs, door } = realDoor();
  const initiative = 'INIT-abandoned-one';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'abandoned', initiative);

  const seen = door(null, Date.now() - 60_000, 'ready-for-review');
  assert.equal(seen!.done, false);
  assert.equal(seen!.state, 'abandoned', 'the finding is the state, not merely the mismatch');
});
