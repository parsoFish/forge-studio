/**
 * Tests for orchestrator/enqueue-flow-run.ts (R2-04-F1 / ADR-041).
 *
 * The generic per-flow claimable enqueue: locate an initiative's manifest
 * across the queue, guard the states a run must never disturb, repoint it at
 * the target flow, and drop it into `_queue/pending/` for the scheduler to
 * claim — threading the SAME cycle_id (DEC-2 lineage), no sibling cycle born.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest, parseManifest, type InitiativeManifest } from '../../manifest.ts';
import { getPaths } from '../../queue.ts';
import { enqueueFlowRun, DEVELOP_FLOW_ID } from '../../enqueue-flow-run.ts';

function manifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-06-21-toc',
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
  const dir = mkdtempSync(join(tmpdir(), 'forge-enqueue-flow-run-'));
  try {
    fn(join(dir, '_queue'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// (1) pending manifest + non-develop target flow → enqueued
// ---------------------------------------------------------------------------

test('enqueueFlowRun: a pending manifest is repointed at a non-develop target flow + a cycle_id is minted', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest());
    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot });

    assert.equal(result.status, 'enqueued');
    assert.equal(result.flowId, 'retro-flow');
    assert.ok(result.cycleId && result.cycleId.includes('INIT-2026-06-21-toc'), 'a cycleId is returned');

    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.flow_id, 'retro-flow', 'flow_id is repointed at the target flow on disk');
    assert.equal(onDisk.phase, 'pending', 'manifest stays claimable (pending)');
    assert.ok(onDisk.cycle_id, 'cycle_id persisted on the manifest');
  });
});

// ---------------------------------------------------------------------------
// (2) generic state guards
// ---------------------------------------------------------------------------

test('enqueueFlowRun: an in-flight initiative is left untouched (already-running)', () => {
  withTmp((queueRoot) => {
    const p = seed(queueRoot, 'in-flight', manifest());
    const before = readFileSync(p, 'utf8');
    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot });

    assert.equal(result.status, 'already-running');
    assert.equal(readFileSync(p, 'utf8'), before, 'the in-flight manifest is not mutated');
    const paths = getPaths(queueRoot);
    assert.ok(!existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'no sibling pending manifest created');
  });
});

test('enqueueFlowRun: a merged initiative is left untouched (already-running — never a run source)', () => {
  withTmp((queueRoot) => {
    const p = seed(queueRoot, 'merged', manifest());
    const before = readFileSync(p, 'utf8');
    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot });

    assert.equal(result.status, 'already-running');
    assert.equal(readFileSync(p, 'utf8'), before, 'the merged manifest is not mutated');
  });
});

test('enqueueFlowRun: ready-for-review with the SAME flow_id as the target → already-running', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'ready-for-review', manifest({ flow_id: 'retro-flow' }));
    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot });

    assert.equal(result.status, 'already-running');
    const paths = getPaths(queueRoot);
    assert.ok(
      existsSync(join(paths.readyForReview, 'INIT-2026-06-21-toc.md')),
      'the manifest stays parked in ready-for-review, awaiting its gate',
    );
  });
});

// TEST-WORLD AMENDMENT — W8-A3 (`flows-37` / `forge-chm`). This test pinned the DIFFERENT-flow hand-off as
// an unconditional fall-through, which is precisely the unconditional repoint
// flows-37 reproduced. The fall-through itself is still correct — a
// ready-for-review manifest from another flow IS runnable — but it is now a
// repoint like any other and needs the caller to confirm it. The state guard
// (ready-for-review does not short-circuit to `already-running` for a different
// flow) is what this test exists to protect, and it still does.
test('enqueueFlowRun: ready-for-review with a DIFFERENT flow_id → enqueued (hand-off fall-through, on a confirmed repoint)', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'ready-for-review', manifest({ flow_id: 'forge-architect' }));
    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot, confirmRepointFrom: 'forge-architect' });

    assert.equal(result.status, 'enqueued');
    const paths = getPaths(queueRoot);
    assert.ok(existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'moved into pending');
    assert.ok(!existsSync(join(paths.readyForReview, 'INIT-2026-06-21-toc.md')), 'removed from ready-for-review');
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.flow_id, 'retro-flow', 'repointed at the new target flow');
  });
});

// ---------------------------------------------------------------------------
// (3) develop-only planned gate
// ---------------------------------------------------------------------------

test('enqueueFlowRun: target forge-develop without decomposition evidence → not-planned', () => {
  withTmp((queueRoot) => {
    const m = manifest();
    delete m.specs;
    seed(queueRoot, 'pending', m);
    const result = enqueueFlowRun('INIT-2026-06-21-toc', DEVELOP_FLOW_ID, { queueRoot });

    assert.equal(result.status, 'not-planned');
    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.flow_id, undefined, 'the manifest is NOT repointed at forge-develop');
  });
});

test('enqueueFlowRun: target retro-flow without decomposition evidence → enqueued (gate is develop-specific)', () => {
  withTmp((queueRoot) => {
    const m = manifest();
    delete m.specs;
    seed(queueRoot, 'pending', m);
    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot });

    assert.equal(result.status, 'enqueued', 'the planned gate only guards forge-develop targets');
    assert.equal(result.flowId, 'retro-flow');
  });
});

// ---------------------------------------------------------------------------
// (4) bad flow id slug
// ---------------------------------------------------------------------------

test('enqueueFlowRun: a path-traversal flow id never escapes the studio flows dir → not-found', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest());
    const result = enqueueFlowRun('INIT-2026-06-21-toc', '../etc', { queueRoot });

    assert.equal(result.status, 'not-found');
    const paths = getPaths(queueRoot);
    // Nothing should have moved — the manifest stays exactly where it was seeded.
    assert.ok(existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'the source manifest is untouched');
  });
});

// ---------------------------------------------------------------------------
// (5) resume_from cleared on repoint
// ---------------------------------------------------------------------------

test('enqueueFlowRun: a stale resume_from is cleared when re-enqueueing for a fresh build', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ resume_from: 'demo' }));
    enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot });
    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.resume_from, undefined, 'resume_from is cleared so the run starts the flow fresh');
  });
});

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 7): "never re-run a SHIPPED manifest from an
// operator action" is a property of the ENQUEUE, not of one route. A3-01
// bolted the rule onto `POST /api/flows/:id/run` as a pre-check, which left
// the sibling operator route (`POST /api/develop/start` → enqueueDevelopRun →
// here) yanking a `done/` manifest back out and re-running it. The rule lives
// on this primitive now: `done/` is a source ONLY for a caller that says so
// (`allowFinishedSource: true` — the trigger drain's flow-complete chaining,
// which legitimately re-runs a finished initiative on the NEXT flow).
// ---------------------------------------------------------------------------

test('enqueueFlowRun: a manifest whose ONLY source is done/ → already-done; the done manifest is untouched and nothing is enqueued', () => {
  withTmp((queueRoot) => {
    const donePath = seed(queueRoot, 'done', manifest({ phase: 'done' }));
    const before = readFileSync(donePath, 'utf8');

    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'forge-develop', { queueRoot });

    assert.equal(result.status, 'already-done');
    assert.equal(result.initiativeId, 'INIT-2026-06-21-toc');
    assert.match(result.detail ?? '', /shipped/i);
    const paths = getPaths(queueRoot);
    assert.equal(readFileSync(donePath, 'utf8'), before, 'the done manifest is byte-unchanged');
    assert.equal(existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), false, 'nothing enqueued');
  });
});

test('enqueueFlowRun: allowFinishedSource re-runs a done manifest (the trigger drain\'s flow-complete chaining is unchanged)', () => {
  withTmp((queueRoot) => {
    const donePath = seed(queueRoot, 'done', manifest({ phase: 'done' }));

    const result = enqueueFlowRun('INIT-2026-06-21-toc', 'retro-flow', { queueRoot, allowFinishedSource: true });

    assert.equal(result.status, 'enqueued');
    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.flow_id, 'retro-flow');
    assert.equal(existsSync(donePath), false, 'claimed out of done/ exactly as before');
  });
});

test('enqueueFlowRun: only done/ is guarded — failed/ and pending/ stay runnable by default', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'failed', manifest({ phase: 'failed' }));
    assert.equal(enqueueFlowRun('INIT-2026-06-21-toc', 'forge-develop', { queueRoot }).status, 'enqueued', 'a failed run is re-runnable');
  });
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest());
    assert.equal(enqueueFlowRun('INIT-2026-06-21-toc', 'forge-develop', { queueRoot }).status, 'enqueued');
  });
});

test('enqueueFlowRun: a pending manifest wins over a stale done/ copy (the guard is about the SOURCE, not id history)', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'done', manifest({ phase: 'done' }));
    seed(queueRoot, 'pending', manifest());
    assert.equal(enqueueFlowRun('INIT-2026-06-21-toc', 'forge-develop', { queueRoot }).status, 'enqueued');
  });
});
