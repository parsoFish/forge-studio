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
  readdirSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { skillDir, skillPath, skillsDir } from '../skill-path.ts';
import { isStudioAgent, listPlainSkills, listAgentDefinitions } from './registry.ts';
import type { AgentDefinition } from './types.ts';
import { readInstallLedger } from './skill-install-ledger.ts';

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
  SkillIdOccupiedError,
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

/** W6-CR-1: community skills live in studio/community/registry.yaml, not
 *  catalog.yaml — converts each raw fixture record's LEGACY field names
 *  (source → sourceUrl, stars → signals.starsDisplay) into a registry item
 *  doc, mirroring community-index.test.ts's own communityRegistryItemDoc. */
function communityRegistryItemDoc(s: Record<string, unknown>): Record<string, unknown> {
  const { source, stars, provenance, ...rest } = s;
  return {
    ...rest,
    kind: 'skill',
    provenance: provenance ?? 'Test Author',
    sourceUrl: source ?? `https://example.com/${s['id']}`,
    signals: { stars: null, starsDisplay: stars ?? null, attributedTo: provenance ?? 'Test Author' },
    upstreamUpdatedAt: null,
    fetchedAt: null,
    fetchedBy: 'seed',
  };
}

/** Write studio/catalog.yaml (community-skills MOVED off it, W6-CR-1) plus its
 *  companion studio/community/registry.yaml built from the same raw
 *  community-skills array the pre-migration fixture used. */
