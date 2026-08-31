/**
 * Tests for cli/reflect-reconcile.ts — the late-feedback reflector auto-rerun.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  needsReflectRerun,
  lastReflectorEndMs,
  hasReflectionLossEvent,
  reconcileReflectFeedback,
} from './reflect-reconcile.ts';

// ---------------------------------------------------------------------------
// needsReflectRerun — the pure predicate
// ---------------------------------------------------------------------------

test('needsReflectRerun: feedback newer than last reflector.end → true', () => {
  assert.equal(needsReflectRerun(2000, 1000), true);
});

test('needsReflectRerun: feedback older than last reflector.end → false', () => {
  assert.equal(needsReflectRerun(1000, 2000), false);
});

test('needsReflectRerun: no prior reflector.end → true', () => {
  assert.equal(needsReflectRerun(1000, null), true);
});

test('needsReflectRerun: exact tie → false (treated as already seen)', () => {
  assert.equal(needsReflectRerun(1500, 1500), false);
});

// ---------------------------------------------------------------------------
// lastReflectorEndMs — parse events.jsonl
// ---------------------------------------------------------------------------

test('lastReflectorEndMs: returns the latest reflector.end started_at in ms', () => {
  const root = mkdtempSync(join(tmpdir(), 'refl-end-'));
  try {
    const p = join(root, 'events.jsonl');
    writeFileSync(
      p,
      [
        JSON.stringify({ message: 'reflector.start', started_at: '2026-06-22T08:50:00.000Z' }),
        JSON.stringify({ message: 'reflector.end', started_at: '2026-06-22T08:53:00.000Z' }),
        JSON.stringify({ message: 'reflector.end', started_at: '2026-06-22T09:10:00.000Z' }),
        'not json',
      ].join('\n'),
    );
    assert.equal(lastReflectorEndMs(p), Date.parse('2026-06-22T09:10:00.000Z'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lastReflectorEndMs: missing file / no end → null', () => {
  const root = mkdtempSync(join(tmpdir(), 'refl-end-'));
  try {
    assert.equal(lastReflectorEndMs(join(root, 'nope.jsonl')), null);
    const p = join(root, 'events.jsonl');
    writeFileSync(p, JSON.stringify({ message: 'reflector.start', started_at: '2026-06-22T08:50:00.000Z' }));
    assert.equal(lastReflectorEndMs(p), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// reconcileReflectFeedback — the walk + trigger
// ---------------------------------------------------------------------------

function writeCycle(
  logsRoot: string,
  cycleId: string,
  opts: { feedback?: boolean; endIso?: string | null; feedbackMs?: number },
): void {
  const dir = join(logsRoot, cycleId);
  mkdirSync(dir, { recursive: true });
  if (opts.endIso) {
    writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ message: 'reflector.end', started_at: opts.endIso }));
  }
  if (opts.feedback) {
    const fp = join(dir, 'user-feedback.md');
    writeFileSync(fp, '# feedback\n');
    if (typeof opts.feedbackMs === 'number') {
      const s = opts.feedbackMs / 1000;
      utimesSync(fp, s, s);
    }
  }
}

test('reconcileReflectFeedback: reruns only cycles whose feedback out-dates the last reflector.end', async () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'reconcile-logs-'));
  try {
    // A: feedback NEWER than end → rerun
    writeCycle(logsRoot, 'A', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: '2026-06-22T00:00:00.000Z' });
    // B: feedback OLDER than end → no rerun
    writeCycle(logsRoot, 'B', { feedback: true, feedbackMs: Date.parse('2026-06-21T00:00:00Z'), endIso: '2026-06-22T00:00:00.000Z' });
    // C: no feedback → no rerun
    writeCycle(logsRoot, 'C', { feedback: false, endIso: '2026-06-22T00:00:00.000Z' });
    // D: feedback but never reflected → rerun
    writeCycle(logsRoot, 'D', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: null });
    // _architect-x: ignored (underscore dir)
    writeCycle(logsRoot, '_architect-x', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: null });

    const calls: string[] = [];
    const reran = await reconcileReflectFeedback({
      logsRoot,
      queueRoot: join(logsRoot, '..', '_queue'),
      now: Date.parse('2026-06-24T00:00:00Z'), // pin the clock: fixtures sit inside the recency window
      rerunReflector: async ({ cycleId }) => { calls.push(cycleId); },
    });

    assert.deepEqual(reran.sort(), ['A', 'D']);
    assert.deepEqual(calls.sort(), ['A', 'D']);
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('reconcileReflectFeedback: skips feedback older than the recovery window (no boot flood)', async () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'reconcile-logs-'));
  try {
    const now = Date.parse('2026-06-24T00:00:00Z');
    // recent: feedback 1 day old → eligible
    writeCycle(logsRoot, 'recent', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: null });
    // stale: feedback 18 days old (the betterado-flood case) → skipped
    writeCycle(logsRoot, 'stale', { feedback: true, feedbackMs: Date.parse('2026-06-06T00:00:00Z'), endIso: null });

    const calls: string[] = [];
    const reran = await reconcileReflectFeedback({
      logsRoot,
      queueRoot: join(logsRoot, '_queue'),
      now,
      rerunReflector: async ({ cycleId }) => { calls.push(cycleId); },
    });
    assert.deepEqual(reran, ['recent'], 'only recent feedback re-runs');
    assert.deepEqual(calls, ['recent']);
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('reconcileReflectFeedback: a throwing rerun is logged-and-skipped, the pass continues', async () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'reconcile-logs-'));
  try {
    writeCycle(logsRoot, 'orphan', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: null });
    writeCycle(logsRoot, 'good', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: null });

    const reran = await reconcileReflectFeedback({
      logsRoot,
      queueRoot: join(logsRoot, '_queue'),
      now: Date.parse('2026-06-24T00:00:00Z'), // pin the clock: fixtures sit inside the recency window
      rerunReflector: async ({ cycleId }) => {
        if (cycleId === 'orphan') throw new Error('no manifest');
      },
    });
    // 'good' still ran despite 'orphan' throwing.
    assert.deepEqual(reran, ['good']);
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2.10 reflector pipeline honesty — the boot reconcile names WHAT it recovered
// ---------------------------------------------------------------------------

test('hasReflectionLossEvent: true only when a cycle.reflection-lost event is present', () => {
  const root = mkdtempSync(join(tmpdir(), 'reconcile-loss-'));
  try {
    const p = join(root, 'events.jsonl');
    writeFileSync(p, [
      JSON.stringify({ message: 'reflector.start', started_at: '2026-07-09T00:00:00.000Z' }),
      JSON.stringify({ message: 'cycle.reflection-lost', started_at: '2026-07-09T00:01:00.000Z', metadata: { cause: 'crash' } }),
    ].join('\n'));
    assert.equal(hasReflectionLossEvent(p), true);

    const q = join(root, 'clean.jsonl');
    writeFileSync(q, JSON.stringify({ message: 'reflector.end', started_at: '2026-07-09T00:00:00.000Z' }));
    assert.equal(hasReflectionLossEvent(q), false);

    assert.equal(hasReflectionLossEvent(join(root, 'missing.jsonl')), false, 'missing file never throws');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reconcileReflectFeedback: log line says it RECOVERED a lost reflection when the loss was recorded', async () => {
  const logsRoot = mkdtempSync(join(tmpdir(), 'reconcile-logs-'));
  try {
    // lost: reflection-lost recorded, feedback later → rerun logs the recovery
    const lostDir = join(logsRoot, 'lost');
    mkdirSync(lostDir, { recursive: true });
    writeFileSync(join(lostDir, 'events.jsonl'), [
      JSON.stringify({ message: 'reflector.start', started_at: '2026-06-22T00:00:00.000Z' }),
      JSON.stringify({ message: 'cycle.reflection-lost', started_at: '2026-06-22T00:01:00.000Z', metadata: { cause: 'budget-exhausted' } }),
    ].join('\n'));
    const lostFp = join(lostDir, 'user-feedback.md');
    writeFileSync(lostFp, '# feedback\n');
    {
      const s = Date.parse('2026-06-23T00:00:00Z') / 1000;
      utimesSync(lostFp, s, s);
    }
    // plain: ordinary late feedback, no loss recorded
    writeCycle(logsRoot, 'plain', { feedback: true, feedbackMs: Date.parse('2026-06-23T00:00:00Z'), endIso: '2026-06-22T00:00:00.000Z' });

    const logged: string[] = [];
    const reran = await reconcileReflectFeedback({
      logsRoot,
      queueRoot: join(logsRoot, '_queue'),
      now: Date.parse('2026-06-24T00:00:00Z'),
      rerunReflector: async () => { /* ok */ },
      log: (msg) => logged.push(msg),
    });
    assert.deepEqual(reran.sort(), ['lost', 'plain']);

    const lostLine = logged.find((l) => l.includes('lost'));
    assert.ok(lostLine, 'expected a log line for the lost cycle');
    assert.match(lostLine!, /recovering lost reflection/, 'the recovery of a recorded loss is named explicitly');
    const plainLine = logged.find((l) => l.includes('plain'));
    assert.ok(plainLine, 'expected a log line for the plain cycle');
    assert.doesNotMatch(plainLine!, /recovering lost reflection/, 'ordinary feedback re-ingest keeps the plain wording');
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
});
