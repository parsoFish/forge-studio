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
 *
 * TEST-WORLD AMENDMENT — W8-A3:
 *
 *  - `flows-37` (S1): `deriveKickoffCandidates` now takes the flow being
 *    VIEWED, and every candidate carries the flow it is queued under plus
 *    whether selecting it is a repoint. The old signature could not express
 *    the difference, which is why the picker could not disclose it.
 *  - `flows-25` (S2): the three `canStartFlow` cases that lived at the bottom
 *    of this file MOVED to `lib/flow-kickoff-render.test.ts`, and one of them
 *    was pinning the defect — it asserted `initiative-select -> true` while
 *    that surface renders no launcher at all. It is now asserted against the
 *    rendered markup instead of against a hand-written enumeration.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveKickoffCandidates, NO_FLOW_SENTINEL } from '../../lib/kickoff-candidates.ts';
import type { Run } from '../../lib/studio-client.ts';

const VIEWED = 'forge-develop';

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
  expect(deriveKickoffCandidates(runs, VIEWED)).toEqual([
    { initiativeId: 'INIT-2026-08-18-add-version-flag', project: 'demo-project', currentFlowId: 'forge-develop', isRepoint: false },
  ]);
});

test('dedupes by initiative id and never fabricates a project (null when the run has none)', () => {
  const runs: Run[] = [
    run({ id: 'INIT-2026-08-18-a', initiativeId: 'INIT-2026-08-18-a', status: 'planned' }),
    run({ id: 'INIT-2026-08-18-a', initiativeId: 'INIT-2026-08-18-a', status: 'planned', flowId: 'onboard-project' }),
    run({ id: 'INIT-2026-08-18-b', initiativeId: 'INIT-2026-08-18-b', status: 'planned', project: 'mdtoc' }),
  ];
  expect(deriveKickoffCandidates(runs, VIEWED)).toEqual([
    { initiativeId: 'INIT-2026-08-18-a', project: null, currentFlowId: 'forge-develop', isRepoint: false },
    { initiativeId: 'INIT-2026-08-18-b', project: 'mdtoc', currentFlowId: 'forge-develop', isRepoint: false },
  ]);
});

test('a run without an initiative id (degraded manifest) is skipped, and no runs → no candidates', () => {
  expect(deriveKickoffCandidates([run({ id: 'x', initiativeId: '', status: 'planned' })], VIEWED)).toEqual([]);
  expect(deriveKickoffCandidates([], VIEWED)).toEqual([]);
});

// ---- W8-A3 (flows-37): the repoint fact, derived per candidate --------------
//
// Every planned initiative on disk carries `flow_id: forge-architect`, so on
// ANY authored flow's monitor every candidate is a repoint. The picker could
// not say so, because the candidate had nowhere to carry it.

test('flows-37: a candidate queued under another flow is marked isRepoint, and names that flow', () => {
  const runs: Run[] = [
    run({ id: 'INIT-2026-08-18-alpha', initiativeId: 'INIT-2026-08-18-alpha', status: 'planned', flowId: 'forge-architect' }),
    run({ id: 'INIT-2026-08-18-beta', initiativeId: 'INIT-2026-08-18-beta', status: 'planned', flowId: 'my-authored-flow' }),
  ];
  expect(deriveKickoffCandidates(runs, 'my-authored-flow')).toEqual([
    { initiativeId: 'INIT-2026-08-18-alpha', project: null, currentFlowId: 'forge-architect', isRepoint: true },
    { initiativeId: 'INIT-2026-08-18-beta', project: null, currentFlowId: 'my-authored-flow', isRepoint: false },
  ]);
});

test('flows-37: the repoint fact is DERIVED per viewed flow — the same run answers differently on two monitors', () => {
  const runs: Run[] = [run({ id: 'INIT-2026-08-18-alpha', initiativeId: 'INIT-2026-08-18-alpha', status: 'planned', flowId: 'forge-architect' })];
  expect(deriveKickoffCandidates(runs, 'forge-architect')[0].isRepoint).toBe(false);
  expect(deriveKickoffCandidates(runs, 'retro-flow')[0].isRepoint).toBe(true);
});

test('flows-37: a run reporting no flow of its own has nothing to be taken from → not a repoint', () => {
  // The REAL shape (review round 1, S3-8): `Run.flowId` is already defaulted to
  // `orchestrator/run-model.ts`'s FALLBACK_FLOW_ID for a manifest that carries no
  // `flow_id`, so `'unknown'` — not `''` — is what a flowless manifest produces
  // over the wire. The first cut of this test pinned `flowId: ''`, an input the
  // product cannot emit, so the branch that mattered was never exercised: the UI
  // said "queued under unknown" and offered a confirmation while the server, which
  // sees the undefined `manifest.flow_id`, called it no repoint at all.
  //
  // KILLS: a derivation that reads `r.flowId` raw and disagrees with the server.
  const flowless: Run[] = [run({ id: 'INIT-2026-08-18-alpha', initiativeId: 'INIT-2026-08-18-alpha', status: 'planned', flowId: 'unknown' })];
  expect(deriveKickoffCandidates(flowless, 'retro-flow')).toEqual([
    { initiativeId: 'INIT-2026-08-18-alpha', project: null, currentFlowId: null, isRepoint: false },
  ]);

  // And the degenerate empty string stays safe too.
  const empty: Run[] = [run({ id: 'INIT-2026-08-18-beta', initiativeId: 'INIT-2026-08-18-beta', status: 'planned', flowId: '' })];
  expect(deriveKickoffCandidates(empty, 'retro-flow')[0]).toEqual(
    { initiativeId: 'INIT-2026-08-18-beta', project: null, currentFlowId: null, isRepoint: false },
  );
});

