/**
 * What a library ACTION does to AGENT identity — install, approve, and the
 * roster the loader returns afterwards.
 *
 * MOVED HERE from `packages/library/studio/skill-library.test.ts` by M4-library
 * s3 (rulings 13/73/127 + ruling 89's shape). Every case below drives a
 * library operation and then asserts on `isStudioAgent` / `listAgentDefinitions`
 * — the Agent kind's loader, owned by `@forge/agents`. Library is rank 2 and
 * agents is rank 3, so those five imports were the whole reason that test file
 * carried a boundary row; and they cannot be replaced by the injected
 * `AgentFacts` port either, because a fixture's answer would make exactly the
 * assertion these cases exist to make vacuous (COMMON §15.28). A test whose
 * subject spans two packages belongs flat at the assembly, where importing
 * both is what the assembly is for.
 *
 * AT-89 travels with them for the same reason from the other side: its
 * subjects are `@forge/kernel`'s `SLUG_RE` and `orchestrator/studio/validate.ts`,
 * neither of which is library's. Its import of the legacy validator is
 * disclosed as an `assembly-to-legacy` row (ruling 116) that dies with that
 * file's carve; what it replaces was a `package-to-legacy` violation with no
 * such exit.
 *
 * The cases and their assertions are byte-identical to the ones deleted there.
 * Only the helper definitions are re-stated here — deliberately, and only the
 * ones these cases use — so this file stands alone rather than reaching back
 * into a sibling package's test internals.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { skillPath, skillsDir } from '@forge/library/skill-path.ts';
import { installSkillPackage, approveSkillDraft } from '@forge/library/studio/skill-install.ts';
import { isStudioAgent, listAgentDefinitions } from '@forge/agents/studio/agent-registry.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function makeForgeRoot(prefix = 'skill-agent-identity-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

/** Write a real skills/<id>/SKILL.md under a forge root, gray-matter frontmatter. */
function writeSkillMd(root: string, id: string, frontmatter: Record<string, unknown>): string {
  const dir = join(root, 'skills', id);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'SKILL.md');
  writeFileSync(p, matter.stringify('\nBody.\n', frontmatter), 'utf8');
  return p;
}

function readFrontmatter(root: string, id: string): Record<string, unknown> {
  return (matter(readFileSync(skillPath(id, root), 'utf8'), {}).data ?? {}) as Record<string, unknown>;
}

function makePackageDir(
  frontmatter: Record<string, unknown> = { name: 'Installable Skill', description: 'a vendored skill' },
  extraFiles: Record<string, string> = { 'reference.md': 'reference content' },
): string {
  const dir = makeTmpDir('skill-pkg-');
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\n# Installable Skill\n\nBody.\n', frontmatter), 'utf8');
  for (const [rel, content] of Object.entries(extraFiles)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return dir;
}

function installDraft(root: string, id: string, sourceFrontmatterExtra: Record<string, unknown> = {}): void {
  const packageDir = makeTmpDir('skill-pkg-approve-');
  writeFileSync(
    join(packageDir, 'SKILL.md'),
    matter.stringify('\nBody.\n', { name: id, description: 'installable', ...sourceFrontmatterExtra }),
    'utf8',
  );
  installSkillPackage({ forgeRoot: root, id, packageDir, upstream: { source: 'https://x' } });
}

describe('a library action never mints an agent (D4)', () => {
  it('AT-17: isStudioAgent() returns false for the installed draft (no runtime:)', () => {
    const root = makeForgeRoot();
    const packageDir = makePackageDir({
      name: 'Vendored Agent',
      description: 'x',
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    });

    installSkillPackage({ forgeRoot: root, id: 'not-an-agent', packageDir, upstream: { source: 'https://x' } });

    assert.equal(isStudioAgent(skillPath('not-an-agent', root)), false);
  });

  it('AT-25: unbound on land — no agent definition composition.skills mentions the new id', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'consumer-agent', {
      name: 'Consumer Agent',
      description: 'x',
      phase: 'tester',
      purpose: 'test',
      brainAccess: 'none',
      interactivity: 'auto',
      composition: { skills: ['some-other-skill'], tools: [], mcps: [], guards: [] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': [],
      'disallowed-tools': [],
      budgets: {},
    });

    installSkillPackage({ forgeRoot: root, id: 'unbound-skill', packageDir: makePackageDir(), upstream: { source: 'https://x' } });

    const agents = listAgentDefinitions(skillsDir(root));
    for (const agent of agents) {
      assert.ok(!agent.composition.skills.includes('unbound-skill'), `agent ${agent.slug} must not compose the freshly installed skill`);
    }
  });

  it('AT-30: does NOT restore runtime/allowed-tools — quarantined preserved verbatim, isStudioAgent stays false (D4)', () => {
    const root = makeForgeRoot();
    installDraft(root, 'approve-agent-shaped', {
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': ['Read'],
    });
    const quarantinedBefore = readFrontmatter(root, 'approve-agent-shaped')['quarantined'];

    approveSkillDraft({ forgeRoot: root, id: 'approve-agent-shaped' });

    const after = readFrontmatter(root, 'approve-agent-shaped');
    assert.ok(!('runtime' in after), 'runtime must remain absent from top level after approval');
    assert.deepEqual(after['quarantined'], quarantinedBefore, 'quarantined block preserved verbatim');
    assert.equal(isStudioAgent(skillPath('approve-agent-shaped', root)), false);
  });

  it('AT-33: approval does not bind the skill to any agent (compositions unchanged)', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'binding-check-agent', {
      name: 'Binding Check Agent',
      description: 'x',
      phase: 'tester',
      purpose: 'test',
      brainAccess: 'none',
      interactivity: 'auto',
      composition: { skills: ['some-other-skill'], tools: [], mcps: [], guards: [] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': [],
      'disallowed-tools': [],
      budgets: {},
    });
    installDraft(root, 'approve-unbound');

    approveSkillDraft({ forgeRoot: root, id: 'approve-unbound' });

    const agents = listAgentDefinitions(skillsDir(root));
    for (const agent of agents) {
      assert.ok(!agent.composition.skills.includes('approve-unbound'));
    }
  });
});

