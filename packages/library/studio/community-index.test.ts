/**
 * Acceptance tests for orchestrator/studio/community-index.ts (R3-07-F1/F2,
 * `_wave5/specs/R3-07.md`) — DOES NOT EXIST YET. This file is RED at branch
 * base: `Cannot find module './community-index.ts'` on import. Do not stub
 * the module into existence; red is the deliverable of this round.
 *
 * This initiative owns ZERO trust decisions (see the spec's table). Every
 * fact this module renders is DERIVED from one of three real registries that
 * already exist and are already merged:
 *   - kind skill  ← studio/catalog.yaml's `community-skills:` (skill-library.ts)
 *   - kind hook   ← vendored packages on disk at studio/community/hooks/<id>/
 *   - kind mcp/tool ← listConnections(forgeRoot) (connection-library.ts)
 *
 * Style: node:test + node:assert/strict, real temp forge roots via
 * mkdtempSync (no mocking of node:fs), mirroring skill-library.test.ts /
 * connection-library.test.ts.
 *
 * ---------------------------------------------------------------------------
 * DESIGN DECISIONS MADE HERE THAT THE T2 SPEC DID NOT FULLY DICTATE (ratify
 * or redirect — restated in the T3 final report as escalations):
 *
 *  E-1. D1 says "kind skill ← studio/catalog.yaml's community-skills
 *       section" naming only ONE source, yet D6 requires at least one
 *       INSTALLABLE vendored skill package to make F3 real for the skill
 *       kind, and the README states a vendored id may never collide with a
 *       community-skills id — which only makes sense if a vendored skill
 *       package can appear as an item distinct from any catalog entry. This
 *       file's design: `listCommunityIndex`'s skill items are the UNION of
 *       (a) every studio/catalog.yaml community-skills entry (installable via
 *       this surface only when a same-id vendored package also exists — none
 *       do among the 9 real entries, by the README's own collision rule) and
 *       (b) every vendored package under studio/community/skills/<id>/ that
 *       has NO matching catalog id (installable, real). This mirrors
 *       skill-library.ts's listSkillLibrary's own local-dir ∪ catalog union
 *       pattern one level up.
 *  E-2. `CommunitySignals.attributedTo`: sourced from the ORIGINAL record's
 *       own curated attribution string (`CommunitySkill.provenance`, e.g.
 *       "obra/superpowers + Matt Pocock") — NOT `hub.name`. Reasoning: `hub`
 *       is already a separate, independently-derived, NULLABLE field on
 *       CommunityItem; `CommunitySignals.attributedTo` is typed as a
 *       required (non-optional) string on the binding interface, so it must
 *       stay populated even for an item whose upstream matches no hub — it
 *       cannot be a mirror of `hub?.name`.
 *
 * ---------------------------------------------------------------------------
 * T2 ROUND 4 (adversarial review, FIX FIRST) additions:
 *  - Seed rename: the vendored hook id is now `block-protected-branch-push`
 *    (was `block-force-push`). Every reference below updated; the scan
 *    verdict is re-verified against the real scanner, not assumed.
 *  - MAJOR 1: a symlinked vendored package ROOT must be refused by
 *    readVendoredPackage, not followed to bytes outside the vendored tree.
 *  - MAJOR 2: listCommunityIndex must NOT throw on a MISSING catalog.yaml
 *    (degrades to vendored-only items) but MUST throw loudly, with the real
 *    parse detail, on a MALFORMED one.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { skillPath } from '../skill-path.ts';
import { communitySourceKey } from './community-source-url.ts';
import { listConnections } from './connection-library.ts';
import { installSkillPackage, approveSkillDraft } from './skill-install.ts';
import { hookDir, hookYamlPath } from './hook-library.ts';
import { scanHookScript } from './hook-scan.ts';
import { approveHook } from './hook-approval-ledger.ts';

import {
  COMMUNITY_KINDS,
  COMMUNITY_INSTALL_STATES,
  listCommunityHubs,
  resolveHub,
  communityInstallState,
  listCommunityIndex,
  communityItem,
  vendoredPackageDir,
  readVendoredPackage,
  hubsWithCounts,
  lintCommunityIndex,
  type CommunityHub,
} from './community-index.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const createdDirs: string[] = [];

function makeForgeRoot(prefix = 'community-index-'): string {
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

type RawTool = {
  id: string;
  name?: string;
  desc?: string;
  install?: Record<string, unknown>;
  probe?: Record<string, unknown>;
  provenance?: string;
  config?: Array<Record<string, unknown>>;
};

function toolDoc(f: RawTool): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name ?? f.id,
    ...(f.desc !== undefined ? { desc: f.desc } : {}),
    install: f.install ?? { method: 'system-provided' },
    probe: f.probe ?? { kind: 'command', command: f.id, args: ['--version'] },
    provenance: f.provenance ?? `https://example.com/${f.id}`,
    config: f.config ?? [],
  };
}

function mcpDoc(f: RawTool): Record<string, unknown> {
  return {
    ...toolDoc(f),
    install: f.install ?? { method: 'npm', package: `@forge-test/${f.id}`, version: '1.0.0' },
    probe: f.probe ?? { kind: 'npm-package' },
  };
}

type RawCommunitySkill = {
  id: string;
  name?: string;
  provenance?: string;
  source?: string;
  category?: string;
  tier?: string;
  stars?: string;
  desc?: string;
};

/** W6-CR-1: community skills live in studio/community/registry.yaml, not
 *  catalog.yaml — this builds one registry item's YAML doc, migrated field
 *  names (source → sourceUrl, stars → signals.starsDisplay). */
