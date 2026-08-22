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

import { serializeManifest, parseManifest, type InitiativeManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { enqueueFlowRun } from './enqueue-flow-run.ts';
import { enqueueDevelopRun } from './enqueue-develop-run.ts';

const INIT = 'INIT-2026-06-21-toc';

function manifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: INIT,
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

    const confirmed = enqueueFlowRun(INIT, 'retro-flow', { queueRoot, confirmRepoint: true });
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
    const result = enqueueFlowRun(INIT, 'some-authored-flow', { queueRoot, confirmRepoint: true });

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

test('flows-37: the architect→develop hand-off (enqueueDevelopRun) is the named exemption — and it is a real parameter, not a bypass', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    // The roadmap's per-initiative "Start development" names both the
    // initiative and the target, so the operator HAS confirmed the transition.
    assert.equal(enqueueDevelopRun(INIT, { queueRoot }).status, 'enqueued');
  });
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ flow_id: 'forge-architect' }));
    // Prove the default is a parameter the caller can close, not a constant:
    // if the exemption were hard-coded, this would still enqueue.
    assert.equal(
      enqueueDevelopRun(INIT, { queueRoot, confirmRepoint: false }).status,
      'repoint-requires-confirm',
    );
  });
});