describe('isStudioAgent / listAgentDefinitions — an installed package is never an agent (D4)', () => {
  const FULL_AGENT_FRONTMATTER = {
    name: 'tester',
    description: 'A test agent.',
    phase: 'tester',
    purpose: 'Test things.',
    composition: { skills: [], tools: [], mcps: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    'allowed-tools': [],
    'disallowed-tools': [],
    budgets: {},
  };

  it('AT-85: a SKILL.md with BOTH a top-level runtime: AND a provenance: block → isStudioAgent is false AND listAgentDefinitions excludes it', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'fake-installed-agent-provenance', {
      ...FULL_AGENT_FRONTMATTER,
      provenance: { source: 'https://x', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
    });

    assert.equal(isStudioAgent(skillPath('fake-installed-agent-provenance', root)), false);
    const defs = listAgentDefinitions(skillsDir(root));
    assert.ok(
      !defs.some((d) => d.slug === 'fake-installed-agent-provenance'),
      'must be excluded from the roster ENUMERATION, not merely fail the predicate in isolation',
    );
  });

  it('AT-86: a SKILL.md with a quarantined: block PLUS a top-level runtime: → excluded from listAgentDefinitions', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'fake-installed-agent-quarantined', {
      ...FULL_AGENT_FRONTMATTER,
      quarantined: { runtime: { sdk: 'claude', strategy: 'fixed' }, library: true },
    });

    assert.equal(isStudioAgent(skillPath('fake-installed-agent-quarantined', root)), false);
    const defs = listAgentDefinitions(skillsDir(root));
    assert.ok(!defs.some((d) => d.slug === 'fake-installed-agent-quarantined'));
  });

  it('AT-88: REGRESSION GUARD — a normal shipped agent (no provenance, no quarantined) stays isStudioAgent + in listAgentDefinitions; the real repo roster count is pinned', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'normal-agent', FULL_AGENT_FRONTMATTER);

    assert.equal(isStudioAgent(skillPath('normal-agent', root)), true);
    assert.ok(listAgentDefinitions(skillsDir(root)).some((d) => d.slug === 'normal-agent'));

    // Pinned against the REAL repo (captured 2026-08-04 against commit
    // 23f414fe: `listAgentDefinitions(skillsDir())` → 10 agents; bumped to 11
    // for R4-18's `contract-check` def. W6-CR-3 briefly bumped it to 12 for
    // its `community-refresh` def (the first interactive session-kind agent
    // to declare `library: true`); W8-B5b retired that whole kind — SKILL.md
    // included — so the count reverts to 11) so the fix cannot quietly
    // delete agents from the roster while closing the hole.
    const REAL_AGENT_COUNT = 11;
    assert.equal(
      listAgentDefinitions(skillsDir(REPO_ROOT)).length,
      REAL_AGENT_COUNT,
      'the real shipped agent roster count must not change from closing this hole',
    );
  });
});

describe('SLUG_RE relocation regression guard', () => {
  // Survived two relocations; now asserts IDENTITY, which equal `.source` did not.
  it('AT-89: SLUG_RE reaches validate.ts as the SAME object kernel defines — one definition, not two with matching sources', async () => {
    const idsModule = (await import('@forge/kernel/ids.ts')) as Record<string, unknown>;
    const validateModule = (await import('../../orchestrator/studio/validate.ts')) as Record<string, unknown>;

    const fromKernel = idsModule['SLUG_RE'] as RegExp | undefined;
    const fromValidate = validateModule['SLUG_RE'] as RegExp;

    assert.equal(fromKernel, fromValidate, '@forge/kernel/ids.ts must define SLUG_RE and validate.ts must RE-EXPORT that object — not a second regex with a matching source');
  });
});
