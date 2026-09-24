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
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  makeCycleTerminalDoor, makeCycleTerminalWatch, STALL_CEILING_MS, TERMINAL_UI_GRACE_MS,
} from './beats-agent-proc.mjs';
import { resolveCycleOf } from './beats.mjs';

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

/**
 * `makeCycleTerminalWatch` — the door above, plus the ONE piece of state the
 * call site would otherwise have to carry.
 *
 * WHY THE STATE LIVES HERE AND NOT IN `beats-page.mjs`. That file is 768 lines
 * against the 800 cap, and T1 1089 ruled: if the call site needs more than its
 * headroom, SPLIT it at a function boundary — never squeeze. The third option
 * is not to put the fat there at all. The watch keeps `terminalAt` beside the
 * doors it belongs to and `waitForConsequence` gains a thin call.
 *
 * WHY A GRACE AT ALL, rather than passing the moment the cycle terminates. The
 * beat asserts the LIVE CARD — `S10.constants.mjs` is explicit that it must not
 * reload, navigate or press Retry, because any of those would refresh the page
 * by hand and turn the beat green over a defect that is still there. So a
 * finished cycle does not end the beat; it ends the WAIT, and the page then has
 * a bounded, named window to show what the product already published. Passing
 * on the terminal event alone would reproduce run 10's `plan-state` defect
 * exactly — "the beat passed anyway" — one layer up.
 *
 * AND THE EXPIRY IS A DIFFERENT FINDING FROM A TIMEOUT. `cycle-done-ui-stale`
 * says the cycle finished and the page never caught up, which is a PRODUCT
 * finding about refresh (7.6.27's territory). Run 17 printed `gave up at the
 * agent wait (declared 360000 ms)` for a cycle that had SUCCEEDED, and two
 * readers concluded the product had stalled.
 */
test('7.6.118: the watch ends the wait when the cycle terminates WRONG, naming the state', () => {
  const { root, logs } = realDoor();
  const initiative = 'INIT-watch-failed';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'failed', initiative);
  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;

  const stop = watch(null, Date.now() - 300_000);
  assert.notEqual(stop, null);
  assert.equal(stop!.reason, 'cycle-ended');
  assert.match(stop!.detail, /failed/, stop!.detail);
});

test('7.6.118: a cycle in the WANTED state does not stop the wait immediately — the card gets its grace', () => {
  const { root, logs } = realDoor();
  const initiative = 'INIT-watch-ok';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);
  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;

  const t0 = Date.now();
  assert.equal(watch(null, t0 - 476_000, t0), null, 'the loop keeps polling the page: the beat asserts the LIVE card');
  assert.equal(watch(null, t0 - 476_000, t0 + TERMINAL_UI_GRACE_MS - 1), null, 'still inside the grace');
});

test('7.6.118: a card that never catches up is `cycle-done-ui-stale`, NOT a timeout', () => {
  const { root, logs } = realDoor();
  const initiative = 'INIT-watch-stale';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);
  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;

  const t0 = Date.now();
  watch(null, t0 - 476_000, t0);
  const stop = watch(null, t0 - 476_000, t0 + TERMINAL_UI_GRACE_MS + 1);
  assert.notEqual(stop, null, 'the wait must still end');
  assert.equal(stop!.reason, 'cycle-done-ui-stale');
  assert.match(stop!.detail, /ready-for-review/, 'and it says the cycle SUCCEEDED — the finding is the page, not the factory');
});