function writeCatalogYaml(root: string, communitySkills: Array<Record<string, unknown>> = []): void {
  const studioDir = join(root, 'studio');
  mkdirSync(studioDir, { recursive: true });
  writeFileSync(join(studioDir, 'catalog.yaml'), ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []'].join('\n') + '\n', 'utf8');

  const communityDir = join(studioDir, 'community');
  mkdirSync(communityDir, { recursive: true });
  const doc = {
    meta: { schemaVersion: 1, lastRefresh: null },
    items: communitySkills.map(communityRegistryItemDoc),
  };
  writeFileSync(join(communityDir, 'registry.yaml'), yaml.dump(doc), 'utf8');
}

/** A minimal, valid studio-agent AgentDefinition fixture (no disk I/O). */
function makeAgentDef(slug: string, composedSkills: string[]): AgentDefinition {
  return {
    slug,
    name: slug,
    description: `Agent ${slug}.`,
    purpose: 'Test purpose.',
    composition: { skills: composedSkills, tools: [], mcps: [], hooks: [], guards: [] },
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

/**
 * The central, git-tracked install ledger — `studio/installed-skills.yaml`
 * (Blocker 2 fix design, T2-binding). A top-level `installed:` list of
 * `{ id, source, upstreamRef?, contentHash, installedAt }` records, mirroring
 * the existing `community-skills:` list-of-records convention in
 * `studio/catalog.yaml`. Read/write helpers for test fixtures only — the
 * production module owns its own internal read of this same file.
 */
function readInstalledSkillsLedger(root: string): Array<Record<string, unknown>> {
  const p = join(root, 'studio', 'installed-skills.yaml');
  if (!existsSync(p)) return [];
  const doc = yaml.load(readFileSync(p, 'utf8')) as { installed?: unknown[] } | null;
  return Array.isArray(doc?.installed) ? (doc!.installed as Array<Record<string, unknown>>) : [];
}

function writeInstalledSkillsLedger(root: string, entries: Array<Record<string, unknown>>): void {
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'installed-skills.yaml'), yaml.dump({ installed: entries }), 'utf8');
}

function removeLedgerEntry(root: string, id: string): void {
  writeInstalledSkillsLedger(root, readInstalledSkillsLedger(root).filter((e) => e['id'] !== id));
}

/** A full recursive listing of `skills/` (relative, sorted, POSIX-separated) —
 *  used to prove "nothing written" / "byte-identical" across an entire
 *  subtree, not just a single file or a single top-level entry. */
function snapshotSkillsTree(root: string): string[] {
  const base = skillsDir(root);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(base, '');
  return out.sort();
}

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

  // W7-B3 (community-25): a registry-only community row has NO local bytes —
  // nothing exists to trust, compose, or bind. Reporting it palette-visible
  // (composable) while /community says the same object cannot even be
  // installed was two surfaces contradicting each other about one id. It is
  // a browse-only REFERENCE: `reference: true`, never palette-visible.
  it('W7-B3: a registry-only community skill (no disk package) is a browse-only reference — reference:true, paletteVisible:false', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root, [
      { id: 'browse-only', name: 'Browse Only', provenance: 'someone', source: 'https://z', category: 'meta' },
    ]);

    const entry = listSkillLibrary(root).find((e) => e.id === 'browse-only');
    assert.ok(entry, 'the reference entry must still appear (browseable)');
    assert.equal(entry!.reference, true, 'no local bytes = a reference, stated as a real field');
    assert.equal(entry!.paletteVisible, false, 'nothing composable exists — it must never surface in the agent-builder palette');
    assert.equal(entry!.installed, false);
  });

  it('W7-B3: a community id that IS on disk carries no reference flag (the filesystem entry is the real thing)', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root, [
      { id: 'handoff', name: 'Handoff', provenance: 'obra/superpowers', source: 'https://x', category: 'memory' },
    ]);
    writeSkillMd(root, 'handoff', { name: 'Handoff (local copy)', description: 'compress session' });
    const entry = listSkillLibrary(root).find((e) => e.id === 'handoff');
    assert.ok(entry);
    assert.notEqual(entry!.reference, true, 'an on-disk skill is never a browse-only reference');
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
      composition: { skills: [], tools: [], mcps: [], guards: [] },
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

  // W7-B3 (library-31): the occupied-destination short-circuit must tell a
  // MANAGED occupancy (this package installed earlier — provenance block
  // present, honest alreadyInstalled) apart from an UNRELATED local skill
  // that merely shares the id. The old {alreadyInstalled:true} for the
  // latter was a laundered false success the /community badge could never
  // clear.
  it('W7-B3: an id occupied by an UNRELATED local skill (no provenance) THROWS a refusal and leaves the victim byte-identical — never a false alreadyInstalled', () => {
    const root = makeForgeRoot();
    const dir = join(root, 'skills', 'occupied-id');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      skillPath('occupied-id', root),
      matter.stringify('\n# Local\n\nHand-authored, unrelated.\n', { name: 'My Local Skill', description: 'hand-authored', library: true }),
      'utf8',
    );
    const before = readFileSync(skillPath('occupied-id', root), 'utf8');
    const packageDir = makePackageDir();
    assert.throws(
      () => installSkillPackage({ forgeRoot: root, id: 'occupied-id', packageDir, upstream: { source: 'https://x' } }),
      (err: unknown) =>
        err instanceof SkillIdOccupiedError && /unmanaged|provenance/i.test((err as Error).message),
      'an unrelated occupancy must refuse loudly via the NAMED SkillIdOccupiedError (route callers map it to 409 without string-matching), naming why',
    );
    assert.equal(readFileSync(skillPath('occupied-id', root), 'utf8'), before, 'the unrelated local skill must stay byte-identical');
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
      composition: { skills: ['some-draft-skill'], tools: [], mcps: [], guards: [] },
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
      composition: { skills: ['totally-unknown-skill-id'], tools: [], mcps: [], guards: [] },
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

// ===========================================================================
// BLOCKER 1 — id is never slug-validated, so a path can escape via the id
// itself (adversarial re-review, R3-01-F4). Every id-taking export must
// reject a non-slug id (SLUG_RE from orchestrator/studio/validate.ts) by
// THROWING with an actionable message naming the bad id, before any fs
// mutation.  (AT 66-71)
// ===========================================================================

describe('id validation — every id-taking export rejects a non-slug id', () => {
  function makeEvilPackageDir(extraFiles: Record<string, string> = {}): string {
    const dir = makeTmpDir('skill-pkg-idval-');
    writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Evil', description: 'd' }), 'utf8');
    for (const [rel, content] of Object.entries(extraFiles)) {
      const p = join(dir, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, content, 'utf8');
    }
    return dir;
  }

  it('AT-66: id: "." throws, and skills/ gains no new file (whole-tree snapshot before/after)', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });
    const before = snapshotSkillsTree(root);

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: '.', packageDir: makeEvilPackageDir(), upstream: { source: 'https://x' } }));

    assert.deepEqual(snapshotSkillsTree(root), before, 'the skills/ subtree must be untouched');
  });

  it('AT-67: id: "" throws, nothing written', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });
    const before = snapshotSkillsTree(root);

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: '', packageDir: makeEvilPackageDir(), upstream: { source: 'https://x' } }));

    assert.deepEqual(snapshotSkillsTree(root), before);
  });

  it('AT-68: id: "sub/evil" (and a backslash variant) throws, nothing written', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });
    const before = snapshotSkillsTree(root);

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: 'sub/evil', packageDir: makeEvilPackageDir(), upstream: { source: 'https://x' } }));
    assert.throws(() => installSkillPackage({ forgeRoot: root, id: 'sub\\evil', packageDir: makeEvilPackageDir(), upstream: { source: 'https://x' } }));

    assert.deepEqual(snapshotSkillsTree(root), before, 'neither variant may create an orphan directory under skills/');
  });

  it('AT-69: id: ".." throws, nothing written', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });
    const before = snapshotSkillsTree(root);

    assert.throws(() => installSkillPackage({ forgeRoot: root, id: '..', packageDir: makeEvilPackageDir(), upstream: { source: 'https://x' } }));

    assert.deepEqual(snapshotSkillsTree(root), before);
  });

  it("AT-70: the reviewer's exact escape is closed — a package file at <sibling>/evil.sh plus id: '.' throws, sibling untouched", () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'brain-query', { name: 'Brain Query', description: 'a real, unrelated sibling skill' });
    const siblingBefore = readdirSync(skillDir('brain-query', root)).sort();
    const siblingContentBefore = readFileSync(skillPath('brain-query', root), 'utf8');

    const evilPackage = makeEvilPackageDir({ 'brain-query/evil.sh': '#!/bin/sh\necho pwned\n' });
    assert.throws(() => installSkillPackage({ forgeRoot: root, id: '.', packageDir: evilPackage, upstream: { source: 'https://x' } }));

    assert.deepEqual(readdirSync(skillDir('brain-query', root)).sort(), siblingBefore, "the sibling skill's directory listing must be byte-identical");
    assert.equal(readFileSync(skillPath('brain-query', root), 'utf8'), siblingContentBefore);
  });

  it('AT-71: skillTrustState / readSkillPackage / approveSkillDraft / repinSkillPackage each throw on a non-slug id', () => {
    const root = makeForgeRoot();
    // A REAL file sits exactly where the non-slug id "." collapses to
    // (skills/SKILL.md, since skillDir('.', root) === skillsDir(root)) — so a
    // throw here can only come from id validation itself, never an
    // incidental "file not found".
    mkdirSync(skillsDir(root), { recursive: true });
    writeFileSync(
      join(skillsDir(root), 'SKILL.md'),
      matter.stringify('\nBody.\n', {
        name: 'x',
        description: 'd',
        status: 'draft',
        provenance: { source: 'https://x', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
      }),
      'utf8',
    );
    const badId = '.';

    assert.throws(() => skillTrustState(root, badId), 'skillTrustState must reject a non-slug id');
    assert.throws(() => readSkillPackage(root, badId), 'readSkillPackage must reject a non-slug id');
    assert.throws(() => approveSkillDraft({ forgeRoot: root, id: badId }), 'approveSkillDraft must reject a non-slug id');
    assert.throws(() => repinSkillPackage({ forgeRoot: root, id: badId }), 'repinSkillPackage must reject a non-slug id');
  });
});

// ===========================================================================
// BLOCKER 2 — the hash pin lives only inside the file it protects, so
// deleting it downgrades a tampered skill to trusted. Fix: a central,
// git-tracked install ledger (`studio/installed-skills.yaml`) is the second
// source of truth skillTrustState cross-checks on-disk provenance against.
//
// HONESTY CONSTRAINT (per the binding design): this is NOT tamper-proof — an
// attacker who edits both files defeats it. The tests below assert only that
// tampering with ONE of the two files (on-disk provenance OR the ledger) is
// caught, never that the scheme is unbeatable.  (AT 72-81)
// ===========================================================================

