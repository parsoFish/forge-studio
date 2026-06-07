/**
 * Tests for the F-W5-7 finalize sweep — selection + re-claim logic. The
 * per-cycle closure→reflector action is injected (`finalizeOne`) so these stay
 * git/SDK-free; the real chain is exercised end-to-end by a live cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { finalizeMergedReadyForReview } from './finalize-merged.ts';

function setup(): { root: string; queueRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'finalize-'));
  const queueRoot = join(root, '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  return { root, queueRoot };
}

function writeManifest(queueRoot: string, state: string, id: string, worktreePath: string): void {
  const body = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${worktreePath}`,
    "created_at: '2026-05-30T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: pending',
    'origin: architect',
    `worktree_path: ${worktreePath}`,
    '---',
    `# ${id}`,
    '',
  ].join('\n');
  writeFileSync(join(queueRoot, state, `${id}.md`), body);
}

test('finalize: merged PR → re-claimed to in-flight + finalizeOne run → finalized', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-merged', wt);
    const calls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      finalizeOne: async (input) => { calls.push(input.initiativeId); return true; },
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.deepEqual(calls, ['INIT-2026-05-30-merged']);
    // Re-claimed: out of ready-for-review/, into in-flight/ for closure's move.
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', 'INIT-2026-05-30-merged.md')), false);
    assert.equal(existsSync(join(queueRoot, 'in-flight', 'INIT-2026-05-30-merged.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: threads the manifest-persisted cycle_id into finalizeOne (ADR 026 lineage)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-05-30-lineage';
    // Manifest carries an explicit cycle_id (the one runCycle persisted at first claim).
    const body = [
      '---',
      `initiative_id: ${id}`,
      'project: demo',
      `project_repo_path: ${wt}`,
      "created_at: '2026-05-30T00:00:00.000Z'",
      'iteration_budget: 2',
      'cost_budget_usd: 1',
      'phase: pending',
      'origin: architect',
      `worktree_path: ${wt}`,
      'cycle_id: 2026-05-30T01-02-03_' + id,
      '---',
      `# ${id}`,
      '',
    ].join('\n');
    writeFileSync(join(queueRoot, 'ready-for-review', `${id}.md`), body);
    let threaded: string | undefined;
    await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      finalizeOne: async (input) => { threaded = input.cycleId; return true; },
    });
    assert.equal(threaded, '2026-05-30T01-02-03_' + id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: open PR → left in ready-for-review, finalizeOne NOT called', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-open', wt);
    let called = false;
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      confirmMerge: () => false,
      finalizeOne: async () => { called = true; return true; },
    });
    assert.deepEqual(results.map((r) => r.status), ['still-open']);
    assert.equal(called, false);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', 'INIT-2026-05-30-open.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: worktree gone → no-worktree, skipped (no re-claim)', async () => {
  const { root, queueRoot } = setup();
  try {
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-nowt', join(root, 'gone'));
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      confirmMerge: () => true,
      finalizeOne: async () => true,
    });
    assert.deepEqual(results.map((r) => r.status), ['no-worktree']);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', 'INIT-2026-05-30-nowt.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
