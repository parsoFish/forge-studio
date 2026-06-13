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
} from './flow-budgets.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

    tracker.addCost(5); // 50% — no event
    assert.strictEqual(logger.events.length, 0);
  });

  it('emits exactly ONE cost-warn when crossing 70%', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.addCost(6); // 60% — no warn yet
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 0);

    tracker.addCost(1.5); // 75% — crosses 70% → ONE warn
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 1);

    tracker.addCost(1); // 85% — still only one warn
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 1);
  });

  it('cost-warn event carries correct metadata', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.addCost(7.5); // 75%

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
    tracker.addCost(9); // 90%
    assert.strictEqual(tracker.checkCeiling(), false);
  });

  it('checkCeiling() emits cost-ceiling-stop and returns true when at/over ceiling', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 10, initiativeId: 'x', logger: logger as never });

    tracker.addCost(10); // 100%

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
    tracker.addCost(11); // over ceiling

    assert.throws(() => {
      tracker.checkCeiling({ throw: true });
    }, CostCeilingError);
  });

  it('no enforcement when ceilingUsd is 0 or absent', () => {
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 0, initiativeId: 'x', logger: logger as never });

    tracker.addCost(1000);
    const stopped = tracker.checkCeiling();
    assert.strictEqual(stopped, false);
    assert.strictEqual(logger.events.filter(e => e.message === 'flow.cost-warn').length, 0);
  });

  it('EQUIVALENCE: forge-cycle config (costCeilingUsd:25) with $5 spend is unaffected', () => {
    // Simulates a run well under the 25 USD ceiling — no events must fire
    const logger = makeLogger();
    const tracker = new CostTracker({ ceilingUsd: 25, initiativeId: 'forge-cycle-init', logger: logger as never });

    tracker.addCost(5); // $5 = 20% of $25 — no warn, no stop
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
});

// ---------------------------------------------------------------------------
// RateLimitGate tests
// ---------------------------------------------------------------------------

describe('RateLimitGate', () => {
  it('waitIfNeeded returns immediately when no resetsAt is recorded', async () => {
    const gate = new RateLimitGate({ now: () => 1000 });
    const start = Date.now();
    await gate.waitIfNeeded();
    const elapsed = Date.now() - start;
    // Should not sleep — resolve in < 50ms
    assert.ok(elapsed < 50, `expected no sleep, got ${elapsed}ms`);
  });

  it('does not wait when now() is past resetsAt', async () => {
    const gate = new RateLimitGate({ now: () => 5000 });
    gate.recordRateLimit(3000); // resetsAt in the past
    const start = Date.now();
    await gate.waitIfNeeded();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `expected no sleep, got ${elapsed}ms`);
  });

  it('waits until resetsAt when resetsAt is in the future (small delta)', async () => {
    // Use real Date.now() but set resetsAt 60ms in the future.
    // This verifies the gate actually sleeps rather than resolving immediately.
    const gate = new RateLimitGate(); // no injected clock → real Date.now()
    const resetsAt = Date.now() + 60;
    gate.recordRateLimit(resetsAt);

    const start = Date.now();
    await gate.waitIfNeeded();
    const elapsed = Date.now() - start;

    // Should have waited ~60ms — give generous slack for CI jitter
    assert.ok(elapsed >= 50, `expected ~60ms wait, got ${elapsed}ms`);
    assert.ok(elapsed < 400, `wait unexpectedly long: ${elapsed}ms`);
  });

  it('clears resetsAt after waiting so the next call returns immediately', async () => {
    // Use real clock; set resetsAt 40ms in the future.
    const gate = new RateLimitGate();
    gate.recordRateLimit(Date.now() + 40);

    await gate.waitIfNeeded(); // first call waits

    // Second call: resetsAt cleared → should resolve immediately
    const start = Date.now();
    await gate.waitIfNeeded();
    const elapsed = Date.now() - start;
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
