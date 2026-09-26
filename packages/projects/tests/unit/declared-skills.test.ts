/**
 * Tests for `loadDeclaredSkills` (forge item 90 / ADR 024) — the loader half
 * of the SKILLS clause (`preflight-skills.ts`'s `checkSkills`), which only
 * ever checked EXISTENCE. This is the shared resolver + content reader every
 * agent builder (runAgent, createClaudeAgent) reads through, so a project's
 * declared `.forge/project.json` `skills[]` actually reaches the agent
 * instead of being a fact preflight confirms and nothing else reads.
 *
 * `checkSkills` must resolve through the SAME `resolveDeclaredSkillPath` this
 * file also exercises — one rule, never two copies (see
 * `preflight-skills.test.ts`'s existing coverage of `checkSkills` itself).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadDeclaredSkills, resolveDeclaredSkillPath, MissingDeclaredSkillError } from '../../preflight-skills.ts';
import { PRESENTATION_ONLY_SKILL_IDS } from '@forge/contracts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'forge-declared-skills-'));
}

function declareProject(dir: string, skills: string[]): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills }),
  );
}

test('loadDeclaredSkills: no skills declared — returns []', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    declareProject(dir, []);
    assert.deepEqual(loadDeclaredSkills(dir, forgeRoot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadDeclaredSkills: no project.json at all — returns [] (same as no skills declared)', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    assert.deepEqual(loadDeclaredSkills(dir, forgeRoot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadDeclaredSkills: resolves PROJECT-LOCAL over forge-wide when both exist, and reads its content', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    declareProject(dir, ['dual-skill']);
    mkdirSync(join(dir, '.forge', 'skills', 'dual-skill'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'dual-skill', 'SKILL.md'), '# project-local\n');
    mkdirSync(join(forgeRoot, 'skills', 'dual-skill'), { recursive: true });
    writeFileSync(join(forgeRoot, 'skills', 'dual-skill', 'SKILL.md'), '# forge-wide\n');

    const loaded = loadDeclaredSkills(dir, forgeRoot);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.id, 'dual-skill');
    assert.equal(loaded[0]!.text, '# project-local\n');
    assert.match(loaded[0]!.path, /\.forge[/\\]skills[/\\]dual-skill[/\\]SKILL\.md$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadDeclaredSkills: falls back to forge-wide when no project-local skill exists', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    declareProject(dir, ['reflector']);
    mkdirSync(join(forgeRoot, 'skills', 'reflector'), { recursive: true });
    writeFileSync(join(forgeRoot, 'skills', 'reflector', 'SKILL.md'), '# reflector\n');

    const loaded = loadDeclaredSkills(dir, forgeRoot);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.text, '# reflector\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadDeclaredSkills: a declared id that resolves NOWHERE throws a named error naming the id — fail fast, no silent skip', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    declareProject(dir, ['ghost-skill']);
    assert.throws(
      () => loadDeclaredSkills(dir, forgeRoot),
      (err: unknown) => {
        assert.ok(err instanceof MissingDeclaredSkillError, 'must throw the named MissingDeclaredSkillError');
        assert.match((err as Error).message, /ghost-skill/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadDeclaredSkills: preserves declaration order across multiple resolving skills', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    declareProject(dir, ['a-skill', 'b-skill']);
    for (const id of ['a-skill', 'b-skill']) {
      mkdirSync(join(dir, '.forge', 'skills', id), { recursive: true });
      writeFileSync(join(dir, '.forge', 'skills', id, 'SKILL.md'), `# ${id}\n`);
    }
    const loaded = loadDeclaredSkills(dir, forgeRoot);
    assert.deepEqual(loaded.map((s) => s.id), ['a-skill', 'b-skill']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ── PRESENTATION_ONLY_SKILL_IDS (bead forge-mfv5.2.2 / forge-mfv5.2.8): a
// generated composer skill (`demo-design`) shapes the Studio demo page, never
// a cycle input, so `loadDeclaredSkills` — the ONE loader both agent-prompt
// builders read through — must never fold it in, whether or not it resolves.

test('loadDeclaredSkills: PRESENTATION_ONLY_SKILL_IDS (demo-design) is filtered out even when its SKILL.md exists', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    assert.deepEqual(PRESENTATION_ONLY_SKILL_IDS, ['demo-design']);
    declareProject(dir, ['demo-design', 'x']);
    mkdirSync(join(dir, '.forge', 'skills', 'demo-design'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'demo-design', 'SKILL.md'), '# demo-design composer\n');
    mkdirSync(join(dir, '.forge', 'skills', 'x'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'x', 'SKILL.md'), '# x\n');

    const loaded = loadDeclaredSkills(dir, forgeRoot);
    assert.deepEqual(loaded.map((s) => s.id), ['x'], 'demo-design must never reach the agent prompt loader');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadDeclaredSkills: a presentation-only id that resolves NOWHERE is silently skipped, never throws', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    // demo-design has no SKILL.md anywhere — SKILLS/checkSkills (a separate,
    // hard clause) is what enforces resolution; the prompt loader just never
    // looks at it.
    declareProject(dir, ['demo-design']);
    assert.deepEqual(loadDeclaredSkills(dir, forgeRoot), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveDeclaredSkillPath: null when neither project-local nor forge-wide resolves', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    assert.equal(resolveDeclaredSkillPath(dir, forgeRoot, 'nope'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
