/**
 * forge-nk1y.20 — a manifest `worktree_path` is the initiative's OWN forge
 * worktree, `<forgeRoot>/_worktrees/<initiative_id>`, and nothing else.
 *
 * THE DEFECT. `isContainedWorktreePath` used to accept that path OR (a
 * fallback) anything under the projects root, for an "in-place worktree" no
 * production code ever writes (the only writer is `scheduler-run-one.ts`, which
 * always uses `<forgeRoot>/_worktrees/<id>`). The fallback let a manifest name
 * another project's directory, the project repo itself, or any dir under
 * `projects/`, and that path then reached `rmSync` / `git -C` /
 * `git worktree remove --force` in requeue, resume, drain, finalize and cleanup.
 *
 * THIS FILE is the ratchet: a table of escape shapes, each REFUSED by the one
 * kernel predicate with a named reason, each planting a REAL target on disk so a
 * row cannot pass because `realpath` of a missing path happened to throw (the one
 * row that is meant to dangle says so). Mutation proof lives in the commit
 * report: a lexical check in place of the identity walk turns the symlink rows
 * red; re-adding the projects-root fallback turns the projects rows red.
 *
 * DECISIONS recorded here:
 *   - `<root>/_worktrees/<id>/` and `.../<id>/.` ARE the same directory as
 *     `<id>`; `resolve()` normalises them, so they are ACCEPTED (not an escape).
 *   - A not-yet-existing (or already-removed) `_worktrees/<id>` is ACCEPTED: the
 *     finalize and requeue paths legitimately hold the path after the directory
 *     is gone, and nothing exists there to hit.
 *   - `_worktrees` itself being a symlink is REFUSED even when it points at a
 *     real directory: identity, not "somewhere under", is the guarantee.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as kernel from '@forge/kernel';
import { isContainedWorktreePath, validateManifestPathFields } from '../../manifest-path-guard.ts';

const ID = 'INIT-2026-10-10-alpha';
const OTHER = 'INIT-2026-10-10-beta';

type World = { forgeRoot: string; outside: string };
type Row = {
  name: string;
  reason: string;
  /** Plants the real targets and returns the candidate path + the initiative id to judge it for. */
  plant: (w: World) => { p: string; id?: string; mustExist?: boolean };
};

function dir(...parts: string[]): string {
  const d = join(...parts);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SENTINEL'), 'real target');
  return d;
}

