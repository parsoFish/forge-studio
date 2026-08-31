/**
 * Acceptance tests for orchestrator/studio/connection-library.ts (R3-04-F1 +
 * F4) — DOES NOT EXIST YET. This file is RED at branch base: every describe
 * block below fails at import time (`Cannot find module
 * './connection-library.ts'`) — that is the expected, deliberate red. Do not
 * stub the module into existence to turn this green; red is the deliverable
 * of this round.
 *
 * Contract this file pins (`_wave5/specs/R3-04.md` D1/D2/D5/D8/D12-D16,
 * Appendix A; `docs/roadmaps/R3-library-componentry.md` §R3-04-F1/F4).
 *
 * ROUND 3 SCHEMA CHANGE (D13-D16, source-verified against upstreams — see
 * the spec's Appendix A): `install:` is a THREE-method union
 * (`system-provided` | `npm` | `external`), not two — `github`/`fetch`/
 * `sqlite` have no working npm install path (deprecated npm package,
 * typosquat-canary npm name, and PyPI-only/archived upstream respectively).
 * `probe:` is a KIND-tagged discriminated union (`command` |
 * `command-presence` | `npm-package`), not a bare `{command,args}` — an
 * `npm` entry's probe reads its own installed `package.json` version
 * against the pin and NEVER executes anything (verified: neither
 * `@modelcontextprotocol/server-filesystem` nor `-memory`'s `dist/index.js`
 * has any `--version` handling).
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE THAT WERE NOT SPECIFIED (ratify or redirect —
 * see the T3 final report for the full list; summarised at each call site):
 *
 *  D-A. Module surface (exact names the implementer must produce):
 *       CONNECTION_KINDS, ConnectionKind, ConnectionInstallMethod,
 *       ConnectionConfigVar, ConnectionProbeSpec, ConnectionCapability,
 *       ConnectionUsedByDerivation, ConnectionDefinition,
 *       CONNECTION_USAGE_SOURCE, listConnections, connectionById,
 *       deriveConnectionUsage.
 *  D-B. `listConnections(forgeRoot)` reads `studio/catalog.yaml` via the
 *       ALREADY-SHIPPED `loadCatalog` (registry.ts) — WI-1 extends
 *       `Catalog.tools`/`Catalog.mcps` to a richer `CatalogConnectionEntry`
 *       (install/config/probe/provenance/capabilities), parsed by
 *       `loadCatalog` itself (structural invalidity THROWS at load — mirrors
 *       every other registry.ts loader). `connection-library.ts` composes
 *       `loadCatalog`'s output with the DERIVED facts (kind, installable,
 *       usedBy, usedByDerivation) — it does not re-parse the YAML itself.
 *       This is why every fixture below writes a full `catalog.yaml`
 *       (sdks/models/tools/mcps/guards, mirroring `validCatalogYaml()` in
 *       cli/studio-lint.test.ts) rather than a bespoke connections-only file.
 *  D-C. `kind` (D2 of the spec): `tools:` section entries get kind:'tool',
 *       `mcps:` section entries get kind:'mcp' — structural, from WHICH
 *       array the entry came from, never content-sniffed.
 *  D-D. `installable` = `install.method === 'npm'` (D13: `external` is
 *       ALSO not forge-installable — "Forge does not install these" — so
 *       installable is narrower than "not system-provided"; it is exactly
 *       "is an npm method", the only method forge actually knows how to
 *       install).
 *  D-E. `usedBy`/`usedByDerivation` mirror hook-library.ts's
 *       `carriedBy`/`carriedByDerivation` precedent exactly: scanned from
 *       every real skill dir's SKILL.md `composition.tools` +
 *       `composition.mcps` arrays (NOT a separate "connections" composition
 *       field — a connection IS a tools/mcps entry, per D2's "no third kind"
 *       ruling). `CONNECTION_USAGE_SOURCE` names the scan verbatim, mirroring
 *       `HOOK_USAGE_SOURCE`.
 *  D-F. `capabilitiesSource: 'curated'` is present ONLY on `kind:'mcp'`
 *       entries that declare `capabilities:` — a `kind:'tool'` entry never
 *       carries `capabilities`/`capabilitiesSource` at all (undefined, not a
 *       fabricated empty array) — the R3-06 D3 "derivation names itself"
 *       device (D8 of the spec).
 *  D-G. Secret-safety (D5 of the spec): `ConnectionConfigVar` is
 *       `{env, required, purpose}` — structurally NO value field anywhere in
 *       the type, so a config var can never carry a secret value even by
 *       mistake. `listConnections`'s OWN serialised output (JSON.stringify)
 *       must never contain a live env-var VALUE, even when that env var
 *       happens to be set in the process at scan time.
 *  D-H. `ConnectionProbeSpec` (D15): `{kind:'command', command, args}` |
 *       `{kind:'command-presence', command}` (NO `args` key — it is never
 *       invoked, so an argv would be meaningless and misleading) |
 *       `{kind:'npm-package'}` (NO `command`/`args` at all — it reads the
 *       installed package's own `package.json`, never spawns anything).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import {
  CONNECTION_KINDS,
  listConnections,
  connectionById,
  deriveConnectionUsage,
  CONNECTION_USAGE_SOURCE,
  type ConnectionDefinition,
} from './connection-library.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const createdDirs: string[] = [];
const envKeysToRestore = new Map<string, string | undefined>();

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'connection-library-'));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of envKeysToRestore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setEnvForTest(key: string, value: string): void {
  if (!envKeysToRestore.has(key)) envKeysToRestore.set(key, process.env[key]);
  process.env[key] = value;
}

type RawToolFixture = {
  id: string;
  name?: string;
  desc?: string;
  install?: Record<string, unknown>;
  config?: Array<Record<string, unknown>>;
  probe?: Record<string, unknown>;
  provenance?: string;
};

type RawMcpFixture = RawToolFixture & { capabilities?: Array<{ name: string; summary: string }> };

const SYSTEM_PROVIDED = { method: 'system-provided' };
/** D16: the real npm-distributed, no-required-config round-trip example. */
const MEMORY_NPM_INSTALL = { method: 'npm', package: '@modelcontextprotocol/server-memory', version: '2026.7.4' };
const MEMORY_NPM_PROBE = { kind: 'npm-package' };
/** D13: the real "no npm distribution" example — used for external-method fixtures. */
const SQLITE_EXTERNAL_INSTALL = { method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' };
const SQLITE_PRESENCE_PROBE = { kind: 'command-presence', command: 'mcp-server-sqlite' };

function toolEntry(f: RawToolFixture): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name ?? f.id,
    desc: f.desc ?? `Test tool ${f.id}.`,
    install: f.install ?? SYSTEM_PROVIDED,
    config: f.config ?? [],
    probe: f.probe ?? { kind: 'command', command: f.id, args: ['--version'] },
    provenance: f.provenance ?? 'system',
  };
}

