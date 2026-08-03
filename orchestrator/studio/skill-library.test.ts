/**
 * Acceptance tests for orchestrator/studio/skill-library.ts (R3-01-F3/F4, WI-0).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./skill-library.ts` import is the expected red).
 * See _wave5/specs/R3-01-F3F4.md for the full design; AT numbers below map
 * 1:1 onto that spec's "AT set — orchestrator/studio/skill-library.test.ts".
 *
 * Style: node:test + node:assert/strict, real temp forge roots via
 * mkdtempSync (no mocking of node:fs), mirroring registry.test.ts.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { skillDir, skillPath, skillsDir } from '../skill-path.ts';
import { isStudioAgent, listPlainSkills, listAgentDefinitions } from './registry.ts';
import type { AgentDefinition } from './types.ts';

import {
  MAX_PACKAGE_FILES,
  MAX_PACKAGE_BYTES,
  EXECUTABLE_EXTENSIONS,
  listSkillLibrary,
  deriveSkillUsage,
  readSkillPackage,
  hashSkillPackage,
  skillTrustState,
  scanSkillPackage,
  installSkillPackage,
  approveSkillDraft,
  repinSkillPackage,
  lintSkillTrust,
  lintSkillRefs,
} from './skill-library.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const createdDirs: string[] = [];

function makeForgeRoot(prefix = 'skill-library-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a real skills/<id>/SKILL.md under a forge root, gray-matter frontmatter. */
function writeSkillMd(
  root: string,
  id: string,
  frontmatter: Record<string, unknown>,
  body = `# ${id}\n\nBody text.\n`,
): string {
  const dir = skillDir(id, root);
  mkdirSync(dir, { recursive: true });
  const p = skillPath(id, root);
  writeFileSync(p, matter.stringify('\n' + body, frontmatter), 'utf8');
  return p;
}

/** Write an extra file inside an already-created skill directory. */
function writeSkillFile(root: string, id: string, relPath: string, content: string): string {
  const p = join(skillDir(id, root), relPath);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
  return p;
}

/** Write studio/catalog.yaml with a given raw community-skills array (kebab-case key). */
function writeCatalogYaml(root: string, communitySkills: Array<Record<string, unknown>> = []): void {
  const studioDir = join(root, 'studio');
  mkdirSync(studioDir, { recursive: true });
  const lines: string[] = ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'hooks: []', 'community-skills:'];
  if (communitySkills.length === 0) {
    lines[lines.length - 1] = 'community-skills: []';
  } else {
    for (const s of communitySkills) {
      lines.push(`  - ${JSON.stringify(s)}`);
    }
  }
  writeFileSync(join(studioDir, 'catalog.yaml'), lines.join('\n') + '\n', 'utf8');
}

