/**
 * Tests for orchestrator/flow-budgets.ts (ADR-028 decision 4, M3-3).
 *
 * All three budget classes are tested with injected clocks / fake streams.
 * No filesystem, no SDK calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CostTracker,
  WedgeDetector,
  RateLimitGate,
  CostCeilingError,
  WedgeKillError,
} from '../../flow-budgets.ts';
import type { EventLogEntry } from '@forge/kernel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal cost-bearing EventLogEntry on a phase that never emits `iteration`
 * (`orchestrator`) — under the event-cost.ts restatement rule, an unlatched
 * phase has EVERY event counted, so feeding one of these per `addCost(N)`
 * call keeps each case's arithmetic identical to the old API.
 */
let costEventSeq = 0;
function costEvent(costUsd: number): EventLogEntry {
  costEventSeq += 1;
  return {
    event_id: `cost-evt-${costEventSeq}`,
    cycle_id: 'test-cycle',
    initiative_id: 'x',
    phase: 'orchestrator',
    skill: 'flow-budgets.test',
    event_type: 'end',
    input_refs: [],
    output_refs: [],
    cost_usd: costUsd,
    started_at: new Date(0).toISOString(),
  };
}

/** Minimal EventLogger spy */
function makeLogger() {
  const events: Array<{ message?: string; metadata?: Record<string, unknown> }> = [];
  return {
    events,
    logFilePath: '/tmp/test.jsonl',
    cycleId: 'test-cycle',
    emit(partial: unknown) {
      events.push(partial as { message?: string; metadata?: Record<string, unknown> });
      return { event_id: `evt-${events.length}` };
    },
  };
}

// ---------------------------------------------------------------------------
// CostTracker tests
// ---------------------------------------------------------------------------

describe('CostTracker', () => {
  it('emits no events when cost stays below 70%', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.noteEvent(costEvent(5)); // 50% — no event
    assert.strictEqual(logger.events.length, 0);
  });

  it('emits exactly ONE cost-warn when crossing 70%', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.noteEvent(costEvent(6)); // 60% — no warn yet
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 0);

    tracker.noteEvent(costEvent(1.5)); // 75% — crosses 70% → ONE warn
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 1);

    tracker.noteEvent(costEvent(1)); // 85% — still only one warn
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 1);
  });

  it('cost-warn event carries correct metadata', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.noteEvent(costEvent(7.5)); // 75%

    const warn = logger.events.find(e => e.message === 'flow.cost-warn');
    assert.ok(warn, 'warn event must be emitted');
    assert.ok(typeof warn.metadata?.spentUsd === 'number');
    assert.ok(typeof warn.metadata?.ceilingUsd === 'number');
    assert.ok(typeof warn.metadata?.pct === 'number');
    assert.ok((warn.metadata?.pct as number) >= 70);
  });

  it('checkCeiling() returns false when under ceiling', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });
    tracker.noteEvent(costEvent(9)); // 90%
    assert.strictEqual(tracker.checkCeiling(), false);
  });

  it('checkCeiling() emits cost-ceiling-stop and returns true when at/over ceiling', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.noteEvent(costEvent(10)); // 100%

    const stopped = tracker.checkCeiling();
    assert.strictEqual(stopped, true);

    const stopEvt = logger.events.find(e => e.message === 'flow.cost-ceiling-stop');
    assert.ok(stopEvt, 'cost-ceiling-stop event must be emitted');
    assert.ok(typeof stopEvt.metadata?.spentUsd === 'number');
    assert.ok(typeof stopEvt.metadata?.ceilingUsd === 'number');
  });

  it('checkCeiling() after exceeding ceiling throws CostCeilingError', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });
    tracker.noteEvent(costEvent(11)); // over ceiling

    assert.throws(() => {
      tracker.checkCeiling({ throw: true });
    }, CostCeilingError);
  });

  it('no enforcement when ceilingUsd is 0 or absent', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 0, initiativeId: 'x', logger: logger as never });

    tracker.noteEvent(costEvent(1000));
    const stopped = tracker.checkCeiling();
    assert.strictEqual(stopped, false);
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 0);
  });

  it('EQUIVALENCE: forge-cycle config (costCeilingUsd:25) with $5 spend is unaffected', () => {
    // Simulates a run well under the 25 USD ceiling — no events must fire
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 25, initiativeId: 'forge-cycle-init', logger: logger as never });

    tracker.noteEvent(costEvent(5)); // $5 = 20% of $25 — no warn, no stop
    assert.strictEqual(logger.events.length, 0);
    assert.strictEqual(tracker.checkCeiling(), false);
  });
});