function mcpEntry(f: RawMcpFixture): Record<string, unknown> {
  return {
    ...toolEntry(f),
    install: f.install ?? MEMORY_NPM_INSTALL,
    probe: f.probe ?? MEMORY_NPM_PROBE,
    capabilities: f.capabilities ?? [{ name: 'query', summary: 'Do the thing.' }],
  };
}

/** Write a full, structurally-valid studio/catalog.yaml (sdks/models/guards
 *  included so loadCatalog's other sections don't throw) with the given
 *  connections-extended tools:/mcps: entries. */
function writeConnectionsCatalog(root: string, opts: { tools?: RawToolFixture[]; mcps?: RawMcpFixture[] } = {}): void {
  const doc = {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: (opts.tools ?? []).map(toolEntry),
    mcps: (opts.mcps ?? []).map(mcpEntry),
    guards: [{ id: 'event-log', name: 'Event Log', desc: 'x' }],
  };
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'catalog.yaml'), yaml.dump(doc), 'utf8');
}

function writeAgentSkillMd(root: string, slug: string, tools: string[] = [], mcps: string[] = []): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const content = `---
name: ${slug}
description: Test agent ${slug}.
purpose: Test purpose.
composition:
  skills: []
  tools: [${tools.join(', ')}]
  mcps: [${mcps.join(', ')}]
  guards: []
  hooks: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: []
disallowed-tools: []
budgets:
  iterationCap: 5
---

Process body.
`;
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
}

function byId(entries: readonly ConnectionDefinition[], id: string): ConnectionDefinition {
  const e = entries.find((x) => x.id === id);
  assert.ok(e, `expected connection "${id}" to be present, got ids: ${entries.map((x) => x.id).join(', ')}`);
  return e!;
}

// ---------------------------------------------------------------------------
// CONNECTION_KINDS — closed, exactly two (D2: no third kind)
// ---------------------------------------------------------------------------

