/**
 * Row 164 (bead forge-8vfn.8.1.51, T1 ruling 1904) — S10 run 43: an
 * architect revise turn (round 2) started 04:52:01 and emitted ONE long
 * StructuredOutput at 04:58:05 — six minutes with no events, no heartbeat —
 * while its claude process was alive and the turn ultimately succeeded. The
 * Studio session lifecycle (`bridge-studio-lifecycle.ts`) read that silence
 * as `stalled` past the architect ceiling (120 s) because the old
 * message-driven heartbeat (`makeHeartbeatTick`) never fires when the SDK
 * stream itself produces nothing at all.
 *
 * This file pins `startHeartbeatTicker` (`../../heartbeat.ts`)
 * directly: (a) a LIVE call that is silent past the architect ceiling still
 * feeds the Studio lifecycle a `working` verdict, because the interval
 * ticker — not message flow — is what keeps `.heartbeat`'s liveness signal
 * fresh; and (b) the ticker stops calling back once the call ends, so it
 * never asserts liveness for a call that is no longer in flight.
 *
 * `Date` is mocked alongside `setTimeout` (both stable under
 * `t.mock.timers` on this repo's Node) so the recorded "last activity"
 * timestamp and `nowMs` both come from the SAME virtual clock the ticker's
 * own `setTimeout` chain advances through — this proves the real relationship
 * between tick cadence and elapsed idle time without an actual multi-minute
 * wait. `t.mock.timers.tick` only fires the timers already pending as of the
 * call (proven empirically against this Node version), so a LOOP of small
 * ticks — not one large one — is what actually walks the ticker's
 * self-rescheduling chain forward; `withIdleDeadline`'s own tests need only
 * one big tick because they have a single pending timer, not a chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runStructuredTurn, type QueryFn } from '../../interactive-session.ts';
import { startHeartbeatTicker, HEARTBEAT_THROTTLE_MS } from '../../heartbeat.ts';
import { deriveSessionLifecycle, stallCeilingForKind } from '../../bridge-studio-lifecycle.ts';

const MODEL = 'claude-sonnet-5';

/** A stream that never yields anything and never ends — run 43's shape: the
 *  SDK call is alive, but the stream itself is a total blank for minutes. */
const totallySilent: QueryFn = () => ({
  async *[Symbol.asyncIterator]() {
    await new Promise<never>(() => { /* never resolves, never rejects */ });
  },
});

/** Advance a mock-timers clock by `totalMs` in `HEARTBEAT_THROTTLE_MS`-sized
 *  steps, draining microtasks between each — the loop shape a chained
 *  self-rescheduling timer needs (a single large `tick` only fires whatever
 *  is ALREADY pending, not what a fired callback reschedules). */
async function tickThrough(tick: (ms: number) => void, totalMs: number): Promise<void> {
  const steps = Math.ceil(totalMs / HEARTBEAT_THROTTLE_MS);
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < 5; j += 1) await Promise.resolve();
    tick(HEARTBEAT_THROTTLE_MS);
  }
  for (let j = 0; j < 5; j += 1) await Promise.resolve();
}