/** W8-B5 schema v2: an item's `sourceUrl` defaults to a real github.com URL
 *  so a fixture that declares `stars` has somewhere for that repo fact to
 *  live — repo facts are keyed by source, not carried on the item. A fixture
 *  that passes an explicit `source` still gets it verbatim (hub-derivation
 *  tests depend on the exact URL). */
function fixtureSourceUrl(s: RawCommunitySkill): string {
  return s.source ?? `https://github.com/test-owner/${s.id}`;
}

function communityRegistryItemDoc(s: RawCommunitySkill): Record<string, unknown> {
  return {
    id: s.id,
    kind: 'skill',
    name: s.name ?? s.id,
    provenance: s.provenance ?? 'Test Author',
    sourceUrl: fixtureSourceUrl(s),
    category: s.category ?? 'testing',
    desc: s.desc ?? `${s.id} description`,
    ...(s.tier !== undefined ? { tier: s.tier } : {}),
    signals: { attributedTo: s.provenance ?? 'Test Author' },
  };
}

/** The v2 `sources:` map, derived from the same raw fixture records — one row
 *  per distinct resolvable source URL, carrying the repo-level `stars`
 *  display the pre-v2 fixture put on each item. */
function communityRegistrySourcesDoc(skills: RawCommunitySkill[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of skills) {
    const key = communitySourceKey(fixtureSourceUrl(s));
    if (key === null || s.stars === undefined) continue;
    out[key] = {
      stars: null,
      starsDisplay: s.stars,
      upstreamUpdatedAt: null,
      fetchedAt: null,
      fetchedBy: 'seed',
    };
  }
  return out;
}

/** Writes studio/community/registry.yaml from the same `communitySkills`
 *  option `writeCatalog` used to embed into catalog.yaml's `community-skills:`
 *  section pre-W6-CR-1 — written UNCONDITIONALLY (even empty) alongside
 *  catalog.yaml, mirroring writeCatalog's own "every section, even when
 *  empty" discipline, so registry.yaml exists in every fixture that calls
 *  writeCatalog and a genuinely MISSING registry.yaml stays confined to the
 *  tests that deliberately never call writeCatalog at all. */
function writeRegistry(root: string, communitySkills: RawCommunitySkill[]): void {
  const dir = join(root, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  const doc = {
    meta: { schemaVersion: 2, lastRefresh: null },
    sources: communityRegistrySourcesDoc(communitySkills),
    items: communitySkills.map(communityRegistryItemDoc),
  };
  writeFileSync(join(dir, 'registry.yaml'), yaml.dump(doc), 'utf8');
}

/** Writes a full studio/catalog.yaml — every section loadCatalog requires,
 *  even when empty (mirrors skill-library.test.ts's writeCatalogYaml, but
 *  generalized to also carry tools:/mcps: connection metadata). ALSO writes
 *  studio/community/registry.yaml from `opts.communitySkills` (W6-CR-1 moved
 *  community skills off catalog.yaml — see writeRegistry above). */
function writeCatalog(
  root: string,
  opts: { tools?: RawTool[]; mcps?: RawTool[]; communitySkills?: RawCommunitySkill[] } = {},
): void {
  const doc = {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: (opts.tools ?? []).map(toolDoc),
    mcps: (opts.mcps ?? []).map(mcpDoc),
    guards: [],
  };
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'catalog.yaml'), yaml.dump(doc), 'utf8');
  writeRegistry(root, opts.communitySkills ?? []);
}

function writeHubs(root: string, hubs: Array<{ id: string; name: string; url: string; kinds: string }>): void {
  const dir = join(root, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hubs.yaml'), yaml.dump({ hubs }), 'utf8');
}

/** Vendors a skill package under studio/community/skills/<id>/SKILL.md. */
function vendorSkillPackage(root: string, id: string, frontmatter: Record<string, unknown> = {}, body = `# ${id}\n\nBody.\n`): void {
  const dir = join(root, 'studio', 'community', 'skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    matter.stringify('\n' + body, { name: id, description: `${id} description`, library: true, ...frontmatter }),
    'utf8',
  );
}

/** Vendors a hook package under studio/community/hooks/<id>/. */
function vendorHookPackage(
  root: string,
  id: string,
  opts: { permissions?: Record<string, unknown>; script?: string } = {},
): void {
  const dir = join(root, 'studio', 'community', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id,
      name: id,
      description: `${id} description`,
      on: 'PreToolUse',
      script: 'scripts/run.sh',
      permissions: opts.permissions ?? { env: [], read: [], network: false },
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'scripts', 'run.sh'), opts.script ?? '#!/usr/bin/env bash\nexit 0\n', 'utf8');
}

/** Real installed (`studio/hooks/<id>/`) hook package, mirroring hook-scan.test.ts. */
function installHookPackage(root: string, id: string, opts: { permissions?: Record<string, unknown>; script?: string } = {}): void {
  const dir = hookDir(id, root);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    hookYamlPath(id, root),
    yaml.dump({
      id,
      name: id,
      description: `${id} description`,
      on: 'PreToolUse',
      script: 'scripts/run.sh',
      permissions: opts.permissions ?? { env: [], read: [], network: false },
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'scripts', 'run.sh'), opts.script ?? '#!/usr/bin/env bash\nexit 0\n', 'utf8');
}

function installDraftSkill(root: string, id: string): void {
  const packageDir = makeTmpDir('community-index-skill-pkg-');
  writeFileSync(join(packageDir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: id, description: 'installable' }), 'utf8');
  installSkillPackage({ forgeRoot: root, id, packageDir, upstream: { source: 'https://example.com/x' } });
}

