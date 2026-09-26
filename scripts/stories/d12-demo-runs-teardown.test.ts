/**
 * d12-demo-runs-teardown.test.ts — real tmp git repos + real tmp `_queue/`
 * trees, no mocks (bead `forge-1rk5.3`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeInitiativeWorktree, deleteLocalBranch, removeQueueManifest } from './d12-demo-runs-teardown.mjs';

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real, tiny git repo with one commit on `main`. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'd12-teardown-repo-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@forge']);
  sh(root, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(root, 'README.md'), 'base\n');
  sh(root, ['add', '.']);
  sh(root, ['commit', '-q', '-m', 'base']);
  return root;
}

describe('removeInitiativeWorktree', () => {
  test('removes a real worktree by its exact path, and prunes the registry', () => {
    const repo = makeRepo();
    try {
      const wtRoot = mkdtempSync(join(tmpdir(), 'd12-teardown-wt-'));
      const worktreePath = join(wtRoot, 'INIT-x');
      sh(repo, ['worktree', 'add', '-b', 'forge/INIT-x', worktreePath]);
      assert.ok(existsSync(worktreePath));

      const r = removeInitiativeWorktree(repo, worktreePath);
      assert.deepEqual(r, { removed: true });
      assert.ok(!existsSync(worktreePath), 'worktree dir must be gone');
      const list = sh(repo, ['worktree', 'list']);
      assert.ok(!list.includes('INIT-x'), 'the registry must no longer list it');
      rmSync(wtRoot, { recursive: true, force: true });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('removes a DIRTY worktree too (--force)', () => {
    const repo = makeRepo();
    try {
      const wtRoot = mkdtempSync(join(tmpdir(), 'd12-teardown-wt-'));
      const worktreePath = join(wtRoot, 'INIT-y');
      sh(repo, ['worktree', 'add', '-b', 'forge/INIT-y', worktreePath]);
      writeFileSync(join(worktreePath, 'uncommitted.txt'), 'dirty\n'); // untracked — a plain remove would refuse

      const r = removeInitiativeWorktree(repo, worktreePath);
      assert.deepEqual(r, { removed: true });
      assert.ok(!existsSync(worktreePath));
      rmSync(wtRoot, { recursive: true, force: true });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('an already-absent worktree is not a failure', () => {
    const repo = makeRepo();
    try {
      const r = removeInitiativeWorktree(repo, join(repo, '..', 'never-existed-INIT-z'));
      assert.deepEqual(r, { removed: false, reason: 'already absent' });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('deleteLocalBranch', () => {
  test('deletes an unmerged branch by its exact name (-D)', () => {
    const repo = makeRepo();
    try {
      sh(repo, ['branch', 'forge/INIT-x']);
      const r = deleteLocalBranch(repo, 'forge/INIT-x');
      assert.deepEqual(r, { removed: true });
      assert.throws(() => sh(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/forge/INIT-x']));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('deletes a branch that carries real (unmerged) commits', () => {
    const repo = makeRepo();
    try {
      sh(repo, ['checkout', '-q', '-b', 'forge/INIT-w']);
      writeFileSync(join(repo, 'feature.txt'), 'work\n');
      sh(repo, ['add', '.']);
      sh(repo, ['commit', '-q', '-m', 'feat: work']);
      sh(repo, ['checkout', '-q', 'main']);

      const r = deleteLocalBranch(repo, 'forge/INIT-w');
      assert.deepEqual(r, { removed: true });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('an already-absent branch is not a failure', () => {
    const repo = makeRepo();
    try {
      const r = deleteLocalBranch(repo, 'forge/never-existed');
      assert.deepEqual(r, { removed: false, reason: 'already absent' });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('refuses to delete a branch still checked out in a worktree — callers must remove the worktree first', () => {
    const repo = makeRepo();
    try {
      const wtRoot = mkdtempSync(join(tmpdir(), 'd12-teardown-wt-'));
      const worktreePath = join(wtRoot, 'INIT-v');
      sh(repo, ['worktree', 'add', '-b', 'forge/INIT-v', worktreePath]);
      assert.throws(() => deleteLocalBranch(repo, 'forge/INIT-v'));
      rmSync(wtRoot, { recursive: true, force: true });
      sh(repo, ['worktree', 'prune']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('removeQueueManifest', () => {
  function makeQueueRoot() {
    const forgeRoot = mkdtempSync(join(tmpdir(), 'd12-teardown-queue-'));
    for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
      mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
    }
    return forgeRoot;
  }

  test('removes the manifest from ready-for-review by exact filename', () => {
    const forgeRoot = makeQueueRoot();
    try {
      const target = join(forgeRoot, '_queue', 'ready-for-review', 'INIT-2026-09-27-d12-positive.md');
      writeFileSync(target, '---\ninitiative_id: INIT-2026-09-27-d12-positive\n---\n');
      const r = removeQueueManifest(forgeRoot, 'INIT-2026-09-27-d12-positive');
      assert.equal(r.removed, true);
      assert.equal(r.state, 'readyForReview');
      assert.equal(r.path, target);
      assert.ok(!existsSync(target));
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('finds it in failed/ too, and never touches a sibling initiative', () => {
    const forgeRoot = makeQueueRoot();
    try {
      const target = join(forgeRoot, '_queue', 'failed', 'INIT-2026-09-27-d12-control.md');
      const sibling = join(forgeRoot, '_queue', 'failed', 'INIT-2026-09-27-d12-other.md');
      writeFileSync(target, 'x');
      writeFileSync(sibling, 'y');
      const r = removeQueueManifest(forgeRoot, 'INIT-2026-09-27-d12-control');
      assert.equal(r.removed, true);
      assert.equal(r.state, 'failed');
      assert.ok(!existsSync(target));
      assert.ok(existsSync(sibling), 'a sibling initiative file must never be touched');
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('reports not-found rather than throwing when nothing matches', () => {
    const forgeRoot = makeQueueRoot();
    try {
      const r = removeQueueManifest(forgeRoot, 'INIT-2026-09-27-d12-nowhere');
      assert.deepEqual(r, { removed: false, reason: 'not found in any _queue/ state dir' });
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
});