test('row 164 (a): a LIVE call silent past the architect ceiling still reads `working` — the interval ticker, not message flow, keeps the lifecycle honest', async (t) => {
  // `now` pins the mocked epoch to a REAL, large timestamp (mock Date defaults
  // to epoch 0) — otherwise `makeHeartbeatTick`'s own throttle (`now -
  // lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS`, both starting at 0) would
  // wrongly suppress the very first tick, a mocking artifact no real turn
  // ever hits (Date.now() is never 0 in production).
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try {
    const startedAt = Date.now();
    let lastActivityMs = startedAt;

    const turn = runStructuredTurn<{ ok: boolean }>({
      queryFn: totallySilent,
      prompt: 'p',
      schema: {},
      model: MODEL,
      allowedTools: ['Read'],
      onHeartbeat: () => { lastActivityMs = Date.now(); },
      label: 'row-164-a',
    });
    // A silent stream never settles the turn — matching run 43's live-but-quiet
    // process. Never awaited; only its side effects (the heartbeat calls) are
    // observed, exactly like the existing idle-deadline pins in this package.
    void turn.then(
      () => { throw new Error('a totally silent stream must never resolve'); },
      () => { /* only reachable past DEFAULT_IDLE_DEADLINE_MS, which this test never reaches */ },
    );

    const architectCeilingMs = stallCeilingForKind('architect');
    // Walk the mocked clock well past the architect ceiling (120s) while
    // remaining comfortably under the 6-minute idle deadline, so the turn
    // stays genuinely "in flight" throughout.
    await tickThrough((ms) => t.mock.timers.tick(ms), architectCeilingMs + 10_000);

    const nowMs = Date.now();
    assert.ok(
      nowMs - startedAt >= architectCeilingMs,
      `the mocked clock must have advanced past the architect ceiling (${architectCeilingMs}ms); advanced ${nowMs - startedAt}ms`,
    );

    const lifecycle = deriveSessionLifecycle({
      terminal: false,
      awaits: null,
      working: true,
      statusMtimeMs: null,
      stderr: null,
      lastActivityMs,
      turnAlive: true,
      hasChannel: true,
      nowMs,
      stallCeilingMs: architectCeilingMs,
    });

    assert.equal(
      lifecycle.state,
      'working',
      `expected working (the ticker kept .heartbeat fresh); got ${lifecycle.state} (idleMs=${lifecycle.idleMs})`,
    );
    assert.equal(lifecycle.needsYou, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('row 164: the ticker stops calling back once the call ends — no heartbeat writes after completion', async (t) => {
  // See the `now` note on the previous test — avoids the mocked-epoch-0
  // throttle artifact.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try {
    let tickCount = 0;
    const queryFn: QueryFn = () => (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
      yield { type: 'result', total_cost_usd: 0.001, structured_output: { ok: true } };
    })();

    await runStructuredTurn<{ ok: boolean }>({
      queryFn,
      prompt: 'p',
      schema: {},
      model: MODEL,
      allowedTools: ['Read'],
      onHeartbeat: () => { tickCount += 1; },
      label: 'row-164-stop',
    });

    const countAtCompletion = tickCount;
    assert.ok(countAtCompletion > 0, 'the turn must have ticked at least once while it ran');

    // Advance the clock well past several ticker cadences AFTER the call has
    // already ended — a live ticker would fire again; a stopped one must not.
    await tickThrough((ms) => t.mock.timers.tick(ms), 10 * HEARTBEAT_THROTTLE_MS);

    assert.equal(
      tickCount,
      countAtCompletion,
      'no heartbeat call is expected after the SDK call ended — the ticker must be stopped in `finally`',
    );
  } finally {
    t.mock.timers.reset();
  }
});

test('startHeartbeatTicker: fires on the HEARTBEAT_THROTTLE_MS cadence while running, and never again once stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let count = 0;
    const stop = startHeartbeatTicker(() => { count += 1; });

    for (let i = 0; i < 10; i += 1) {
      for (let j = 0; j < 3; j += 1) await Promise.resolve();
      t.mock.timers.tick(HEARTBEAT_THROTTLE_MS);
    }
    assert.equal(count, 10, `expected exactly 10 ticks over 10 cadences; got ${count}`);

    stop();
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 3; j += 1) await Promise.resolve();
      t.mock.timers.tick(HEARTBEAT_THROTTLE_MS);
    }
    assert.equal(count, 10, 'no further ticks after stop() — the timer chain must be cancelled, not merely ignored');
  } finally {
    t.mock.timers.reset();
  }
});

test('startHeartbeatTicker: a no-op onHeartbeat still returns a safe no-op stop function', () => {
  const stop = startHeartbeatTicker(undefined);
  assert.doesNotThrow(() => stop());
});
