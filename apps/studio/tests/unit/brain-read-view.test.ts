/**
 * forge-8vfn.5.16 (M7-C U2) — `deriveBrainReadSummary` is the pure reducer
 * PhaseDrawer.tsx folds a run's raw event stream (from `useCycleEvents`)
 * down into "which KB did the planner read, and how much" — the source
 * `data-brain-read-kb`/`data-brain-read-count` render from.
 *
 * No DOM, no React, no network — mirrors hook-library-view.ts's testability
 * convention (this repo's vitest has no jsdom).
 *
 * WHAT EACH TEST KILLS:
 *  - "no matching events -> []" kills an implementation that fabricates a
 *    row for a run that never emitted brain.read at all.
 *  - "sums themeCount across multiple events for the SAME kb" kills a
 *    reducer that only keeps the last event per kb (a run can touch one KB
 *    across multiple phases/turns).
 *  - "ignores events with the wrong message / a missing kbId" kills a
 *    filter that matches on event_type alone (this reuses the pre-existing
 *    'brain-query' event_type the architect's unconditional per-turn
 *    marker also uses — that marker carries no kbId and must NOT show up
 *    here as a fabricated row).
 */
import { describe, expect, test } from 'vitest';
import type { EventLogEntry } from '../../lib/bridge-client';
import { deriveBrainReadSummary } from '../../lib/brain-read-view';

function brainReadEvent(kbId: string, themeCount: number): EventLogEntry {
  return {
    event_id: `EV_${kbId}_${themeCount}`,
    initiative_id: 'INIT-1',
    started_at: '2026-09-25T00:00:00.000Z',
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'brain-query',
    message: 'brain.read',
    metadata: { kbId, themeCount, reader: 'project-manager', runId: 'INIT-1' },
  };
}

describe('deriveBrainReadSummary', () => {
  test('no matching events -> []', () => {
    expect(deriveBrainReadSummary([])).toEqual([]);
    const unrelated: EventLogEntry[] = [
      { ...brainReadEvent('cycles', 4), message: 'pm.context-injected' },
    ];
    expect(deriveBrainReadSummary(unrelated)).toEqual([]);
  });

  test('the architect\'s unconditional per-turn brain-query marker (no kbId) never fabricates a row', () => {
    const marker: EventLogEntry = {
      event_id: 'EV_marker',
      initiative_id: 'INIT-1',
      started_at: '2026-09-25T00:00:00.000Z',
      phase: 'architect',
      skill: 'architect-runner',
      event_type: 'brain-query',
      message: 'brain-query (project=testproj)',
      metadata: { session_id: 'S1', project: 'testproj' },
    };
    expect(deriveBrainReadSummary([marker])).toEqual([]);
  });

  test('sums themeCount across multiple brain.read events for the SAME kb', () => {
    const events = [brainReadEvent('cycles', 4), brainReadEvent('cycles', 2)];
    expect(deriveBrainReadSummary(events)).toEqual([{ kbId: 'cycles', count: 6 }]);
  });

  test('two different kbs produce two separate rows', () => {
    const events = [brainReadEvent('cycles', 4), brainReadEvent('testproj', 1)];
    const result = deriveBrainReadSummary(events);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      { kbId: 'cycles', count: 4 },
      { kbId: 'testproj', count: 1 },
    ]));
  });
});
