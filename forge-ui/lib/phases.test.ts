/**
 * Tests for phase-state derivation.
 *
 * Operator model (2026-05-30): amber only while running; green/red are the
 * only terminal phase states. A dev-loop that ends `complete:0/failed:N` is
 * RED even with no separate `error` event and no cycle-level verdict.
 */
import { test, expect } from 'vitest';
import { derivePhaseStates, costForPhaseHex } from './phases.ts';
import type { EventLogEntry, CostSummary } from './bridge-client.ts';

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
  for (const p of derivePhaseStates([])) expect(p.status).toBe('pending');
});

test('phase started, not ended → active', () => {
  expect(statusOf([ev('project-manager', 'start')], 'project-manager')).toBe('active');
});

test('phase ended clean → complete (green)', () => {
  const events = [ev('project-manager', 'start'), ev('project-manager', 'end', { work_item_count: 3 })];
  expect(statusOf(events, 'project-manager')).toBe('complete');
});

test('dev-loop ends complete:0/failed:3 → failed (red), not green', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 3, complete: 0, failed: 3 }),
  ];
  expect(statusOf(events, 'developer-loop')).toBe('failed');
});

test('dev-loop ends complete:2/failed:1 → failed (red) — fewer complete than taken on', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 3, complete: 2, failed: 1 }),
  ];
  expect(statusOf(events, 'developer-loop')).toBe('failed');
});

test('per-WI end does NOT end the dev-loop phase (stays active)', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_id: 'WI-1', status: 'complete' }),
  ];
  expect(statusOf(events, 'developer-loop')).toBe('active');
});

test('phase errored in-flight, still running → retrying (amber)', () => {
  const events = [ev('developer-loop', 'start'), ev('developer-loop', 'error', {})];
  expect(statusOf(events, 'developer-loop')).toBe('retrying');
});

test('phase errored in-flight but ended clean → complete (recovered, green)', () => {
  const events = [ev('developer-loop', 'start'), ev('developer-loop', 'error', {}), ev('developer-loop', 'end', { work_item_count: 1, complete: 1, failed: 0 })];
  expect(statusOf(events, 'developer-loop')).toBe('complete');
});

test('PM throws (error, no clean end) + orchestrator error → failed (red)', () => {
  const events = [
    ev('project-manager', 'start'),
    ev('project-manager', 'error', {}),
    ev('orchestrator', 'error', {}), // cycle-level terminal failure
  ];
  expect(statusOf(events, 'project-manager')).toBe('failed');
});

test('expected_fail error does not tint the phase → ends complete', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'error', { expected_fail: true }),
    ev('developer-loop', 'end', { work_item_count: 1, complete: 1, failed: 0 }),
  ];
  expect(statusOf(events, 'developer-loop')).toBe('complete');
});

test('closure events fold into review-loop phase', () => {
  expect(statusOf([ev('closure', 'start')], 'review-loop')).toBe('active');
});

// betterado #6: the unifier is its own hex (skill developer-unifier → 'unifier'),
// so the dev-loop hex no longer shows green while the unifier still loops.
function unifierEv(event_type: string, metadata: Record<string, unknown> = {}): EventLogEntry {
  return { ...ev('developer-loop', event_type, metadata), skill: 'developer-unifier' };
}

test('unifier is a distinct phase: dev-loop complete while unifier still active', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 2, complete: 2, failed: 0 }), // per-WI loop done
    unifierEv('start'), // unifier running, no end yet
  ];
  expect(statusOf(events, 'developer-loop')).toBe('complete');
  expect(statusOf(events, 'unifier')).toBe('active');
});

test('unifier hex completes on unifier.end', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 1, complete: 1, failed: 0 }),
    unifierEv('start'),
    unifierEv('end', { status: 'complete' }),
  ];
  expect(statusOf(events, 'unifier')).toBe('complete');
});

test('unifier.failed reddens the unifier hex (not the dev-loop hex)', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 1, complete: 1, failed: 0 }),
    unifierEv('start'),
    unifierEv('error', { status: 'failed' }),
    ev('orchestrator', 'error', {}), // delivery gate threw
  ];
  expect(statusOf(events, 'developer-loop')).toBe('complete');
  expect(statusOf(events, 'unifier')).toBe('failed');
});

test('resume-from-unifier: dev-loop end complete:0/failed:N/resumed is NOT a failure', () => {
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { work_item_count: 2, complete: 0, failed: 2, resumed: true }),
  ];
  expect(statusOf(events, 'developer-loop')).toBe('complete');
});

// costForPhaseHex: the per-hex cost must apply the SAME split as the status —
// unifier carved out of dev-loop (by skill), closure folded into review-loop —
// or the unifier hex shows $0 while its cost hides in the dev-loop pill.
test('costForPhaseHex: unifier cost is split out of developer-loop', () => {
  const cost: CostSummary = {
    totalUsd: 15, total_cost_usd: 15,
    perPhase: { 'developer-loop': { cost_usd: 12, iterations: 0, duration_ms: 0 }, 'review-loop': { cost_usd: 1, iterations: 0, duration_ms: 0 }, closure: { cost_usd: 0.5, iterations: 0, duration_ms: 0 } },
    perSkill: { 'developer-unifier': { invocations: 1, cost_usd: 9, duration_ms: 0 } },
  } as unknown as CostSummary;
  expect(costForPhaseHex('unifier', cost)).toBe(9);
  expect(costForPhaseHex('developer-loop', cost)).toBe(3);
  expect(costForPhaseHex('review-loop', cost)).toBe(1.5);
});

test('costForPhaseHex: null cost → 0 for every phase', () => {
  for (const p of ['architect', 'unifier', 'review-loop'] as const) {
    expect(costForPhaseHex(p, null)).toBe(0);
  }
});