// ===========================================================================
// Constants
// ===========================================================================

describe('constants', () => {
  it('COMMUNITY_KINDS is exactly [skill, hook, mcp, tool] — D8: cli is never fabricated', () => {
    assert.deepEqual(COMMUNITY_KINDS, ['skill', 'hook', 'mcp', 'tool']);
  });

  // W7-B3 amendment (library-31): 'present-unmanaged' joins as the honest
  // name for an id occupied by a local skill the community pipeline does
  // not manage — see communityInstallState's skill branch.
  it('COMMUNITY_INSTALL_STATES is exactly the 5-member union (D3 + W7-B3 present-unmanaged)', () => {
    assert.deepEqual(COMMUNITY_INSTALL_STATES, ['not-installed', 'draft-pending-approval', 'needs-review', 'installed', 'present-unmanaged']);
  });
});

// ===========================================================================
// listCommunityHubs — real registry read, no crawl (D10)
// ===========================================================================

describe('listCommunityHubs', () => {
  it('reads the REAL committed studio/community/hubs.yaml — exact literal count and the forge-seed entry', () => {
    const hubs = listCommunityHubs(REPO_ROOT);
    assert.equal(hubs.length, 9, `expected exactly the 9 committed hubs, got ${hubs.length}: ${hubs.map((h) => h.id).join(', ')}`);
    const forgeSeed = hubs.find((h) => h.id === 'forge-seed');
    assert.ok(forgeSeed, 'expected the forge-seed hub (vendored packages are attributed here)');
    assert.equal(forgeSeed!.url, 'https://github.com/parsoFish/forge-studio');
    assert.equal(forgeSeed!.kinds, 'skills, hooks');
  });

  it('an absent hubs.yaml yields an empty list, never a throw (fresh/half-onboarded root)', () => {
    const root = makeForgeRoot();
    assert.deepEqual(listCommunityHubs(root), []);
  });

  it('a fixture hubs.yaml round-trips id/name/url/kinds exactly (kinds stays a raw string, never parsed into an array)', () => {
    const root = makeForgeRoot();
    writeHubs(root, [{ id: 'hub-a', name: 'Hub A', url: 'https://example.com/hub-a', kinds: 'skills, hooks' }]);
    const hubs = listCommunityHubs(root);
    assert.deepEqual(hubs, [{ id: 'hub-a', name: 'Hub A', url: 'https://example.com/hub-a', kinds: 'skills, hooks' }]);
  });
});

// ===========================================================================
// resolveHub — D4: prefix match on a PATH-SEGMENT BOUNDARY, both directions
// ===========================================================================

describe('resolveHub — D4', () => {
  it('the real memory mcp (upstream .../servers/tree/main/src/memory) resolves to the real mcp-servers hub', () => {
    const hubs = listCommunityHubs(REPO_ROOT);
    const memory = listConnections(REPO_ROOT).find((c) => c.id === 'memory');
    assert.ok(memory, 'expected the real memory mcp catalog entry');
    const resolved = resolveHub(memory!.provenance, hubs);
    assert.ok(resolved, 'expected memory to resolve to a hub');
    assert.equal(resolved!.id, 'mcp-servers');
  });

  it('the real sqlite mcp (upstream .../servers-archived/tree/main/src/sqlite) resolves to null — "servers-archived" must NOT match the "servers" hub', () => {
    const hubs = listCommunityHubs(REPO_ROOT);
    const sqlite = listConnections(REPO_ROOT).find((c) => c.id === 'sqlite');
    assert.ok(sqlite, 'expected the real sqlite mcp catalog entry');
    assert.equal(resolveHub(sqlite!.provenance, hubs), null, 'a hub-name PREFIX collision ("servers" vs "servers-archived") must never resolve');
  });

  it('boundary is a PATH SEGMENT, not a bare string prefix: ".../foo/barbaz" must NOT match hub url ".../foo/bar"', () => {
    const hubs: CommunityHub[] = [{ id: 'hub-bar', name: 'Bar', url: 'https://github.com/foo/bar', kinds: 'skills' }];
    assert.equal(resolveHub('https://github.com/foo/barbaz', hubs), null);
  });

  it('a genuine sub-path DOES match: ".../foo/bar/sub/thing" matches hub url ".../foo/bar"', () => {
    const hubs: CommunityHub[] = [{ id: 'hub-bar', name: 'Bar', url: 'https://github.com/foo/bar', kinds: 'skills' }];
    const resolved = resolveHub('https://github.com/foo/bar/sub/thing', hubs);
    assert.equal(resolved?.id, 'hub-bar');
  });

  it('an exact match (no trailing segment) DOES match', () => {
    const hubs: CommunityHub[] = [{ id: 'hub-exact', name: 'Exact', url: 'https://example.com/exact', kinds: 'skills' }];
    assert.equal(resolveHub('https://example.com/exact', hubs)?.id, 'hub-exact');
  });

  it('an upstream matching no hub at all resolves to null — never an invented hub', () => {
    const hubs: CommunityHub[] = [{ id: 'hub-a', name: 'A', url: 'https://example.com/a', kinds: 'skills' }];
    assert.equal(resolveHub('https://totally-unaffiliated.example/x', hubs), null);
  });
});

// ===========================================================================
// communityInstallState — D3 mapping, per kind
// ===========================================================================