describe('install ledger — the second source of truth (studio/installed-skills.yaml)', () => {
  function installAndApprove(root: string, id: string): void {
    const packageDir = makeTmpDir('skill-pkg-ledger-');
    writeFileSync(join(packageDir, 'SKILL.md'), matter.stringify('\nOriginal body.\n', { name: id, description: 'installable' }), 'utf8');
    installSkillPackage({ forgeRoot: root, id, packageDir, upstream: { source: 'https://x' } });
    approveSkillDraft({ forgeRoot: root, id });
  }

  /** A skill authored directly on disk (bypassing installSkillPackage — no
   *  ledger entry is ever written for it) whose provenance.contentHash is
   *  nonetheless internally self-consistent: hashSkillPackage excludes the
   *  `provenance` key itself from the hash input, so any value placed there
   *  survives a "compute the real hash of THIS exact file" round-trip. This
   *  simulates "content is not tampered" while still being unregistered. */
  function writeUnregisteredButConsistentSkill(root: string, id: string): void {
    writeSkillMd(root, id, {
      name: id,
      description: 'never went through installSkillPackage',
      provenance: { source: 'https://unregistered.example', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
    });
    const realHash = hashSkillPackage(readSkillPackage(root, id));
    const data = readFrontmatter(root, id);
    (data['provenance'] as Record<string, unknown>)['contentHash'] = realHash;
    const raw = readFileSync(skillPath(id, root), 'utf8');
    const { content } = matter(raw, {});
    writeFileSync(skillPath(id, root), matter.stringify('\n' + content.replace(/^\n+/, ''), data), 'utf8');
  }

  it('AT-72: install writes a studio/installed-skills.yaml entry (id, source, contentHash, installedAt); upstreamRef only when supplied', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);

    installAndApprove(root, 'ledger-with-ref');
    installSkillPackage({
      forgeRoot: root,
      id: 'ledger-without-ref',
      packageDir: (() => {
        const dir = makeTmpDir('skill-pkg-ledger-noref-');
        writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'x', description: 'd' }), 'utf8');
        return dir;
      })(),
      upstream: { source: 'https://x', ref: undefined },
    });
    // Re-install ledger-with-ref's underlying id WITH a ref via a fresh id to
    // exercise the upstreamRef-present path distinctly from the absent path.
    installSkillPackage({
      forgeRoot: root,
      id: 'ledger-with-ref-2',
      packageDir: (() => {
        const dir = makeTmpDir('skill-pkg-ledger-ref2-');
        writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'x', description: 'd' }), 'utf8');
        return dir;
      })(),
      upstream: { source: 'https://x', ref: 'v2.0.0' },
    });

    const ledger = readInstalledSkillsLedger(root);
    const withRef = ledger.find((e) => e['id'] === 'ledger-with-ref-2');
    const withoutRef = ledger.find((e) => e['id'] === 'ledger-without-ref');

    assert.ok(withRef, 'a ledger entry must be written on install');
    assert.equal(withRef!['source'], 'https://x');
    assert.match(String(withRef!['contentHash']), /^sha256:[0-9a-f]{64}$/);
    assert.match(String(withRef!['installedAt']), ISO_8601_RE);
    assert.equal(withRef!['upstreamRef'], 'v2.0.0');

    assert.ok(withoutRef, 'a ledger entry must be written even without a ref');
    assert.ok(!('upstreamRef' in withoutRef!), 'upstreamRef must be ABSENT (no placeholder) when not supplied');
  });

  it('AT-73: TAMPER — provenance key deleted: needs-review, paletteVisible:false, excluded from the palette, lintSkillTrust reports provenance-tampered', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    installAndApprove(root, 'victim-provenance-deleted');

    const mdPath = skillPath('victim-provenance-deleted', root);
    const data = readFrontmatter(root, 'victim-provenance-deleted');
    delete data['provenance'];
    writeFileSync(mdPath, matter.stringify('\nMALICIOUS INJECTED BODY\n', data), 'utf8');

    assert.equal(skillTrustState(root, 'victim-provenance-deleted'), 'needs-review');
    const entry = listSkillLibrary(root).find((e) => e.id === 'victim-provenance-deleted');
    assert.ok(entry);
    assert.equal(entry!.paletteVisible, false);
    assert.ok(
      !listPlainSkills(root).map((s) => s.id).includes('victim-provenance-deleted'),
      'must be excluded via the palette enumeration, not just a status field',
    );
    const findings = lintSkillTrust(root);
    assert.ok(findings.some((f) => f.check === 'skill-trust/provenance-tampered'));
  });

  it('AT-74: TAMPER — contentHash sub-field deleted only (body untouched): same outcome as AT-73', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    installAndApprove(root, 'victim-hash-field-deleted');

    const mdPath = skillPath('victim-hash-field-deleted', root);
    const data = readFrontmatter(root, 'victim-hash-field-deleted');
    delete (data['provenance'] as Record<string, unknown>)['contentHash'];
    const raw = readFileSync(mdPath, 'utf8');
    const { content } = matter(raw, {});
    writeFileSync(mdPath, matter.stringify('\n' + content.replace(/^\n+/, ''), data), 'utf8');

    assert.equal(skillTrustState(root, 'victim-hash-field-deleted'), 'needs-review');
    const entry = listSkillLibrary(root).find((e) => e.id === 'victim-hash-field-deleted');
    assert.ok(entry);
    assert.equal(entry!.paletteVisible, false);
    assert.ok(!listPlainSkills(root).map((s) => s.id).includes('victim-hash-field-deleted'));
    assert.ok(lintSkillTrust(root).some((f) => f.check === 'skill-trust/provenance-tampered'));
  });

  it('AT-75: TAMPER — contentHash present but altered to a different valid-looking sha: needs-review + provenance-tampered', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    installAndApprove(root, 'victim-hash-altered');

    const mdPath = skillPath('victim-hash-altered', root);
    const data = readFrontmatter(root, 'victim-hash-altered');
    (data['provenance'] as Record<string, unknown>)['contentHash'] = `sha256:${'a'.repeat(64)}`;
    const raw = readFileSync(mdPath, 'utf8');
    const { content } = matter(raw, {});
    writeFileSync(mdPath, matter.stringify('\n' + content.replace(/^\n+/, ''), data), 'utf8');

    assert.equal(skillTrustState(root, 'victim-hash-altered'), 'needs-review');
    // NOTE: a plain byte-drift check alone would already call this needs-review
    // (the fabricated hash no longer matches the real recomputed hash either),
    // so the specific, load-bearing assertion here is the FINDING CHECK ID —
    // the ledger cross-check must recognise this as tampering against its own
    // recorded pin, not merely as generic drift.
    assert.ok(lintSkillTrust(root).some((f) => f.check === 'skill-trust/provenance-tampered'));
  });

  it('AT-76: UNREGISTERED — full, internally-consistent provenance block with NO matching ledger entry → needs-review + unregistered-install', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeUnregisteredButConsistentSkill(root, 'unregistered-skill');

    assert.equal(skillTrustState(root, 'unregistered-skill'), 'needs-review');
    assert.ok(lintSkillTrust(root).some((f) => f.check === 'skill-trust/unregistered-install'));
  });

  it('AT-77: deleting the ledger ENTRY while on-disk provenance survives → needs-review (case 76, arrived at from the other direction)', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    installAndApprove(root, 'orphaned-ledger-entry');
    assert.equal(skillTrustState(root, 'orphaned-ledger-entry'), 'ready', 'sanity: consistent + registered starts ready');

    removeLedgerEntry(root, 'orphaned-ledger-entry');

    assert.equal(skillTrustState(root, 'orphaned-ledger-entry'), 'needs-review');
    assert.ok(lintSkillTrust(root).some((f) => f.check === 'skill-trust/unregistered-install'));
  });

  it('AT-78: a hand-authored skill (no provenance, no ledger entry) stays ready + palette-visible after arbitrary edits (AT-37 survives the ledger)', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'hand-authored-with-ledger', { name: 'Hand Authored', description: 'no provenance ever' });
    writeSkillFile(root, 'hand-authored-with-ledger', 'notes.md', 'v1');

    assert.equal(skillTrustState(root, 'hand-authored-with-ledger'), 'ready');

    writeSkillFile(root, 'hand-authored-with-ledger', 'notes.md', 'v2 — an arbitrary edit');

    assert.equal(skillTrustState(root, 'hand-authored-with-ledger'), 'ready');
    const entry = listSkillLibrary(root).find((e) => e.id === 'hand-authored-with-ledger');
    assert.ok(entry);
    assert.equal(entry!.paletteVisible, true);
    assert.ok(listPlainSkills(root).map((s) => s.id).includes('hand-authored-with-ledger'));
  });

  it('AT-79: an absent studio/installed-skills.yaml (fresh checkout, nothing ever installed) is NOT an error', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'fresh-checkout-skill-a', { name: 'A', description: 'hand-authored' });
    writeSkillMd(root, 'fresh-checkout-skill-b', { name: 'B', description: 'hand-authored' });
    assert.equal(existsSync(join(root, 'studio', 'installed-skills.yaml')), false, 'sanity: no ledger file exists at all');

    assert.doesNotThrow(() => listSkillLibrary(root));
    assert.doesNotThrow(() => lintSkillTrust(root));

    const entries = listSkillLibrary(root);
    assert.equal(entries.find((e) => e.id === 'fresh-checkout-skill-a')!.trust, 'ready');
    assert.equal(entries.find((e) => e.id === 'fresh-checkout-skill-b')!.trust, 'ready');
    assert.deepEqual(lintSkillTrust(root), []);
  });

  it('AT-80: a malformed/unparseable studio/installed-skills.yaml FAILS LOUD — never silently treated as empty', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    // A skill whose on-disk provenance WOULD be wrongly resolved to 'ready' if
    // the malformed ledger were silently treated as "no ledger" (re-opening
    // Blocker 2 by a different door).
    writeUnregisteredButConsistentSkill(root, 'ledger-malformed-skill');
    mkdirSync(join(root, 'studio'), { recursive: true });
    writeFileSync(join(root, 'studio', 'installed-skills.yaml'), 'installed: [ { id: broken, source: \n', 'utf8');

    let threw = false;
    let observedTrust: string | undefined;
    try {
      observedTrust = skillTrustState(root, 'ledger-malformed-skill');
    } catch {
      threw = true;
    }
    if (!threw) {
      // If it didn't throw, it must not have silently resolved as if the
      // ledger were empty — that would be exactly the class of failure this
      // whole ledger mechanism exists to close.
      assert.notEqual(observedTrust, 'ready', 'a malformed ledger must never be silently treated as empty');
    }
  });

  it('AT-81: repinSkillPackage after an intentional edit updates BOTH the on-disk hash and the ledger entry, returning trust to ready', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    installAndApprove(root, 'repin-with-ledger');
    const hashBefore = (readFrontmatter(root, 'repin-with-ledger')['provenance'] as Record<string, unknown>)['contentHash'];
    const ledgerHashBefore = readInstalledSkillsLedger(root).find((e) => e['id'] === 'repin-with-ledger')!['contentHash'];
    assert.equal(ledgerHashBefore, hashBefore, 'sanity: ledger and on-disk pin start in agreement');

    writeSkillFile(root, 'repin-with-ledger', 'extra.md', 'an intentional local edit');
    assert.equal(skillTrustState(root, 'repin-with-ledger'), 'needs-review');

    const newHash = repinSkillPackage({ forgeRoot: root, id: 'repin-with-ledger' });

    assert.notEqual(newHash, hashBefore);
    const ledgerAfter = readInstalledSkillsLedger(root).find((e) => e['id'] === 'repin-with-ledger');
    assert.ok(ledgerAfter, 'the ledger entry must still exist after repin');
    assert.equal(ledgerAfter!['contentHash'], newHash, 'the ledger entry itself must be updated by repin, not just the on-disk file');
    assert.equal(skillTrustState(root, 'repin-with-ledger'), 'ready');
  });
});

