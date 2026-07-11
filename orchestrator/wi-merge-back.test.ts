/**
 * Phase 4 step 5 — per-WI merge-back fan-in.
 *
 * `mergeWiIntoCycle` is pure git plumbing tested against real tmp repos (the
 * repo pattern `pr.test.ts` / `wi-worktree.test.ts` already use); the loop
 * itself lives in `developer-loop.ts` and is exercised end-to-end by
 * `developer-loop.wi-worktree-fanin.test.ts`. `createMergeQueue` is tested
 * standalone — pure ordering logic, no filesystem involved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMergeQueue, mergeWiIntoCycle } from './wi-merge-back.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/**
 * A repo with `main` (base commit) checked out as the "cycle" branch, plus a
 * sibling `wi-branch` created from the same tip. Mirrors the shape a real
 * cycle worktree + per-WI worktree share (same object DB, different
 * branches) without needing an actual second worktree — `git merge` only
 * needs the WI branch ref to resolve, not a live worktree checked out on it.
 */
function setup(): { proj: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-merge-back-'));
  const proj = join(root, 'proj');
  mkdirSync(proj, { recursive: true });
  sh(proj, ['init', '-q', '-b', 'main']);
  sh(proj, ['config', 'user.email', 't@forge']);
  sh(proj, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(proj, 'README.md'), 'base\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'base']);
  sh(proj, ['checkout', '-q', '-b', 'cycle-branch']);
  return { proj, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('mergeWiIntoCycle: merges a clean WI branch into the cycle branch with --no-ff', () => {
  const { proj, cleanup } = setup();
  try {
    sh(proj, ['checkout', '-q', '-b', 'wi-branch']);
    writeFileSync(join(proj, 'wi-1.txt'), 'wi work\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: work']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-1' });

    assert.deepEqual(result, { merged: true });
    assert.equal(readFileSync(join(proj, 'wi-1.txt'), 'utf8'), 'wi work\n');

    // --no-ff: the merge commit has TWO parents even though a fast-forward
    // was possible (cycle-branch had no divergent commits of its own).
    const parents = sh(proj, ['log', '-1', '--pretty=%P']).trim().split(/\s+/);
    assert.equal(parents.length, 2, 'merge commit must have two parents (--no-ff, not a fast-forward)');

    const log = sh(proj, ['log', '-1', '--pretty=%s']).trim();
    assert.equal(log, 'wi(WI-1): merge');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a content conflict aborts cleanly — merged:false, working tree clean', () => {
  const { proj, cleanup } = setup();
  try {
    // Diverge: cycle-branch changes README.md...
    writeFileSync(join(proj, 'README.md'), 'cycle change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'cycle: change readme']);

    // ...and wi-branch, forked from the ORIGINAL base tip, changes the SAME
    // line differently.
    sh(proj, ['checkout', '-q', '-b', 'wi-branch', 'main']);
    writeFileSync(join(proj, 'README.md'), 'wi change\n');
    sh(proj, ['add', '.']);
    sh(proj, ['commit', '-q', '-m', 'wi: change readme']);
    sh(proj, ['checkout', '-q', 'cycle-branch']);

    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'wi-branch', workItemId: 'WI-2' });

    assert.equal(result.merged, false);
    if (!result.merged) {
      assert.ok(result.detail.length > 0, 'a diagnostic detail is carried');
    }

    // The abort must leave the working tree clean — no MERGE_HEAD, no
    // conflict markers, no staged/unstaged changes left behind.
    const status = sh(proj, ['status', '--porcelain']).trim();
    assert.equal(status, '', 'working tree must be clean after merge --abort');
    assert.throws(
      () => sh(proj, ['rev-parse', '--verify', 'MERGE_HEAD']),
      'MERGE_HEAD must not linger after abort',
    );
    // cycle-branch itself must be unmoved (still at its own change, not the WI's).
    assert.equal(readFileSync(join(proj, 'README.md'), 'utf8'), 'cycle change\n');
  } finally {
    cleanup();
  }
});

test('mergeWiIntoCycle: a nonexistent WI branch fails without leaving a mid-merge state', () => {
  const { proj, cleanup } = setup();
  try {
    const result = mergeWiIntoCycle({ cycleWorktreePath: proj, wiBranch: 'does-not-exist', workItemId: 'WI-3' });
    assert.equal(result.merged, false);
    const status = sh(proj, ['status', '--porcelain']).trim();
    assert.equal(status, '', 'working tree must be clean');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// createMergeQueue
// ---------------------------------------------------------------------------

test('createMergeQueue: serializes calls in enqueue order, even when the first is slower', async () => {
  const queue = createMergeQueue();
  const order: string[] = [];

  const slow = queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('slow');
    return 'slow-result';
  });
  const fast = queue.enqueue(async () => {
    order.push('fast');
    return 'fast-result';
  });

  const results = await Promise.all([slow, fast]);
  assert.deepEqual(order, ['slow', 'fast'], 'fast must not run before slow, despite finishing sooner if unserialized');
  assert.deepEqual(results, ['slow-result', 'fast-result']);
});

test('createMergeQueue: a rejected task does not stall subsequent tasks', async () => {
  const queue = createMergeQueue();

  const failing = queue.enqueue(async () => {
    throw new Error('boom');
  });
  const following = queue.enqueue(async () => 'ok');

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'ok', 'a later task must still run after an earlier one rejects');
});

test('createMergeQueue: supports synchronous functions', async () => {
  const queue = createMergeQueue();
  const result = await queue.enqueue(() => 42);
  assert.equal(result, 42);
});
