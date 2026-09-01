/**
 * Acceptance tests for `packages/library/skill-path.ts` — the skills-directory
 * layout half of `packages/agents/skill-path.ts`, quarried into library in
 * M4-library PR 2 (T1 ruling, park #1 Q3).
 *
 * WHY LIBRARY. Spec §3.1 gives library the Skill kind; `skills/<id>/SKILL.md`
 * is that kind's on-disk layout. `agents`, `sessions`, `flows` and `factory`
 * all sit ABOVE library in `PACKAGE_RANK` (check-boundaries.mjs:47) and may
 * import it; the id vocabulary and the slug guard went to `@forge/kernel`
 * instead, because `orchestrator/studio/validate.ts` re-exports those to
 * validate projects and KBs, which are not library's.
 *
 * RED BEFORE THE MOVE: `Cannot find module '../../skill-path.ts'`.
 *
 * The three property assertions below (relative-by-contract, SKILL.md-bearing
 * filter, guard inherited) are the ones that would go silently wrong in a move
 * and that no type-check would catch.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, test } from 'node:test';

import {
  skillsDir,
  skillDir,
  skillPath,
  skillPathRelative,
  listSkillMdDirs,
  listSkillDirs,
} from '../../skill-path.ts';

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'lib-skill-path-'));
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true });
  writeFileSync(join(root, 'skills', 'alpha', 'SKILL.md'), '# alpha\n');
  mkdirSync(join(root, 'skills', 'beta'), { recursive: true });
  writeFileSync(join(root, 'skills', 'beta', 'SKILL.md'), '# beta\n');
  // A directory with NO SKILL.md — the filter's whole job.
  mkdirSync(join(root, 'skills', 'not-a-skill'), { recursive: true });
  // A FILE named like a skill — `withFileTypes` must exclude it.
  writeFileSync(join(root, 'skills', 'stray.md'), 'x');
  return root;
}

describe('library/skill-path — layout, parameterized by root', () => {
  test('skillsDir/skillDir/skillPath compose the one literal `skills` segment', () => {
    const root = tree();
    assert.equal(skillsDir(root), join(root, 'skills'));
    assert.equal(skillDir('alpha', root), join(root, 'skills', 'alpha'));
    assert.equal(skillPath('alpha', root), join(root, 'skills', 'alpha', 'SKILL.md'));
    assert.ok(isAbsolute(skillPath('alpha', root)));
  });

  // Kills: a move that made skillPathRelative resolve against a root. Its
  // return value is echoed verbatim into `PhaseAgentSpec.skill`, which is
  // root-relative BY CONTRACT — an absolute path there leaks a worktree path
  // into the portable event log.
  test('skillPathRelative is relative regardless of anything', () => {
    const rel = skillPathRelative('alpha');
    assert.equal(rel, join('skills', 'alpha', 'SKILL.md'));
    assert.ok(!isAbsolute(rel));
  });

  // Kills: a move that dropped the SKILL.md existence filter, or that stopped
  // excluding plain files — either turns a stray directory into a "skill".
  test('listSkillMdDirs keeps only SKILL.md-bearing SUBDIRECTORIES, sorted', () => {
    const root = tree();
    const found = listSkillMdDirs(join(root, 'skills'));
    assert.deepEqual(found, [join(root, 'skills', 'alpha'), join(root, 'skills', 'beta')]);
  });

  test('listSkillMdDirs returns [] for an absent or unreadable directory rather than throwing', () => {
    assert.deepEqual(listSkillMdDirs(join(tmpdir(), 'definitely-not-here-' + Date.now())), []);
  });

  test('listSkillDirs is listSkillMdDirs over <root>/skills', () => {
    const root = tree();
    assert.deepEqual(listSkillDirs(root), listSkillMdDirs(join(root, 'skills')));
  });
});

describe('library/skill-path — the slug guard is INHERITED, not re-implemented', () => {
  // Kills: a move that dropped assertSkillSlug from the path builders. A naive
  // join lets `.` collapse to skillsDir itself, `..` escape it, and `sub/evil`
  // open an orphan directory listSkillDirs never discovers. This is the whole
  // reason the resolver exists (R3-01-F4, adversarial re-review, Blocker 1).
  for (const bad of ['.', '..', 'sub/evil', 'a\\b', '/etc/passwd', '']) {
    test(`skillDir/skillPath/skillPathRelative all refuse ${JSON.stringify(bad)}`, () => {
      assert.throws(() => skillDir(bad, '/tmp'), /invalid skill id/);
      assert.throws(() => skillPath(bad, '/tmp'), /invalid skill id/);
      assert.throws(() => skillPathRelative(bad), /invalid skill id/);
    });
  }

  test('the guard is kernel\'s single definition, not a second copy', async () => {
    const kernel = await import('@forge/kernel/ids.ts');
    const lib = await import('../../skill-path.ts');
    // library must not re-export a slug regex of its own; the one rule lives
    // in kernel and library composes it.
    assert.equal(Object.keys(lib).includes('SLUG_RE'), false);
    assert.equal(typeof kernel.assertSkillSlug, 'function');
  });
});