test('7.6.118: the grace is measured from the TERMINAL EVENT, not from the wait\'s start', () => {
  // The distinction run 17 turned on. A grace counted from the wait's start is
  // just a second deadline; counted from the moment the product published, it
  // measures exactly the page's lag and nothing else.
  const { root, logs } = realDoor();
  const initiative = 'INIT-watch-late';
  liveDispatch(logs, `_dev-2026-09-17T22-38-55_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);
  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;

  const t0 = Date.now();
  // First sighting a long way into the wait — 20 minutes of watching an
  // in-flight cycle costs the grace nothing.
  assert.equal(watch(null, t0 - 1_200_000, t0 + 1_200_000), null);
  assert.equal(watch(null, t0 - 1_200_000, t0 + 1_200_000 + TERMINAL_UI_GRACE_MS - 1), null, 'the grace starts at the sighting');
  assert.notEqual(watch(null, t0 - 1_200_000, t0 + 1_200_000 + TERMINAL_UI_GRACE_MS + 1), null);
});

test('7.6.118: a watch with no wanted state is inert — no beat gains a new way to fail', () => {
  const { root, logs } = realDoor();
  liveDispatch(logs, '_dev-2026-09-17T22-38-55_INIT-no-want');
  queueFile(root, 'failed', 'INIT-no-want');
  assert.equal(makeCycleTerminalWatch(root, null), null, 'a beat that declared no terminal state is not watched at all');
  assert.equal(makeCycleTerminalWatch(root, ''), null);
});

/**
 * THE STALE-TERMINAL ORDERING, stated as a door because S10 beat 11 now relies
 * on it — `forge-8vfn.7.6.124`.
 *
 * Both forge flows terminate in the SAME queue state. When the operator presses
 * `start-development`, the initiative is ALREADY sitting in
 * `_queue/ready-for-review/` from the ARCHITECT cycle that just finished. A
 * terminal read that landed there would report the develop cycle finished
 * before it had started — passing a beat on the previous cycle's verdict, which
 * is precisely the class of false green this campaign keeps meeting.
 *
 * IT CANNOT, AND ORDERING IS WHY, NOT LUCK. The watch resolves its channel with
 * `newestChannelSince(anchor)`: with no dispatch dir born since the press there
 * is nothing to read, so it returns null however the queue looks. A dispatch dir
 * appears only once the scheduler has CLAIMED the initiative, and a claim
 * requires it to have been repointed into `_queue/pending/` first — so by the
 * time the watch has anything to read, the initiative has already LEFT
 * ready-for-review.
 *
 * That chain is load-bearing and invisible in the story file, so it is pinned
 * here. If `newestChannelSince` ever starts falling back to an older channel,
 * this reds and beat 11 does not silently pass on the architect's verdict.
 */
/**
 * AGE IS READ FROM BIRTH TIME, AND A FIXTURE CANNOT FAKE IT — learned by getting
 * this wrong. `newestChannelSince` filters on `statSync(...).birthtimeMs ||
 * ctimeMs`, and `utimesSync` moves only atime/mtime. So a dispatch dir "aged" an
 * hour with `utimesSync` is NOT aged at all: it was born a millisecond ago and
 * the scan finds it.
 *
 * My first draft of the stale-terminal door did exactly that, asserted null on
 * the first call, and PASSED — for the wrong reason. The watch returns null on a
 * first sighting BY DESIGN (it starts the page's grace), so "null" could not
 * distinguish "read nothing" from "read the architect's leftover and began
 * waiting on the card". Only running it past the grace showed the fixture had
 * been reading the stale terminal all along.
 *
 * So age is expressed the way the production code reads it: the ANCHOR sits
 * after the stale dispatch's birth, which is the real relation — the operator
 * pressed `start-development` AFTER the architect's dispatch dir existed.
 */
test('7.6.124: a stale terminal with no dispatch since the anchor is never a verdict', () => {
  const { root, logs } = realDoor();
  const initiative = 'INIT-2026-09-18-exclude-author-flag';
  // The architect cycle's leftover: the initiative IS in ready-for-review, and
  // its dispatch dir exists — both true at the instant the operator presses.
  queueFile(root, 'ready-for-review', initiative);
  liveDispatch(logs, `_architect-2026-09-18T03-45-41_${initiative}`);

  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;
  // The press happens AFTER that dir was born. Nothing has been dispatched since.
  const pressedAt = Date.now() + 5_000;
  assert.equal(watch(null, pressedAt, pressedAt), null, 'nothing dispatched since the press');
  assert.equal(watch(null, pressedAt, pressedAt + TERMINAL_UI_GRACE_MS + 1), null,
    'and still nothing PAST THE GRACE — the develop wait must never be satisfied by the '
    + 'architect cycle sitting in ready-for-review. A null only at the first call would '
    + 'have meant the grace had started, which is the opposite of this claim.');
});

test('7.6.124: once a dispatch IS born since the anchor, the SAME queue row does count', () => {
  // THE CONTRAST IS THE DOOR, and my first draft of it asserted the wrong thing:
  // it expected a non-null on the first sighting, which contradicts the watch's
  // own design — a first sighting of the wanted state STARTS the page's grace
  // and returns null deliberately (a finished cycle ends the WAIT, not the
  // BEAT). Asserting at the first call could never distinguish "saw the terminal
  // and is waiting on the card" from "saw nothing at all", which is exactly the
  // distinction this pair exists to pin.
  //
  // So both cases are measured PAST the grace, where they finally differ:
  //   stale-only  -> still null, the terminal was never read
  //   dispatched   -> cycle-done-ui-stale, the terminal WAS read
  const { root, logs } = realDoor();
  const initiative = 'INIT-2026-09-18-exclude-author-flag';
  queueFile(root, 'ready-for-review', initiative);
  liveDispatch(logs, `_dev-2026-09-18T04-30-00_${initiative}`);

  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;
  const t0 = Date.now();
  assert.equal(watch(null, t0 - 60_000, t0), null, 'first sighting starts the grace, by design');
  const after = watch(null, t0 - 60_000, t0 + TERMINAL_UI_GRACE_MS + 1);
  assert.equal(after?.reason, 'cycle-done-ui-stale',
    'the terminal state was READ for this cycle — which the stale-only case never reaches');
});



/**
 * `forge-8vfn.7.6.143` (a), T1 ruling 1147 — RUN 20'S SHAPE.
 *
 * MEASURED, not imagined. S10 run 20:
 *   cycle dir birth            20:21:58.902   (ONE dir, shared by all phases)
 *   beat 10 press / anchor     20:26:22.301   (3.4 min LATER)
 *   beat 10 verdict GREEN      20:26:22.532   (231 ms for a 30-MINUTE wait)
 *   dispatch dirs born at/after the anchor:  NONE
 *
 * The develop station runs INSIDE the cycle dir minted at architect time —
 * DEC-2 threads the same `cycle_id` through the kickoff on purpose — so
 * `newestChannelSince` (which skips every dir with `born < sinceMs`) finds
 * nothing, the door returns null forever, and the declared terminal wait
 * watches NOTHING while the beat reports green.
 *
 * S10 beat 10's own comment argued this was impossible: "a dispatch dir exists
 * only once the scheduler has CLAIMED the initiative... Dispatch dir implies
 * already left ready-for-review." That assumed the develop cycle MINTS a new
 * dispatch dir. It continues the architect's. The premise was false.
 *
 * The fix is ADDITIVE (1147): resolution by the cycle's own identity, BESIDE
 * the born-after-the-anchor form, so every existing story keeps its exact
 * semantics. Both halves are asserted here — the old form must still not see
 * it, or the new form is not additive, it is a behaviour change wearing a new
 * name.
 */
test('7.6.143: a cycle born BEFORE the anchor is invisible to the anchor form and found by identity', () => {
  const { root, logs, door } = realDoor();
  const initiative = 'INIT-2026-09-18-exclude-author-flag';
  liveDispatch(logs, `2026-09-18T10-21-56_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);

  // The press anchors AFTER the dir was born — run 20's 3.4-minute gap.
  const anchorAfterBirth = Date.now() + 5_000;

  assert.equal(
    door(null, anchorAfterBirth, 'ready-for-review'), null,
    'the born-after-the-anchor form must STILL not see this cycle — that is run 20\'s defect preserved ' +
    'deliberately, because every other story depends on those semantics and 1147 ruled the fix additive.',
  );

  const byIdentity = makeCycleTerminalDoor(root, { cycleOf: initiative })!;
  // T1 1231 (S10 run 22): FOUND is not DONE. By identity the cycle predates the
  // press, and the queue still reads the PREVIOUS run's terminal; it counts
  // only once the cycle has started a run at or after the anchor.
  assert.equal(byIdentity(null, anchorAfterBirth, 'ready-for-review'), null, 'no run since the anchor — nothing has terminated for this press');
  assert.equal(byIdentity.sawCycle, true, 'resolved by the initiative the press named, the cycle is found whatever its birth time');
  appendFileSync(join(logs, `2026-09-18T10-21-56_${initiative}`, 'events.jsonl'),
    `${JSON.stringify({ event_type: 'start', message: 'cycle.start', started_at: new Date(anchorAfterBirth + 1_000).toISOString() })}\n`);
  const seen = byIdentity(null, anchorAfterBirth, 'ready-for-review');
  assert.notEqual(seen, null);
  assert.equal(seen!.done, true, `the press's own run published the state the beat waits for: ${seen?.detail}`);
});