// ---- W8-A3 (review round 2, finding 9): the client copy of a server constant --

test('flows-37: NO_FLOW_SENTINEL still equals the server\'s FALLBACK_FLOW_ID', () => {
  // KILLS: silent drift. `lib/kickoff-candidates.ts` re-declares
  // `orchestrator/run-model.ts`'s module-private `FALLBACK_FLOW_ID` client-side
  // (this repo's re-declare convention for orchestrator constants), and the only
  // thing linking them was a comment. Renaming the server constant's VALUE would
  // silently re-open the UI/server disagreement about a flowless manifest that
  // round 1's S3-8 closed — the UI would offer a confirmation to move an
  // initiative off a flow the server does not think it is on.
  // The constant moved to `run-model-flow-graph.ts` when `run-model.ts` was
  // split under the 800-line cap (M4-flows exit row 4): it is flow-graph
  // vocabulary, not run vocabulary. RE-POINTED, never deleted — this pin is the
  // only thing linking the client copy to the server's value.
  const src = readFileSync(
    resolve(__dirname, '..', '..', '..', '..', 'packages', 'flows', 'run-model-flow-graph.ts'),
    'utf8',
  );
  const match = /const FALLBACK_FLOW_ID = '([^']+)'/.exec(src);
  expect(match, 'FALLBACK_FLOW_ID must still be declared in packages/flows/run-model-flow-graph.ts').not.toBeNull();
  expect(NO_FLOW_SENTINEL).toBe(match![1]);
});

/*
 * `forge-8vfn.7.6.132` — TEST-WORLD AMENDMENT, and it narrows this file's own
 * headline contract. T1 ruling 1124.
 *
 * The header above says "finished/failed/active/gated never are". That is now
 * true of `gated` ONLY when the parked manifest belongs to the flow being
 * viewed. A `gated` run is a manifest in `_queue/ready-for-review/`
 * (`run-model.ts:93`), and one whose flow DIFFERS is the architect hand-off
 * `enqueueFlowRun` has always claimed — its own comment names "forge-architect
 * finalised with no review node" as exactly that case. This picker never
 * offered it, which is half of why S10 could not start development for nineteen
 * runs.
 *
 * THE DEFECT THIS FILE EXISTS TO KILL IS UNTOUCHED, and the third test is the
 * lock. `isRunnableSource` — the shared predicate beside the server's rule —
 * also accepts `done` and `failed`. This surface still refuses both, because
 * offering every complete/failed initiative is how one click yanked a shipped
 * manifest out of `_queue/done` and re-ran it. The server's rule is COMPOSED
 * with this file's narrower policy, never substituted for it, and the lock stops
 * a later edit from "simplifying" the composition into the server rule alone.
 */
test('7.6.132: a GATED run of a DIFFERENT flow is offered — the architect hand-off', () => {
  const runs: Run[] = [
    run({ id: 'INIT-handoff', initiativeId: 'INIT-handoff', status: 'gated', flowId: 'forge-architect', project: 'gitpulse' }),
  ];
  const out = deriveKickoffCandidates(runs, VIEWED);
  expect(out.map((c) => c.initiativeId)).toEqual(['INIT-handoff']);
  expect(out[0]!.isRepoint).toBe(true);
  expect(out[0]!.currentFlowId).toBe('forge-architect');
});

test('7.6.132: a GATED run of the VIEWED flow is still not offered — the parked sibling', () => {
  const runs: Run[] = [
    run({ id: 'INIT-parked', initiativeId: 'INIT-parked', status: 'gated', flowId: VIEWED, project: 'gitpulse' }),
  ];
  expect(deriveKickoffCandidates(runs, VIEWED)).toEqual([]);
});

test('7.6.132: complete and failed are STILL never offered — the shipped-manifest lock', () => {
  const runs: Run[] = [
    run({ id: 'INIT-shipped', initiativeId: 'INIT-shipped', status: 'complete', flowId: 'forge-architect', project: 'gitpulse' }),
    run({ id: 'INIT-broke', initiativeId: 'INIT-broke', status: 'failed', flowId: 'forge-architect', project: 'gitpulse' }),
  ];
  expect(deriveKickoffCandidates(runs, VIEWED)).toEqual([]);
});