describe('CONNECTION_KINDS', () => {
  it('is exactly {tool, mcp} — no third kind (D2)', () => {
    assert.deepEqual([...CONNECTION_KINDS].sort(), ['mcp', 'tool']);
  });
});

// ---------------------------------------------------------------------------
// listConnections — kind derivation (D-C), structural, never content-sniffed
// ---------------------------------------------------------------------------

describe('listConnections: kind is derived from the catalog section, never content-sniffed', () => {
  it('a tools: entry gets kind "tool"; a mcps: entry gets kind "mcp"', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      tools: [{ id: 'git' }],
      mcps: [{ id: 'memory' }],
    });
    const entries = listConnections(root);
    assert.equal(byId(entries, 'git').kind, 'tool');
    assert.equal(byId(entries, 'memory').kind, 'mcp');
  });

  it('returns exactly the union of tools: and mcps: — nothing invented, nothing dropped', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      tools: [{ id: 'git' }, { id: 'node' }],
      mcps: [{ id: 'memory' }],
    });
    const ids = listConnections(root).map((e) => e.id).sort();
    assert.deepEqual(ids, ['git', 'memory', 'node']);
  });
});

// ---------------------------------------------------------------------------
// installable (D-D, D13): npm ONLY. system-provided AND external are both
// non-installable — neither has a forge-driven install path.
// ---------------------------------------------------------------------------

describe('listConnections: installable derivation (D13 — npm ONLY)', () => {
  it('system-provided → installable: false', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git', install: SYSTEM_PROVIDED }] });
    assert.equal(byId(listConnections(root), 'git').installable, false);
  });

  it('external → installable: false (D13: "Forge does not install these" — NOT the same as installable)', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'sqlite', install: SQLITE_EXTERNAL_INSTALL, probe: SQLITE_PRESENCE_PROBE }],
    });
    assert.equal(byId(listConnections(root), 'sqlite').installable, false);
  });

  it('an npm install method → installable: true', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { mcps: [{ id: 'memory' }] }); // mcpEntry's default is npm
    assert.equal(byId(listConnections(root), 'memory').installable, true);
  });
});

// ---------------------------------------------------------------------------
// Install/config/probe/provenance carried through verbatim (F1 AC: every
// entry carries the extended metadata) — one AT per probe KIND (D15/D-H).
// ---------------------------------------------------------------------------

describe('listConnections: extended metadata (install/config/probe/provenance) round-trips verbatim', () => {
  it('an npm-pinned mcp carries its exact package/version pin, a KIND:"npm-package" probe (no command/args), and provenance', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [
        {
          id: 'memory',
          install: MEMORY_NPM_INSTALL,
          probe: MEMORY_NPM_PROBE,
          provenance: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
          config: [{ env: 'MEMORY_FILE_PATH', required: false, purpose: 'Where to persist the graph.' }],
        },
      ],
    });
    const entry = byId(listConnections(root), 'memory');
    assert.deepEqual(entry.install, MEMORY_NPM_INSTALL);
    assert.deepEqual(entry.probe, { kind: 'npm-package' });
    assert.equal('command' in entry.probe, false, 'an npm-package probe must carry no command — it is never spawned (D15)');
    assert.equal('args' in entry.probe, false, 'an npm-package probe must carry no args — it is never spawned (D15)');
    assert.equal(entry.provenance, 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory');
    assert.deepEqual(entry.config, [{ env: 'MEMORY_FILE_PATH', required: false, purpose: 'Where to persist the graph.' }]);
  });

  it('a system-provided tool carries a KIND:"command" probe with command + args verbatim', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      tools: [{ id: 'git', probe: { kind: 'command', command: 'git', args: ['--version'] } }],
    });
    const entry = byId(listConnections(root), 'git');
    assert.deepEqual(entry.probe, { kind: 'command', command: 'git', args: ['--version'] });
  });

  it('an external entry with an unverified probe flag carries a KIND:"command-presence" probe — command only, NO args key at all', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'sqlite', install: SQLITE_EXTERNAL_INSTALL, probe: SQLITE_PRESENCE_PROBE }],
    });
    const entry = byId(listConnections(root), 'sqlite');
    assert.deepEqual(entry.probe, { kind: 'command-presence', command: 'mcp-server-sqlite' });
    assert.equal('args' in entry.probe, false, 'command-presence never carries args — it is never invoked (D15)');
  });

  it('an external entry\'s install carries {method, upstream} verbatim — no package/version fields at all (D13: "no package name to resolve")', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'sqlite', install: SQLITE_EXTERNAL_INSTALL, probe: SQLITE_PRESENCE_PROBE }],
    });
    const entry = byId(listConnections(root), 'sqlite');
    assert.deepEqual(entry.install, { method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' });
    assert.equal('package' in entry.install, false);
    assert.equal('version' in entry.install, false);
  });

  it('a config var carries EXACTLY {env, required, purpose} — no other key, structurally no value field', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'github', install: { method: 'external', upstream: 'https://github.com/github/github-mcp-server' }, probe: { kind: 'command', command: 'github-mcp-server', args: ['--version'] }, config: [{ env: 'GITHUB_PERSONAL_ACCESS_TOKEN', required: true, purpose: 'GitHub API auth.' }] }],
    });
    const entry = byId(listConnections(root), 'github');
    assert.equal(entry.config.length, 1);
    assert.deepEqual(Object.keys(entry.config[0]!).sort(), ['env', 'purpose', 'required']);
  });
});

