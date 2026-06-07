/**
 * Tests for per-WI status derivation. Pure functions.
 *
 * Operator model (2026-05-30): amber ('retrying') is a live WORKING tone that
 * only flags "not the first attempt"; the ONLY terminal states are green
 * ('complete') and red ('failed'). A unit that terminally failed is red
 * immediately — never held amber on a cycle-level verdict.
 */
import { test, expect } from 'vitest';
import { derivePerWiStatus, rollupStatus } from './wi-status.ts';
import type { EventLogEntry } from './bridge-client.ts';

let seq = 0;
function ev(wi: string, event_type: string, extra: Partial<EventLogEntry> = {}): EventLogEntry {
  seq += 1;
  return {
    event_id: `e${seq}`,
    initiative_id: 'INIT-x',
    started_at: `2026-05-30T08:00:${String(seq).padStart(2, '0')}.000Z`,
    phase: 'developer-loop',
    skill: 'developer-loop',
    event_type,
    metadata: { work_item_id: wi, ...(extra.metadata ?? {}) },
    ...extra,
  } as EventLogEntry;
}

test('no events → pending', () => {
  expect(derivePerWiStatus([], ['WI-1'])['WI-1']).toBe('pending');
});

test('started, no end → active (blue, first attempt)', () => {
  const events = [ev('WI-1', 'start'), ev('WI-1', 'iteration')];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('active');
});

test('terminal end success → complete (green)', () => {
  const events = [ev('WI-1', 'start'), ev('WI-1', 'end', { metadata: { work_item_id: 'WI-1', status: 'complete' } })];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('complete');
});

test('terminal end failed → failed (red) — NOT gated on a cycle-level verdict', () => {
  // The WI exhausted its budget; there is no orchestrator end-failed event.
  const events = [ev('WI-1', 'start'), ev('WI-1', 'end', { metadata: { work_item_id: 'WI-1', status: 'failed' } })];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('failed');
});

test('error mid-flight, still running → retrying (amber, working)', () => {
  const events = [ev('WI-1', 'start'), ev('WI-1', 'error'), ev('WI-1', 'iteration')];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('retrying');
});

test('retrying → success resolves to complete (green), amber does not persist', () => {
  const events = [
    ev('WI-1', 'start'), ev('WI-1', 'error'), ev('WI-1', 'iteration'),
    ev('WI-1', 'end', { metadata: { work_item_id: 'WI-1', status: 'complete' } }),
  ];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('complete');
});

test('error between start and end → failed (red)', () => {
  const events = [ev('WI-1', 'start'), ev('WI-1', 'error'), ev('WI-1', 'end')];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('failed');
});

test('expected_fail error is ignored (iter-0 sharp gate) → active', () => {
  const events = [ev('WI-1', 'start'), ev('WI-1', 'error', { metadata: { work_item_id: 'WI-1', expected_fail: true } })];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('active');
});

test('re-attempt after a prior failed end → retrying (amber)', () => {
  const events = [
    ev('WI-1', 'start'), ev('WI-1', 'end', { metadata: { work_item_id: 'WI-1', status: 'failed' } }),
    ev('WI-1', 'start'), ev('WI-1', 'iteration'),
  ];
  expect(derivePerWiStatus(events, ['WI-1'])['WI-1']).toBe('retrying');
});

test('rollup precedence: failed > retrying > active > complete > pending', () => {
  expect(rollupStatus(['complete', 'failed', 'active'])).toBe('failed');
  expect(rollupStatus(['complete', 'retrying'])).toBe('retrying');
  expect(rollupStatus(['complete', 'active'])).toBe('active');
  expect(rollupStatus(['complete', 'complete'])).toBe('complete');
  expect(rollupStatus([])).toBe('pending');
});
