/**
 * Tests for the initiative-centric cycle grouping (forge-refinement plan
 * 1.6): a raw `Cycle[]` can carry more than one entry per initiative (a
 * resume/requeue after a crash or a send-back), and every consumer should
 * collapse that to one card per initiative rather than showing disconnected
 * cycle cards. See `cycle-grouping.ts` for the pure functions under test.
 */
import { test, expect } from 'vitest';
import { groupCyclesByInitiative, groupInitiativesByProject } from './cycle-grouping.ts';
import type { Cycle } from './bridge-client.ts';

function cycle(overrides: Partial<Cycle> & { cycleId: string; initiativeId: string }): Cycle {
  return {
    status: 'pending',
    ...overrides,
  };
}

test('empty input → empty groups', () => {
  expect(groupCyclesByInitiative([])).toEqual([]);
});

test('one cycle per initiative → one group each, no prior attempts', () => {
  const groups = groupCyclesByInitiative([
    cycle({ cycleId: '2026-07-01T08-00-00_INIT-a', initiativeId: 'INIT-a', status: 'done', project: 'p1' }),
    cycle({ cycleId: '2026-07-02T08-00-00_INIT-b', initiativeId: 'INIT-b', status: 'in-flight', project: 'p1' }),
  ]);

  expect(groups).toHaveLength(2);
  const a = groups.find((g) => g.initiativeId === 'INIT-a');
  expect(a).toMatchObject({
    initiativeId: 'INIT-a',
    project: 'p1',
    status: 'done',
    activeCycleId: '2026-07-01T08-00-00_INIT-a',
    attemptCount: 1,
    priorCycleIds: [],
  });
});

test('multiple cycles for the same initiative (resume/requeue) collapse to one group', () => {
  const groups = groupCyclesByInitiative([
    cycle({ cycleId: '2026-07-01T08-00-00_INIT-a', initiativeId: 'INIT-a', status: 'failed' }),
    cycle({ cycleId: '2026-07-03T08-00-00_INIT-a', initiativeId: 'INIT-a', status: 'in-flight' }),
    cycle({ cycleId: '2026-07-02T08-00-00_INIT-a', initiativeId: 'INIT-a', status: 'failed' }),
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    initiativeId: 'INIT-a',
    attemptCount: 3,
    activeCycleId: '2026-07-03T08-00-00_INIT-a',
    status: 'in-flight',
    priorCycleIds: ['2026-07-02T08-00-00_INIT-a', '2026-07-01T08-00-00_INIT-a'],
  });
});

test('group status/project/dependsOnInitiatives reflect the active (most recent) cycle, not a stale prior one', () => {
  const groups = groupCyclesByInitiative([
    cycle({ cycleId: '2026-07-01T08-00-00_INIT-a', initiativeId: 'INIT-a', status: 'failed', project: 'old-project', dependsOnInitiatives: ['INIT-x'] }),
    cycle({ cycleId: '2026-07-05T08-00-00_INIT-a', initiativeId: 'INIT-a', status: 'done', project: 'new-project', dependsOnInitiatives: ['INIT-x', 'INIT-y'] }),
  ]);

  expect(groups[0]).toMatchObject({
    status: 'done',
    project: 'new-project',
    dependsOnInitiatives: ['INIT-x', 'INIT-y'],
  });
});

test('output is sorted newest-active-cycle-first', () => {
  const groups = groupCyclesByInitiative([
    cycle({ cycleId: '2026-07-01T08-00-00_INIT-a', initiativeId: 'INIT-a' }),
    cycle({ cycleId: '2026-07-05T08-00-00_INIT-b', initiativeId: 'INIT-b' }),
    cycle({ cycleId: '2026-07-03T08-00-00_INIT-c', initiativeId: 'INIT-c' }),
  ]);

  expect(groups.map((g) => g.initiativeId)).toEqual(['INIT-b', 'INIT-c', 'INIT-a']);
});

test('groupInitiativesByProject buckets initiatives by project, alpha-sorted', () => {
  const groups = groupCyclesByInitiative([
    cycle({ cycleId: '2026-07-01T08-00-00_INIT-a', initiativeId: 'INIT-a', project: 'zeta' }),
    cycle({ cycleId: '2026-07-02T08-00-00_INIT-b', initiativeId: 'INIT-b', project: 'alpha' }),
    cycle({ cycleId: '2026-07-03T08-00-00_INIT-c', initiativeId: 'INIT-c', project: 'alpha' }),
  ]);

  const tracks = groupInitiativesByProject(groups);

  expect(tracks.map((t) => t.project)).toEqual(['alpha', 'zeta']);
  expect(tracks.find((t) => t.project === 'alpha')?.initiatives).toHaveLength(2);
  expect(tracks.find((t) => t.project === 'zeta')?.initiatives).toHaveLength(1);
});

test('groupInitiativesByProject falls back to an "unassigned" bucket when project is missing', () => {
  const groups = groupCyclesByInitiative([
    cycle({ cycleId: '2026-07-01T08-00-00_INIT-a', initiativeId: 'INIT-a' }),
  ]);

  const tracks = groupInitiativesByProject(groups);
  expect(tracks).toEqual([{ project: 'unassigned', initiatives: groups }]);
});
