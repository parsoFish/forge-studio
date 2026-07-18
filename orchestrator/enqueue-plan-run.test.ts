/**
 * Tests for orchestrator/enqueue-plan-run.ts (R4-05 / F4).
 *
 * The standalone "Plan" trigger: repoint a WI-less initiative's manifest at
 * the forge-architect flow and make it claimable (pending) — the scheduler
 * decomposes it via execPm -> runProjectManager, the exact same pipeline the
 * batch promoteManifests path feeds. No sibling cycle, no lost lineage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest, parseManifest, type InitiativeManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { enqueuePlanRun, PLAN_FLOW_ID } from './enqueue-plan-run.ts';
import { DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';

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
  const dir = mkdtempSync(join(tmpdir(), 'forge-enqueue-plan-'));
  try {
    fn(join(dir, '_queue'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('enqueuePlanRun: a pending manifest is repointed at forge-architect + a cycle_id is minted', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest());
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'enqueued');
    assert.equal(result.flowId, PLAN_FLOW_ID);
    assert.equal(PLAN_FLOW_ID, 'forge-architect');
    assert.ok(result.cycleId && result.cycleId.includes('INIT-2026-06-21-toc'), 'a cycleId is returned');

    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.flow_id, PLAN_FLOW_ID, 'flow_id is forge-architect on disk');
    assert.equal(onDisk.phase, 'pending', 'manifest stays claimable (pending)');
    assert.ok(onDisk.cycle_id, 'cycle_id persisted on the manifest');
  });
});

test('enqueuePlanRun: an existing cycle_id is reused, not re-minted', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ cycle_id: '2026-06-21T00-00-00_INIT-2026-06-21-toc' }));
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'enqueued');
    assert.equal(result.cycleId, '2026-06-21T00-00-00_INIT-2026-06-21-toc', 'the existing cycle_id is preserved');
  });
});

test('enqueuePlanRun: a non-develop manifest parked in ready-for-review (architect hand-off) is re-planned', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'ready-for-review', manifest({ flow_id: PLAN_FLOW_ID }));
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    const paths = getPaths(queueRoot);
    assert.equal(result.status, 'enqueued');
    assert.ok(existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'moved into pending');
    assert.ok(!existsSync(join(paths.readyForReview, 'INIT-2026-06-21-toc.md')), 'removed from ready-for-review');
  });
});

test('enqueuePlanRun: a forge-develop manifest parked in ready-for-review is left untouched (a develop cycle is running)', () => {
  withTmp((queueRoot) => {
    const p = seed(queueRoot, 'ready-for-review', manifest({ flow_id: DEVELOP_FLOW_ID }));
    const before = readFileSync(p, 'utf8');
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'already-running');
    assert.equal(readFileSync(p, 'utf8'), before, 'the ready-for-review develop manifest is not mutated');
    const paths = getPaths(queueRoot);
    assert.ok(!existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'no sibling pending manifest created');
  });
});

test('enqueuePlanRun: a merged initiative is left untouched (R4-11-F1: merged is a transient pass-through, not a plan source)', () => {
  withTmp((queueRoot) => {
    const p = seed(queueRoot, 'merged', manifest({ flow_id: DEVELOP_FLOW_ID }));
    const before = readFileSync(p, 'utf8');
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'already-running');
    assert.equal(readFileSync(p, 'utf8'), before, 'the merged manifest is not mutated');
    const paths = getPaths(queueRoot);
    assert.ok(!existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'no sibling pending manifest created');
  });
});

test('enqueuePlanRun: an in-flight initiative is left untouched (already running)', () => {
  withTmp((queueRoot) => {
    const p = seed(queueRoot, 'in-flight', manifest({ flow_id: PLAN_FLOW_ID }));
    const before = readFileSync(p, 'utf8');
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'already-running');
    assert.equal(readFileSync(p, 'utf8'), before, 'the in-flight manifest is not mutated');
    const paths = getPaths(queueRoot);
    assert.ok(!existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'no sibling pending manifest created');
  });
});

test('enqueuePlanRun: an unknown initiative returns not-found', () => {
  withTmp((queueRoot) => {
    mkdirSync(join(queueRoot, 'pending'), { recursive: true });
    const result = enqueuePlanRun('INIT-2026-06-21-nope', { queueRoot });
    assert.equal(result.status, 'not-found');
  });
});

test('enqueuePlanRun: a path-traversal id never escapes the queue dir', () => {
  withTmp((queueRoot) => {
    mkdirSync(join(queueRoot, 'pending'), { recursive: true });
    const result = enqueuePlanRun('../../etc/passwd', { queueRoot });
    assert.equal(result.status, 'not-found', 'a malformed id resolves to not-found, never a traversal');
  });
});

test('enqueuePlanRun: a done initiative is re-planned (re-plan parallels re-develop)', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'done', manifest({ flow_id: DEVELOP_FLOW_ID, phase: 'done' }));
    const result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'enqueued');
    const paths = getPaths(queueRoot);
    assert.ok(existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'moved into pending');
    assert.ok(!existsSync(join(paths.done, 'INIT-2026-06-21-toc.md')), 'removed from done');
  });
});

test('enqueuePlanRun: a stale resume_from is cleared when re-enqueueing', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ resume_from: 'unifier' }));
    enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });
    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.resume_from, undefined, 'resume_from is cleared for the fresh decompose pass');
  });
});

test('enqueuePlanRun: a write failure is contained → status error, never throws (contract)', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'done', manifest());
    // Sabotage: `pending` exists as a FILE, so the enqueue's mkdirSync /
    // writeFileSync must fail. The doc contract says the function never
    // throws — the failure must come back as an error-shaped result.
    writeFileSync(join(queueRoot, 'pending'), 'not a directory');

    let result: ReturnType<typeof enqueuePlanRun> | undefined;
    assert.doesNotThrow(() => {
      result = enqueuePlanRun('INIT-2026-06-21-toc', { queueRoot });
    });
    assert.equal(result?.status, 'error');
    assert.equal(result?.initiativeId, 'INIT-2026-06-21-toc');
    assert.ok(result?.detail, 'the underlying filesystem error is surfaced in detail');
  });
});