/** Identity resolution must not invent a cycle. An initiative with no dispatch
 *  dir returns null — keep waiting — never a verdict about a cycle that is not
 *  there (§15.504: UNKNOWN never resolves toward proceeding). */
test('7.6.143: identity resolution finds no cycle for an initiative that has none', () => {
  const { root } = realDoor();
  const byIdentity = makeCycleTerminalDoor(root, { cycleOf: 'INIT-nothing-here' })!;
  assert.equal(byIdentity(null, Date.now(), 'ready-for-review'), null);
});

/** THE CONSUMPTION HALF (b2). A `terminal:` declaration is consumed only when
 *  the watch actually RESOLVED a cycle. Run 20's beat 10 ran its consequence
 *  wait and called the watch on every poll — the watch simply never found a
 *  cycle — and `agentWaitConsumed` was nonetheless true, because a handle wait
 *  had set it. So the watch must report whether it ever saw one. */
test('7.6.143: the watch reports that it never resolved a cycle (run 20 beat 10, red-at-base)', () => {
  const { root, logs } = realDoor();
  const initiative = 'INIT-2026-09-18-exclude-author-flag';
  liveDispatch(logs, `2026-09-18T10-21-56_${initiative}`);
  queueFile(root, 'ready-for-review', initiative);

  const watch = makeCycleTerminalWatch(root, 'ready-for-review')!;
  watch(null, Date.now() + 5_000);
  assert.equal(
    watch.sawCycle, false,
    'run 20 beat 10: the watch ran on every poll and resolved nothing, so its terminal declaration was ' +
    'NOT consumed — a handle wait must never credit it.',
  );

  const watched = makeCycleTerminalWatch(root, 'ready-for-review', { cycleOf: initiative })!;
  watched(null, Date.now() + 5_000);
  assert.equal(watched.sawCycle, true, 'resolved by identity, the same cycle IS seen');
});

