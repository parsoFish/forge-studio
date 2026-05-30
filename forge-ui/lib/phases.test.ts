/**
 * Tests for phase-state derivation. Run directly with
 * `node --test --experimental-strip-types forge-ui/lib/phases.test.ts`.
 *
 * Operator model (2026-05-30): amber only while running; green/red are the
 * only terminal phase states. A dev-loop that ends `complete:0/failed:N` is
 * RED even with no separate `error` event and no cycle-level verdict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePhaseStates } from './phases.ts';
import type { EventLogEntry } from './bridge-client.ts';

let seq = 0;
function ev(phase: string, event_type: string, metadata: Record<string, unknown> = {}): EventLogEntry {
  seq += 1;
  return {
    event_id: `e${seq}`,
    initiative_id: 'INIT-x',
    started_at: `2026-05-30T08:00:${String(seq).padStart(2, '0')}.000Z`,
    phase,
    skill: phase,
    event_type,
    metadata,
  } as EventLogEntry;
}
const statusOf = (events: EventLogEntry[], phase: string) =>
  derivePhaseStates(events).find((p) => p.phase === phase)?.status;

test('no events → all pending', () => {
  for (const p of derivePhaseStates([])) assert.equal(p.status, 'pending');
});

test('phase started, not ended → active', () => {
  assert.equal(statusOf([ev('project-manager', 'start')], 'project-manager'), 'active');
});

test('phase ended clean → complete (green)', () => {
  const events = [ev('project-manager', 'start'), ev('project-manager', 'end', { work_item_count: 3 })];
  assert.equal(statusOf(events, 'project-manager'), 'complete');
});

test('dev-loop ends complete:0/failed:3 → failed (red), not green', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 3, complete: 0, failed: 3 }),
  ];
  assert.equal(statusOf(events, 'developer-loop'), 'failed');
});

test('dev-loop ends complete:2/failed:1 → failed (red) — fewer complete than taken on', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 3, complete: 2, failed: 1 }),
  ];
  assert.equal(statusOf(events, 'developer-loop'), 'failed');
});

test('per-WI end does NOT end the dev-loop phase (stays active)', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_id: 'WI-1', status: 'complete' }),
  ];
  assert.equal(statusOf(events, 'developer-loop'), 'active');
});

test('phase errored in-flight, still running → retrying (amber)', () => {
  const events = [ev('developer-loop', 'start'), ev('developer-loop', 'error', {})];
  assert.equal(statusOf(events, 'developer-loop'), 'retrying');
});

test('phase errored in-flight but ended clean → complete (recovered, green)', () => {
  const events = [ev('developer-loop', 'start'), ev('developer-loop', 'error', {}), ev('developer-loop', 'end', { work_item_count: 1, complete: 1, failed: 0 })];
  assert.equal(statusOf(events, 'developer-loop'), 'complete');
});

test('PM throws (error, no clean end) + orchestrator error → failed (red)', () => {
  const events = [
    ev('project-manager', 'start'),
    ev('project-manager', 'error', {}),
    ev('orchestrator', 'error', {}), // cycle-level terminal failure
  ];
  assert.equal(statusOf(events, 'project-manager'), 'failed');
});

test('expected_fail error does not tint the phase → ends complete', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'error', { expected_fail: true }),
    ev('developer-loop', 'end', { work_item_count: 1, complete: 1, failed: 0 }),
  ];
  assert.equal(statusOf(events, 'developer-loop'), 'complete');
});

test('closure events fold into review-loop phase', () => {
  assert.equal(statusOf([ev('closure', 'start')], 'review-loop'), 'active');
});
