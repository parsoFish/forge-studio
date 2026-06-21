/**
 * Tests for orchestrator/enqueue-develop-run.ts (S7 / DEC-3).
 *
 * The "start development" trigger: repoint a decomposed initiative's manifest at
 * the forge-develop flow and make it claimable (pending), threading the SAME
 * cycle_id the architect flow minted (DEC-2). No sibling cycle, no lost lineage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest, parseManifest, type InitiativeManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { enqueueDevelopRun, DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';

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
  const dir = mkdtempSync(join(tmpdir(), 'forge-enqueue-'));
  try {
    fn(join(dir, '_queue'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('enqueueDevelopRun: a pending manifest is repointed at forge-develop + a cycle_id is minted', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest());
    const result = enqueueDevelopRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'enqueued');
    assert.equal(result.flowId, DEVELOP_FLOW_ID);
    assert.ok(result.cycleId && result.cycleId.includes('INIT-2026-06-21-toc'), 'a cycleId is returned');

    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.flow_id, DEVELOP_FLOW_ID, 'flow_id is forge-develop on disk');
    assert.equal(onDisk.phase, 'pending', 'manifest stays claimable (pending)');
    assert.ok(onDisk.cycle_id, 'cycle_id persisted on the manifest');
  });
});

test('enqueueDevelopRun: an existing cycle_id is reused, not re-minted (DEC-2 threading)', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ cycle_id: '2026-06-21T00-00-00_INIT-2026-06-21-toc' }));
    const result = enqueueDevelopRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'enqueued');
    assert.equal(result.cycleId, '2026-06-21T00-00-00_INIT-2026-06-21-toc', 'the architect-minted cycle_id is preserved');
  });
});

test('enqueueDevelopRun: a manifest parked in ready-for-review is moved to pending', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'ready-for-review', manifest());
    // ready-for-review with NO pending UWIs / open cycle is the architect-flow
    // hand-off state — start-development claims it. (An in-flight cycle is a
    // different case, covered below.)
    const result = enqueueDevelopRun('INIT-2026-06-21-toc', { queueRoot });

    const paths = getPaths(queueRoot);
    assert.equal(result.status, 'enqueued');
    assert.ok(existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'moved into pending');
    assert.ok(!existsSync(join(paths.readyForReview, 'INIT-2026-06-21-toc.md')), 'removed from ready-for-review');
  });
});

test('enqueueDevelopRun: an in-flight initiative is left untouched (already developing)', () => {
  withTmp((queueRoot) => {
    const p = seed(queueRoot, 'in-flight', manifest({ flow_id: DEVELOP_FLOW_ID }));
    const before = readFileSync(p, 'utf8');
    const result = enqueueDevelopRun('INIT-2026-06-21-toc', { queueRoot });

    assert.equal(result.status, 'already-developing');
    assert.equal(readFileSync(p, 'utf8'), before, 'the in-flight manifest is not mutated');
    const paths = getPaths(queueRoot);
    assert.ok(!existsSync(join(paths.pending, 'INIT-2026-06-21-toc.md')), 'no sibling pending manifest created');
  });
});

test('enqueueDevelopRun: an unknown initiative returns not-found', () => {
  withTmp((queueRoot) => {
    mkdirSync(join(queueRoot, 'pending'), { recursive: true });
    const result = enqueueDevelopRun('INIT-2026-06-21-nope', { queueRoot });
    assert.equal(result.status, 'not-found');
  });
});

test('enqueueDevelopRun: a path-traversal id never escapes the queue dir', () => {
  withTmp((queueRoot) => {
    mkdirSync(join(queueRoot, 'pending'), { recursive: true });
    const result = enqueueDevelopRun('../../etc/passwd', { queueRoot });
    assert.equal(result.status, 'not-found', 'a malformed id resolves to not-found, never a traversal');
  });
});

test('enqueueDevelopRun: a stale resume_from is cleared when re-enqueueing for a fresh build', () => {
  withTmp((queueRoot) => {
    seed(queueRoot, 'pending', manifest({ resume_from: 'unifier' }));
    enqueueDevelopRun('INIT-2026-06-21-toc', { queueRoot });
    const paths = getPaths(queueRoot);
    const onDisk = parseManifest(readFileSync(join(paths.pending, 'INIT-2026-06-21-toc.md'), 'utf8'));
    assert.equal(onDisk.resume_from, undefined, 'resume_from is cleared so the develop run starts the full dev→unifier→review spine');
  });
});
