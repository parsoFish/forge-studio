/**
 * SEAM F1 (operator ruling item 81), extended to skills: `skillPath`,
 * `guardedSkillMdPath` and `listSkillDirs` (packages/library/skill-path.ts)
 * must resolve/enumerate across every skill root (`@forge/kernel`'s
 * `skillRoots`) — `skills/` AND every `packages/<pkg>/skills/` — so a
 * package-owned skill that appears in the agent roster (already covered by
 * `packages/agents/tests/unit/agent-registry-multi-root.test.ts`) is also
 * READABLE and LINTABLE through the same primitives every other skill read
 * goes through.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { skillPath, guardedSkillMdPath, listSkillDirs } from '../../skill-path.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'lib-skill-path-package-roots-'));
}

function withFixtureRoot(build: (root: string) => void, run: (root: string) => void): void {
  const root = tmpRoot();
  try {
    build(root);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seedTwoRootFixture(root: string): void {
  mkdirSync(join(root, 'skills', 'operator-skill'), { recursive: true });
  writeFileSync(join(root, 'skills', 'operator-skill', 'SKILL.md'), '# operator-skill\n');
  mkdirSync(join(root, 'packages', 'demo-pkg', 'skills', 'x'), { recursive: true });
  writeFileSync(join(root, 'packages', 'demo-pkg', 'skills', 'x', 'SKILL.md'), '# x\n');
}

describe('skillPath — package roots', () => {
  test('resolves a package-owned skill to its package path', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(skillPath('x', root), join(root, 'packages', 'demo-pkg', 'skills', 'x', 'SKILL.md'));
    });
  });

  test('still resolves an operator-owned skill to its skills/ path', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(skillPath('operator-skill', root), join(root, 'skills', 'operator-skill', 'SKILL.md'));
    });
  });

  test('falls back to the skills/ path for an unknown name (unchanged pre-seam behavior)', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(skillPath('missing', root), join(root, 'skills', 'missing', 'SKILL.md'));
    });
  });

  test('THROWS naming both paths when a slug resolves under two roots', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(join(root, 'skills', 'dup'), { recursive: true });
        writeFileSync(join(root, 'skills', 'dup', 'SKILL.md'), '# dup\n');
        mkdirSync(join(root, 'packages', 'demo-pkg', 'skills', 'dup'), { recursive: true });
        writeFileSync(join(root, 'packages', 'demo-pkg', 'skills', 'dup', 'SKILL.md'), '# dup\n');
      },
      (root) => {
        assert.throws(
          () => skillPath('dup', root),
          (err: Error) =>
            err.message.includes(join(root, 'skills', 'dup', 'SKILL.md')) &&
            err.message.includes(join(root, 'packages', 'demo-pkg', 'skills', 'dup', 'SKILL.md')),
        );
      },
    );
  });
});

describe('guardedSkillMdPath — package roots', () => {
  test('resolves a package-owned skill (containment-checked)', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(guardedSkillMdPath('x', root), join(root, 'packages', 'demo-pkg', 'skills', 'x', 'SKILL.md'));
    });
  });

  test('returns null for an unknown name (never fabricates a path)', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      assert.equal(guardedSkillMdPath('missing', root), null);
    });
  });
});

describe('listSkillDirs — package roots', () => {
  test('unions an operator skill and a package-owned skill', () => {
    withFixtureRoot(seedTwoRootFixture, (root) => {
      const names = listSkillDirs(root).map((d) => d.split('/').pop());
      assert.deepEqual(names.sort(), ['operator-skill', 'x']);
    });
  });

  test('THROWS naming both roots when the same slug exists under two roots', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(join(root, 'skills', 'dup'), { recursive: true });
        writeFileSync(join(root, 'skills', 'dup', 'SKILL.md'), '# dup\n');
        mkdirSync(join(root, 'packages', 'demo-pkg', 'skills', 'dup'), { recursive: true });
        writeFileSync(join(root, 'packages', 'demo-pkg', 'skills', 'dup', 'SKILL.md'), '# dup\n');
      },
      (root) => {
        assert.throws(
          () => listSkillDirs(root),
          (err: Error) =>
            err.message.includes(join(root, 'skills', 'dup')) &&
            err.message.includes(join(root, 'packages', 'demo-pkg', 'skills', 'dup')),
        );
      },
    );
  });
});