// ===========================================================================
// Third adversarial-review round (MAJOR 1, MINOR 1, MINOR 2, MAJOR 2):
//
// MAJOR 1 — a hand-written ledger with two entries sharing an `id` (different
// contentHash) parses to a Map of size 1, last-one-wins, no throw. The
// ledger's whole job is to be an independently self-consistent second source
// of truth; it must enforce its own 1:1 shape.
//
// MINOR 1 — ledger entry ids are never slug-validated (`../../etc/passwd`,
// `NOT-a-slug!!` both parse in inert). Not currently exploitable (callers
// resolve through the now-guarded skillPath), but it is a second-source-of-
// truth file with no shape enforcement.
//
// MINOR 2 — assertSkillSlug has no length cap; an over-long charset-valid id
// dies as a raw ENAMETOOLONG instead of an actionable validation message.
//
// MAJOR 2 (promoted from "out of scope" by T2) — isStudioAgent() is purely
// structural (checks only for `runtime:` + `library !== false`). Hand-editing
// an installed community skill to move `quarantined.runtime` back to
// top-level `runtime:` makes it load as a legitimate studio agent via
// listAgentDefinitions, which never consults trust. Enforced at the palette,
// not at the agent roster — this repo's #1 recurring defect class, and a
// direct contradiction of D4 ("an installed+approved skill can never be
// loaded as a studio agent").
//
// AT-89 also regression-guards the planned SLUG_RE relocation
// (validate.ts → skill-path.ts, to break the skill-path → validate →
// registry → skill-path import cycle the guard introduced). AT-84 and AT-89
// probe not-yet-existing named exports via DYNAMIC import deliberately — a
// static top-level import of a name that doesn't exist yet would fail the
// whole module at link time (ERR: "does not provide an export named ..."),
// taking down every other test in this file, not just the new one.
//   (AT 82-89)
// ===========================================================================