describe('communityInstallState — skill (D3)', () => {
  it('absent skill (no skills/<id>/ on disk) → not-installed', () => {
    const root = makeForgeRoot();
    assert.equal(communityInstallState(root, 'skill', 'ghost-skill'), 'not-installed');
  });

  it('status: draft (freshly community-installed, unreviewed) → draft-pending-approval', () => {
    const root = makeForgeRoot();
    installDraftSkill(root, 'draft-skill');
    assert.equal(communityInstallState(root, 'skill', 'draft-skill'), 'draft-pending-approval');
  });

  it('approved, hash matches (trust: ready) → installed', () => {
    const root = makeForgeRoot();
    installDraftSkill(root, 'ready-skill');
    approveSkillDraft({ forgeRoot: root, id: 'ready-skill' });
    assert.equal(communityInstallState(root, 'skill', 'ready-skill'), 'installed');
  });

  it('approved then tampered (trust: needs-review) → needs-review, NOT laundered into installed — D3 spec correction', () => {
    const root = makeForgeRoot();
    installDraftSkill(root, 'tampered-skill');
    approveSkillDraft({ forgeRoot: root, id: 'tampered-skill' });
    // Tamper: append content to the installed SKILL.md after approval.
    const p = skillPath('tampered-skill', root);
    writeFileSync(p, readFileSync(p, 'utf8') + '\nTampered line.\n', 'utf8');
    assert.equal(communityInstallState(root, 'skill', 'tampered-skill'), 'needs-review');
  });

  // T2 round 6, AT GROUP 4 (T2 ruling): install-state must describe THIS
  // community package, not the path. A hand-authored local skill with NO
  // provenance block genuinely never went through the community install
  // pipeline — it merely happens to occupy the same id. Reporting it
  // "installed" is a status attributed from path occupancy, exactly the
  // standing wave-4 lesson this campaign keeps re-finding. Expected RED:
  // the current implementation maps trust:'ready' (a hand-authored skill
  // with no provenance, no ledger entry) straight to 'installed'.
  it("an UNRELATED local skill (no provenance block) occupying the id → not-installed, NEVER installed — the id is occupied, but this community package was never installed", () => {
    const root = makeForgeRoot();
    const dir = join(root, 'skills', 'collide-id');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      skillPath('collide-id', root),
      matter.stringify('\n# Local\n\nHand-authored, unrelated to any community package.\n', {
        name: 'My Local Skill',
        description: 'hand-authored, unrelated',
        library: true,
      }),
      'utf8',
    );
    // W7-B3 amendment (library-31): 'not-installed' was itself half the lie —
    // it made /community offer an Install for a path install could never
    // touch, while /skills said the same id was fine. The third state names
    // the truth both surfaces now share: the id is OCCUPIED by a local skill
    // the community pipeline does not manage. The original intent ("never
    // reported as installed") is preserved and re-asserted below.
    const state = communityInstallState(root, 'skill', 'collide-id');
    assert.equal(
      state,
      'present-unmanaged',
      'a local skill with no provenance block is present-unmanaged — occupied, but this community package was never installed',
    );
    assert.notEqual(state, 'installed', 'a local skill with no provenance block must never be reported as an INSTALLED community package');
  });
});

describe('communityInstallState — hook (D3)', () => {
  it('absent hook (no studio/hooks/<id>/ on disk) → not-installed', () => {
    const root = makeForgeRoot();
    assert.equal(communityInstallState(root, 'hook', 'ghost-hook'), 'not-installed');
  });

  it('materialised but not approved (runnable: false, no ledger entry) → draft-pending-approval', () => {
    const root = makeForgeRoot();
    installHookPackage(root, 'unapproved-hook');
    assert.equal(communityInstallState(root, 'hook', 'unapproved-hook'), 'draft-pending-approval');
  });

  it('materialised AND approved (runnable: true) → installed', () => {
    const root = makeForgeRoot();
    installHookPackage(root, 'approved-hook');
    approveHook({ forgeRoot: root, id: 'approved-hook' });
    assert.equal(communityInstallState(root, 'hook', 'approved-hook'), 'installed');
  });
});

describe('communityInstallState — connection (mcp/tool) (D3)', () => {
  it('probe not-installed → not-installed', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {
      tools: [{ id: 'absent-tool', probe: { kind: 'command-presence', command: 'definitely-absent-binary-community-xyz' } }],
    });
    assert.equal(communityInstallState(root, 'tool', 'absent-tool'), 'not-installed');
  });

  it('probe available → installed, probeState surfaced separately as available (via listCommunityIndex)', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { tools: [{ id: 'node', probe: { kind: 'command', command: 'node', args: ['--version'] } }] });
    assert.equal(communityInstallState(root, 'tool', 'node'), 'installed');
  });

  it('probe misconfigured (present, required config unset) → installed, NOT its own install-state member (D3 correction: misconfigured is a probeState, not an installState)', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {
      mcps: [
        {
          id: 'misconfigured-mcp',
          install: { method: 'system-provided' },
          probe: { kind: 'command-presence', command: 'node' },
          config: [{ env: 'FORGE_COMMUNITY_TEST_REQUIRED_XYZ', required: true, purpose: 'test' }],
        },
      ],
    });
    delete process.env['FORGE_COMMUNITY_TEST_REQUIRED_XYZ'];
    assert.equal(communityInstallState(root, 'mcp', 'misconfigured-mcp'), 'installed');
  });
});

// ===========================================================================
// listCommunityIndex — D1 (derivation), D5 (no fabricated signals), D13
// (kind,id identity)
// ===========================================================================

