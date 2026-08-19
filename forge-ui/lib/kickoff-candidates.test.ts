/**
 * W7-FIX-A3 (A3-01) — pinned contract for `kickoff-candidates.ts`, the pure
 * derivation behind the generic Start-Run initiative picker on the flow
 * monitor (`app/flows/[id]/page.tsx` → `FlowKickoff`'s GenericKickoff).
 *
 * THE DEFECT THIS KILLS: the picker used to offer every `complete`/`failed`
 * initiative from every flow — a merged, shipped initiative was visually
 * indistinguishable from a live one and one click yanked its manifest out
 * of `_queue/done` and re-ran it. Only genuinely startable (queued) runs
 * are candidates; finished/failed/active/gated never are.
 */
import { test, expect } from 'vitest';

import { deriveKickoffCandidates } from './kickoff-candidates.ts';
import type { Run } from './studio-client.ts';

function run(over: Partial<Run> & Pick<Run, 'id' | 'initiativeId' | 'status'>): Run {
  return {
    flowId: 'forge-develop',
    initiative: over.initiativeId,
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: ['forge-develop'],
    ...over,
  };
}

test('only PLANNED (queued) runs are candidates — complete/failed/active/gated are never offered', () => {
  const runs: Run[] = [
    run({ id: 'INIT-2026-08-18-add-version-flag', initiativeId: 'INIT-2026-08-18-add-version-flag', status: 'planned', project: 'demo-project' }),
    run({ id: '2026-08-01T00-00-00_INIT-2026-08-01-shipped', initiativeId: 'INIT-2026-08-01-shipped', status: 'complete', project: 'gitpulse' }),
    run({ id: '2026-08-02T00-00-00_INIT-2026-08-02-broken', initiativeId: 'INIT-2026-08-02-broken', status: 'failed' }),
    run({ id: '2026-08-03T00-00-00_INIT-2026-08-03-live', initiativeId: 'INIT-2026-08-03-live', status: 'active' }),
    run({ id: '2026-08-04T00-00-00_INIT-2026-08-04-gated', initiativeId: 'INIT-2026-08-04-gated', status: 'gated' }),
  ];
  expect(deriveKickoffCandidates(runs)).toEqual([
    { initiativeId: 'INIT-2026-08-18-add-version-flag', project: 'demo-project' },
  ]);
});

test('dedupes by initiative id and never fabricates a project (null when the run has none)', () => {
  const runs: Run[] = [
    run({ id: 'INIT-2026-08-18-a', initiativeId: 'INIT-2026-08-18-a', status: 'planned' }),
    run({ id: 'INIT-2026-08-18-a', initiativeId: 'INIT-2026-08-18-a', status: 'planned', flowId: 'onboard-project' }),
    run({ id: 'INIT-2026-08-18-b', initiativeId: 'INIT-2026-08-18-b', status: 'planned', project: 'mdtoc' }),
  ];
  expect(deriveKickoffCandidates(runs)).toEqual([
    { initiativeId: 'INIT-2026-08-18-a', project: null },
    { initiativeId: 'INIT-2026-08-18-b', project: 'mdtoc' },
  ]);
});

test('a run without an initiative id (degraded manifest) is skipped, and no runs → no candidates', () => {
  expect(deriveKickoffCandidates([run({ id: 'x', initiativeId: '', status: 'planned' })])).toEqual([]);
  expect(deriveKickoffCandidates([])).toEqual([]);
});
