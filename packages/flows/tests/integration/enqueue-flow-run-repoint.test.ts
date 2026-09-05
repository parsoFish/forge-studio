/**
 * W8-A3 WI-1 — `flows-37` / `forge-chm` (S1, data-corruption class).
 *
 * THE DEFECT THIS FILE KILLS
 * --------------------------
 * `enqueueFlowRun` rewrote `flow_id` unconditionally. Every initiative sitting
 * in the queue carries the flow that produced it (`flow_id: forge-architect`
 * for everything the architect plans), so ONE click on an unrelated authored
 * flow's generic "Start Run" picker silently STOLE a queued initiative from
 * the flow it was waiting under — no warning, no confirmation, no disclosure
 * of the flow of origin anywhere in the request path.
 *
 * The rule lives HERE, on the enqueue, and not on a route: the operator-facing
 * `POST /api/flows/:id/run` and `POST /api/develop/start` are two doors onto
 * the same primitive, and W7-FIX-A3 already learned (round-2 finding 6) that a
 * pre-check bolted onto one route leaves the sibling wide open.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS
 * ------------------------------------------
 * These are acceptance tests, not characterization: every one of them is RED
 * against the pre-fix `enqueue-flow-run.ts`, which had no notion of a repoint
 * at all. The refusal tests assert the ARTIFACT (the source manifest is
 * byte-identical and nothing was written to `pending/`), not merely a status
 * string — a guard that refuses after writing is not a guard.
 *
 * A blanket refusal was NOT implementable and is not what this pins: it would
 * refuse every candidate the picker can legitimately offer (they all carry
 * `flow_id: forge-architect`) and would break the roadmap's architect→develop
 * hand-off. The contract is an EXPLICIT confirmation, defaulting closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest, parseManifest, type InitiativeManifest } from '../../manifest.ts';
import { getPaths } from '../../queue.ts';
import { enqueueFlowRun } from '../../enqueue-flow-run.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';

const INIT = 'INIT-2026-06-21-toc';

function manifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: INIT,
    class: 'code',
    acceptance_criteria: [],
    project: 'mdtoc',
    project_repo_path: '/tmp/mdtoc',
    created_at: '2026-06-21T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 25,
    phase: 'pending',
    origin: 'architect',
    specs: ['WI-1'],
    body: '# TOC injection\n\nAdd --write in-place TOC injection.',
    ...overrides,
  };
}

function seed(queueRoot: string, state: string, m: InitiativeManifest): string {
  const dir = join(queueRoot, state);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${m.initiative_id}.md`);
  writeFileSync(p, serializeManifest(m));
  return p;
}

function withTmp(fn: (queueRoot: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'forge-flow-repoint-'));
  try {
    fn(join(dir, '_queue'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The refusal — and the artifact behind it
// ---------------------------------------------------------------------------

test('flows-37: a cross-flow repoint without confirmation is REFUSED — the source manifest is byte-unchanged and nothing is enqueued', () => {
  withTmp((queueRoot) => {
    const src = seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    const before = readFileSync(src, 'utf8');

    const result = enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot });

    assert.equal(result.status, 'repoint-requires-confirm');
    assert.equal(result.currentFlowId, 'forge-architect', 'the refusal names the flow the initiative is queued under');
    assert.match(result.detail ?? '', /forge-architect/, 'the operator-facing detail names the flow of origin');
    // The artifact, not the status code.
    assert.equal(readFileSync(src, 'utf8'), before, 'the queued manifest is byte-identical — nothing was stolen');
    const onDisk = parseManifest(readFileSync(src, 'utf8'));
    assert.equal(onDisk.flow_id, 'forge-architect', 'flow_id untouched');
  });
});

test('flows-37: the refusal holds for a FAILED source too — a re-run of someone else\'s failed initiative is still a repoint', () => {
  withTmp((queueRoot) => {
    const src = seed(queueRoot, 'failed', manifest({ flow_id: 'forge-develop', phase: 'failed' }));
    const before = readFileSync(src, 'utf8');

    const result = enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot });

    assert.equal(result.status, 'repoint-requires-confirm');
    assert.equal(result.currentFlowId, 'forge-develop');
    assert.equal(readFileSync(src, 'utf8'), before, 'the failed manifest stays exactly where it was');
    assert.equal(existsSync(join(getPaths(queueRoot).pending, `${INIT}.md`)), false, 'no pending copy written');
  });
});

test('flows-37: a ready-for-review hand-off from ANOTHER flow is a repoint too — it needs the same confirmation', () => {
  // This is the case orchestrator/enqueue-flow-run.test.ts pins as a
  // "hand-off fall-through". It stays runnable — but only on purpose.
  withTmp((queueRoot) => {
    const src = seed(queueRoot, 'ready-for-review', manifest({ flow_id: 'forge-architect' }));
    const before = readFileSync(src, 'utf8');

    assert.equal(enqueueFlowRun(INIT, 'retro-flow', { queueRoot }).status, 'repoint-requires-confirm');
    assert.equal(readFileSync(src, 'utf8'), before);

    const confirmed = enqueueFlowRun(INIT, 'retro-flow', { queueRoot, confirmRepointFrom: 'forge-architect' });
    assert.equal(confirmed.status, 'enqueued');
  });
});

// ---------------------------------------------------------------------------
// What must NOT be refused — the guard is about STEALING, not about enqueueing
// ---------------------------------------------------------------------------

test('flows-37: re-running an initiative on the flow it is ALREADY queued under needs no confirmation', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'retro-flow' }));
    const result = enqueueFlowRun(INIT, 'retro-flow', { queueRoot });
    assert.equal(result.status, 'enqueued', 'same flow → no repoint → no confirmation');
  });
});

test('flows-37: a manifest with NO flow_id has nothing to steal — enqueued without confirmation', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest());
    const result = enqueueFlowRun(INIT, 'retro-flow', { queueRoot });
    assert.equal(result.status, 'enqueued');
    const onDisk = parseManifest(readFileSync(join(getPaths(queueRoot).pending, `${INIT}.md`), 'utf8'));
    assert.equal(onDisk.flow_id, 'retro-flow');
  });
});

test('flows-37: confirmRepoint:true performs the repoint the operator asked for', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    const result = enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot, confirmRepointFrom: 'forge-architect' });

    assert.equal(result.status, 'enqueued');
    assert.equal(result.flowId, 'some-authored-flow');
    const onDisk = parseManifest(readFileSync(join(getPaths(queueRoot).pending, `${INIT}.md`), 'utf8'));
    assert.equal(onDisk.flow_id, 'some-authored-flow', 'repointed, because the operator confirmed it');
  });
});

// ---------------------------------------------------------------------------
// The two callers that legitimately repoint, and the proof each opt-in is a
// real parameter rather than a hard-coded bypass
// ---------------------------------------------------------------------------

test('flows-37: the trigger drain\'s flow-complete chaining still repoints on every hop (it opts in explicitly)', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'done', manifest({ flow_id: 'forge-develop', phase: 'done' }));
    const result = enqueueFlowRun(INIT, 'retro-flow', { queueRoot, allowFinishedSource: true, confirmRepoint: true });
    assert.equal(result.status, 'enqueued', 'chaining is unchanged — that is what a flow-complete trigger IS');
  });
});

test('flows-37: the architect→develop hand-off enqueues without a flag — that transition IS what the roadmap button means', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    assert.equal(enqueueDevelopRun(INIT, { queueRoot }).status, 'enqueued');
  });
});

test('flows-37 REGRESSION (review round 1, S1-1): "Start development" must NOT take an initiative queued under an authored flow', () => {
  // The first cut of this fix defaulted `confirmRepoint: true` inside
  // enqueueDevelopRun, reasoning that the roadmap names the initiative and the
  // target. It does not: `StartWorkActions.onDevelop` posts a BATCH of every
  // eligible id on one click, and RoadmapInitiative carries no flow id at all,
  // so the button cannot disclose the flow of origin even in principle. That
  // left flows-37 fully reachable one route over.
  //
  // KILLS: any re-introduction of a blanket repoint default on this delegate.
  withTmp((queueRoot) => {
    const src = seed(queueRoot, 'pending', manifest({ flow_id: 'my-authored-flow' }));
    const before = readFileSync(src, 'utf8');

    const result = enqueueDevelopRun(INIT, { queueRoot });

    assert.equal(result.status, 'repoint-requires-confirm');
    assert.equal(result.currentFlowId, 'my-authored-flow');
    assert.equal(readFileSync(src, 'utf8'), before, 'the authored flow\'s queued manifest is byte-identical');
    assert.equal(existsSync(join(getPaths(queueRoot).pending, `${INIT}.md`)), true);
    const onDisk = parseManifest(readFileSync(src, 'utf8'));
    assert.equal(onDisk.flow_id, 'my-authored-flow', 'still queued under the flow it belongs to');
  });
});

test('flows-37: the develop hand-off exemption is scoped to the SOURCE flow, not to the caller — an explicit confirm still works', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'my-authored-flow' }));
    // The operator CAN move it, having been asked; the exemption is about who
    // may skip the question, not about who may perform the move. The confirmation
    // names the flow they were SHOWN, which is the flow it is actually on.
    assert.equal(enqueueDevelopRun(INIT, { queueRoot, confirmRepointFrom: 'my-authored-flow' }).status, 'enqueued');
  });
});

// ---------------------------------------------------------------------------
// Ordering (review round 1, S3-7)
// ---------------------------------------------------------------------------

test('flows-37: an undecomposed initiative answers `not-planned`, not a confirmation it could never satisfy', () => {
  withTmp((queueRoot) => {
    // No `specs`, no WI snapshot, no worktree — the develop precondition fails.
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect', specs: [] }));
    const result = enqueueFlowRun(INIT, 'forge-develop', { queueRoot });
    assert.equal(
      result.status, 'not-planned',
      'the cheap precondition answers first — confirming a repoint that then 409s is a question with no right answer',
    );
  });
});

// ---------------------------------------------------------------------------
// COMPARE-AND-SWAP (adversarial review round 3, S2-3) — the class-level cure.
//
// `confirmRepoint: boolean` was an unconditional override that carried no
// evidence of WHAT was confirmed. Two consequences, both reproduced by round 3:
// a client snapshot that goes stale under a poll, a chained trigger or a second
// tab still authorised a move off a flow the operator was never shown; and a
// caller that never asked anything could send `true`.
//
// KILLS: any reintroduction of a boolean confirmation on an operator door.
// ---------------------------------------------------------------------------

test('flows-37 CAS: a confirmation naming the flow the initiative is actually on proceeds', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    const r = enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot, confirmRepointFrom: 'forge-architect' });
    assert.equal(r.status, 'enqueued');
  });
});

test('flows-37 CAS: a STALE confirmation is refused — the initiative moved while the operator was being asked', () => {
  withTmp((queueRoot) => {
    // The panel was rendered while it sat on forge-architect; by the time the
    // operator clicked, a flow-complete trigger had chained it onto retro-flow.
    const src = seed(queueRoot, 'pending', manifest({ flow_id: 'retro-flow' }));
    const before = readFileSync(src, 'utf8');

    const r = enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot, confirmRepointFrom: 'forge-architect' });

    assert.equal(r.status, 'repoint-requires-confirm');
    assert.equal(r.currentFlowId, 'retro-flow', 'the refusal reports where it actually is now');
    assert.match(r.detail ?? '', /moved to "retro-flow"/, 'and says the confirmation went stale');
    assert.match(r.detail ?? '', /forge-architect/, 'naming what the operator had been asked about');
    assert.equal(readFileSync(src, 'utf8'), before, 'nothing written on a stale confirmation');
  });
});

test('flows-37 CAS: an empty-string confirmation confirms nothing', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    assert.equal(
      enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot, confirmRepointFrom: '' }).status,
      'repoint-requires-confirm',
    );
  });
});
