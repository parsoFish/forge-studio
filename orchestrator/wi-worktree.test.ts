/**
 * Tests for orchestrator/wi-worktree.ts — Phase 4 step 4: per-WI worktree
 * bootstrap. Pattern-matches orchestrator/worktree.test.ts: a real temp git
 * repo fixture, no mocks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createWiWorktree, removeWiWorktree, wiBranchName, wiWorktreePath } from './wi-worktree.ts';
import { list } from './worktree.ts';

function initRepo(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-worktree-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'], { stdio: 'pipe' });
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { stdio: 'pipe' });
  return { dir, repo };
}

function headRef(repo: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function branchRef(repo: string, branch: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', branch], { encoding: 'utf8' }).trim();
}

function commitFile(repo: string, relPath: string, content: string, message: string): string {
  writeFileSync(join(repo, relPath), content);
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message], { stdio: 'pipe' });
  return headRef(repo);
}

function writeCycleWorkItems(cycleWorktreePath: string, files: Record<string, string>): void {
  const dir = join(cycleWorktreePath, '.forge', 'work-items');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

test('createWiWorktree: fresh → sibling path (never nested), branch@startPoint, deps linked, work-items copied', () => {
  const { dir, repo } = initRepo();
  try {
    const worktreesRoot = join(dir, '_wt');
    const initiativeId = 'INIT-parallel';
    const workItemId = 'WI-1';

    // The "cycle worktree" — a real dir carrying the untracked PM spec.
    const cycleWorktreePath = join(dir, 'cycle-wt');
    mkdirSync(cycleWorktreePath, { recursive: true });
    writeCycleWorkItems(cycleWorktreePath, { 'WI-1.md': '# WI-1\nDo the thing.\n' });

    // node_modules to link (F-24 convention).
    const nodeModules = join(repo, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    writeFileSync(join(nodeModules, 'marker.txt'), 'dep\n');

    const startPointRef = headRef(repo);

    const wt = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId,
      workItemId,
      startPointRef,
      cycleWorktreePath,
    });

    // Path shape + helpers agree.
    assert.equal(wt.path, resolve(worktreesRoot, initiativeId, 'wi', workItemId));
    assert.equal(wt.path, wiWorktreePath({ worktreesRoot, initiativeId, workItemId }));
    assert.equal(wt.branch, `forge/${initiativeId}/wi/${workItemId}`);
    assert.equal(wt.branch, wiBranchName({ initiativeId, workItemId }));
    assert.ok(existsSync(wt.path));

    // Sibling subtree — never nested inside the cycle worktree's own tree.
    assert.ok(!resolve(wt.path).startsWith(resolve(cycleWorktreePath) + '/'));

    // Registered as a real git worktree.
    assert.ok(list(repo).some((w) => resolve(w.path) === resolve(wt.path)));

    // Branch created at the EXPLICIT start point.
    assert.equal(branchRef(repo, wt.branch), startPointRef);

    // linkProjectDeps ran (node_modules symlinked in).
    assert.ok(existsSync(join(wt.path, 'node_modules', 'marker.txt')));

    // .forge/work-items copied from the cycle worktree — these are
    // UNTRACKED files `git worktree add` would never bring across.
    const copied = readFileSync(join(wt.path, '.forge', 'work-items', 'WI-1.md'), 'utf8');
    assert.equal(copied, '# WI-1\nDo the thing.\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWiWorktree: missing .forge/work-items in the cycle worktree → best-effort skip, no throw', () => {
  const { dir, repo } = initRepo();
  try {
    const worktreesRoot = join(dir, '_wt');
    const cycleWorktreePath = join(dir, 'cycle-wt');
    mkdirSync(cycleWorktreePath, { recursive: true }); // no .forge/work-items written

    const wt = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId: 'INIT-nospec',
      workItemId: 'WI-1',
      startPointRef: headRef(repo),
      cycleWorktreePath,
    });

    assert.ok(existsSync(wt.path));
    assert.equal(existsSync(join(wt.path, '.forge', 'work-items')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWiWorktree: collision from a crashed prior run (dir + branch left behind) → self-heals and recreates at the fresh start point', () => {
  const { dir, repo } = initRepo();
  try {
    const worktreesRoot = join(dir, '_wt');
    const initiativeId = 'INIT-crash';
    const workItemId = 'WI-2';
    const cycleWorktreePath = join(dir, 'cycle-wt');
    mkdirSync(cycleWorktreePath, { recursive: true });
    writeCycleWorkItems(cycleWorktreePath, { 'WI-2.md': 'spec v1\n' });

    const startPointRef = headRef(repo);
    const first = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId,
      workItemId,
      startPointRef,
      cycleWorktreePath,
    });

    // Simulate a crash: the worktree dir vanishes out from under git (the
    // registry entry AND the branch are left behind — the exact state a
    // killed dev-loop process would leave).
    rmSync(first.path, { recursive: true, force: true });

    // A later commit lands on main before the retry — proves self-heal
    // recreates the branch at the FRESH start point, not the stale one.
    const laterRef = commitFile(repo, 'later.txt', 'later\n', 'later commit');
    writeCycleWorkItems(cycleWorktreePath, { 'WI-2.md': 'spec v2\n' });

    const second = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId,
      workItemId,
      startPointRef: laterRef,
      cycleWorktreePath,
    });

    assert.ok(existsSync(second.path));
    assert.equal(second.path, first.path, 'same target path across retries');
    assert.equal(second.branch, first.branch, 'same branch name across retries');
    assert.equal(
      branchRef(repo, second.branch),
      laterRef,
      'branch recreated at the NEW start point, not stuck on the stale one',
    );
    assert.ok(existsSync(join(second.path, 'later.txt')));
    assert.equal(
      readFileSync(join(second.path, '.forge', 'work-items', 'WI-2.md'), 'utf8'),
      'spec v2\n',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWiWorktree: honors an explicit startPointRef distinct from the branch tip (file present at ref A, absent at ref B)', () => {
  const { dir, repo } = initRepo();
  try {
    const refA = headRef(repo);
    const refB = commitFile(repo, 'only-in-b.txt', 'b\n', 'add only-in-b');
    assert.notEqual(refA, refB);

    const worktreesRoot = join(dir, '_wt');
    const cycleWorktreePath = join(dir, 'cycle-wt');
    mkdirSync(cycleWorktreePath, { recursive: true });

    const wt = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId: 'INIT-startpoint',
      workItemId: 'WI-5',
      startPointRef: refA,
      cycleWorktreePath,
    });

    assert.equal(
      existsSync(join(wt.path, 'only-in-b.txt')),
      false,
      'a file only present at the LATER ref must be absent when startPointRef is the earlier ref',
    );
    assert.equal(branchRef(repo, wt.branch), refA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeWiWorktree: removes the worktree + branch cleanly, and is idempotent on an already-gone one', () => {
  const { dir, repo } = initRepo();
  try {
    const worktreesRoot = join(dir, '_wt');
    const cycleWorktreePath = join(dir, 'cycle-wt');
    mkdirSync(cycleWorktreePath, { recursive: true });

    const wt = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId: 'INIT-remove',
      workItemId: 'WI-3',
      startPointRef: headRef(repo),
      cycleWorktreePath,
    });
    assert.ok(list(repo).some((w) => resolve(w.path) === resolve(wt.path)));

    removeWiWorktree({ projectRepoPath: repo, path: wt.path, branch: wt.branch, deleteBranch: true });

    assert.equal(existsSync(wt.path), false);
    assert.equal(list(repo).some((w) => resolve(w.path) === resolve(wt.path)), false);
    assert.throws(() =>
      execFileSync('git', ['-C', repo, 'rev-parse', '--verify', wt.branch], { stdio: 'pipe' }),
    );

    // Idempotent — a second call on an already-gone worktree/branch must
    // never throw (per-WI worktrees are pure scratch).
    assert.doesNotThrow(() =>
      removeWiWorktree({ projectRepoPath: repo, path: wt.path, branch: wt.branch, deleteBranch: true }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeWiWorktree: deleteBranch omitted → worktree removed but branch survives', () => {
  const { dir, repo } = initRepo();
  try {
    const worktreesRoot = join(dir, '_wt');
    const cycleWorktreePath = join(dir, 'cycle-wt');
    mkdirSync(cycleWorktreePath, { recursive: true });
    const startPointRef = headRef(repo);

    const wt = createWiWorktree({
      projectRepoPath: repo,
      worktreesRoot,
      initiativeId: 'INIT-keep-branch',
      workItemId: 'WI-4',
      startPointRef,
      cycleWorktreePath,
    });

    removeWiWorktree({ projectRepoPath: repo, path: wt.path, branch: wt.branch });

    assert.equal(existsSync(wt.path), false);
    // Branch survives when deleteBranch is falsy.
    assert.equal(branchRef(repo, wt.branch), startPointRef);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
