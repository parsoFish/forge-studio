/**
 * Tests for the ADR 026 drain sweep — selection + re-claim logic. The cycle run
 * is injected (`runDrainCycle`) so these stay git/SDK-free; the real spine is
 * exercised end-to-end by a live cycle (verify:cycle).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainPendingUnifierItems, type DrainStatus } from './drain-unifier-items.ts';
import { seedStaticUnifierItem, appendReviewUnifierItems, unifierItemsDir } from './unifier-items.ts';
import { writeWorkItemStatus } from './work-item.ts';
import type { CycleInput } from './cycle-context.ts';

const GATE = ['go', 'test', './...'];
const ID = 'INIT-2026-06-07-drain';

function setup(): { root: string; queueRoot: string; wt: string } {
  const root = mkdtempSync(join(tmpdir(), 'drain-'));
  const queueRoot = join(root, '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  const wt = join(root, 'wt');
  mkdirSync(wt, { recursive: true });
  return { root, queueRoot, wt };
}

function writeManifest(queueRoot: string, state: string, wt: string, opts: { cycleId?: string } = {}): void {
  const lines = [
    '---',
    `initiative_id: ${ID}`,
    'project: demo',
    `project_repo_path: ${wt}`,
    "created_at: '2026-06-07T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: ready-for-review',
    'origin: architect',
    `worktree_path: ${wt}`,
    ...(opts.cycleId ? [`cycle_id: ${opts.cycleId}`] : []),
    '---',
    `# ${ID}`,
    '',
  ];
  writeFileSync(join(queueRoot, state, `${ID}.md`), lines.join('\n'));
}

/** Seed a post-first-cycle queue: UWI-1 complete, then a code-fix send-back. */
function seedDrainableQueue(wt: string): void {
  const uwi1 = seedStaticUnifierItem(wt, { initiativeId: ID, estimatedIterations: 6, qualityGateCmd: GATE });
  writeWorkItemStatus(uwi1, 'complete');
  appendReviewUnifierItems({
    worktreePath: wt,
    initiativeId: ID,
    concern: { rationale: 'fix the path', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
    projectGateCmd: GATE,
    estimatedIterations: 6,
  });
}

test('drain: pending UWIs + unmerged PR → re-claimed, runDrainCycle threads cycle_id + resumeFrom', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    const calls: CycleInput[] = [];
    const results = await drainPendingUnifierItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async (input) => { calls.push(input); return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['drained' as DrainStatus]);
    assert.equal(calls.length, 1, 'runDrainCycle was called once');
    assert.equal(calls[0]!.cycleId, 'CYCLE-XYZ', 'threads the persisted cycle_id');
    assert.equal(calls[0]!.resumeFrom, 'unifier');
    // The stub did not run closure, so the drain returns the stranded manifest
    // from in-flight back to ready-for-review.
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), true);
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${ID}.md`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: no pending UWIs → no-pending, runDrainCycle NOT called', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    const uwi1 = seedStaticUnifierItem(wt, { initiativeId: ID, estimatedIterations: 6, qualityGateCmd: GATE });
    writeWorkItemStatus(uwi1, 'complete'); // UWI-1 done, nothing appended
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let called = false;
    const results = await drainPendingUnifierItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['no-pending']);
    assert.equal(called, false);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: merged PR → pr-merged (finalize-merged domain), runDrainCycle NOT called', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let called = false;
    const results = await drainPendingUnifierItems({
      queueRoot,
      confirmMerge: () => true,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['pr-merged']);
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: a failed UWI → needs-operator (never auto-retry)', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    const uwi1 = seedStaticUnifierItem(wt, { initiativeId: ID, estimatedIterations: 6, qualityGateCmd: GATE });
    writeWorkItemStatus(uwi1, 'complete');
    const { appended } = appendReviewUnifierItems({
      worktreePath: wt,
      initiativeId: ID,
      concern: { rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
      projectGateCmd: GATE,
      estimatedIterations: 6,
    });
    // Mark the concern UWI failed (a prior drain couldn't satisfy it).
    writeWorkItemStatus(join(unifierItemsDir(wt), `${appended[0]}.md`), 'failed');
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let called = false;
    const results = await drainPendingUnifierItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['needs-operator']);
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: a thrown drain cycle returns the manifest to ready-for-review (B1, never stranded)', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    const results = await drainPendingUnifierItems({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => false,
      runDrainCycle: async () => { throw new Error('cycle blew up mid-drain'); },
    });
    assert.deepEqual(results.map((r) => r.status), ['error' as DrainStatus]);
    // Not stranded in in-flight — the finally returned it to ready-for-review.
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${ID}.md`)), false);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), true);
    // No leftover heartbeat.
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${ID}.md.heartbeat`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: cycle_id falls back to the latest _logs dir when the manifest lacks one (N1)', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt); // no cycle_id
    const logsRoot = join(root, '_logs');
    mkdirSync(join(logsRoot, `2026-06-07T01-02-03_${ID}`), { recursive: true });
    const calls: CycleInput[] = [];
    await drainPendingUnifierItems({
      queueRoot,
      logsRoot,
      confirmMerge: () => false,
      runDrainCycle: async (input) => { calls.push(input); return { status: 'pr-open' }; },
    });
    assert.equal(calls[0]!.cycleId, `2026-06-07T01-02-03_${ID}`, 'threads the latest matching _logs dir');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: no worktree → no-worktree, skipped', async () => {
  const { root, queueRoot } = setup();
  try {
    writeManifest(queueRoot, 'ready-for-review', join(root, 'gone'), { cycleId: 'CYCLE-XYZ' });
    const results = await drainPendingUnifierItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => ({ status: 'pr-open' }),
    });
    assert.deepEqual(results.map((r) => r.status), ['no-worktree']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