// ---------------------------------------------------------------------------
// capabilities / curated labelling (D-F, D8 of the spec)
// ---------------------------------------------------------------------------

describe('capabilities: curated, self-naming, MCP-only', () => {
  it('an mcp entry carries capabilities verbatim + capabilitiesSource: "curated"', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'memory', capabilities: [{ name: 'create_entities', summary: 'Create graph entities.' }, { name: 'read_graph', summary: 'Read the whole graph.' }] }],
    });
    const entry = byId(listConnections(root), 'memory');
    assert.deepEqual(entry.capabilities, [
      { name: 'create_entities', summary: 'Create graph entities.' },
      { name: 'read_graph', summary: 'Read the whole graph.' },
    ]);
    assert.equal(entry.capabilitiesSource, 'curated', 'must name itself as curated — never presented as a verified live capability list (D8)');
  });

  it('a tool entry NEVER carries capabilities or capabilitiesSource — undefined, not a fabricated empty array', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git' }] });
    const entry = byId(listConnections(root), 'git');
    assert.equal(entry.capabilities, undefined);
    assert.equal(entry.capabilitiesSource, undefined);
    assert.equal('capabilities' in entry, false, 'a tool entry must not carry a "capabilities" key at all');
  });
});

// ---------------------------------------------------------------------------
// usedBy / usedByDerivation (D-E) — derived, self-naming (R3-06 D3 precedent)
// ---------------------------------------------------------------------------

describe('usedBy: derived from real agent composition.tools/composition.mcps, self-naming', () => {
  it('a connection used by no agent still names WHAT it scanned and HOW MANY (never "unknown, rendered empty")', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git' }] });
    writeAgentSkillMd(root, 'unrelated-agent', [], []);
    const entry = byId(listConnections(root), 'git');
    assert.deepEqual(entry.usedBy, []);
    assert.equal(entry.usedByDerivation.scanned, 1);
    assert.equal(entry.usedByDerivation.source, CONNECTION_USAGE_SOURCE);
  });

  it('a tool bound via composition.tools is used by exactly that agent slug', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git' }] });
    writeAgentSkillMd(root, 'git-user-agent', ['git'], []);
    writeAgentSkillMd(root, 'bystander-agent', [], []);
    const entry = byId(listConnections(root), 'git');
    assert.deepEqual(entry.usedBy, ['git-user-agent']);
    assert.equal(entry.usedByDerivation.scanned, 2);
  });

  it('an mcp bound via composition.mcps is used by exactly that agent slug', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { mcps: [{ id: 'memory' }] });
    writeAgentSkillMd(root, 'memory-user-agent', [], ['memory']);
    const entry = byId(listConnections(root), 'memory');
    assert.deepEqual(entry.usedBy, ['memory-user-agent']);
  });

  it('usedBy is sorted + de-duplicated across multiple carrying agents', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git' }] });
    writeAgentSkillMd(root, 'z-agent', ['git'], []);
    writeAgentSkillMd(root, 'a-agent', ['git'], []);
    const entry = byId(listConnections(root), 'git');
    assert.deepEqual(entry.usedBy, ['a-agent', 'z-agent']);
  });

  it('deriveConnectionUsage(forgeRoot) exposes the same fact as a standalone Map', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { mcps: [{ id: 'memory' }] });
    writeAgentSkillMd(root, 'map-carrier', [], ['memory']);
    const usage = deriveConnectionUsage(root);
    assert.deepEqual(usage.get('memory'), ['map-carrier']);
  });
});