/** A minimal, valid studio-agent AgentDefinition fixture (no disk I/O). */
function makeAgentDef(slug: string, composedSkills: string[]): AgentDefinition {
  return {
    slug,
    name: slug,
    description: `Agent ${slug}.`,
    purpose: 'Test purpose.',
    composition: { skills: composedSkills, tools: [], mcps: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Body.',
    path: `/unused/${slug}/SKILL.md`,
  };
}

/** Read back the frontmatter data of a skill's SKILL.md. */
function readFrontmatter(root: string, id: string): Record<string, unknown> {
  const raw = readFileSync(skillPath(id, root), 'utf8');
  return matter(raw).data as Record<string, unknown>;
}

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// ===========================================================================
// Union + source discrimination — listSkillLibrary(forgeRoot)  (AT 1-7)
// ===========================================================================

describe('listSkillLibrary — union + source discrimination', () => {
  it('AT-1: returns one entry per local plain skill with source: local', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'local-a', { name: 'Local A', description: 'a' });
    writeSkillMd(root, 'local-b', { name: 'Local B', description: 'b' });

    const entries = listSkillLibrary(root);
    const local = entries.filter((e) => e.source === 'local');
    assert.deepEqual(local.map((e) => e.id).sort(), ['local-a', 'local-b']);
  });

  it('AT-2: returns one entry per catalog community skill with source: community', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root, [
      { id: 'handoff', name: 'Handoff', provenance: 'obra/superpowers', source: 'https://x', category: 'memory' },
      { id: 'security-review', name: 'Security Review', provenance: 'ToB', source: 'https://y', category: 'review' },
    ]);

    const entries = listSkillLibrary(root);
    const community = entries.filter((e) => e.source === 'community');
    assert.deepEqual(community.map((e) => e.id).sort(), ['handoff', 'security-review']);
  });

  it('AT-3: a catalog id also on disk appears ONCE, source local, installed true, catalog metadata carried', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root, [
      {
        id: 'handoff',
        name: 'Handoff',
        provenance: 'obra/superpowers',
        source: 'https://x',
        category: 'memory',
        stars: '228k',
      },
    ]);
    writeSkillMd(root, 'handoff', { name: 'Handoff (local copy)', description: 'compress session' });

    const entries = listSkillLibrary(root);
    const matches = entries.filter((e) => e.id === 'handoff');
    assert.equal(matches.length, 1, 'must appear exactly once, not duplicated across sources');
    assert.equal(matches[0].source, 'local', 'filesystem wins on existence');
    assert.equal(matches[0].installed, true);
    assert.equal(matches[0].stars, '228k', 'catalog wins on provenance/stars metadata');
    assert.equal(matches[0].category, 'memory');
  });

  it('AT-4: a catalog id with no local dir has installed: false', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root, [
      { id: 'ghost-skill', name: 'Ghost', provenance: 'nobody', source: 'https://z', category: 'meta' },
    ]);

    const entries = listSkillLibrary(root);
    const ghost = entries.find((e) => e.id === 'ghost-skill');
    assert.ok(ghost, 'catalog-only entry must appear');
    assert.equal(ghost!.installed, false);
  });

  it('AT-5: studio agents (SKILL.md WITH runtime:) are NOT in the skill library', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'plain-one', { name: 'Plain One', description: 'plain' });
    writeSkillMd(root, 'studio-agent-one', {
      name: 'Studio Agent',
      description: 'an agent',
      phase: 'tester',
      purpose: 'test',
      brainAccess: 'none',
      interactivity: 'auto',
      composition: { skills: [], tools: [], mcps: [], hooks: [] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': [],
      'disallowed-tools': [],
      budgets: {},
    });

    const entries = listSkillLibrary(root);
    assert.ok(entries.some((e) => e.id === 'plain-one'));
    assert.ok(!entries.some((e) => e.id === 'studio-agent-one'), 'studio agents must be excluded from the skill library');
  });

  it('AT-6: entries are sorted by id (deterministic output)', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'zulu-skill', { name: 'Zulu', description: 'z' });
    writeSkillMd(root, 'alpha-skill', { name: 'Alpha', description: 'a' });
    writeSkillMd(root, 'mike-skill', { name: 'Mike', description: 'm' });

    const ids = listSkillLibrary(root).map((e) => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('AT-7: an unreadable/malformed local SKILL.md is reported with an explicit error field, not dropped, and does not throw the whole listing', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'clean-skill', { name: 'Clean', description: 'ok' });
    // Malformed YAML frontmatter — unterminated flow sequence.
    const brokenDir = skillDir('broken-skill', root);
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'SKILL.md'), '---\nname: [unterminated\n---\nBody.\n', 'utf8');

    let entries: ReturnType<typeof listSkillLibrary> = [];
    assert.doesNotThrow(() => { entries = listSkillLibrary(root); }, 'a single malformed skill must not throw the whole listing');

    assert.ok(entries.some((e) => e.id === 'clean-skill'), 'the clean skill must still be reported');
    const broken = entries.find((e) => e.id === 'broken-skill');
    assert.ok(broken, 'the malformed skill must still be reported (not silently dropped)');
    assert.ok(typeof broken!.error === 'string' && broken!.error.length > 0, 'must carry an explicit non-empty error field');
  });
});

// ===========================================================================
// Used-by derivation — deriveSkillUsage(agents) / the usedBy field  (AT 8-10)
// ===========================================================================