// ---------------------------------------------------------------------------
// WedgeDetector tests
// ---------------------------------------------------------------------------

describe('WedgeDetector', () => {
  it('does nothing when wedgeKillMs is not set', () => {
    const detector = new WedgeDetector({ wedgeKillMs: undefined, nodeId: 'pm' });
    // Simulate heartbeats with no tool events — should not throw
    detector.onHeartbeat(1000);
    detector.onHeartbeat(2000);
    const killed = detector.check(99_000);
    assert.strictEqual(killed, false);
  });

  it('does not fire when tool progress events arrive within the window', () => {
    const detector = new WedgeDetector({ wedgeKillMs: 5_000, nodeId: 'dev' });

    detector.onHeartbeat(0);
    detector.onToolProgress(3_000); // progress at 3s
    detector.onHeartbeat(4_000);

    // Check at 7s — only 4s since last progress, under the 5s window
    const killed = detector.check(7_000);
    assert.strictEqual(killed, false);
  });

  it('fires when heartbeats continue but no tool progress for wedgeKillMs', () => {
    const detector = new WedgeDetector({ wedgeKillMs: 5_000, nodeId: 'dev' });

    detector.onHeartbeat(0); // start
    detector.onHeartbeat(2_000);
    detector.onHeartbeat(5_000);

    // No tool progress — at 6000ms (1s past the 5s window) it is a wedge
    const killed = detector.check(6_000);
    assert.strictEqual(killed, true);
  });

  it('does NOT fire when no heartbeats have arrived (agent not yet lively)', () => {
    const detector = new WedgeDetector({ wedgeKillMs: 5_000, nodeId: 'dev' });
    // check at t=10s, but no heartbeats → no wedge (may just be a slow start)
    const killed = detector.check(10_000);
    assert.strictEqual(killed, false);
  });

  it('resets after tool progress — kill clock restarts', () => {
    const detector = new WedgeDetector({ wedgeKillMs: 5_000, nodeId: 'dev' });

    detector.onHeartbeat(0);
    // No tool progress until 4999ms — just inside window
    const almostKilled = detector.check(4_999);
    assert.strictEqual(almostKilled, false);

    // Progress at 5000 resets the clock
    detector.onToolProgress(5_000);
    detector.onHeartbeat(8_000);

    // Check at 9000ms — only 4s since last progress
    const notKilled = detector.check(9_000);
    assert.strictEqual(notKilled, false);

    // Check at 11000ms — 6s since last progress → wedge
    const killed = detector.check(11_000);
    assert.strictEqual(killed, true);
  });

  it('wedgeKillError carries correct metadata', () => {
    const detector = new WedgeDetector({ wedgeKillMs: 5_000, nodeId: 'pm' });
    detector.onHeartbeat(0);

    const err = detector.buildKillError(6_000);
    assert.ok(err instanceof WedgeKillError);
    assert.strictEqual(err.nodeId, 'pm');
    assert.ok(typeof err.lastProgressAt === 'number');
  });

  /**
   * forge-8vfn.7.6.50: `buildKillError(nowMs)` already receives the caller's
   * injected "now" — every other WedgeDetector method takes `nowMs` as a
   * parameter and never reads the wall clock itself. `WedgeKillError`'s
   * constructor broke that: it called `Date.now()` directly instead of using
   * the `nowMs` it was handed, so the message's "Xs ago" was always measured
   * against the REAL current wall clock, not the (possibly fake, possibly
   * historical) nowMs the caller supplied. `detector.onHeartbeat(0)` then
   * `detector.buildKillError(6_000)` should report "6s ago"; it actually
   * reports the live epoch in seconds — e.g. "1789778103s ago".
   */
  it("wedgeKillError's message uses the injected nowMs, not a fresh Date.now() read", () => {
    const detector = new WedgeDetector({ wedgeKillMs: 5_000, nodeId: 'pm' });
    detector.onHeartbeat(0);
    const err = detector.buildKillError(6_000);
    assert.match(
      err.message,
      /last progress 6s ago/,
      `must report the injected 6s gap (nowMs=6000, lastProgressAt=0), not a live wall-clock read:\n${err.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// RateLimitGate tests
// ---------------------------------------------------------------------------

describe('RateLimitGate', () => {
  it('waitIfNeeded returns immediately when no resetsAt is recorded', async () => {
    const gate = new RateLimitGate({ now: () => 1000 });
    // performance.now(), not Date.now() (forge-8vfn.7.6.50): this measures
    // the TEST's own wall-clock cost, a local duration unrelated to the
    // gate's injected `now` above — Date.now() is not monotonic on this host.
    const start = performance.now();
    await gate.waitIfNeeded();
    const elapsed = performance.now() - start;
    // Should not sleep — resolve in < 50ms
    assert.ok(elapsed < 50, `expected no sleep, got ${elapsed}ms`);
  });

  it('does not wait when now() is past resetsAt', async () => {
    const gate = new RateLimitGate({ now: () => 5000 });
    gate.recordRateLimit(3000); // resetsAt in the past
    const start = performance.now();
    await gate.waitIfNeeded();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `expected no sleep, got ${elapsed}ms`);
  });

  it('waits until resetsAt when resetsAt is in the future, driven by a fake clock and fake timer (no real sleep)', async () => {
    // forge-m7-c: this test used to run against REAL Date.now()/setTimeout
    // and assert a real-elapsed-wall-time upper bound (`elapsed < 400`) via
    // performance.now(). performance.now() is monotonic, so that part was
    // right — but under host CPU starvation a real `setTimeout(tick, 10)`
    // poll tick can fire ~2.9s late regardless (this host steps its wall
    // clock by that much under load; see
    // /home/parso/forge/_1.0/reports/m7-c-clockprobe-1.log), so the
    // assertion was really measuring host scheduling jitter, not gate
    // correctness. Flake seen 2026-09-25: "wait unexpectedly long:
    // 2940.48ms". Fix: inject BOTH the clock and the timer scheduler, drive
    // both fakes by hand, and assert the REQUESTED sleep cadence (10ms per
    // poll tick, 6 ticks for a 60ms gap) instead of a measured real duration.
    let current = 1_000_000;
    const scheduled: Array<{ fn: () => void; delayMs: number }> = [];
    const fakeSetTimeout = ((fn: () => void, delayMs: number) => {
      scheduled.push({ fn, delayMs });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    const gate = new RateLimitGate({ now: () => current, setTimeout: fakeSetTimeout });
    const resetsAt = current + 60; // 60ms ahead, entirely on the fake clock
    gate.recordRateLimit(resetsAt);

    const waitPromise = gate.waitIfNeeded();

    // Drain the fake timer queue by hand: each iteration advances the fake
    // clock by exactly the delay the gate requested, then fires that tick.
    // This proves the gate's REQUESTED poll cadence, independent of any
    // real wall-clock timing.
    let ticks = 0;
    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      assert.strictEqual(next.delayMs, 10, 'gate must poll in 10ms ticks');
      current += next.delayMs;
      next.fn();
      ticks += 1;
      assert.ok(ticks <= 20, 'gate kept scheduling polls after resetsAt had passed');
    }

    // Safety net only, not a timing assertion: once the fake queue drains,
    // resolution is synchronous (a couple of microtask turns), so this
    // should never come close to firing. It exists so a regression that
    // silently falls back to the real global setTimeout fails fast with a
    // legible reason instead of hanging the test run.
    const guardMs = 500;
    const guard = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(
        `gate.waitIfNeeded() did not resolve within ${guardMs}ms of draining the fake timer queue — ` +
          'is it still using the real global setTimeout instead of the injected one?',
      )), guardMs);
    });
    await Promise.race([waitPromise, guard]);

    assert.strictEqual(ticks, 6, 'expected exactly 6 polling ticks to cover a 60ms gap at 10ms/tick');
  });

  it('clears resetsAt after waiting so the next call returns immediately', async () => {
    // Use real clock; set resetsAt 40ms in the future.
    const gate = new RateLimitGate();
    gate.recordRateLimit(Date.now() + 40);

    await gate.waitIfNeeded(); // first call waits

    // Second call: resetsAt cleared → should resolve immediately
    const start = performance.now();
    await gate.waitIfNeeded();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `expected immediate return, got ${elapsed}ms`);
  });

  it('recordRateLimit is idempotent — keeps the latest resetsAt', () => {
    const gate = new RateLimitGate({ now: () => 0 });
    gate.recordRateLimit(1000);
    gate.recordRateLimit(2000); // later reset
    // Access internal for assertion — using the public interface: check
    // that waitIfNeeded sleeps for ~2s (we just verify it doesn't instantly return)
    assert.ok((gate as unknown as { resetsAt: number | null }).resetsAt === 2000);
  });
});
