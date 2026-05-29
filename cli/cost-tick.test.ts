/**
 * S7 / C14 — `cost_tick` derived-consumer tests.
 *
 * Every test stands up a real `EventLogger` over a tempdir and a synthetic
 * clock so debounce + emit semantics are deterministic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readFileSync as _readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger, type EventLogEntry } from '../orchestrator/logging.ts';
import { createCostTickConsumer } from './cost-tick.ts';

function readEntries(path: string): EventLogEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((s) => s.trim() !== '')
    .map((s) => JSON.parse(s) as EventLogEntry);
}

function makeClock(initial = 0) {
  let now = initial;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function baseEntry(
  overrides: Partial<EventLogEntry> & { cost_usd?: number; metadata?: Record<string, unknown> },
): EventLogEntry {
  return {
    event_id: 'EV_test',
    cycle_id: 'cycle-ct',
    initiative_id: 'INIT-ct',
    phase: 'developer-loop',
    skill: 'dev-ralph',
    event_type: 'iteration',
    input_refs: [],
    output_refs: [],
    started_at: '2026-05-23T14:30:00.000Z',
    ...overrides,
  } as EventLogEntry;
}

// ---------------------------------------------------------------------------
// 1. Emits on cost change.
// ---------------------------------------------------------------------------

test('cost-tick: emits a cost_tick when cycle cost changes (S7 / C14)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct', join(root, '_logs'));
    const clock = makeClock();
    const sub = createCostTickConsumer(logger, { now: clock.now });

    sub.consume(baseEntry({ cost_usd: 0.1 }));
    clock.advance(1100);
    sub.consume(baseEntry({ cost_usd: 0.2 }));

    const entries = readEntries(logger.logFilePath);
    const ticks = entries.filter((e) => e.event_type === 'cost_tick');
    assert.ok(ticks.length >= 1, `expected ≥1 cost_tick, got ${ticks.length}`);
    const last = ticks[ticks.length - 1]!;
    assert.equal((last.metadata as { cycle_cost_usd: number }).cycle_cost_usd, 0.3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Debounce: rapid cost-changes within 1s collapse to one tick.
// ---------------------------------------------------------------------------

test('cost-tick: debounces rapid cost changes within 1s to a single emit', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct-debounce', join(root, '_logs'));
    const clock = makeClock();
    const sub = createCostTickConsumer(logger, { now: clock.now, debounceMs: 1000 });

    // 5 cost-bearing events at 0, 200, 400, 600, 800 ms.
    sub.consume(baseEntry({ cost_usd: 0.01 }));
    clock.advance(200);
    sub.consume(baseEntry({ cost_usd: 0.01 }));
    clock.advance(200);
    sub.consume(baseEntry({ cost_usd: 0.01 }));
    clock.advance(200);
    sub.consume(baseEntry({ cost_usd: 0.01 }));
    clock.advance(200);
    sub.consume(baseEntry({ cost_usd: 0.01 }));

    const ticks = readEntries(logger.logFilePath).filter((e) => e.event_type === 'cost_tick');
    // First emit fires at t=0 (no prior emit). All subsequent collapse
    // because t-lastEmittedAt < 1000ms.
    assert.equal(ticks.length, 1, `expected exactly 1 tick during the 1s burst, got ${ticks.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. No emit when cost unchanged.
// ---------------------------------------------------------------------------

test('cost-tick: does not emit when cost is unchanged across events (S7 / C14)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct-noop', join(root, '_logs'));
    const clock = makeClock();
    const sub = createCostTickConsumer(logger, { now: clock.now });

    sub.consume(baseEntry({ cost_usd: 0.05 })); // → 1 tick
    clock.advance(2000);
    // Zero-cost events MUST NOT trigger a tick.
    sub.consume(baseEntry({ cost_usd: 0 }));
    sub.consume(baseEntry({ event_type: 'log', message: 'noop' }));
    sub.consume(baseEntry({ cost_usd: undefined as unknown as number }));
    clock.advance(2000);

    const ticks = readEntries(logger.logFilePath).filter((e) => e.event_type === 'cost_tick');
    assert.equal(ticks.length, 1, `expected exactly 1 tick (no re-emit on unchanged cost), got ${ticks.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Rolling sum per WI vs per cycle.
// ---------------------------------------------------------------------------

test('cost-tick: rolling sum partitions per WI distinct from cycle-level (S7 / C14)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct-partitions', join(root, '_logs'));
    const clock = makeClock();
    const sub = createCostTickConsumer(logger, { now: clock.now, debounceMs: 100 });

    sub.consume(baseEntry({ cost_usd: 0.10, metadata: { work_item_id: 'WI-1' } }));
    clock.advance(200);
    sub.consume(baseEntry({ cost_usd: 0.20, metadata: { work_item_id: 'WI-2' } }));
    clock.advance(200);
    sub.consume(baseEntry({ cost_usd: 0.05, metadata: { work_item_id: 'WI-1' } }));

    sub.flushAll();

    const ticks = readEntries(logger.logFilePath).filter((e) => e.event_type === 'cost_tick');
    // Find the most recent WI-1 vs WI-2 vs cycle-level ticks.
    const wi1 = ticks.filter((t) => (t.metadata as { wi_id?: string }).wi_id === 'WI-1').pop();
    const wi2 = ticks.filter((t) => (t.metadata as { wi_id?: string }).wi_id === 'WI-2').pop();
    const cycleOnly = ticks.filter((t) => !(t.metadata as { wi_id?: string }).wi_id).pop();

    assert.ok(wi1, 'expected a WI-1 tick');
    assert.ok(wi2, 'expected a WI-2 tick');
    assert.ok(cycleOnly, 'expected a cycle-level tick');
    assert.equal((wi1!.metadata as { wi_cost_usd: number }).wi_cost_usd, 0.15);
    assert.equal((wi2!.metadata as { wi_cost_usd: number }).wi_cost_usd, 0.2);
    assert.equal((cycleOnly!.metadata as { cycle_cost_usd: number }).cycle_cost_usd, 0.35);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. unsubscribe() cleanly stops further emits.
// ---------------------------------------------------------------------------

test('cost-tick: unsubscribe() stops further emits (S7 / C14)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct-unsub', join(root, '_logs'));
    const clock = makeClock();
    const sub = createCostTickConsumer(logger, { now: clock.now });

    sub.consume(baseEntry({ cost_usd: 0.1 })); // → tick
    sub.unsubscribe();
    clock.advance(5000);
    sub.consume(baseEntry({ cost_usd: 0.2 })); // ignored
    sub.flushAll();                            // also a no-op once unsubscribed

    const ticks = readEntries(logger.logFilePath).filter((e) => e.event_type === 'cost_tick');
    assert.equal(ticks.length, 1, `expected exactly 1 tick after unsubscribe, got ${ticks.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. C14 invariant: cost_tick is never re-fed into itself.
// ---------------------------------------------------------------------------

test('cost-tick: ignores its own cost_tick events (no self-loop)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct-self', join(root, '_logs'));
    const clock = makeClock();
    const sub = createCostTickConsumer(logger, { now: clock.now });

    sub.consume(baseEntry({
      event_type: 'cost_tick',
      cost_usd: 99,
      metadata: { cycle_cost_usd: 99 },
    }));
    sub.flushAll();

    const ticks = readEntries(logger.logFilePath).filter((e) => e.event_type === 'cost_tick');
    assert.equal(ticks.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. C14 invariant: outerTee gets every entry, in order.
// ---------------------------------------------------------------------------

test('cost-tick: chains outer tee (chained sink invariant)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-cost-tick-'));
  try {
    const logger = createLogger('cycle-ct-chain', join(root, '_logs'));
    const clock = makeClock();
    const seen: string[] = [];
    const sub = createCostTickConsumer(logger, {
      now: clock.now,
      tee: (e) => seen.push(e.event_type),
    });

    sub.consume(baseEntry({ event_type: 'start' }));
    sub.consume(baseEntry({ cost_usd: 0.1 }));
    sub.consume(baseEntry({ event_type: 'end' }));

    assert.deepEqual(seen, ['start', 'iteration', 'end']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