function withWorld(fn: (w: World) => void): void {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wt-escapes-')));
  try {
    const forgeRoot = join(base, 'forge');
    const outside = join(base, 'outside');
    mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
    mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    fn({ forgeRoot, outside });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const REFUSED: Row[] = [
  { name: 'sibling project dir', reason: 'not-under-forge-worktrees', plant: (w) => ({ p: dir(w.forgeRoot, 'projects', 'other') }) },
  { name: 'the project repo itself', reason: 'not-under-forge-worktrees', plant: (w) => ({ p: dir(w.forgeRoot, 'projects', 'demo') }) },
  {
    name: 'in-place worktree under a project',
    reason: 'not-under-forge-worktrees',
    plant: (w) => ({ p: dir(w.forgeRoot, 'projects', 'demo', 'worktrees', ID) }),
  },
  { name: 'absolute path elsewhere', reason: 'not-under-forge-worktrees', plant: (w) => ({ p: dir(w.outside, 'elsewhere') }) },
  { name: 'the _worktrees root itself', reason: 'not-under-forge-worktrees', plant: (w) => ({ p: join(w.forgeRoot, '_worktrees') }) },
  {
    name: 'dotdot traversal into another initiative',
    reason: 'not-this-initiative',
    plant: (w) => {
      dir(w.forgeRoot, '_worktrees', ID);
      dir(w.forgeRoot, '_worktrees', OTHER);
      return { p: `${join(w.forgeRoot, '_worktrees', ID)}/../${OTHER}` };
    },
  },
  { name: "another initiative's worktree", reason: 'not-this-initiative', plant: (w) => ({ p: dir(w.forgeRoot, '_worktrees', OTHER) }) },
  { name: 'per-WI worktree shape', reason: 'not-this-initiative', plant: (w) => ({ p: dir(w.forgeRoot, '_worktrees', 'wi', ID, 'WI-1') }) },
  { name: 'sibling sharing the id as a prefix', reason: 'not-this-initiative', plant: (w) => ({ p: dir(w.forgeRoot, '_worktrees', `${ID}-evil`) }) },
  { name: 'subdirectory of the worktree', reason: 'not-this-initiative', plant: (w) => ({ p: dir(w.forgeRoot, '_worktrees', ID, 'sub') }) },
  {
    name: 'relative path (would resolve against cwd)',
    reason: 'not-absolute',
    plant: (w) => {
      dir(w.forgeRoot, '_worktrees', ID);
      return { p: join('_worktrees', ID), mustExist: false };
    },
  },
  { name: 'empty string', reason: 'not-absolute', plant: () => ({ p: '', mustExist: false }) },
  {
    name: 'the worktree is a symlink to an outside dir',
    reason: 'symlink-or-alias',
    plant: (w) => {
      const target = dir(w.outside, 'victim');
      symlinkSync(target, join(w.forgeRoot, '_worktrees', ID), 'dir');
      return { p: join(w.forgeRoot, '_worktrees', ID) };
    },
  },
  {
    name: '_worktrees itself is a symlink to an outside dir that holds a real <id>',
    reason: 'symlink-or-alias',
    plant: (w) => {
      const realWorktrees = join(w.outside, 'moved-worktrees');
      dir(realWorktrees, ID);
      rmSync(join(w.forgeRoot, '_worktrees'), { recursive: true, force: true });
      symlinkSync(realWorktrees, join(w.forgeRoot, '_worktrees'), 'dir');
      return { p: join(w.forgeRoot, '_worktrees', ID) };
    },
  },
  {
    name: "cross-object alias: the worktree is a symlink to another initiative's worktree",
    reason: 'symlink-or-alias',
    plant: (w) => {
      const other = dir(w.forgeRoot, '_worktrees', OTHER);
      symlinkSync(other, join(w.forgeRoot, '_worktrees', ID), 'dir');
      return { p: join(w.forgeRoot, '_worktrees', ID) };
    },
  },
  {
    name: 'dangling symlink (the one row meant to dangle)',
    reason: 'symlink-or-alias',
    plant: (w) => {
      symlinkSync(join(w.outside, 'gone'), join(w.forgeRoot, '_worktrees', ID), 'dir');
      return { p: join(w.forgeRoot, '_worktrees', ID), mustExist: false };
    },
  },
  {
    name: 'unsafe initiative id: parent traversal',
    reason: 'unsafe-initiative-id',
    plant: (w) => ({ p: dir(w.forgeRoot, 'x'), id: '../x' }),
  },
  {
    name: 'unsafe initiative id: nested',
    reason: 'unsafe-initiative-id',
    plant: (w) => ({ p: dir(w.forgeRoot, '_worktrees', 'a', 'b'), id: 'a/b' }),
  },
  {
    name: 'unsafe initiative id: empty',
    reason: 'unsafe-initiative-id',
    plant: (w) => ({ p: join(w.forgeRoot, '_worktrees'), id: '' }),
  },
];

for (const row of REFUSED) {
  test(`worktree_path escape REFUSED (${row.reason}): ${row.name}`, () => {
    withWorld((w) => {
      const { p, id = ID, mustExist = true } = row.plant(w);
      if (mustExist) assert.ok(existsSync(p), `the target must be REAL so the refusal is the guard's, not a missing path's: ${p}`);

      assert.equal(kernel.initiativeWorktreeRefusal(p, { forgeRoot: w.forgeRoot, initiativeId: id }), row.reason);
      assert.equal(isContainedWorktreePath(p, { forgeRoot: w.forgeRoot, initiativeId: id }), false);

      if (p !== '') {
        const errors = validateManifestPathFields({ initiative_id: id, worktree_path: p }, { forgeRoot: w.forgeRoot });
        assert.equal(errors.length, 1, JSON.stringify(errors));
        assert.match(errors[0]!, new RegExp(`^worktree_path refused \\(${row.reason}\\): must be the initiative's own forge worktree _worktrees/<initiative_id>$`));
        assert.ok(!errors[0]!.includes(w.forgeRoot), 'the refusal never echoes a resolved path');
      }
    });
  });
}

test('worktree_path escape REFUSED: a path under a CONFIGURED projects root outside the forge root (FORGE_PROJECTS_DIR) is no longer a worktree', () => {
  withWorld((w) => {
    const projects = join(w.outside, 'my-projects');
    const target = dir(projects, 'demo', 'worktrees', ID);
    const saved = process.env.FORGE_PROJECTS_DIR;
    process.env.FORGE_PROJECTS_DIR = projects;
    try {
      assert.ok(existsSync(target));
      assert.equal(isContainedWorktreePath(target, { forgeRoot: w.forgeRoot, initiativeId: ID }), false);
      assert.equal(kernel.initiativeWorktreeRefusal(target, { forgeRoot: w.forgeRoot, initiativeId: ID }), 'not-under-forge-worktrees');
    } finally {
      if (saved === undefined) delete process.env.FORGE_PROJECTS_DIR;
      else process.env.FORGE_PROJECTS_DIR = saved;
    }
  });
});

test('worktree_path escape REFUSED: a relative path is refused even with cwd at the forge root (the cwd-dependence stays closed)', () => {
  withWorld((w) => {
    dir(w.forgeRoot, '_worktrees', ID);
    const cwd = process.cwd();
    process.chdir(w.forgeRoot);
    try {
      assert.ok(existsSync(join('_worktrees', ID)), 'the relative path resolves to a REAL dir from this cwd');
      assert.equal(kernel.initiativeWorktreeRefusal(join('_worktrees', ID), { forgeRoot: w.forgeRoot, initiativeId: ID }), 'not-absolute');
    } finally {
      process.chdir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// Positive controls — without these a predicate that refuses everything passes.
// ---------------------------------------------------------------------------

test('worktree_path ACCEPTED: the initiative\'s own real _worktrees/<id>', () => {
  withWorld((w) => {
    const p = dir(w.forgeRoot, '_worktrees', ID);
    assert.equal(kernel.initiativeWorktreeRefusal(p, { forgeRoot: w.forgeRoot, initiativeId: ID }), null);
    assert.equal(isContainedWorktreePath(p, { forgeRoot: w.forgeRoot, initiativeId: ID }), true);
    assert.deepEqual(validateManifestPathFields({ initiative_id: ID, worktree_path: p }, { forgeRoot: w.forgeRoot }), []);
  });
});

test('worktree_path ACCEPTED: trailing-slash and trailing-dot forms are the SAME directory (resolve() normalises them)', () => {
  withWorld((w) => {
    const p = dir(w.forgeRoot, '_worktrees', ID);
    for (const form of [`${p}/`, `${p}/.`]) {
      assert.equal(kernel.initiativeWorktreeRefusal(form, { forgeRoot: w.forgeRoot, initiativeId: ID }), null, form);
    }
  });
});

test('worktree_path ACCEPTED: an already-removed _worktrees/<id> (finalize/requeue still hold the path; nothing is there to hit)', () => {
  withWorld((w) => {
    const p = join(w.forgeRoot, '_worktrees', ID);
    assert.ok(!existsSync(p));
    assert.equal(kernel.initiativeWorktreeRefusal(p, { forgeRoot: w.forgeRoot, initiativeId: ID }), null);
  });
});

test('worktree_path ACCEPTED: a legitimately symlinked forge checkout still works (the root is trusted; only segments are identity-checked)', () => {
  withWorld((w) => {
    dir(w.forgeRoot, '_worktrees', ID);
    const link = join(w.outside, 'forge-link');
    symlinkSync(w.forgeRoot, link, 'dir');
    assert.equal(kernel.initiativeWorktreeRefusal(join(link, '_worktrees', ID), { forgeRoot: link, initiativeId: ID }), null);
  });
});