describe('deriveSkillUsage — used-by derivation', () => {
  it('AT-8: usedBy for brain-query contains exactly the composing agent slugs, sorted and deduped', () => {
    const agents = [
      makeAgentDef('architect', ['brain-query']),
      makeAgentDef('project-manager', ['brain-query']),
      // brain-query listed twice within one agent's own composition — must dedupe.
      makeAgentDef('brain-ingest', ['brain-query', 'brain-query']),
      makeAgentDef('reflector', ['brain-query']),
      makeAgentDef('developer-ralph', ['tdd-workflow']),
    ];

    const usage = deriveSkillUsage(agents);
    assert.deepEqual(usage.get('brain-query'), ['architect', 'brain-ingest', 'project-manager', 'reflector']);
  });

  it('AT-9: a skill no agent composes has usedBy: [] (checked at the listSkillLibrary entry level)', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'unused-skill', { name: 'Unused', description: 'nobody composes this' });

    const entry = listSkillLibrary(root).find((e) => e.id === 'unused-skill');
    assert.ok(entry);
    assert.deepEqual(entry!.usedBy, []);
  });

  it('AT-10: usedBy is derived from agent specs ONLY — a stale catalog composedBy claim contributes nothing, and the library type has no composedBy field at all', () => {
    const root = makeForgeRoot();
    // Simulate a stale/defensive raw catalog record that still carries composedBy
    // (WI-1 deletes the field from the type + parse; this proves it can never leak
    // through regardless of which layer drops it).
    writeCatalogYaml(root, [
      {
        id: 'stale-composed',
        name: 'Stale Composed',
        provenance: 'x',
        source: 'https://x',
        category: 'meta',
        composedBy: ['developer-ralph'],
      },
    ]);
    // No skills/ dir with studio agents at all — usedBy must be empty regardless.

    const entry = listSkillLibrary(root).find((e) => e.id === 'stale-composed');
    assert.ok(entry);
    assert.deepEqual(entry!.usedBy, [], 'a catalog composedBy claim must contribute nothing to usedBy');
    assert.ok(!('composedBy' in entry!), 'SkillLibraryEntry must never carry a composedBy field');
  });
});

// ===========================================================================
// Package read + hash  (AT 11-14)
// ===========================================================================

describe('readSkillPackage', () => {
  it('AT-11: reads SKILL.md plus every file under the skill dir, {path, body}, path relative + POSIX, SKILL.md first, rest sorted', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'pkg-skill', { name: 'Pkg Skill', description: 'd' }, '# Pkg Skill\n\nBody.\n');
    // A file that would sort BEFORE "SKILL.md" under plain lexicographic ordering
    // (uppercase 'A' < uppercase 'S') — proves SKILL.md-first is an explicit rule,
    // not an accident of ASCII ordering.
    writeSkillFile(root, 'pkg-skill', 'AAA.md', 'aaa content');
    writeSkillFile(root, 'pkg-skill', 'docs/help.md', 'help content');
    writeSkillFile(root, 'pkg-skill', 'scripts/run.sh', '#!/bin/sh\necho hi\n');

    const files = readSkillPackage(root, 'pkg-skill');
    assert.equal(files[0].path, 'SKILL.md', 'SKILL.md must be first regardless of lexicographic order');
    const rest = files.slice(1).map((f) => f.path);
    assert.deepEqual(rest, ['AAA.md', 'docs/help.md', 'scripts/run.sh']);
    assert.ok(!rest.some((p) => p.includes('\\')), 'paths must be POSIX-separated');

    const help = files.find((f) => f.path === 'docs/help.md');
    assert.equal(help!.body, 'help content');
  });
});

describe('hashSkillPackage', () => {
  it('AT-12: deterministic and order-independent, returns sha256:<64 hex>', () => {
    const files = [
      { path: 'SKILL.md', body: '# A\n\nBody.\n' },
      { path: 'scripts/x.sh', body: 'echo one\n' },
      { path: 'docs/help.md', body: 'help\n' },
    ];
    const h1 = hashSkillPackage(files);
    const h2 = hashSkillPackage([...files].reverse());
    assert.equal(h1, h2, 'hash must be order-independent');
    assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  });

  it('AT-13: changing one byte of ANY file (including scripts/x.sh, not just SKILL.md) changes the hash', () => {
    const base = [
      { path: 'SKILL.md', body: '# A\n\nBody.\n' },
      { path: 'scripts/x.sh', body: 'echo one\n' },
    ];
    const mutated = [
      { path: 'SKILL.md', body: '# A\n\nBody.\n' },
      { path: 'scripts/x.sh', body: 'echo ONE\n' }, // one-byte-class change, non-SKILL.md file
    ];
    assert.notEqual(hashSkillPackage(base), hashSkillPackage(mutated));
  });

  it('AT-14: renaming a file changes the hash', () => {
    const before = [{ path: 'SKILL.md', body: 'x' }, { path: 'scripts/x.sh', body: 'echo\n' }];
    const renamed = [{ path: 'SKILL.md', body: 'x' }, { path: 'scripts/y.sh', body: 'echo\n' }];
    assert.notEqual(hashSkillPackage(before), hashSkillPackage(renamed));
  });
});

