/**
 * repeat-live-session-wait.test.ts — bead `forge-8vfn.8.5.15` (row 179), T1
 * 1973bq: a `repeat` beat's wait becomes an INACTIVITY window reset by the
 * bound session's own liveness, not a wall clock — backstopped by the same
 * absolute wall ceiling a `cycleOf` agent wait already answers to.
 *
 * THE MEASURED DEFECT. S2 beat 12 (`tests/stories/S2.story.mjs`) is a
 * `repeat` with `until: { 'session-phase': 'awaiting-verdict' }` and a plain
 * `wait: { for: 'agent', upTo: 780_000 }` — no `perTransition`, so
 * `runRepeatStep`'s own `tracker` (`beats-repeat.mjs`) is `null` and the loop
 * had ZERO inactivity-awareness: `left()` alone, a pure wall-clock countdown.
 * A real run answered one interview round at 06:28:28Z, the architect session
 * then WORKED CONTINUOUSLY — a draft turn writing tool events to 06:39:21, a
 * completeness critic 06:39:21–06:40:54, `.heartbeat` warm throughout — and
 * wrote `awaiting-verdict` at 06:40:54Z, 14s AFTER the wall bound expired at
 * 06:40:40Z. A wall-clock bound red-flagged a live agent.
 *
 * RAISING 780_000 IS NOT THE FIX. These three doors pin the ruled shape
 * directly against `runRepeatStep`, in the fake-page/fake-clock style
 * `beats-repeat-progress.test.ts` already uses for this same function: a page
 * whose gate is present throughout (the subject here is the GOVERNING BOUND,
 * never the DOM), and `readSessionLivenessNow` standing in for a real
 * `.heartbeat`/`events.jsonl` idle-ms reading (`runLogIdleMs`,
 * `beats-agent-proc.mjs`) without touching a real filesystem.
 *
 * `wallCeilingMs` is injected as a TEST SEAM ONLY — the exact shape
 * `makeWaitSpendGuard`'s `pollMs` already is, and the exact reason
 * `beats-cycle-progress.test.ts` unit-tests `cycleWaitDeadline` at an
 * injected ceiling rather than the real 90-minute `CYCLE_WAIT_WALL_CEILING_MS`:
 * a door that needs the wall ceiling to actually fire cannot wait out ninety
 * real minutes to prove it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runRepeatStep } from './beats-repeat.mjs';

const UNTIL = { 'session-phase': 'awaiting-verdict' };
const ROUND = [
  { fillAll: 'question-freetext', with: 'the answer' },
  { press: 'submit-answers' },
];

/** The gate is present from t=0 — the subject under test is the governing
 *  bound, not whether the DOM carries the act. */
function gatePresent() {
  return {
    locator: () => ({ count: async () => 1 }),
    url: () => 'http://localhost:4124/sessions/architect/s1',
  };
}

test('T1 1973bq (GREEN): a session that keeps advancing survives past the old wall-clock bound', async () => {
  // The declared bound (scaled from S2 beat 12's 780_000 ms) becomes an
  // INACTIVITY window. `left()` models what a caller with no session binding
  // would still enforce TODAY — deliberately set BELOW the point `until` is
  // met, so a green result here can only be the liveness extension bypassing
  // it, never luck against a generous `left`.
  const TIMEOUT_MS = 300;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const r = await runRepeatStep({
    page: gatePresent() as never,
    step: { repeat: ROUND, until: UNTIL } as never,
    left: () => Math.max(0, 310 - elapsed()), // today's wall clock would cut this off at ~310ms
    matches: async () => elapsed() >= 400, // `until` answers AFTER the old bound would have expired
    timeoutMs: TIMEOUT_MS,
    run: async () => ({ waitedForHandle: false, error: null }),
    // The session's own `.heartbeat`/`events.jsonl` ticks on every poll —
    // idle never grows, exactly like a continuously-working architect turn.
    readSessionLivenessNow: () => 0,
  } as never);

  assert.equal(r.error, null, `a live session must not be cut off by the old wall-clock bound: ${r.error}`);
  assert.ok(elapsed() >= 400, `it must have genuinely waited past the old bound, not raced it: took ${elapsed()}ms`);
});

test('T1 1973bq (RED, inactivity): a session that goes silent reds after one inactivity window, naming inactivity — never the wall ceiling', async () => {
  const TIMEOUT_MS = 200;
  const startedAt = Date.now();

  const r = await runRepeatStep({
    page: gatePresent() as never,
    step: { repeat: ROUND, until: UNTIL } as never,
    // Generous and IRRELEVANT: the inactivity window must be what reds this,
    // not the plain wall clock a caller with no session binding would use.
    left: () => Math.max(0, 5_000 - (Date.now() - startedAt)),
    matches: async () => false, // `until` is never met
    timeoutMs: TIMEOUT_MS,
    run: async () => ({ waitedForHandle: false, error: null }),
    // No activity since the wait began — idle grows 1:1 with real time.
    readSessionLivenessNow: () => Date.now() - startedAt,
  } as never);

  assert.notEqual(r.error, null, 'it must red');
  assert.match(r.error!, /inactiv/i, `the reason must name inactivity: ${r.error}`);
  assert.doesNotMatch(r.error!, /wall ceiling/i, `this is the inactivity reason, not the wall ceiling: ${r.error}`);
});