describe('listCommunityIndex — D1: derived from real registries, no fourth declared file', () => {
  it('a NEW registry.yaml community-skills entry appears in the index by editing ONLY registry.yaml — no vendored package needed (W6-CR-1)', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { communitySkills: [{ id: 'brand-new-skill', stars: '42' }] });
    // Deliberately: no hubs.yaml write, no studio/community/skills/ write.
    const items = listCommunityIndex(root);
    const found = items.find((i) => i.kind === 'skill' && i.id === 'brand-new-skill');
    assert.ok(found, 'a registry-only community-skills entry must appear in the index without any vendored package on disk');
    assert.equal(found!.vendored, false, 'no vendored package exists on disk for this id — vendored must be false');
  });

  it('a vendored skill package with NO matching catalog id appears in the index too (E-1) — installable, distinct from the 9 catalog reference entries', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {}); // no catalog community-skills at all
    vendorSkillPackage(root, 'vendored-only-skill');
    const items = listCommunityIndex(root);
    const found = items.find((i) => i.kind === 'skill' && i.id === 'vendored-only-skill');
    assert.ok(found, 'a vendored-only skill package must be a browsable, installable community item');
    assert.equal(found!.vendored, true);
  });

  it('a hook is sourced from the vendored package on disk — no catalog entry needed at all', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    vendorHookPackage(root, 'my-hook');
    const items = listCommunityIndex(root);
    const found = items.find((i) => i.kind === 'hook' && i.id === 'my-hook');
    assert.ok(found);
    assert.equal(found!.vendored, true);
    assert.equal(found!.installState, 'not-installed');
  });

  it('mcp/tool items are sourced 1:1 from listConnections(forgeRoot) — the real R3-04 registry, never re-parsed', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { tools: [{ id: 'git-like-tool' }], mcps: [{ id: 'some-mcp' }] });
    const items = listCommunityIndex(root);
    assert.ok(items.some((i) => i.kind === 'tool' && i.id === 'git-like-tool'));
    assert.ok(items.some((i) => i.kind === 'mcp' && i.id === 'some-mcp'));
  });
});

// ===========================================================================
// T2 round 4, MAJOR 2: a fresh/half-onboarded root (no studio/catalog.yaml
// at all) must NOT throw — it must degrade to the sources that don't need
// the catalog (vendored skills + vendored hooks), mirroring
// listCommunityHubs's own documented fresh-root precedent two functions
// above in the same file. A MALFORMED catalog.yaml, by contrast, must
// throw LOUDLY with the real parse detail — a corrupt catalog is an
// operator-visible error; silently returning a short index would render
// "nothing here" indistinguishable from a genuinely empty library (the
// house rule: a broken registry must never look the same as an honest
// empty one). Expected RED (not yet fixed) — listCommunityIndex currently
// calls loadCatalog bare, so BOTH cases throw ENOENT/parse-error today,
// undifferentiated.
// ===========================================================================

describe('listCommunityIndex — MAJOR 2: missing vs malformed studio/catalog.yaml', () => {
  it('a MISSING studio/catalog.yaml does NOT throw — degrades to vendored skill + hook items only', () => {
    const root = makeForgeRoot();
    // Deliberately: no writeCatalog call at all — studio/catalog.yaml is
    // entirely absent, the fresh/half-onboarded-root shape.
    vendorSkillPackage(root, 'vendored-skill-no-catalog');
    vendorHookPackage(root, 'vendored-hook-no-catalog');

    const items = listCommunityIndex(root);

    assert.equal(items.length, 2, `expected EXACTLY the two vendored items, no throw, no fabricated extras — got: ${JSON.stringify(items)}`);
    assert.ok(items.some((i) => i.kind === 'skill' && i.id === 'vendored-skill-no-catalog'));
    assert.ok(items.some((i) => i.kind === 'hook' && i.id === 'vendored-hook-no-catalog'));
    assert.ok(!items.some((i) => i.kind === 'tool' || i.kind === 'mcp'), 'with no catalog there is nothing to source a tool/mcp item from — none may be fabricated');
  });

  // Reviewer fix (LOW): registrySource's degrade-on-missing path was
  // previously untested — nothing asserted the console.warn actually fires,
  // or what it says. console.warn (not createLogger's structured JSONL
  // event log) is the right choke point here and matches this repo's own
  // house precedent for a warn with no cycle/run context to log through
  // (see packages/flows/bridge-hooks.ts's own "no cycle context exists" console.warn
  // family) — this is a synchronous read helper, not a phase or agent run.
  it('a MISSING studio/community/registry.yaml warns loud via console.warn, naming the file (registrySource, community-index.ts)', (t) => {
    const root = makeForgeRoot();
    // Deliberately: no writeRegistry call — registry.yaml absent, the
    // fresh/half-onboarded-root shape registrySource degrades on.
    const warnCalls: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => {
      warnCalls.push(args);
    });

    listCommunityIndex(root);

    assert.ok(
      warnCalls.some((args) => typeof args[0] === 'string' && /studio[/\\]community[/\\]registry\.yaml/.test(args[0])),
      `expected a console.warn call naming studio/community/registry.yaml — got: ${JSON.stringify(warnCalls)}`,
    );
  });

  it('a MALFORMED studio/catalog.yaml THROWS LOUDLY, carrying the real underlying parse detail, never a generic string', () => {
    const root = makeForgeRoot();
    mkdirSync(join(root, 'studio'), { recursive: true });
    writeFileSync(join(root, 'studio', 'catalog.yaml'), 'tools: [unclosed\n  bad: [[[ yaml', 'utf8');

    assert.throws(
      () => listCommunityIndex(root),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /catalog\.yaml/i, `expected the error to name the file; got: "${message}"`);
        assert.match(message, /YAML parse error/i, `expected the real underlying parse detail (loadYaml's own wrapper), not a generic string; got: "${message}"`);
        return true;
      },
      'a corrupt catalog.yaml must fail loud, not silently degrade to a short index (that would render a BROKEN registry the same as an honest EMPTY one)',
    );
  });
});