describe('ledger integrity — duplicate/non-slug entry ids must fail loud', () => {
  it('AT-82: a ledger with two entries sharing an id (different contentHash) → readInstallLedger THROWS, naming the duplicated id', () => {
    const root = makeForgeRoot();
    writeInstalledSkillsLedger(root, [
      { id: 'dup-skill', source: 'https://a', contentHash: `sha256:${'1'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'dup-skill', source: 'https://b', contentHash: `sha256:${'2'.repeat(64)}`, installedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    assert.throws(
      () => readInstallLedger(root),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('dup-skill'), `expected the duplicated id in the message: ${err.message}`);
        return true;
      },
    );
  });

  it('AT-83: a ledger entry with a non-slug id throws, naming the bad id', () => {
    for (const badId of ['../../etc/passwd', 'NOT-a-slug!!']) {
      const root = makeForgeRoot();
      writeInstalledSkillsLedger(root, [
        { id: badId, source: 'https://x', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
      ]);

      assert.throws(
        () => readInstallLedger(root),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes(badId), `expected "${badId}" in the message: ${err.message}`);
          return true;
        },
        `expected a throw for ledger entry id ${JSON.stringify(badId)}`,
      );
    }
  });
});

describe('assertSkillSlug — length cap', () => {
  it('AT-84: an over-long but charset-valid id → installSkillPackage throws an actionable (non-ENAMETOOLONG) message naming the length limit; nothing written; the cap is an exported named constant', async () => {
    const skillPathModule = (await import('../skill-path.ts')) as Record<string, unknown>;
    const cap = skillPathModule['MAX_SKILL_ID_LENGTH'];
    assert.equal(typeof cap, 'number', 'expected an exported named constant MAX_SKILL_ID_LENGTH in orchestrator/skill-path.ts for the id length cap');

    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });
    const before = snapshotSkillsTree(root);

    const overLongId = 'a'.repeat((cap as number) + 50);
    const packageDir = makeTmpDir('skill-pkg-overlong-');
    writeFileSync(join(packageDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'x', description: 'd' }), 'utf8');

    assert.throws(
      () => installSkillPackage({ forgeRoot: root, id: overLongId, packageDir, upstream: { source: 'https://x' } }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!/ENAMETOOLONG/.test(err.message), `must not leak the raw OS error: ${err.message}`);
        assert.ok(/length|too long|characters|exceeds/i.test(err.message), `must name the length limit: ${err.message}`);
        return true;
      },
    );
    assert.deepEqual(snapshotSkillsTree(root), before, 'nothing must be written for a rejected id');
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

  it('AT-87: lintSkillTrust reports skill-trust/installed-agent-shape for that skill, naming it', () => {
    const root = makeForgeRoot();
    writeCatalogYaml(root);
    writeSkillMd(root, 'fake-installed-agent-lint', {
      ...FULL_AGENT_FRONTMATTER,
      provenance: { source: 'https://x', contentHash: `sha256:${'0'.repeat(64)}`, installedAt: '2026-01-01T00:00:00.000Z' },
    });

    const findings = lintSkillTrust(root);
    const f = findings.find((x) => x.check === 'skill-trust/installed-agent-shape');
    assert.ok(f, `expected a skill-trust/installed-agent-shape finding, got: ${JSON.stringify(findings)}`);
    assert.ok(f!.message.includes('fake-installed-agent-lint'), 'message must name the offending skill');
  });

  it('AT-88: REGRESSION GUARD — a normal shipped agent (no provenance, no quarantined) stays isStudioAgent + in listAgentDefinitions; the real repo roster count is pinned', () => {
    const root = makeForgeRoot();
    writeSkillMd(root, 'normal-agent', FULL_AGENT_FRONTMATTER);

    assert.equal(isStudioAgent(skillPath('normal-agent', root)), true);
    assert.ok(listAgentDefinitions(skillsDir(root)).some((d) => d.slug === 'normal-agent'));

    // Pinned against the REAL repo (captured 2026-08-04 against commit
    // 23f414fe: `listAgentDefinitions(skillsDir())` → 10 agents; bumped to 11
    // for R4-18's `contract-check` def; bumped to 12 for W6-CR-3's
    // `community-refresh` def — the first interactive session-kind agent to
    // declare `library: true`, see orchestrator/studio/seed-data.test.ts's
    // own roster pin for why) so the fix cannot quietly delete agents from
    // the roster while closing the hole.
    const REAL_AGENT_COUNT = 12;
    assert.equal(
      listAgentDefinitions(skillsDir(REPO_ROOT)).length,
      REAL_AGENT_COUNT,
      'the real shipped agent roster count must not change from closing this hole',
    );
  });
});

describe('SLUG_RE relocation regression guard', () => {
  it('AT-89: SLUG_RE re-exported identically from orchestrator/skill-path.ts and orchestrator/studio/validate.ts', async () => {
    const skillPathModule = (await import('../skill-path.ts')) as Record<string, unknown>;
    const validateModule = (await import('./validate.ts')) as Record<string, unknown>;

    const fromSkillPath = skillPathModule['SLUG_RE'] as RegExp | undefined;
    const fromValidate = validateModule['SLUG_RE'] as RegExp;

    assert.ok(fromSkillPath, 'orchestrator/skill-path.ts must export SLUG_RE once the definition moves there (breaking the import cycle)');
    assert.equal(fromSkillPath!.source, fromValidate.source, 'both re-exports must be the identical regex, not a divergent copy');
  });
});

// ===========================================================================
// scanSkillPackage must report keys quarantined AT INSTALL, not only ones
// still sitting at top level (ui:journey-found defect, R3-01-F4).
//
// `quarantinedKeys` was computed from the package's CURRENT top-level
// frontmatter only. The one production caller — GET /api/studio/skills/<id>
// for a draft, feeding the operator's approval gate — hands it the
// ALREADY-INSTALLED package, where `runtime`/`allowed-tools` have already
// been moved under the nested `quarantined:` block by installSkillPackage
// (D4). So those two keys could never appear in the scan report; only
// `library` (always present, always top-level on a fresh draft) ever showed,
// and the count was always exactly 1 — silently under-reporting on the exact
// axis the scan exists to surface (did this untrusted package try to declare
// a runtime / grab its own tools?).
//
// Fix (binding, T2): quarantinedKeys is the union of the quarantine-able keys
// (`runtime`, `allowed-tools`, `library`) present at TOP LEVEL of the supplied
// SKILL.md and the keys present under its nested `quarantined:` block — deduped,
// ordered by QUARANTINED_FRONTMATTER_KEYS's own declared order
// (runtime, allowed-tools, library), which is what the tests below assert
// rather than a sorted array (so the order assertion is itself load-bearing,
// not incidental).  (AT 90-94)
// ===========================================================================

describe('scanSkillPackage — quarantined keys are reported from BOTH top-level and nested quarantined: (defect fix)', () => {
  it("AT-90: a nested quarantined: block (runtime + allowed-tools) is reported — the defect's direct regression test", () => {
    const files = [
      {
        path: 'SKILL.md',
        body: matter.stringify('\nBody.\n', {
          name: 'x',
          description: 'd',
          status: 'draft',
          library: false,
          quarantined: {
            runtime: { sdk: 'claude', strategy: 'fixed' },
            'allowed-tools': ['Read'],
          },
        }),
      },
    ];
    const report = scanSkillPackage(files);
    assert.ok(report.quarantinedKeys.includes('runtime'), 'runtime moved under quarantined: must still be reported');
    assert.ok(report.quarantinedKeys.includes('allowed-tools'), 'allowed-tools moved under quarantined: must still be reported');
  });

  it('AT-91: THE REAL PIPELINE, end to end — install → readSkillPackage the draft → scan reports runtime+allowed-tools+library (count 3, not 1)', () => {
    const root = makeForgeRoot();
    const packageDir = makeTmpDir('skill-pkg-scan-e2e-');
    writeFileSync(
      join(packageDir, 'SKILL.md'),
      matter.stringify('\nBody.\n', {
        name: 'Vendored Agent-Shaped Skill',
        description: 'declares runtime + allowed-tools + library at the source',
        runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
        'allowed-tools': ['Read'],
        library: true,
      }),
      'utf8',
    );

    installSkillPackage({ forgeRoot: root, id: 'scan-e2e-skill', packageDir, upstream: { source: 'https://x' } });

    // The REAL functions, not a hand-built fixture: read the INSTALLED draft
    // back off disk exactly as the GET /api/studio/skills/<id> route does,
    // then scan THAT.
    const installedFiles = readSkillPackage(root, 'scan-e2e-skill');
    const report = scanSkillPackage(installedFiles);

    assert.deepEqual(
      report.quarantinedKeys,
      ['runtime', 'allowed-tools', 'library'],
      'must report all three quarantined keys, not just the one (library) that happens to still sit at top level',
    );
    assert.equal(report.quarantinedKeys.length, 3);
  });

  it('AT-92: dedupe/order — library present BOTH at top level and inside quarantined: yields library exactly once, in QUARANTINED_FRONTMATTER_KEYS declared order', () => {
    const files = [
      {
        path: 'SKILL.md',
        body: matter.stringify('\nBody.\n', {
          name: 'x',
          description: 'd',
          library: true, // top-level
          quarantined: { runtime: { sdk: 'claude', strategy: 'fixed' }, library: false }, // library ALSO nested
        }),
      },
    ];
    const report = scanSkillPackage(files);
    // Asserted order: QUARANTINED_FRONTMATTER_KEYS's own declaration order
    // (runtime, allowed-tools, library) — NOT alphabetical, NOT insertion
    // order of top-level-then-nested. A key present in both locations must
    // still appear exactly once.
    assert.deepEqual(report.quarantinedKeys, ['runtime', 'library']);
  });

  it('AT-93: a package with NO quarantine-able keys anywhere (top-level or nested) → quarantinedKeys is [] (guards over-reporting)', () => {
    const noKeys = [{ path: 'SKILL.md', body: matter.stringify('\nBody.\n', { name: 'x', description: 'd' }) }];
    assert.deepEqual(scanSkillPackage(noKeys).quarantinedKeys, []);

    // An empty (present-but-empty) quarantined: block must not itself count
    // as anything — its KEY NAME is not one of the three tracked keys.
    const emptyQuarantinedBlock = [
      { path: 'SKILL.md', body: matter.stringify('\nBody.\n', { name: 'x', description: 'd', quarantined: {} }) },
    ];
    assert.deepEqual(scanSkillPackage(emptyQuarantinedBlock).quarantinedKeys, []);
  });

  it('AT-94: AT-42\'s rule still holds — key set is exactly {quarantinedKeys, executableFiles, fileCount, totalBytes, body}, still no verdict field (D5)', () => {
    const files = [
      {
        path: 'SKILL.md',
        body: matter.stringify('\nBody.\n', {
          name: 'x',
          description: 'd',
          quarantined: { runtime: { sdk: 'claude', strategy: 'fixed' } },
        }),
      },
    ];
    const report = scanSkillPackage(files);
    assert.deepEqual(
      Object.keys(report).sort(),
      ['body', 'executableFiles', 'fileCount', 'quarantinedKeys', 'totalBytes'].sort(),
    );
  });
});

// ===========================================================================
// SEC-05 q80 — skill/hook package install CONTAINMENT (RED at base).
//
// PROVEN defect this pins (d2): installSkillPackage's per-entry destination
// guard is a LEXICAL check — `resolve(join(skillDir(id), ...f.path)).startsWith(
// skillsDir + sep)` (skill-library.ts:613-621) — and its idempotency
// short-circuit is `existsSync(skillPath(id))` (skill-library.ts:547).
// `resolve()` does NOT dereference symlinks and `existsSync` DOES follow them,
// so a pre-planted symlink at (or below) `skills/<id>` lets a write escape
// through it: the lexical path never leaves `skills/`, yet the real inode is
// outside the root (or is a DIFFERENT skill). The SEC-04 primitive
// `guardedFile(root, segments, mode)` (cli/studio-path-guard.ts) does
// per-SEGMENT realpath identity, catching every shape below.
//
// SURFACE NOTE (honest scope): this file tests the ORCHESTRATOR function
// installSkillPackage — i.e. the d2 destination guard. Two sibling q80 vectors
// are NOT reachable at this surface and are pinned in the bridge/staging suite
// instead, NOT here:
//   * d1 "client-named SOURCE root pointing outside both roots" — a bridge
//     concern (cli/bridge-studio-skills.test.ts); installSkillPackage is
//     CONTRACTUALLY handed a package directory to copy, so it can never be the
//     refusal point for the source path (post-fix it receives a server-minted,
//     already-guarded staging realpath).
//   * a literal `..`-string ENTRY path ('a/../../../../tmp/OUT/x') — the entry
//     paths installSkillPackage sees come from a real readdirSync() walk, which
//     never yields a `..` segment, so that string is only injectable at the
//     staging layer where `path` is client-supplied (cli/skill-staging.test.ts).
// Writing either against installSkillPackage would produce a gate that can
// never go GREEN (immutable-gates: a test must flip, not merely stay red), so
// the reachable analogs below (a symlinked skills/<id>, and a symlinked NESTED
// destination segment) carry the intent here.
//
// Each test asserts the OUT-OF-ROOT (or cross-object) ARTIFACT is byte-absent /
// byte-unchanged — never merely that a call "returned an error" — plants and
// verifies its symlink PRECONDITION before reading the verdict, and pins
// per-element isolation (one escaping entry refuses the WHOLE install; the
// sibling-valid entry is never written = no partial write). Named killed impl
// per test.  (AT q80-1 .. q80-5)
// ===========================================================================

import { lstatSync } from 'node:fs';

describe('SEC-05 q80 — skill install containment (installSkillPackage, d2)', () => {
  /** A benign, valid package (SKILL.md + reference.md) in a throwaway tmp dir.
   *  The SOURCE side is never the vector under test here — every vector below
   *  is an attacker-planted DESTINATION shape under skills/. */
  function benignPackage(): string {
    const dir = makeTmpDir('sec05-q80-pkg-');
    writeFileSync(
      join(dir, 'SKILL.md'),
      matter.stringify('\n# Benign\n\nBody.\n', { name: 'Benign', description: 'benign package' }),
      'utf8',
    );
    writeFileSync(join(dir, 'reference.md'), 'reference content', 'utf8');
    return dir;
  }

  /** Recursive, sorted relative listing of an arbitrary directory — proves an
   *  outside region / sibling skill gains NOTHING, not just that one named
   *  file is absent. */
  function listTree(base: string): string[] {
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = (absDir: string, relDir: string): void => {
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(absDir, entry.name), rel);
        else out.push(rel);
      }
    };
    walk(base, '');
    return out.sort();
  }

  it('AT-q80-1 (exfil / dedup-follows-symlink): a pre-planted skills/<id> symlink to OUTSIDE both roots must be REFUSED, never blessed as already-installed — kills the existsSync-follows-symlink short-circuit at skill-library.ts:547', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });

    // A region OUTSIDE both the forge root and skills/ (a sibling temp dir),
    // pre-seeded to LOOK like an installed package (it has a SKILL.md) and to
    // hold a secret the attacker wants GET /api/studio/skills/<id> to read back.
    const outside = makeTmpDir('sec05-q80-outside1-');
    writeFileSync(
      join(outside, 'SKILL.md'),
      matter.stringify('\nAliased body.\n', { name: 'Exfil', description: 'aliased-in from outside both roots' }),
      'utf8',
    );
    const secretPath = join(outside, 'secret.txt');
    writeFileSync(secretPath, 'TOP SECRET — must never be surfaced through skills/', 'utf8');
    const secretBefore = readFileSync(secretPath, 'utf8');
    const outsideBefore = listTree(outside);

    // The attack: skills/exfil-skill is a SYMLINK into that outside region.
    const aliasPath = skillDir('exfil-skill', root);
    symlinkSync(outside, aliasPath);
    assert.ok(lstatSync(aliasPath).isSymbolicLink(), 'precondition: skills/exfil-skill symlink is planted');

    // TODAY (RED): existsSync(skills/exfil-skill/SKILL.md) FOLLOWS the symlink,
    // finds outside/SKILL.md, and installSkillPackage short-circuits to
    // { alreadyInstalled: true } — falsely telling the bridge the skill is
    // installed so GET serves readSkillPackage() → the OUTSIDE secret. The
    // containment contract is to REFUSE (throw): the fix reads the idempotency
    // probe through guardedFile('read'), which returns null for the symlink, so
    // control falls through to the write-phase guard, which throws.
    assert.throws(() =>
      installSkillPackage({ forgeRoot: root, id: 'exfil-skill', packageDir: benignPackage(), upstream: { source: 'https://x' } }),
    );

    // The outside region — including its secret — must be byte-untouched, and
    // the alias must remain a symlink (never replaced by a real written dir).
    assert.equal(readFileSync(secretPath, 'utf8'), secretBefore, 'the outside secret must be byte-unchanged');
    assert.deepEqual(listTree(outside), outsideBefore, 'no package file may be copied into the outside region');
    assert.ok(lstatSync(aliasPath).isSymbolicLink(), 'the aliased skills/<id> must not be materialised into a real directory');
  });

  it('AT-q80-2 (dir-symlink zip-slip, write-through): a skills/<id> symlink to OUTSIDE (no SKILL.md at target) must not be written through — kills the lexical resolve().startsWith at skill-library.ts:617', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });

    // Real outside dir with a marker but NO SKILL.md — so existsSync does NOT
    // short-circuit and the write-phase is actually reached.
    const outside = makeTmpDir('sec05-q80-outside2-');
    const marker = join(outside, 'marker.txt');
    writeFileSync(marker, 'outside marker', 'utf8');

    const aliasPath = skillDir('evil-dir', root);
    symlinkSync(outside, aliasPath);
    assert.ok(lstatSync(aliasPath).isSymbolicLink(), 'precondition: skills/evil-dir symlink is planted');
    assert.equal(
      existsSync(join(outside, 'SKILL.md')),
      false,
      'precondition: no SKILL.md at the symlink target, so the existsSync dedup cannot short-circuit',
    );

    // TODAY (RED): install proceeds (dedup miss); resolve(destPath).startsWith
    // passes because resolve() does NOT dereference the symlink; mkdirSync is a
    // no-op on the existing dir-symlink; writeFileSync then writes THROUGH it,
    // materialising outside/SKILL.md OUTSIDE both roots. Also proves the dedup
    // did NOT report alreadyInstalled (it fell through to the write).
    assert.throws(() =>
      installSkillPackage({ forgeRoot: root, id: 'evil-dir', packageDir: benignPackage(), upstream: { source: 'https://x' } }),
    );

    assert.equal(existsSync(join(outside, 'SKILL.md')), false, 'no SKILL.md may be written through the dir symlink into the outside region');
    assert.equal(existsSync(join(outside, 'reference.md')), false, 'no package file may escape into the outside region');
    assert.equal(readFileSync(marker, 'utf8'), 'outside marker', 'the outside region must be otherwise byte-unchanged');
  });

  it('AT-q80-3 (attack-the-fix, per-segment hoisting): a NESTED destination subdir symlink must be caught segment-by-segment, not just the top-level skills/<id> — kills a guard that blesses skills/<id> then raw-joins the tail', () => {
    const root = makeForgeRoot();
    const outside = makeTmpDir('sec05-q80-outside3-');
    const marker = join(outside, 'marker.txt');
    writeFileSync(marker, 'outside marker', 'utf8');

    // A REAL skills/good-nested/ (no SKILL.md → no dedup short-circuit) whose
    // `sub/` is a symlink to the outside region.
    const skillDirPath = skillDir('good-nested', root);
    mkdirSync(skillDirPath, { recursive: true });
    const nestedLink = join(skillDirPath, 'sub');
    symlinkSync(outside, nestedLink);
    assert.ok(lstatSync(nestedLink).isSymbolicLink(), 'precondition: skills/good-nested/sub symlink is planted');

    // Package carries a benign SKILL.md (valid dest) AND a nested sub/x entry
    // (dest escapes through the planted symlink). Two real files, no symlinks
    // in the package itself — the escape is purely a DESTINATION shape.
    const pkg = makeTmpDir('sec05-q80-pkg3-');
    writeFileSync(join(pkg, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Nested', description: 'd' }), 'utf8');
    mkdirSync(join(pkg, 'sub'), { recursive: true });
    writeFileSync(join(pkg, 'sub', 'x'), 'pwned nested content', 'utf8');

    // (The literal string-`..` entry-path variant 'a/../../../../tmp/OUT/x' is
    // NOT reachable here — installSkillPackage's entry paths derive from a real
    // readdir() walk that never yields a `..` segment — so it is pinned at the
    // staging layer where `path` is client-supplied. The reachable analog is
    // this nested dir symlink, which a guard that validated only skills/<id>
    // and then raw-joined the tail would let escape.)
    assert.throws(() =>
      installSkillPackage({ forgeRoot: root, id: 'good-nested', packageDir: pkg, upstream: { source: 'https://x' } }),
    );

    assert.equal(existsSync(join(outside, 'x')), false, 'no file may be written through the nested subdir symlink');
    assert.equal(readFileSync(marker, 'utf8'), 'outside marker', 'the outside region must be byte-unchanged');
    // Per-element isolation / no partial write: the sibling-valid SKILL.md must
    // NOT be written when a sibling entry escapes (whole install refuses).
    assert.equal(existsSync(join(skillDirPath, 'SKILL.md')), false, 'the valid SKILL.md must not be written when a sibling entry escapes (no partial write)');
  });

  it('AT-q80-4 (attack-the-fix, symlinked leaf): a symlinked LEAF file inside a real skills/<id> must be caught — kills a raw join(guardedDir, "SKILL.md") that guards the directory but not the leaf', () => {
    const root = makeForgeRoot();
    const outside = makeTmpDir('sec05-q80-outside4-');
    const marker = join(outside, 'marker.txt');
    writeFileSync(marker, 'outside marker', 'utf8');

    // A REAL skills/good-leaf/ whose SKILL.md is a (dangling) symlink to the
    // outside region: existsSync follows the dangling link → false → no dedup
    // short-circuit → writeFileSync follows the link and CREATES the target.
    const skillDirPath = skillDir('good-leaf', root);
    mkdirSync(skillDirPath, { recursive: true });
    const leafLink = join(skillDirPath, 'SKILL.md');
    symlinkSync(join(outside, 'SKILL.md'), leafLink);
    assert.ok(lstatSync(leafLink).isSymbolicLink(), 'precondition: skills/good-leaf/SKILL.md symlink is planted');
    assert.equal(existsSync(join(outside, 'SKILL.md')), false, 'precondition: the symlink target does not yet exist (dangling)');

    const pkg = makeTmpDir('sec05-q80-pkg4-');
    writeFileSync(join(pkg, 'SKILL.md'), matter.stringify('\nBody.\n', { name: 'Leaf', description: 'd' }), 'utf8');
    writeFileSync(join(pkg, 'reference.md'), 'reference content', 'utf8');

    // TODAY (RED): writeFileSync(skills/good-leaf/SKILL.md) follows the leaf
    // symlink and materialises outside/SKILL.md OUTSIDE both roots.
    assert.throws(() =>
      installSkillPackage({ forgeRoot: root, id: 'good-leaf', packageDir: pkg, upstream: { source: 'https://x' } }),
    );

    assert.equal(existsSync(join(outside, 'SKILL.md')), false, 'SKILL.md must not be written through the leaf symlink into the outside region');
    assert.equal(readFileSync(marker, 'utf8'), 'outside marker', 'the outside region must be byte-unchanged');
    // No partial write: the sibling reference.md must not land either.
    assert.equal(existsSync(join(skillDirPath, 'reference.md')), false, 'the sibling reference.md must not be written when the leaf escapes (no partial write)');
  });

  it('AT-q80-5 (cross-object same-root alias): containment must require IDENTITY, not mere membership under skills/ — kills a "somewhere under the skills root" startsWith check', () => {
    const root = makeForgeRoot();
    mkdirSync(skillsDir(root), { recursive: true });

    // A REAL sibling object under skills/. It deliberately has NO SKILL.md at
    // the aliased probe path: if it did, existsSync(skills/evil-alias/SKILL.md)
    // would follow the alias, find it, and short-circuit to alreadyInstalled —
    // the unrelated idempotency check would ACCIDENTALLY mask the escape (green
    // for the wrong reason). Named per the immutable-gates catalogue
    // ("accidentally-safe production code"): shaped so the test is genuinely
    // RED, exercising the cross-object write-through the guard must close.
    const legitDir = skillDir('legit-real', root);
    mkdirSync(legitDir, { recursive: true });
    const legitData = join(legitDir, 'legit-data.md');
    writeFileSync(legitData, 'legitimate sibling content', 'utf8');
    const legitBefore = listTree(legitDir);

    // skills/evil-alias -> skills/legit-real: a SAME-ROOT alias. Every write to
    // evil-alias/* lands inside legit-real/*, which a lexical
    // resolve().startsWith(skillsRoot) check accepts (it never leaves skills/).
    const aliasPath = skillDir('evil-alias', root);
    symlinkSync(legitDir, aliasPath);
    assert.ok(lstatSync(aliasPath).isSymbolicLink(), 'precondition: skills/evil-alias -> skills/legit-real symlink is planted');

    assert.throws(() =>
      installSkillPackage({ forgeRoot: root, id: 'evil-alias', packageDir: benignPackage(), upstream: { source: 'https://x' } }),
    );

    // The sibling object must be byte-identical — no cross-object write-through.
    assert.deepEqual(listTree(legitDir), legitBefore, 'skills/legit-real must gain no files from the aliased install');
    assert.equal(existsSync(join(legitDir, 'SKILL.md')), false, 'no SKILL.md may be written into the sibling skill');
    assert.equal(existsSync(join(legitDir, 'reference.md')), false, 'no package file may be written into the sibling skill');
    assert.equal(readFileSync(legitData, 'utf8'), 'legitimate sibling content', 'the sibling content must be byte-unchanged');
  });
});