test('T1 1973bq (RED, wall ceiling): a session that never stops advancing still reds at the absolute wall ceiling', async () => {
  const TIMEOUT_MS = 100_000; // huge — the inactivity window alone must never fire here
  const WALL_CEILING_MS = 150; // TEST SEAM ONLY — never a real-run override
  const startedAt = Date.now();

  const r = await runRepeatStep({
    page: gatePresent() as never,
    step: { repeat: ROUND, until: UNTIL } as never,
    left: () => Math.max(0, 5_000 - (Date.now() - startedAt)), // generous and irrelevant
    matches: async () => false, // `until` is never met
    timeoutMs: TIMEOUT_MS,
    run: async () => ({ waitedForHandle: false, error: null }),
    // Continuous activity — the inactivity deadline keeps getting pushed out,
    // so only the wall ceiling can end this wait.
    readSessionLivenessNow: () => 0,
    wallCeilingMs: WALL_CEILING_MS,
  } as never);
  const took = Date.now() - startedAt;

  assert.notEqual(r.error, null, 'it must red');
  assert.match(r.error!, /wall ceiling/i, `the reason must name the wall ceiling: ${r.error}`);
  assert.ok(took < 5_000, `it must stop at the injected wall ceiling, not the 5s \`left\` backstop — took ${took}ms`);
});

test('a beat whose repeat already declares `perTransition`/`progressKey` is UNCHANGED by this fix', async () => {
  // SCOPE LINE: a repeat with its own inactivity-aware early-stall detector
  // (T1 ruling 1545) already has protection, and its trailing `do` steps (S1
  // beat 11's `open-plan`/`approve-plan`) depend on the OUTER bound staying
  // the beat's one shared deadline. `readSessionLivenessNow` must be inert
  // whenever a progress bound is already declared.
  const TIMEOUT_MS = 150;
  const startedAt = Date.now();

  const r = await runRepeatStep({
    page: gatePresent() as never,
    step: { repeat: ROUND, until: UNTIL, perTransition: 50, progressKey: 'session-phase' } as never,
    left: () => Math.max(0, TIMEOUT_MS - (Date.now() - startedAt)),
    matches: async () => false,
    timeoutMs: TIMEOUT_MS,
    run: async () => ({ waitedForHandle: false, error: null }),
    progress: { perTransition: 50, progressKey: 'session-phase' } as never,
    readProgressNow: async () => ({ value: 'frozen', source: 'root', carriers: 1 }),
    // Even though the session is reported as continuously live, a declared
    // progress bound must keep today's exact (tighter) behaviour.
    readSessionLivenessNow: () => 0,
  } as never);

  assert.notEqual(r.error, null, 'it must still red');
  assert.match(r.error!, /stalled-no-transition \(repeat\)/, `the progress-bound path must be untouched: ${r.error}`);
  assert.doesNotMatch(r.error!, /inactiv/i, 'the liveness-governed wording must never appear when a progress bound already exists');
});

test('a repeat whose act never appears is still bounded by the plain wall clock, even with a live session reader wired', async () => {
  // SCOPE LINE: ruling 569's own protection (`beats-repeat.test.ts`) must
  // survive this change untouched — a page that never carries the act at all
  // must not be allowed to run to the (90-minute) wall ceiling just because
  // some unrelated session channel is ticking.
  const TIMEOUT_MS = 150;
  const startedAt = Date.now();
  const page = {
    locator: () => ({ count: async () => 0 }), // the act never appears
    url: () => 'http://localhost:4124/monitor',
  };

  const r = await runRepeatStep({
    page: page as never,
    step: { repeat: ROUND, until: UNTIL } as never,
    left: () => Math.max(0, TIMEOUT_MS - (Date.now() - startedAt)),
    matches: async () => false,
    timeoutMs: TIMEOUT_MS,
    run: async () => ({ waitedForHandle: false, error: null }),
    readSessionLivenessNow: () => 0, // a live channel elsewhere must not rescue a wrong-page beat
  } as never);
  const took = Date.now() - startedAt;

  assert.notEqual(r.error, null);
  assert.match(r.error!, /never became available/, `Got: ${r.error}`);
  assert.ok(took < 2_000, `must stop at the plain declared bound, not be rescued into a long wait — took ${took}ms`);
});