describe('listCommunityIndex — D5: signals are never invented', () => {
  it('the REAL "security-review" community-skill (no stars field in catalog.yaml) has signals: null — never stars: "0"', () => {
    const items = listCommunityIndex(REPO_ROOT);
    const entry = items.find((i) => i.kind === 'skill' && i.id === 'security-review');
    assert.ok(entry, 'expected the real security-review community-skill');
    assert.equal(entry!.signals, null, 'a community-skill with no curated stars must render signals:null, never a fabricated zero');
  });

  it('the REAL "handoff" community-skill (stars: "228k" in catalog.yaml) carries real signals, attributed to its curated provenance string (E-2)', () => {
    const items = listCommunityIndex(REPO_ROOT);
    const entry = items.find((i) => i.kind === 'skill' && i.id === 'handoff');
    assert.ok(entry);
    assert.ok(entry!.signals, 'expected non-null signals for a catalog entry that carries stars');
    assert.equal(entry!.signals!.stars, '228k');
    assert.equal(entry!.signals!.attributedTo, 'obra/superpowers + Matt Pocock', 'attributedTo must be the curated provenance string, not an invented value');
  });

  it('connections NEVER carry signals — no code path produces stars:"0" or stars:"" for a tool/mcp', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { tools: [{ id: 'signal-free-tool' }], mcps: [{ id: 'signal-free-mcp' }] });
    const items = listCommunityIndex(root);
    for (const item of items.filter((i) => i.kind === 'tool' || i.kind === 'mcp')) {
      assert.equal(item.signals, null, `connection "${item.id}" must never carry a fabricated signal`);
    }
  });

  it('a vendored (forge-authored) skill/hook NEVER carries signals — no star/download number invented for forge-authored content', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    vendorSkillPackage(root, 'no-signal-skill');
    vendorHookPackage(root, 'no-signal-hook');
    const items = listCommunityIndex(root);
    assert.equal(items.find((i) => i.id === 'no-signal-skill')!.signals, null);
    assert.equal(items.find((i) => i.id === 'no-signal-hook')!.signals, null);
  });

  // T2 round 2, escalation #2 mandatory addition: "a signals block that
  // cannot name who published the number is worse than no signals block."
  // reqString('provenance') only rejects a truly EMPTY string, not a
  // whitespace-only one — so a whitespace-only provenance is a real,
  // loader-reachable edge case, not a hypothetical.
  it('a catalog entry with stars but a WHITESPACE-ONLY provenance renders signals:null, not a signals block with a blank attributedTo', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { communitySkills: [{ id: 'blank-provenance-skill', stars: '99', provenance: '   ' }] });
    const items = listCommunityIndex(root);
    const entry = items.find((i) => i.id === 'blank-provenance-skill');
    assert.ok(entry);
    assert.equal(entry!.signals, null, 'a signals block whose attributedTo would be blank/whitespace must not be emitted at all — fall back to null');
  });
});

// W6-CR-2, D14: fetchedAt/fetchedBy/upstreamUpdatedAt thread through only
// from a value the source record already carries — a registry-sourced skill
// carries its real facts; a vendored-only skill/hook or a connection (no
// registry row) honestly carries fetchedAt:null/fetchedBy:'local'/
// upstreamUpdatedAt:null, never a fabricated timestamp.
describe('listCommunityIndex — D14: fetchedAt/fetchedBy/upstreamUpdatedAt', () => {
  it('a registry-sourced community-skill carries its real fetchedBy/fetchedAt/upstreamUpdatedAt (the REAL "handoff" entry: fetchedBy "seed", fetchedAt/upstreamUpdatedAt null)', () => {
    const items = listCommunityIndex(REPO_ROOT);
    const entry = items.find((i) => i.kind === 'skill' && i.id === 'handoff');
    assert.ok(entry);
    assert.equal(entry!.fetchedBy, 'seed');
    assert.equal(entry!.fetchedAt, null);
    assert.equal(entry!.upstreamUpdatedAt, null);
  });

  it('a vendored-only skill (no registry row) carries fetchedAt:null, fetchedBy:"local", upstreamUpdatedAt:null — never fabricated', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    vendorSkillPackage(root, 'no-fetch-skill');
    const items = listCommunityIndex(root);
    const entry = items.find((i) => i.id === 'no-fetch-skill');
    assert.ok(entry);
    assert.equal(entry!.fetchedAt, null);
    assert.equal(entry!.fetchedBy, 'local');
    assert.equal(entry!.upstreamUpdatedAt, null);
  });

  it('a vendored hook (no registry row) carries fetchedAt:null, fetchedBy:"local", upstreamUpdatedAt:null', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    vendorHookPackage(root, 'no-fetch-hook');
    const items = listCommunityIndex(root);
    const entry = items.find((i) => i.id === 'no-fetch-hook');
    assert.ok(entry);
    assert.equal(entry!.fetchedAt, null);
    assert.equal(entry!.fetchedBy, 'local');
    assert.equal(entry!.upstreamUpdatedAt, null);
  });

  it('a connection (tool/mcp, no registry row) carries fetchedAt:null, fetchedBy:"local", upstreamUpdatedAt:null', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { tools: [{ id: 'no-fetch-tool' }], mcps: [{ id: 'no-fetch-mcp' }] });
    const items = listCommunityIndex(root);
    for (const id of ['no-fetch-tool', 'no-fetch-mcp']) {
      const entry = items.find((i) => i.id === id);
      assert.ok(entry, `expected item "${id}"`);
      assert.equal(entry!.fetchedAt, null, `"${id}".fetchedAt`);
      assert.equal(entry!.fetchedBy, 'local', `"${id}".fetchedBy`);
      assert.equal(entry!.upstreamUpdatedAt, null, `"${id}".upstreamUpdatedAt`);
    }
  });

  it('every item in the REAL committed index carries a real, non-blank fetchedBy — never absent', () => {
    const items = listCommunityIndex(REPO_ROOT);
    assert.ok(items.length > 0, 'sanity: the real index has entries');
    for (const item of items) {
      assert.equal(typeof item.fetchedBy, 'string', `item "${item.kind}:${item.id}" fetchedBy must be a string`);
      assert.ok(item.fetchedBy.trim().length > 0, `item "${item.kind}:${item.id}" fetchedBy must not be blank`);
    }
  });
});

