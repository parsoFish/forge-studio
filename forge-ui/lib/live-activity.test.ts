/**
 * Unit tests for live-activity derivations (Fix B: canonicalPhase in ownerId).
 */
import { test, expect } from 'vitest';
import { deriveLiveToolBursts } from './live-activity.ts';
import type { EventLogEntry } from './bridge-client.ts';

const NOW = 1_700_000_000_000;

function toolEv(
  phase: string,
  overrides: Partial<EventLogEntry> & { work_item_id?: string } = {},
): EventLogEntry {
  const { work_item_id, ...rest } = overrides;
  return {
    event_id: `e-${Math.random()}`,
    initiative_id: 'INIT-x',
    started_at: new Date(NOW - 100).toISOString(), // within default 2800ms window
    phase,
    skill: phase,
    event_type: 'tool_use',
    metadata: {
      tool: 'Bash',
      input_summary: 'npm test',
      ...(work_item_id ? { work_item_id } : {}),
    },
    ...rest,
  } as EventLogEntry;
}

test('deriveLiveToolBursts: unifier tool_use (phase:unifier, no work_item_id) → ownerId:unifier, ownerKind:phase', () => {
  const events = [toolEv('unifier')];
  const bursts = deriveLiveToolBursts(events, NOW);
  expect(bursts).toHaveLength(1);
  expect(bursts[0]!.ownerId).toBe('unifier');
  expect(bursts[0]!.ownerKind).toBe('phase');
});

test('deriveLiveToolBursts: WI event → ownerId is the work_item_id', () => {
  const events = [toolEv('developer-loop', { work_item_id: 'WI-3' })];
  const bursts = deriveLiveToolBursts(events, NOW);
  expect(bursts).toHaveLength(1);
  expect(bursts[0]!.ownerId).toBe('WI-3');
  expect(bursts[0]!.ownerKind).toBe('wi');
});

test('deriveLiveToolBursts: closure event folds to review-loop via canonicalPhase', () => {
  const events = [toolEv('closure')];
  const bursts = deriveLiveToolBursts(events, NOW);
  expect(bursts).toHaveLength(1);
  expect(bursts[0]!.ownerId).toBe('review-loop');
  expect(bursts[0]!.ownerKind).toBe('phase');
});

test('deriveLiveToolBursts: stale events (outside window) produce no bursts', () => {
  const staleEv = toolEv('unifier');
  (staleEv as unknown as Record<string, unknown>).started_at = new Date(NOW - 5000).toISOString();
  expect(deriveLiveToolBursts([staleEv], NOW)).toHaveLength(0);
});