// ---------------------------------------------------------------------------
// connectionById
// ---------------------------------------------------------------------------

describe('connectionById', () => {
  it('returns the entry for a known id', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git' }] });
    const entry = connectionById(root, 'git');
    assert.ok(entry);
    assert.equal(entry!.id, 'git');
  });

  it('returns undefined (never throws) for an unknown id', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, { tools: [{ id: 'git' }] });
    assert.equal(connectionById(root, 'no-such-connection'), undefined);
  });
});

// ---------------------------------------------------------------------------
// D-G — Secret-safety: a config var NAME never carries a live VALUE anywhere
// in the derived, serialised connection payload (D5 of the spec)
// ---------------------------------------------------------------------------

describe('secret-safety: a config env-var VALUE never appears in the serialized connection payload', () => {
  it('setting the declared env var to a unique sentinel — the sentinel appears NOWHERE in listConnections output', () => {
    const root = makeForgeRoot();
    const SENTINEL = 'FORGE_TEST_SENTINEL_7f3a9c21';
    setEnvForTest('FORGE_CONN_TEST_SECRET', SENTINEL);
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'github', install: { method: 'external', upstream: 'https://github.com/github/github-mcp-server' }, probe: { kind: 'command', command: 'github-mcp-server', args: ['--version'] }, config: [{ env: 'FORGE_CONN_TEST_SECRET', required: true, purpose: 'auth token' }] }],
    });
    const entries = listConnections(root);
    const serialized = JSON.stringify(entries);
    assert.ok(!serialized.includes(SENTINEL), 'a live env-var VALUE must never appear in the serialized connection payload — only the NAME may');
    assert.ok(serialized.includes('FORGE_CONN_TEST_SECRET'), 'the env-var NAME itself is expected to appear (that is the whole point of config)');
  });
});

// ---------------------------------------------------------------------------
// D13 (round 3, supersedes the round-2 "closed two-value" ruling): install:
// is a CLOSED THREE-method discriminated union — {method:'system-provided'}
// | {method:'npm', package, version} | {method:'external', upstream}. Any
// other method value THROWS at load. A "binary" download method is
// DELIBERATELY not built — it would need a checksum/verification story
// nothing in the curated set needs; that limit is stated here, not silently
// absent.
// ---------------------------------------------------------------------------

describe('install: closed THREE-value discriminated union (D13, round 3 — supersedes round 2\'s two-value ruling)', () => {
  it('an unrecognised method ("binary") THROWS — no checksum/verification story exists for it, by design', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      tools: [{ id: 'bad-binary-tool', install: { method: 'binary', url: 'https://example.com/bad-binary-tool' } }],
    });
    assert.throws(() => listConnections(root));
  });

  it('an unrecognised method ("brew") THROWS — the set is exactly three, not "whatever curation feels like this week"', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      tools: [{ id: 'bad-brew-tool', install: { method: 'brew', package: 'bad-brew-tool' } }],
    });
    assert.throws(() => listConnections(root));
  });

  it('an "external" entry missing its required "upstream" field THROWS — the whole point of external is naming the real upstream', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      mcps: [{ id: 'bad-external-mcp', install: { method: 'external' }, probe: SQLITE_PRESENCE_PROBE }],
    });
    assert.throws(() => listConnections(root));
  });

  it('"system-provided", "npm", AND "external" are ALL accepted without throwing (the three real members of the closed set)', () => {
    const root = makeForgeRoot();
    writeConnectionsCatalog(root, {
      tools: [{ id: 'git', install: SYSTEM_PROVIDED }],
      mcps: [
        { id: 'memory', install: MEMORY_NPM_INSTALL, probe: MEMORY_NPM_PROBE },
        { id: 'sqlite', install: SQLITE_EXTERNAL_INSTALL, probe: SQLITE_PRESENCE_PROBE },
      ],
    });
    assert.doesNotThrow(() => listConnections(root));
  });
});

// ---------------------------------------------------------------------------
// F1 AC — the real repo's Appendix A content: 3 tools + 6 mcps, verified
// shape. Stays RED against the current, UNEXTENDED real catalog.yaml until
// WI-1 lands (see the T3 final report).
// ---------------------------------------------------------------------------