// T2 round 2, MANDATORY M4: a negative sweep over the REAL repo's full index
// — no item anywhere may carry a fabricated/degenerate signal.
describe('listCommunityIndex — M4: full-repo negative sweep for a fabricated zero', () => {
  it('no item in the REAL committed index has signals non-null with a degenerate stars value ("", "0", "0k", or null)', () => {
    const items = listCommunityIndex(REPO_ROOT);
    const degenerate = new Set(['', '0', '0k', 'null']);
    for (const item of items) {
      if (item.signals === null) continue;
      assert.ok(item.signals!.stars !== null, `item "${item.kind}:${item.id}" has signals but a null stars value — should have been signals:null instead`);
      assert.ok(
        !degenerate.has((item.signals!.stars ?? '').trim().toLowerCase()),
        `item "${item.kind}:${item.id}" has a degenerate stars value "${item.signals!.stars}" — a non-null signals block must always carry a REAL published value`,
      );
      assert.ok(item.signals!.attributedTo.trim().length > 0, `item "${item.kind}:${item.id}" has a signals block with a blank attributedTo`);
    }
  });

  it('every vendored item and every connection (tool/mcp) in the REAL index carries signals === null EXACTLY, never an empty object', () => {
    const items = listCommunityIndex(REPO_ROOT);
    for (const item of items) {
      if (item.vendored || item.kind === 'tool' || item.kind === 'mcp') {
        assert.equal(item.signals, null, `item "${item.kind}:${item.id}" (vendored:${item.vendored}) must carry signals === null exactly`);
      }
    }
  });
});

describe('listCommunityIndex — D13: item identity is the (kind, id) PAIR', () => {
  it('a skill and an mcp sharing the same id are two DISTINCT items — communityItem disambiguates by kind', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {
      mcps: [{ id: 'shared-id' }],
      communitySkills: [{ id: 'shared-id' }],
    });
    const items = listCommunityIndex(root).filter((i) => i.id === 'shared-id');
    assert.equal(items.length, 2, 'both a skill and an mcp entry sharing "shared-id" must both be present');
    assert.deepEqual(
      items.map((i) => i.kind).sort(),
      ['mcp', 'skill'],
    );

    const skillItem = communityItem(root, 'skill', 'shared-id');
    const mcpItem = communityItem(root, 'mcp', 'shared-id');
    assert.ok(skillItem && mcpItem, 'both lookups must resolve');
    assert.equal(skillItem!.kind, 'skill');
    assert.equal(mcpItem!.kind, 'mcp');
    assert.notDeepEqual(skillItem, mcpItem);
  });

  it('communityItem returns undefined for a genuinely unknown (kind, id) pair — never a fabricated entry', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    assert.equal(communityItem(root, 'skill', 'no-such-skill-anywhere'), undefined);
  });
});

// ===========================================================================
// hubsWithCounts — DERIVED per-hub counts, honest zero
// ===========================================================================

describe('hubsWithCounts', () => {
  it('a hub matching exactly one item counts 1; a hub matching none counts 0 (the honest zero, D10)', () => {
    const root = makeForgeRoot();
    writeHubs(root, [
      { id: 'hub-with-one', name: 'Hub One', url: 'https://example.com/hub-one', kinds: 'skills' },
      { id: 'hub-with-none', name: 'Hub None', url: 'https://example.com/hub-none', kinds: 'skills' },
    ]);
    writeCatalog(root, { communitySkills: [{ id: 'counted-skill', source: 'https://example.com/hub-one/some/skill' }] });

    const counted = hubsWithCounts(root);
    const one = counted.find((h) => h.id === 'hub-with-one');
    const none = counted.find((h) => h.id === 'hub-with-none');
    assert.equal(one?.itemCount, 1);
    assert.equal(none?.itemCount, 0, 'a hub with zero matching items must render the honest zero, not be omitted or fabricated');
  });
});

// ===========================================================================
// vendoredPackageDir / readVendoredPackage
// ===========================================================================

