/**
 * Measured data-loss defect (real project, `.gitignore` blanket-ignores
 * `.forge/`, skills tracked at `forge/skills/<id>/`): `forge project reset
 * --apply` produced a commit that DELETED the nine tracked
 * `forge/skills/<id>/SKILL.md` sources and added NOTHING — the relocated
 * `.forge/skills/<id>/SKILL.md` and `.forge/project.json` were still
 * git-ignored at the moment `commitStudioChange`'s `git add -- <paths>` ran
 * (`allowFail: true` swallows git's "paths are ignored" failure), so they
 * were silently skipped from the commit. The `.gitignore` fix landed in a
 * SECOND, later commit — too late to help the first. A fresh clone of that
 * HEAD has no skills at all.
 *
 * Two independent fixes, two independent tests:
 *   A. `applyContractReset` commits the `.gitignore` fix FIRST, so the
 *      working tree's ignore rules are already correct by the time the
 *      contract/skills commit's `git add` runs.
 *   B. `commitStudioChange`, given an explicit `paths` list, fails LOUD if
 *      git refuses to stage a path that still exists on disk — never a
 *      silent drop — independent, defence-in-depth backstop for A.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeContractDrift, applyContractReset } from '../../reset.ts';
import { commitStudioChange, ensureStudioBranch, StudioWritePathIgnoredError } from '../../project-repo-tx.ts';
import { projectStartersDir } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-tracked-commit-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/** A real, on-disk git repo shaped exactly like the measured defect: a
 *  blanket `.forge/` ignore, two skills tracked at the drifted
 *  `forge/skills/<id>/SKILL.md` location, and `.forge/project.json`
 *  untracked+ignored (declaring the same two skills, `artifactRoot: "forge"`
 *  — mirrors `reset-drift-report.test.ts`'s `driftedProjectTree`). */
function blanketIgnoredTrackedSkillsRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-tracked-commit-project-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@forge.dev']);
  g(dir, ['config', 'user.name', 'Forge Test']);

  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.forge/\n');

  mkdirSync(join(dir, 'forge', 'skills', 'a'), { recursive: true });
  writeFileSync(join(dir, 'forge', 'skills', 'a', 'SKILL.md'), '# skill a\n', 'utf8');
  mkdirSync(join(dir, 'forge', 'skills', 'b'), { recursive: true });
  writeFileSync(join(dir, 'forge', 'skills', 'b', 'SKILL.md'), '# skill b\n', 'utf8');

  g(dir, ['add', '--', '.gitignore', 'forge/skills/a/SKILL.md', 'forge/skills/b/SKILL.md']);
  g(dir, ['commit', '-m', 'init: tracked skills at the drifted location']);

  // `.forge/project.json` is written AFTER the initial commit, exactly like
  // a real project's config: untracked AND ignored by the blanket `.forge/`
  // line the moment it exists.
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify(
      {
        name: 'tracked-commit-fixture',
        artifactRoot: 'forge',
        testProcess: { local: { cmd: ['echo', 'ok'] } },
        skills: ['a', 'b'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return dir;
}

test('applyContractReset: on a repo whose .gitignore blanket-ignores .forge/, HEAD tracks the relocated skills + project.json, and forge/skills is gone', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = blanketIgnoredTrackedSkillsRepo();
  try {
    const drift = computeContractDrift(dir, { forgeRoot, appType: 'cli' });
    assert.equal(drift.gitignoreDrift.action, 'regenerate', 'fixture precondition: the blanket .forge/ line must be drift-visible');
    assert.equal(drift.skillMoves.length, 2, 'fixture precondition: both skills must be reported as needing relocation');

    applyContractReset(dir, drift);

    // HEAD (the forge-studio branch applyContractReset commits to) must
    // track BOTH relocated SKILL.md files and .forge/project.json...
    const skillFiles = g(dir, ['ls-files', '.forge/skills']).split('\n').filter(Boolean);
    assert.deepEqual(
      skillFiles.sort(),
      ['.forge/skills/a/SKILL.md', '.forge/skills/b/SKILL.md'],
      `expected both relocated SKILL.md files tracked on HEAD, got: ${skillFiles.join(', ')}`,
    );
    assert.notEqual(g(dir, ['ls-files', '.forge/project.json']), '', '.forge/project.json must be tracked on HEAD');

    // ...and must NOT still track the old drifted location.
    assert.equal(g(dir, ['ls-files', 'forge/skills']), '', 'forge/skills must no longer be tracked on HEAD');

    // Nothing left dangling in the working tree either.
    const porcelain = g(dir, ['status', '--porcelain']);
    for (const p of ['.forge/project.json', '.forge/skills/a/SKILL.md', '.forge/skills/b/SKILL.md', 'forge/skills']) {
      assert.equal(porcelain.includes(p), false, `git status --porcelain must not mention ${p}, got:\n${porcelain}`);
    }

    // Content survived the move byte-for-byte.
    assert.equal(g(dir, ['show', 'HEAD:.forge/skills/a/SKILL.md']), '# skill a', 'content must survive the relocation unchanged');
    assert.equal(g(dir, ['show', 'HEAD:.forge/skills/b/SKILL.md']), '# skill b', 'content must survive the relocation unchanged');

    // A fresh clone of this HEAD must have the skills — the defect's own
    // reproduction check ("a fresh clone of that HEAD has no skills at all").
    const clone = mkdtempSync(join(tmpdir(), 'reset-tracked-commit-clone-'));
    try {
      execFileSync('git', ['clone', '-q', '--branch', 'forge-studio', dir, clone]);
      assert.equal(
        readFileSync(join(clone, '.forge', 'skills', 'a', 'SKILL.md'), 'utf8'),
        '# skill a\n',
        'a fresh clone of HEAD must have the relocated skill',
      );
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commitStudioChange: an explicitly-listed path that git refuses to stage (still ignored) throws StudioWritePathIgnoredError naming it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-studio-ignored-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
    g(dir, ['config', 'user.email', 'test@forge.dev']);
    g(dir, ['config', 'user.name', 'Forge Test']);
    writeFileSync(join(dir, '.gitignore'), 'blocked/\n');
    writeFileSync(join(dir, 'README.md'), '# x\n');
    g(dir, ['add', '-A']);
    g(dir, ['commit', '-m', 'init']);

    ensureStudioBranch(dir);
    mkdirSync(join(dir, 'blocked'), { recursive: true });
    writeFileSync(join(dir, 'blocked', 'file.txt'), 'hello\n', 'utf8');

    assert.throws(
      () => commitStudioChange(dir, 'forge-studio: write an ignored path', ['blocked/file.txt']),
      (err: unknown) => {
        assert.ok(err instanceof StudioWritePathIgnoredError, `expected StudioWritePathIgnoredError, got: ${err}`);
        assert.ok((err as StudioWritePathIgnoredError).paths.includes('blocked/file.txt'), `error must name the ignored path: ${err}`);
        return true;
      },
    );

    // Nothing must have been committed — the throw is fail-closed, not
    // fail-open-with-a-partial-commit.
    const log = execFileSync('git', ['-C', dir, 'log', '--oneline', 'forge-studio'], { encoding: 'utf8' }).trim();
    assert.equal(log.split('\n').length, 1, `expected no new commit beyond the branch point, got:\n${log}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commitStudioChange: a listed path that legitimately does not exist on disk (e.g. a move source already gone) still commits fine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-studio-gone-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
    g(dir, ['config', 'user.email', 'test@forge.dev']);
    g(dir, ['config', 'user.name', 'Forge Test']);
    writeFileSync(join(dir, 'moved.txt'), 'x\n');
    g(dir, ['add', '-A']);
    g(dir, ['commit', '-m', 'init']);

    ensureStudioBranch(dir);
    // Plain filesystem move — mirrors `guardedRename` (a bare `fs.renameSync`,
    // never a `git mv`), so `moved.txt` is gone from disk but still TRACKED
    // in the index, exactly the "move source already gone" shape.
    rmSync(join(dir, 'moved.txt'));
    writeFileSync(join(dir, 'moved-to.txt'), 'x\n', 'utf8');

    const committed = commitStudioChange(dir, 'forge-studio: move', ['moved.txt', 'moved-to.txt']);
    assert.equal(committed, true);
    const tree = g(dir, ['ls-tree', '--name-only', 'forge-studio']);
    assert.ok(tree.includes('moved-to.txt') && !tree.includes('moved.txt'), `expected the move committed cleanly, got tree: ${tree}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
