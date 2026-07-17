import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  STUDIO_BRANCH,
  ensureStudioBranch,
  commitStudioChange,
  withStudioWrite,
  saveProjectRepo,
  hasPendingStudioChanges,
  defaultBranch,
  isGitRepo,
} from './project-repo-tx.ts';

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/** A git repo with a `main` branch + one commit, no remote. */
function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'proj-tx-'));
  execFileSync('git', ['-C', dir, 'init', '-b', 'main'], { stdio: 'ignore' });
  g(dir, ['config', 'user.email', 'test@forge.dev']);
  g(dir, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(dir, 'README.md'), '# project\n');
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-m', 'init']);
  return dir;
}

test('ensureStudioBranch creates forge-studio from the default branch', () => {
  const dir = setupRepo();
  try {
    assert.equal(defaultBranch(dir), 'main');
    ensureStudioBranch(dir);
    assert.equal(g(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), STUDIO_BRANCH);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withStudioWrite commits the change to forge-studio, leaving main untouched until save', () => {
  const dir = setupRepo();
  try {
    withStudioWrite(dir, 'forge-studio: add AGENTS.md', () => {
      writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
    }, ['AGENTS.md']);

    // On forge-studio, the file is committed.
    assert.equal(g(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), STUDIO_BRANCH);
    assert.match(g(dir, ['log', '-1', '--pretty=%s']), /add AGENTS\.md/);
    assert.equal(hasPendingStudioChanges(dir), true);
    // main does not have it yet.
    assert.equal(g(dir, ['ls-tree', '--name-only', 'main']).includes('AGENTS.md'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveProjectRepo merges forge-studio into main (no remote → local), deletes the branch', () => {
  const dir = setupRepo();
  try {
    withStudioWrite(dir, 'forge-studio: add config', () => {
      writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
    }, ['AGENTS.md']);

    const r = saveProjectRepo(dir);
    assert.equal(r.merged, true);
    assert.equal(r.pushed, false, 'no origin → not pushed');
    assert.match(r.detail, /local only/);
    // Now on main, with the file merged in, and forge-studio gone.
    assert.equal(g(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.equal(g(dir, ['ls-tree', '--name-only', 'main']).includes('AGENTS.md'), true);
    try { g(dir, ['rev-parse', '--verify', STUDIO_BRANCH]); assert.fail('forge-studio should be deleted'); } catch { /* expected */ }
    assert.equal(hasPendingStudioChanges(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accumulates multiple writes on the one branch, merged by a single save', () => {
  const dir = setupRepo();
  try {
    withStudioWrite(dir, 'forge-studio: write 1', () => writeFileSync(join(dir, 'a.txt'), '1\n'), ['a.txt']);
    withStudioWrite(dir, 'forge-studio: write 2', () => writeFileSync(join(dir, 'b.txt'), '2\n'), ['b.txt']);
    const r = saveProjectRepo(dir);
    assert.equal(r.merged, true);
    const tree = g(dir, ['ls-tree', '--name-only', 'main']);
    assert.ok(tree.includes('a.txt') && tree.includes('b.txt'), 'both writes merged by one save');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commitStudioChange -A excludes forge scratch/session dirs', () => {
  const dir = setupRepo();
  try {
    ensureStudioBranch(dir);
    writeFileSync(join(dir, 'keep.txt'), 'keep\n');
    mkdirSync(join(dir, '_demo', 'sess'), { recursive: true });
    writeFileSync(join(dir, '_demo', 'sess', 'status.json'), '{}');
    commitStudioChange(dir, 'forge-studio: scoped');
    const tree = g(dir, ['ls-tree', '-r', '--name-only', STUDIO_BRANCH]);
    assert.ok(tree.includes('keep.txt'), 'real file committed');
    assert.equal(tree.includes('_demo'), false, 'scratch session dir excluded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no-op on a non-git dir; save reports nothing pending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proj-tx-nogit-'));
  try {
    assert.equal(isGitRepo(dir), false);
    ensureStudioBranch(dir); // no throw
    assert.equal(commitStudioChange(dir, 'x'), false);
    assert.deepEqual(saveProjectRepo(dir), { merged: false, pushed: false, detail: 'not a git repo' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('save with no pending forge-studio branch is a no-op', () => {
  const dir = setupRepo();
  try {
    const r = saveProjectRepo(dir);
    assert.equal(r.merged, false);
    assert.match(r.detail, /no pending/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R5-01 Defect B (2026-07-18): a managed project dir with NO `.git` of its
// own, nested inside an OUTER git repo (exactly how `projects/<name>` sits
// inside the forge repo/worktree), must never trigger a branch checkout —
// `git rev-parse --git-dir` succeeds for such a dir (git walks upward to
// find `.git`), which previously made `isGitRepo` wrongly report `true` and
// `ensureStudioBranch` ran `git checkout forge-studio` against the OUTER
// repo, moving ITS HEAD.
// ---------------------------------------------------------------------------

/** An outer git repo (with a `main` branch + one commit) containing a
 *  nested subdirectory that has NO `.git` of its own. */
function setupNestedNoGitProject(): { outerDir: string; nestedDir: string } {
  const outerDir = mkdtempSync(join(tmpdir(), 'proj-tx-outer-'));
  execFileSync('git', ['-C', outerDir, 'init', '-b', 'main'], { stdio: 'ignore' });
  g(outerDir, ['config', 'user.email', 'test@forge.dev']);
  g(outerDir, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(outerDir, 'README.md'), '# outer\n');
  g(outerDir, ['add', '-A']);
  g(outerDir, ['commit', '-m', 'init']);

  const nestedDir = join(outerDir, 'projects', 'nested-no-git');
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(join(nestedDir, 'project.json'), '{}');
  g(outerDir, ['add', '-A']);
  g(outerDir, ['commit', '-m', 'add nested project']);
  return { outerDir, nestedDir };
}

test('isGitRepo is false for a dir nested inside an outer repo with no .git of its own', () => {
  const { outerDir, nestedDir } = setupNestedNoGitProject();
  try {
    assert.equal(isGitRepo(nestedDir), false);
  } finally {
    rmSync(outerDir, { recursive: true, force: true });
  }
});

test('ensureStudioBranch/withStudioWrite on a nested no-.git project dir does not move the outer repo HEAD', () => {
  const { outerDir, nestedDir } = setupNestedNoGitProject();
  try {
    const outerHeadBefore = g(outerDir, ['rev-parse', 'HEAD']);
    const outerBranchBefore = g(outerDir, ['rev-parse', '--abbrev-ref', 'HEAD']);

    ensureStudioBranch(nestedDir); // must no-op, not throw
    assert.equal(g(outerDir, ['rev-parse', 'HEAD']), outerHeadBefore, 'outer repo HEAD sha unmoved');
    assert.equal(g(outerDir, ['rev-parse', '--abbrev-ref', 'HEAD']), outerBranchBefore, 'outer repo branch unmoved');
    // The outer repo must not have gained a forge-studio branch either.
    try {
      g(outerDir, ['rev-parse', '--verify', STUDIO_BRANCH]);
      assert.fail('outer repo should not have a forge-studio branch');
    } catch { /* expected */ }

    withStudioWrite(nestedDir, 'forge-studio: edit', () => {
      writeFileSync(join(nestedDir, 'project.json'), '{"touched":true}');
    }, ['project.json']);
    assert.equal(g(outerDir, ['rev-parse', 'HEAD']), outerHeadBefore, 'outer repo HEAD still unmoved after withStudioWrite');
    assert.equal(g(outerDir, ['rev-parse', '--abbrev-ref', 'HEAD']), outerBranchBefore, 'outer repo branch still unmoved');

    const r = saveProjectRepo(nestedDir);
    assert.deepEqual(r, { merged: false, pushed: false, detail: 'not a git repo' });
  } finally {
    rmSync(outerDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// G8 wave 2 (2026-07-12): forge-studio writes are orchestrator-issued (no
// agent in the loop) — the commit AND the save-merge must carry
// forge-orchestrator identity via -c flags, not the `test@forge.dev`/
// `Forge Test` local identity `setupRepo` configures (deliberately distinct,
// so this proves the override rather than a passive match).
// ---------------------------------------------------------------------------

test('withStudioWrite: the forge-studio commit carries forge-orchestrator identity', () => {
  const dir = setupRepo();
  try {
    withStudioWrite(dir, 'forge-studio: add AGENTS.md', () => {
      writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
    }, ['AGENTS.md']);

    assert.equal(g(dir, ['log', '-1', '--pretty=%an']), 'forge-orchestrator');
    assert.equal(g(dir, ['log', '-1', '--pretty=%ae']), 'forge-orchestrator@forge.local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveProjectRepo: the merge commit onto main carries forge-orchestrator identity', () => {
  const dir = setupRepo();
  try {
    withStudioWrite(dir, 'forge-studio: add config', () => {
      writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
    }, ['AGENTS.md']);

    const r = saveProjectRepo(dir);
    assert.equal(r.merged, true);
    assert.equal(g(dir, ['log', '-1', '--pretty=%an']), 'forge-orchestrator');
    assert.equal(g(dir, ['log', '-1', '--pretty=%ae']), 'forge-orchestrator@forge.local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