describe('vendoredPackageDir / readVendoredPackage', () => {
  it('vendoredPackageDir resolves to the exact, byte-literal real seed path for both real seed ids', () => {
    assert.equal(
      vendoredPackageDir(REPO_ROOT, 'skill', 'dependency-diff-review'),
      join(REPO_ROOT, 'studio', 'community', 'skills', 'dependency-diff-review'),
    );
    assert.equal(
      vendoredPackageDir(REPO_ROOT, 'hook', 'block-protected-branch-push'),
      join(REPO_ROOT, 'studio', 'community', 'hooks', 'block-protected-branch-push'),
    );
  });

  it('readVendoredPackage returns the REAL committed hook package bytes (hook.yaml + scripts/run.sh)', () => {
    const files = readVendoredPackage(REPO_ROOT, 'hook', 'block-protected-branch-push');
    const paths = files.map((f) => f.path).sort();
    assert.deepEqual(paths, ['hook.yaml', 'scripts/run.sh']);
    const script = files.find((f) => f.path === 'scripts/run.sh')!;
    assert.ok(script.body.includes('block-protected-branch-push'), 'expected the real script body, not a placeholder');
  });

  it('readVendoredPackage returns the REAL committed skill package bytes (SKILL.md)', () => {
    const files = readVendoredPackage(REPO_ROOT, 'skill', 'dependency-diff-review');
    assert.ok(files.some((f) => f.path === 'SKILL.md'));
    const skillMd = files.find((f) => f.path === 'SKILL.md')!;
    assert.ok(skillMd.body.includes('dependency-diff-review'));
  });

  it('a non-vendored id (no package on disk) yields an empty file list, never a throw', () => {
    const root = makeForgeRoot();
    assert.deepEqual(readVendoredPackage(root, 'skill', 'never-vendored'), []);
  });

  // T2 round 4, item 0: re-verify the REAL committed seed hook's scan
  // verdict is still "clean" post-rename — checked against the actual
  // scanner, not assumed. Uses the real vendored bytes read via
  // readVendoredPackage, exactly what the community detail route scans.
  it('the REAL committed seed hook (block-protected-branch-push) still scans CLEAN — re-verified, not assumed, after the rename', () => {
    const files = readVendoredPackage(REPO_ROOT, 'hook', 'block-protected-branch-push');
    const hookYamlFile = files.find((f) => f.path === 'hook.yaml');
    const scriptFile = files.find((f) => f.path === 'scripts/run.sh');
    assert.ok(hookYamlFile && scriptFile, 'expected both real seed files to be present');
    const parsedYaml = yaml.load(hookYamlFile!.body) as { permissions: { env: string[]; read: string[]; network: boolean } };
    const report = scanHookScript({ body: scriptFile!.body, permissions: parsedYaml.permissions });
    assert.equal(report.verdict, 'clean', `expected the real seed hook to scan clean, got: ${JSON.stringify(report)}`);
  });

  // ---------------------------------------------------------------------
  // T2 round 4, MAJOR 1: a symlinked vendored package ROOT must be
  // refused, not followed. Plants a REAL symlink (symlinkSync), not a
  // simulation. Expected RED (not yet fixed) — vendoredPackageDir's
  // current boundary check is purely lexical (resolve()+startsWith), no
  // realpathSync, so it does not catch a symlinked package directory.
  // ---------------------------------------------------------------------

  it('MAJOR 1: readVendoredPackage REFUSES a vendored package dir that is a SYMLINK resolving outside the vendored root', () => {
    const root = makeForgeRoot();
    const externalDir = makeTmpDir('community-index-external-');
    const marker = 'EXTERNAL_SECRET_MARKER_index_side';
    writeFileSync(join(externalDir, 'hook.yaml'), yaml.dump({ id: 'evil-index-symlink', name: 'evil', description: 'planted', on: 'PreToolUse', script: 'scripts/run.sh', permissions: { env: [], read: [], network: false } }), 'utf8');
    mkdirSync(join(externalDir, 'scripts'), { recursive: true });
    writeFileSync(join(externalDir, 'scripts', 'run.sh'), `#!/usr/bin/env bash\necho "${marker}"\n`, 'utf8');

    const vendoredHooksDir = join(root, 'studio', 'community', 'hooks');
    mkdirSync(vendoredHooksDir, { recursive: true });
    symlinkSync(externalDir, join(vendoredHooksDir, 'evil-index-symlink'), 'dir');

    assert.throws(
      () => readVendoredPackage(root, 'hook', 'evil-index-symlink'),
      /./,
      'a symlinked package root resolving outside the vendored tree must be refused (throw), never silently read',
    );
  });

  it('the negative direction still holds for readVendoredPackage: an ordinary, non-symlinked vendored package still reads its real bytes', () => {
    const root = makeForgeRoot();
    vendorHookPackage(root, 'ordinary-non-symlink-read');
    const files = readVendoredPackage(root, 'hook', 'ordinary-non-symlink-read');
    assert.ok(files.some((f) => f.path === 'hook.yaml'), 'the fix must not degenerate into refusing every vendored package, symlinked or not');
  });
});

// ===========================================================================
// lintCommunityIndex — README rule: a vendored id must NEVER collide with a
// community-skills id (that would be claiming third-party bytes as forge's own)
// ===========================================================================

describe('lintCommunityIndex', () => {
  it('a vendored skill id colliding with a catalog community-skills id is a lint error', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { communitySkills: [{ id: 'handoff' }] });
    vendorSkillPackage(root, 'handoff'); // collision: claims to BE the real "handoff" catalog entry's bytes
    const findings = lintCommunityIndex(root);
    assert.ok(
      findings.some((f) => f.level === 'error' && /handoff/.test(f.message) && /collid/i.test(f.message)),
      `expected a collision finding naming "handoff", got: ${JSON.stringify(findings)}`,
    );
  });

  it('no collision → no finding (sanity: the check does not fire on a clean fixture)', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { communitySkills: [{ id: 'catalog-only-skill' }] });
    vendorSkillPackage(root, 'vendored-only-skill');
    const findings = lintCommunityIndex(root);
    assert.equal(findings.filter((f) => /collid/i.test(f.message)).length, 0);
  });

  it('the REAL committed seed has zero collisions (grounds the rule against production data)', () => {
    const findings = lintCommunityIndex(REPO_ROOT);
    assert.equal(findings.filter((f) => /collid/i.test(f.message)).length, 0, 'the real committed seed must already satisfy its own rule');
  });
});