// ===========================================================================
// Install — installSkillPackage  (AT 15-25)
// ===========================================================================

describe('installSkillPackage', () => {
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

  it('AT-15: writes skills/<id>/ mirroring the package; SKILL.md gains status: draft, library: false, provenance{source,contentHash,installedAt}', () => {
    const root = makeForgeRoot();
    const packageDir = makePackageDir();

    installSkillPackage({ forgeRoot: root, id: 'new-skill', packageDir, upstream: { source: 'https://github.com/example/new-skill' } });

    assert.ok(existsSync(skillPath('new-skill', root)));
    assert.equal(readFileSync(join(skillDir('new-skill', root), 'reference.md'), 'utf8'), 'reference content');

    const data = readFrontmatter(root, 'new-skill');
    assert.equal(data['status'], 'draft');
    assert.equal(data['library'], false);
    const prov = data['provenance'] as Record<string, unknown>;
    assert.ok(prov, 'provenance block must be present');
    assert.equal(prov['source'], 'https://github.com/example/new-skill');
    assert.match(String(prov['contentHash']), /^sha256:[0-9a-f]{64}$/);
    assert.match(String(prov['installedAt']), ISO_8601_RE);
  });

  it('AT-16: runtime/allowed-tools/library from the SOURCE package are moved under quarantined: and absent from top level', () => {
    const root = makeForgeRoot();
    const packageDir = makePackageDir({
      name: 'Vendored Agent-Shaped Skill',
      description: 'has agent-shaped fields',
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': ['Read'],
      library: true,
    });

    installSkillPackage({ forgeRoot: root, id: 'quarantine-me', packageDir, upstream: { source: 'https://x' } });

    const data = readFrontmatter(root, 'quarantine-me');
    assert.ok(!('runtime' in data), 'runtime must be absent from top-level frontmatter');
    assert.ok(!('allowed-tools' in data), 'allowed-tools must be absent from top-level frontmatter');
    // The installer's OWN explicit draft stamp — distinct from the quarantined source value.
    assert.equal(data['library'], false);

    const quarantined = data['quarantined'] as Record<string, unknown>;
    assert.ok(quarantined, 'quarantined block must be present');
    assert.deepEqual(quarantined['runtime'], { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' });
    assert.deepEqual(quarantined['allowed-tools'], ['Read']);
    assert.equal(quarantined['library'], true, 'the SOURCE package library value is preserved verbatim in quarantine');
  });

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

  it('AT-18: upstream.ref supplied → provenance.upstreamRef; omitted → key ABSENT (no placeholder)', () => {
    const root = makeForgeRoot();

    installSkillPackage({
      forgeRoot: root,
      id: 'with-ref',
      packageDir: makePackageDir(),
      upstream: { source: 'https://x', ref: 'v1.2.3' },
    });
    const withRefData = readFrontmatter(root, 'with-ref')['provenance'] as Record<string, unknown>;
    assert.equal(withRefData['upstreamRef'], 'v1.2.3');

    installSkillPackage({
      forgeRoot: root,
      id: 'without-ref',
      packageDir: makePackageDir(),
      upstream: { source: 'https://x' },
    });
    const withoutRefData = readFrontmatter(root, 'without-ref')['provenance'] as Record<string, unknown>;
    assert.ok(!('upstreamRef' in withoutRefData), 'upstreamRef must be absent, not an empty string or placeholder');
  });

  it('AT-19: missing/empty upstream.source → throws with an actionable message', () => {
    const root = makeForgeRoot();
    assert.throws(
      () => installSkillPackage({ forgeRoot: root, id: 'no-source-a', packageDir: makePackageDir(), upstream: { source: '' } }),
      (err: unknown) => { assert.ok(err instanceof Error); assert.match(err.message, /upstream\.source|source/i); return true; },
    );
    assert.throws(() =>
      installSkillPackage({ forgeRoot: root, id: 'no-source-b', packageDir: makePackageDir(), upstream: {} as { source: string } }),
    );
  });

  it('AT-20: package with no SKILL.md at its root → throws', () => {
    const root = makeForgeRoot();
    const packageDir = makeTmpDir('skill-pkg-no-md-');
    writeFileSync(join(packageDir, 'readme.txt'), 'no SKILL.md here', 'utf8');

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: 'no-md', packageDir, upstream: { source: 'https://x' } }));
  });

  it('AT-21: a package file escaping via a symlink pointing outside → throws and writes NOTHING', () => {
    const root = makeForgeRoot();
    const packageDir = makeTmpDir('skill-pkg-evil-');
    writeFileSync(join(packageDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Evil', description: 'd' }), 'utf8');
    const outsideDir = makeTmpDir('skill-pkg-outside-');
    const secretPath = join(outsideDir, 'secret.txt');
    writeFileSync(secretPath, 'top secret', 'utf8');
    symlinkSync(secretPath, join(packageDir, 'escape-link'));

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: 'evil-skill', packageDir, upstream: { source: 'https://x' } }));
    assert.equal(existsSync(skillDir('evil-skill', root)), false, 'no partial write must be left behind');
  });

  it('AT-22: package exceeding the file-count or total-byte cap → throws (caps are exported named constants)', () => {
    assert.ok(Number.isInteger(MAX_PACKAGE_FILES) && MAX_PACKAGE_FILES > 0);
    assert.ok(Number.isInteger(MAX_PACKAGE_BYTES) && MAX_PACKAGE_BYTES > 0);

    // File-count cap
    const root1 = makeForgeRoot();
    const manyFilesDir = makeTmpDir('skill-pkg-many-');
    writeFileSync(join(manyFilesDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Many', description: 'd' }), 'utf8');
    for (let i = 0; i < MAX_PACKAGE_FILES; i++) {
      writeFileSync(join(manyFilesDir, `extra-${i}.txt`), 'x', 'utf8');
    }
    assert.throws(() => installSkillPackage({ forgeRoot: root1, id: 'too-many-files', packageDir: manyFilesDir, upstream: { source: 'https://x' } }));

    // Total-byte cap
    const root2 = makeForgeRoot();
    const bigFileDir = makeTmpDir('skill-pkg-big-');
    writeFileSync(join(bigFileDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Big', description: 'd' }), 'utf8');
    writeFileSync(join(bigFileDir, 'big.txt'), 'x'.repeat(MAX_PACKAGE_BYTES + 1), 'utf8');
    assert.throws(() => installSkillPackage({ forgeRoot: root2, id: 'too-big', packageDir: bigFileDir, upstream: { source: 'https://x' } }));
  });

  it('AT-23: a non-UTF-8 (binary) file in the package → throws', () => {
    const root = makeForgeRoot();
    const packageDir = makeTmpDir('skill-pkg-binary-');
    writeFileSync(join(packageDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Binary', description: 'd' }), 'utf8');
    writeFileSync(join(packageDir, 'blob.bin'), Buffer.from([0xff, 0xfe, 0x00, 0xff, 0xd8, 0xff]));

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: 'binary-pkg', packageDir, upstream: { source: 'https://x' } }));
  });

  it('AT-24: reinstalling an existing id returns { alreadyInstalled: true } and leaves the dir byte-identical', () => {
    const root = makeForgeRoot();
    const packageDir = makePackageDir();
    installSkillPackage({ forgeRoot: root, id: 'reinstall-me', packageDir, upstream: { source: 'https://x' } });
    const before = readFileSync(skillPath('reinstall-me', root), 'utf8');

    // Second install attempt with DIFFERENT source content — must not overwrite.
    const differentPackageDir = makePackageDir({ name: 'Different Content', description: 'different' });
    const result = installSkillPackage({ forgeRoot: root, id: 'reinstall-me', packageDir: differentPackageDir, upstream: { source: 'https://x' } });

    assert.equal(result.alreadyInstalled, true);
    const after = readFileSync(skillPath('reinstall-me', root), 'utf8');
    assert.equal(after, before, 'existing directory must remain byte-identical, no overwrite');
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
      composition: { skills: ['some-other-skill'], tools: [], mcps: [], hooks: [] },
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
});

// ===========================================================================
// Palette exclusion — the enforcement point  (AT 26-28)
// ===========================================================================

describe('palette exclusion (listPlainSkills / listSkillLibrary)', () => {
  function makeDraftAndDriftRoot(): string {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'draft-skill', { name: 'Draft Skill', description: 'a draft', status: 'draft' });
    writeSkillMd(root, 'hash-drift-skill', {
      name: 'Hash Drift Skill',
      description: 'drifted',
      provenance: { source: 'https://x', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
    });
    return root;
  }

  it('AT-26: listPlainSkills excludes a status: draft skill', () => {
    const root = makeDraftAndDriftRoot();
    const ids = listPlainSkills(root).map((s) => s.id);
    assert.ok(!ids.includes('draft-skill'), 'draft skill must not be palette-visible');
  });

  it('AT-27: listPlainSkills excludes a needs-review skill (hash drift)', () => {
    const root = makeDraftAndDriftRoot();
    const ids = listPlainSkills(root).map((s) => s.id);
    assert.ok(!ids.includes('hash-drift-skill'), 'hash-drift skill must not be palette-visible');
  });

  it('AT-28: listSkillLibrary INCLUDES both with trust draft/needs-review and paletteVisible: false', () => {
    const root = makeDraftAndDriftRoot();
    const entries = listSkillLibrary(root);

    const draft = entries.find((e) => e.id === 'draft-skill');
    assert.ok(draft, 'library must show the draft skill');
    assert.equal(draft!.trust, 'draft');
    assert.equal(draft!.paletteVisible, false);

    const drifted = entries.find((e) => e.id === 'hash-drift-skill');
    assert.ok(drifted, 'library must show the needs-review skill');
    assert.equal(drifted!.trust, 'needs-review');
    assert.equal(drifted!.paletteVisible, false);

    // The library shows them, the palette does not — assert via the palette enumeration.
    const paletteIds = listPlainSkills(root).map((s) => s.id);
    assert.ok(!paletteIds.includes('draft-skill') && !paletteIds.includes('hash-drift-skill'));
  });
});

// ===========================================================================
// Approve — approveSkillDraft  (AT 29-33)
// ===========================================================================

describe('approveSkillDraft', () => {
  function installDraft(root: string, id: string, sourceFrontmatterExtra: Record<string, unknown> = {}): void {
    const packageDir = makeTmpDir('skill-pkg-approve-');
    writeFileSync(
      join(packageDir, 'SKILL.md'),
      matter.stringify('\nBody.\n', { name: id, description: 'installable', ...sourceFrontmatterExtra }),
      'utf8',
    );
    installSkillPackage({ forgeRoot: root, id, packageDir, upstream: { source: 'https://x' } });
  }

  it('AT-29: flips library: true, removes status: draft, keeps provenance + contentHash unchanged', () => {
    const root = makeForgeRoot();
    installDraft(root, 'approve-me');
    const before = readFrontmatter(root, 'approve-me');
    const hashBefore = (before['provenance'] as Record<string, unknown>)['contentHash'];

    approveSkillDraft({ forgeRoot: root, id: 'approve-me' });

    const after = readFrontmatter(root, 'approve-me');
    assert.equal(after['library'], true);
    assert.notEqual(after['status'], 'draft');
    assert.equal((after['provenance'] as Record<string, unknown>)['contentHash'], hashBefore);
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

  it('AT-31: approved skill becomes palette-visible', () => {
    const root = makeForgeRoot();
    installDraft(root, 'approve-visible');
    assert.ok(!listPlainSkills(root).map((s) => s.id).includes('approve-visible'), 'draft must be excluded pre-approval');

    approveSkillDraft({ forgeRoot: root, id: 'approve-visible' });

    assert.ok(listPlainSkills(root).map((s) => s.id).includes('approve-visible'), 'approved skill must be palette-visible');
  });

  it('AT-32: approving a non-draft id throws (fail loud)', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'already-ready', { name: 'Already Ready', description: 'a normal hand-authored skill' });

    assert.throws(() => approveSkillDraft({ forgeRoot: root, id: 'already-ready' }));
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
      composition: { skills: ['some-other-skill'], tools: [], mcps: [], hooks: [] },
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

// ===========================================================================
// Re-review on change — skillTrustState  (AT 34-37)
// ===========================================================================

describe('skillTrustState — re-review on change', () => {
  function installAndApprove(root: string, id: string): void {
    const packageDir = makeTmpDir('skill-pkg-rereview-');
    writeFileSync(join(packageDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: id, description: 'installable' }), 'utf8');
    writeFileSync(join(packageDir, 'reference.md'), 'original reference content', 'utf8');
    installSkillPackage({ forgeRoot: root, id, packageDir, upstream: { source: 'https://x' } });
    approveSkillDraft({ forgeRoot: root, id });
  }

  it('AT-34: mutating ANY package file after approval → needs-review, and it drops out of the palette (checked via palette enumeration)', () => {
    const root = makeForgeRoot();
    installAndApprove(root, 'mutate-me');
    assert.equal(skillTrustState(root, 'mutate-me'), 'ready');

    writeFileSync(join(skillDir('mutate-me', root), 'reference.md'), 'MUTATED reference content', 'utf8');

    assert.equal(skillTrustState(root, 'mutate-me'), 'needs-review');
    assert.ok(!listPlainSkills(root).map((s) => s.id).includes('mutate-me'), 'must drop out of the palette enumeration');
  });

  it('AT-35: restoring the bytes → trust: ready again (hash match)', () => {
    const root = makeForgeRoot();
    installAndApprove(root, 'restore-me');
    const refPath = join(skillDir('restore-me', root), 'reference.md');
    const original = readFileSync(refPath, 'utf8');

    writeFileSync(refPath, 'temporarily mutated', 'utf8');
    assert.equal(skillTrustState(root, 'restore-me'), 'needs-review');

    writeFileSync(refPath, original, 'utf8');
    assert.equal(skillTrustState(root, 'restore-me'), 'ready');
  });

  it('AT-36: repinSkillPackage after an intentional edit updates contentHash and returns trust to ready', () => {
    const root = makeForgeRoot();
    installAndApprove(root, 'repin-me');
    const hashBefore = (readFrontmatter(root, 'repin-me')['provenance'] as Record<string, unknown>)['contentHash'];

    writeFileSync(join(skillDir('repin-me', root), 'reference.md'), 'an intentional local edit', 'utf8');
    assert.equal(skillTrustState(root, 'repin-me'), 'needs-review');

    const newHash = repinSkillPackage({ forgeRoot: root, id: 'repin-me' });

    assert.notEqual(newHash, hashBefore);
    const recomputed = hashSkillPackage(readSkillPackage(root, 'repin-me'));
    assert.equal(newHash, recomputed, 'the returned hash must match the actual recomputed package hash');
    assert.equal(skillTrustState(root, 'repin-me'), 'ready');
  });

  it('AT-37: a skill with NO provenance block is never needs-review however it is edited', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'hand-authored', { name: 'Hand Authored', description: 'no provenance ever' });
    writeSkillFile(root, 'hand-authored', 'notes.md', 'v1');

    assert.equal(skillTrustState(root, 'hand-authored'), 'ready');

    writeSkillFile(root, 'hand-authored', 'notes.md', 'v2 — arbitrary edit');

    assert.equal(skillTrustState(root, 'hand-authored'), 'ready', 'no provenance ⇒ never needs-review');
  });
});

// ===========================================================================
// Scan — scanSkillPackage(files)  (AT 38-42)
// ===========================================================================

describe('scanSkillPackage', () => {
  it('AT-38: reports the exact list of quarantined frontmatter keys present', () => {
    const files = [
      {
        path: 'SKILL.md',
        body: matter.stringify('\nBody.\n', {
          name: 'x',
          description: 'd',
          runtime: { sdk: 'claude', strategy: 'fixed' },
          library: true,
        }),
      },
    ];
    const report = scanSkillPackage(files);
    assert.deepEqual([...report.quarantinedKeys].sort(), ['library', 'runtime']);
  });

  it('AT-39: reports files with executable extensions (.sh .bash .js .mjs .cjs .py .rb .pl)', () => {
    assert.deepEqual([...EXECUTABLE_EXTENSIONS].sort(), ['.bash', '.cjs', '.js', '.mjs', '.pl', '.py', '.rb', '.sh'].sort());

    const skillMd = { path: 'SKILL.md', body: matter.stringify('\nBody.\n', { name: 'x', description: 'd' }) };
    const executableFiles = EXECUTABLE_EXTENSIONS.map((ext, i) => ({ path: `scripts/file-${i}${ext}`, body: 'x' }));
    const nonExecutable = { path: 'docs/notes.md', body: 'plain doc' };

    const report = scanSkillPackage([skillMd, ...executableFiles, nonExecutable]);
    assert.deepEqual(
      [...report.executableFiles].sort(),
      executableFiles.map((f) => f.path).sort(),
    );
    assert.ok(!report.executableFiles.includes('docs/notes.md'));
    assert.ok(!report.executableFiles.includes('SKILL.md'));
  });

  it('AT-40: reports fileCount + totalBytes matching reality', () => {
    const files = [
      { path: 'SKILL.md', body: matter.stringify('\nBody.\n', { name: 'x', description: 'd' }) },
      { path: 'scripts/a.sh', body: 'echo a\n' },
      { path: 'scripts/b.sh', body: 'echo b longer content\n' },
    ];
    const report = scanSkillPackage(files);
    assert.equal(report.fileCount, files.length);
    const expectedBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.body, 'utf8'), 0);
    assert.equal(report.totalBytes, expectedBytes);
  });

  it('AT-41: returns the full SKILL.md body verbatim (post-frontmatter content, not the raw frontmatter)', () => {
    const content = '# My Skill\n\nThis is the human-readable body a reviewer reads.\n';
    const files = [
      {
        path: 'SKILL.md',
        body: matter.stringify('\n' + content, { name: 'x', description: 'd', runtime: { sdk: 'claude', strategy: 'fixed' } }),
      },
    ];
    const report = scanSkillPackage(files);
    assert.equal(report.body.trim(), content.trim());
    assert.ok(!report.body.includes('runtime:'), 'frontmatter must not leak into the reported body');
  });

  it('AT-42: has NO verdict/pass/clean/severity field — assert the exact key set (D5: never judges)', () => {
    const files = [{ path: 'SKILL.md', body: matter.stringify('\nBody.\n', { name: 'x', description: 'd' }) }];
    const report = scanSkillPackage(files);
    assert.deepEqual(
      Object.keys(report).sort(),
      ['body', 'executableFiles', 'fileCount', 'quarantinedKeys', 'totalBytes'].sort(),
    );
  });
});

// ===========================================================================
// Lint — lintSkillTrust / lintSkillRefs  (AT 43-46)
// ===========================================================================

describe('lintSkillTrust / lintSkillRefs', () => {
  it('AT-43: an agent composing a draft skill → error skill-trust/draft-unapproved', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'some-draft-skill', { name: 'Some Draft', description: 'd', status: 'draft' });
    writeSkillMd(root, 'composer-agent', {
      name: 'Composer Agent',
      description: 'x',
      phase: 'tester',
      purpose: 'test',
      brainAccess: 'none',
      interactivity: 'auto',
      composition: { skills: ['some-draft-skill'], tools: [], mcps: [], hooks: [] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': [],
      'disallowed-tools': [],
      budgets: {},
    });

    const findings = lintSkillTrust(root);
    assert.ok(findings.some((f) => f.check === 'skill-trust/draft-unapproved' && f.level === 'error'));
  });

  it('AT-44: a needs-review skill present in the library → error skill-trust/hash-drift (no composer required)', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'drifted-skill', {
      name: 'Drifted',
      description: 'd',
      provenance: { source: 'https://x', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
    });

    const findings = lintSkillTrust(root);
    assert.ok(findings.some((f) => f.check === 'skill-trust/hash-drift' && f.level === 'error'));
  });

  it('AT-45: an agent composing an unresolvable skill id → error agent/skill-ref naming the agent + the id', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'dangling-ref-agent', {
      name: 'Dangling Ref Agent',
      description: 'x',
      phase: 'tester',
      purpose: 'test',
      brainAccess: 'none',
      interactivity: 'auto',
      composition: { skills: ['totally-unknown-skill-id'], tools: [], mcps: [], hooks: [] },
      runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
      'allowed-tools': [],
      'disallowed-tools': [],
      budgets: {},
    });

    const findings = lintSkillRefs(root);
    const f = findings.find((x) => x.check === 'agent/skill-ref');
    assert.ok(f, 'expected an agent/skill-ref finding');
    assert.ok(f!.message.includes('dangling-ref-agent'), 'message must name the agent');
    assert.ok(f!.message.includes('totally-unknown-skill-id'), 'message must name the unresolved id');
  });

  it('AT-46: the real shipped repo state passes both (guard against shipping a red lint)', () => {
    const trustFindings = lintSkillTrust(REPO_ROOT).filter((f) => f.level === 'error');
    const refFindings = lintSkillRefs(REPO_ROOT).filter((f) => f.level === 'error');
    assert.deepEqual(trustFindings, [], `lintSkillTrust must be clean on the real repo: ${JSON.stringify(trustFindings)}`);
    assert.deepEqual(refFindings, [], `lintSkillRefs must be clean on the real repo: ${JSON.stringify(refFindings)}`);
  });
});