describe('the real repo (F1 AC, Appendix A): every existing tool/mcp entry carries the VERIFIED extended metadata', () => {
  it('exactly the 3 real tool ids {git, node, gh} + 6 real mcp ids {filesystem, memory, playwright, github, fetch, sqlite}', () => {
    const entries = listConnections(REPO_ROOT);
    const toolIds = entries.filter((e) => e.kind === 'tool').map((e) => e.id).sort();
    const mcpIds = entries.filter((e) => e.kind === 'mcp').map((e) => e.id).sort();
    assert.deepEqual(toolIds, ['gh', 'git', 'node']);
    assert.deepEqual(mcpIds, ['fetch', 'filesystem', 'github', 'memory', 'playwright', 'sqlite']);
  });

  it('every entry carries a non-empty install/probe/provenance and a config array (may be empty)', () => {
    const entries = listConnections(REPO_ROOT);
    for (const e of entries) {
      assert.ok(e.install, `"${e.id}" must carry an install method`);
      assert.ok(e.probe && e.probe.kind, `"${e.id}" must carry a kind-tagged probe`);
      assert.ok(e.provenance && e.provenance.trim().length > 0, `"${e.id}" must carry a non-empty provenance`);
      assert.ok(Array.isArray(e.config), `"${e.id}" must carry a config array`);
    }
  });

  it('every real mcp entry carries at least one capability, labelled curated', () => {
    const mcps = listConnections(REPO_ROOT).filter((e) => e.kind === 'mcp');
    for (const e of mcps) {
      assert.ok(Array.isArray(e.capabilities) && e.capabilities.length > 0, `"${e.id}" must carry ≥1 capability (F1/D8 lint requirement)`);
      assert.equal(e.capabilitiesSource, 'curated');
    }
  });

  it('all 3 tools are system-provided with a KIND:"command" probe (D13/D15)', () => {
    for (const id of ['git', 'node', 'gh']) {
      const entry = byId(listConnections(REPO_ROOT), id);
      assert.equal(entry.install.method, 'system-provided');
      assert.equal(entry.probe.kind, 'command');
    }
  });

  it('filesystem/memory/playwright are npm-installed with a KIND:"npm-package" probe (D13/D15)', () => {
    for (const id of ['filesystem', 'memory', 'playwright']) {
      const entry = byId(listConnections(REPO_ROOT), id);
      assert.equal(entry.install.method, 'npm', `"${id}" must be npm-installed per Appendix A`);
      assert.equal(entry.probe.kind, 'npm-package');
      assert.equal(entry.installable, true);
    }
  });

  it('github/fetch/sqlite are ALL "external" — none has a working npm install path (D13, the whole point of this round\'s correction)', () => {
    for (const id of ['github', 'fetch', 'sqlite']) {
      const entry = byId(listConnections(REPO_ROOT), id);
      assert.equal(entry.install.method, 'external', `"${id}" must be external per Appendix A — it has no working npm install path`);
      assert.equal(entry.installable, false, `"${id}" must never present as forge-installable`);
      assert.ok('upstream' in entry.install && typeof (entry.install as { upstream: string }).upstream === 'string' && (entry.install as { upstream: string }).upstream.startsWith('http'), `"${id}" must carry a real upstream URL`);
    }
  });

  it('REGRESSION GUARD: the "fetch" entry never declares an npm package — the npm name "mcp-server-fetch" is a security-research typosquat canary (D13)', () => {
    const fetchEntry = byId(listConnections(REPO_ROOT), 'fetch');
    assert.notEqual(fetchEntry.install.method, 'npm', 'fetch must never be npm-installed — the only npm package with this name is a canary/squat, not the real server');
    assert.equal('package' in fetchEntry.install, false);
  });

  it('sqlite\'s description honestly says the upstream is archived — an operator must not read this entry as live software (D16)', () => {
    const sqliteEntry = byId(listConnections(REPO_ROOT), 'sqlite');
    assert.ok(sqliteEntry.desc, 'sqlite must carry a desc');
    assert.match(sqliteEntry.desc!.toLowerCase(), /archiv/, 'sqlite\'s desc must plainly say the upstream is archived, not silently present it as live');
  });

  it('github/fetch/sqlite (command | command-presence probes) never carry an "args" key when their kind is command-presence', () => {
    for (const id of ['fetch', 'sqlite']) {
      const entry = byId(listConnections(REPO_ROOT), id);
      assert.equal(entry.probe.kind, 'command-presence', `"${id}" has no verified probe flag per Appendix A — must be command-presence`);
      assert.equal('args' in entry.probe, false);
    }
  });
});