/**
 * `forge-8vfn.7.6.147` — AN UNBOUND `cycleOf` IS REPORTED, NEVER PAPERED OVER.
 *
 * Run 21's beat 10 declared `cycleOf: '<runId>'`. `runId` binds at beat 8's
 * `expect.data`; beat 8 reded on a PM stall and `stuckVerdict` exports no
 * bindings by design. The first wiring turned that into `null` — the same value
 * it uses for "no cycleOf declared" — so the watch fell back to the
 * born-after-the-anchor form and found nothing.
 *
 * The two cases MUST be distinguishable at the boundary, or the caller cannot
 * refuse one and proceed on the other.
 */
test('7.6.147: an unbound cycleOf reports the placeholder rather than resolving to null', () => {
  const { value, unbound } = resolveCycleOf('<runId>', {});
  assert.equal(value, null, 'no value, because nothing bound it');
  assert.equal(unbound, 'runId', 'and the caller is TOLD which placeholder — that is the whole difference');
});

test('7.6.147: a bound cycleOf resolves, and an absent one is not an error', () => {
  assert.deepEqual(resolveCycleOf('<runId>', { runId: 'INIT-x' }), { value: 'INIT-x', unbound: null });
  assert.deepEqual(resolveCycleOf(undefined, {}), { value: null, unbound: null },
    'a beat that declares no cycleOf is not a beat whose cycleOf failed to bind');
});

/**
 * 7.6.147 RED-AT-BASE ON RUN 21'S OWN BEAT (T1 ruling 1164).
 *
 * Not a hand-built object: S10's REAL beat 10, through the REAL validator,
 * driven with the empty bindings a stalled beat 8 leaves behind. Run 21 reached
 * exactly this state and reded with "NO WAITER CONSUMED IT — give the beat a
 * `do` block", which is advice for a different failure: beat 10 has a `do`
 * block, and what was missing was the SUBJECT of its wait.
 *
 * The prior wiring passed this state straight through (unbound -> null -> fall
 * back to the anchor form), so this test fails against it.
 */
test('7.6.147: S10 beat 10 with no bindings REFUSES, naming the placeholder', async () => {
  const story = await import('../../tests/stories/S10.story.mjs');
  const { validateStory } = await import('./story-file.mjs');
  const { driveBeat } = await import('./beats-drive.mjs');
  const st = validateStory((story as any).story ?? (story as any).default) as any;

  const v = await driveBeat(null, st.beats[9], 9, 'http://localhost:0', {});

  assert.equal(v.status, 'red', 'a beat that cannot name the cycle it watches must not proceed (§15.504)');
  assert.match(v.failures[0], /needs <runId>, which no earlier beat bound/);
  assert.match(v.failures[0], /NOT "give the beat a `do` block"/,
    'the remedy text must name THIS failure — run 21 was told to add a `do` block it already had');
  assert.deepEqual(v.bindings, {}, 'a refusing beat exports no bindings, like stuckVerdict');
});
