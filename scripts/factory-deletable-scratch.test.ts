/**
 * bead forge-8vfn.6.10.21 — the deletability proof must not delete the tree it
 * is run against.
 *
 * WHAT WENT WRONG. `factory-deletable.mjs`'s first shape called `rmSync` on
 * `packages/factory` and `node_modules/@forge/factory` IN PLACE. CI's checkout
 * is ephemeral, so CI never noticed; `gate.sh` replicates every `ci.yml` step in
 * a PERSISTENT worktree, so one green gate left that worktree with no example
 * package and the next gate failed the build, 32 tests and four guards on empty
 * populations. These pins are the property that was missing: the caller's tree
 * survives, and it is asserted against a fixture repo rather than against the
 * real one, so the test itself cannot be the thing that breaks a worktree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFactorylessWorktree, isFactoryless, porcelain } from './factory-deletable-scratch.mjs';

/** A minimal git repo shaped like forge: packages/factory + a sibling, and the workspace links. */
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'deletable-fixture-'));
  mkdirSync(join(root, 'packages', 'factory'), { recursive: true });
  mkdirSync(join(root, 'packages', 'kernel'), { recursive: true });
  writeFileSync(join(root, 'packages', 'factory', 'index.ts'), 'export const example = 1;\n');
  writeFileSync(join(root, 'packages', 'kernel', 'index.ts'), 'export const platform = 1;\n');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'fixture']);
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture']);
  // The workspace links, as npm lays them out: relative, one level of @scope.
  mkdirSync(join(root, 'node_modules', '@forge'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'third-party'), { recursive: true });
  symlinkSync('../../packages/factory', join(root, 'node_modules', '@forge', 'factory'));
  symlinkSync('../../packages/kernel', join(root, 'node_modules', '@forge', 'kernel'));
  return root;
}

test('kills "the proof deletes the tree it is run against": the fixture keeps its packages/factory, and its worktree is clean afterwards', () => {
  const root = fixtureRepo();
  try {
    assert.equal(porcelain(root, 'packages/factory'), '', 'precondition: the fixture is clean');

    const { dir, cleanup } = createFactorylessWorktree(root);
    try {
      // THE PIN. This is the assertion whose absence broke a gate worktree.
      assert.equal(existsSync(join(root, 'packages', 'factory', 'index.ts')), true, 'the ROOT keeps its example package');
      assert.equal(existsSync(join(root, 'node_modules', '@forge', 'factory')), true, 'and its workspace link');
      assert.equal(porcelain(root, 'packages/factory'), '', 'and git sees no deletion in the root');
    } finally {
      cleanup();
    }

    assert.equal(existsSync(join(root, 'packages', 'factory', 'index.ts')), true, 'still there after cleanup');
    assert.equal(porcelain(root, 'packages/factory'), '', 'and still clean after cleanup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('kills "the scratch tree still resolves the factory": it has neither the package nor a link to one, while its siblings resolve INTO it', () => {
  const root = fixtureRepo();
  try {
    const { dir, cleanup } = createFactorylessWorktree(root);
    try {
      assert.equal(isFactoryless(dir), true, 'the scratch tree is the one without the example');
      // The sibling link must point at the SCRATCH tree, not back at the root —
      // otherwise the proof runs against the root's modules and proves nothing.
      assert.equal(existsSync(join(dir, 'node_modules', '@forge', 'kernel', 'index.ts')), true, 'a sibling package resolves');
      assert.equal(existsSync(join(dir, 'packages', 'kernel', 'index.ts')), true, 'and it is the scratch copy it resolves to');
      assert.equal(existsSync(join(dir, 'node_modules', 'third-party')), true, 'third-party entries resolve through the root');
    } finally {
      cleanup();
    }
    assert.equal(existsSync(dir), false, 'cleanup removes the scratch tree');
    const worktrees = execFileSync('git', ['-C', root, 'worktree', 'list'], { encoding: 'utf8' });
    assert.equal(worktrees.includes(dir), false, 'and deregisters it, so the root keeps no stale worktree');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('kills "a failed setup leaves a worktree behind": the scratch tree is registered and removed as one unit', () => {
  const root = fixtureRepo();
  try {
    const before = execFileSync('git', ['-C', root, 'worktree', 'list'], { encoding: 'utf8' }).split('\n').length;
    const { cleanup } = createFactorylessWorktree(root);
    cleanup();
    const after = execFileSync('git', ['-C', root, 'worktree', 'list'], { encoding: 'utf8' }).split('\n').length;
    assert.equal(after, before, 'the worktree list is where it started');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
