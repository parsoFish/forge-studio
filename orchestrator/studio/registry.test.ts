/**
 * Tests for orchestrator/studio/registry.ts
 * Uses node:test + node:assert/strict with mkdtempSync fixtures.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  isStudioAgent,
  loadAgentDefinition,
  serializeAgentDefinition,
  listAgentDefinitions,
  loadFlowDefinition,
  serializeFlowDefinition,
  loadKbDescriptor,
  loadCatalog,
  discoverProjects,
} from './registry.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_FIXTURE = `---
name: tester
description: A test agent.
phase: tester
purpose: Test things.
composition:
  skills: [demo]
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: [Read, Grep]
disallowed-tools: [Bash]
budgets:
  iterationCap: 15
---

Process body here.
`;

const LEGACY_AGENT_FIXTURE = `---
name: legacy-agent
description: A legacy skill without studio fields.
---

Some body.
`;

const FLOW_FIXTURE = `id: forge-cycle
name: Forge Cycle
version: 1
goal: Take an approved initiative to a merged PR with reflection captured.
project: null
kb: cycles
costCeilingUsd: 25
origin: seed
nodes:
  - { id: architect, agent: architect, gate: plan }
  - { id: pm, agent: project-manager }
  - { id: dev, agent: developer-ralph, fanOut: work-items }
  - { id: unifier, agent: developer-unifier, resumable: true }
  - { id: review, gate: verdict }
  - { id: reflect, agent: reflector }
edges:
  - { from: architect, to: pm, artifact: plan }
  - { from: pm, to: dev, artifact: work-items }
  - { from: dev, to: unifier, artifact: wi-branches }
  - { from: unifier, to: review, artifact: pr }
  - { from: review, to: reflect, artifact: verdict }
triggers: []
`;

const KB_FIXTURE = `id: cycles
name: Cycle Patterns
scope: flow
desc: Accumulated cross-cycle patterns and retros.
`;

const CATALOG_FIXTURE = `sdks:
  - { id: claude, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }
tools:
  - { id: Read, name: Read }
  - { id: Grep, name: Grep }
mcps:
  - { id: gmail, name: Gmail MCP }
hooks:
  - { id: event-log, name: Event Log Hook }
`;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'forge-studio-registry-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

function writeAgentFixture(dirName: string, content: string): string {
  const dir = join(tmpDir, dirName);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'SKILL.md');
  writeFileSync(p, content, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// isStudioAgent
// ---------------------------------------------------------------------------

describe('isStudioAgent', () => {
  it('returns true for studio frontmatter (has runtime block)', () => {
    const p = writeAgentFixture('studio-agent', AGENT_FIXTURE);
    assert.equal(isStudioAgent(p), true);
  });

  it('returns false for legacy frontmatter (no runtime block)', () => {
    const p = writeAgentFixture('legacy-agent', LEGACY_AGENT_FIXTURE);
    assert.equal(isStudioAgent(p), false);
  });
});

// ---------------------------------------------------------------------------
// loadAgentDefinition
// ---------------------------------------------------------------------------

describe('loadAgentDefinition', () => {
  it('parses slug from parent directory name', () => {
    const p = writeAgentFixture('my-tester', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.slug, 'my-tester');
  });

  it('parses name and description', () => {
    const p = writeAgentFixture('name-desc-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.name, 'tester');
    assert.equal(def.description, 'A test agent.');
  });

  it('parses phase', () => {
    const p = writeAgentFixture('phase-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.phase, 'tester');
  });

  it('parses composition.hooks', () => {
    const p = writeAgentFixture('hooks-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.composition.hooks, ['event-log']);
    assert.deepEqual(def.composition.skills, ['demo']);
    assert.deepEqual(def.composition.tools, []);
    assert.deepEqual(def.composition.mcps, []);
  });

  it('parses runtime.model', () => {
    const p = writeAgentFixture('runtime-model-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.runtime.model, 'claude-sonnet-4-6');
    assert.equal(def.runtime.sdk, 'claude');
    assert.equal(def.runtime.strategy, 'fixed');
  });

  it('parses allowedTools and disallowedTools', () => {
    const p = writeAgentFixture('tools-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.allowedTools, ['Read', 'Grep']);
    assert.deepEqual(def.disallowedTools, ['Bash']);
  });

  it('parses budgets.iterationCap', () => {
    const p = writeAgentFixture('budgets-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.budgets.iterationCap, 15);
  });

  it('parses body content', () => {
    const p = writeAgentFixture('body-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.ok(def.body.includes('Process body here.'));
  });

  it('sets path to the absolute SKILL.md path', () => {
    const p = writeAgentFixture('path-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.path, p);
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition (round-trip)
// ---------------------------------------------------------------------------

describe('serializeAgentDefinition', () => {
  it('round-trips losslessly: load → serialize → write → load → deepEqual (ignoring path)', () => {
    const p = writeAgentFixture('roundtrip-agent', AGENT_FIXTURE);
    const original = loadAgentDefinition(p);

    const serialized = serializeAgentDefinition(original);

    // Write to a new file in a new dir
    const rtDir = join(tmpDir, 'roundtrip-agent-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, serialized, 'utf8');

    const reloaded = loadAgentDefinition(rtPath);

    // Compare everything except path and slug (slug is derived from dir name, which differs).
    const { path: _origPath, slug: _origSlug, ...origRest } = original;
    const { path: _rtPath, slug: _rtSlug, ...reloadedRest } = reloaded;
    assert.deepEqual(reloadedRest, origRest);
  });
});

// ---------------------------------------------------------------------------
// loadFlowDefinition
// ---------------------------------------------------------------------------

describe('loadFlowDefinition', () => {
  it('parses id, name, version, goal, origin, costCeilingUsd', () => {
    const p = writeFixture('forge-cycle.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.id, 'forge-cycle');
    assert.equal(flow.name, 'Forge Cycle');
    assert.equal(flow.version, 1);
    assert.equal(flow.goal, 'Take an approved initiative to a merged PR with reflection captured.');
    assert.equal(flow.origin, 'seed');
    assert.equal(flow.costCeilingUsd, 25);
  });

  it('parses nodes: agent nodes and gate-only node', () => {
    const p = writeFixture('flow-nodes.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.nodes.length, 6);

    // Agent node
    const pm = flow.nodes.find((n) => n.id === 'pm');
    assert.ok(pm);
    assert.equal(pm.agent, 'project-manager');
    assert.equal(pm.gate, undefined);

    // fanOut node
    const dev = flow.nodes.find((n) => n.id === 'dev');
    assert.ok(dev);
    assert.equal(dev.fanOut, 'work-items');

    // resumable node
    const unifier = flow.nodes.find((n) => n.id === 'unifier');
    assert.ok(unifier);
    assert.equal(unifier.resumable, true);

    // gate-only node (no agent)
    const review = flow.nodes.find((n) => n.id === 'review');
    assert.ok(review);
    assert.equal(review.agent, undefined);
    assert.equal(review.gate, 'verdict');
  });

  it('parses edges with from/to/artifact', () => {
    const p = writeFixture('flow-edges.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.edges.length, 5);
    assert.deepEqual(flow.edges[0], { from: 'architect', to: 'pm', artifact: 'plan' });
  });

  it('project: null → null', () => {
    const p = writeFixture('flow-null-project.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.project, null);
  });

  it('kb present → string', () => {
    const p = writeFixture('flow-kb.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.kb, 'cycles');
  });

  it('triggers absent or [] → []', () => {
    const p = writeFixture('flow-triggers.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.deepEqual(flow.triggers, []);
  });

  it('triggers absent (no key) → []', () => {
    const noTriggers = FLOW_FIXTURE.replace('triggers: []\n', '');
    const p = writeFixture('flow-no-triggers.yaml', noTriggers);
    const flow = loadFlowDefinition(p);
    assert.deepEqual(flow.triggers, []);
  });

  it('kickoff present → parsed', () => {
    const p = writeFixture('flow-kickoff.yaml', FLOW_FIXTURE + 'kickoff: { kind: initiative-select }\n');
    const flow = loadFlowDefinition(p);
    assert.deepEqual(flow.kickoff, { kind: 'initiative-select' });
  });

  it('kickoff absent → undefined', () => {
    const p = writeFixture('flow-kickoff-absent.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.strictEqual(flow.kickoff, undefined);
  });

  it('kickoff round-trips through serialize', () => {
    const p = writeFixture('flow-kickoff-rt-src.yaml', FLOW_FIXTURE + 'kickoff: { kind: trigger-only }\n');
    const original = loadFlowDefinition(p);
    const reloaded = loadFlowDefinition(
      writeFixture('flow-kickoff-rt-dst.yaml', serializeFlowDefinition(original)),
    );
    assert.deepEqual(reloaded.kickoff, { kind: 'trigger-only' });
  });

  it('project absent → null', () => {
    const noProject = FLOW_FIXTURE.replace('project: null\n', '');
    const p = writeFixture('flow-no-project.yaml', noProject);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.project, null);
  });

  it('kb absent → null', () => {
    const noKb = FLOW_FIXTURE.replace('kb: cycles\n', '');
    const p = writeFixture('flow-no-kb.yaml', noKb);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.kb, null);
  });

  it('sets path', () => {
    const p = writeFixture('flow-path.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.path, p);
  });
});

// ---------------------------------------------------------------------------
// serializeFlowDefinition (round-trip)
// ---------------------------------------------------------------------------

describe('serializeFlowDefinition', () => {
  it('round-trips: load → serialize → load → deepEqual sans path', () => {
    const p = writeFixture('flow-rt-src.yaml', FLOW_FIXTURE);
    const original = loadFlowDefinition(p);

    const serialized = serializeFlowDefinition(original);

    const rtPath = writeFixture('flow-rt-dst.yaml', serialized);
    const reloaded = loadFlowDefinition(rtPath);

    const { path: _op, ...origRest } = original;
    const { path: _rp, ...reloadedRest } = reloaded;
    assert.deepEqual(reloadedRest, origRest);
  });

  it('persists node x/y positions across serialize → load (J3 / ADR-033)', () => {
    const src = loadFlowDefinition(writeFixture('flow-xy-src.yaml', FLOW_FIXTURE));
    const positioned = {
      ...src,
      nodes: src.nodes.map((n, i) => ({ ...n, x: 100 + i * 50, y: 200 + i * 30 })),
    };
    const reloaded = loadFlowDefinition(writeFixture('flow-xy-dst.yaml', serializeFlowDefinition(positioned)));
    for (let i = 0; i < positioned.nodes.length; i++) {
      assert.equal(reloaded.nodes[i].x, 100 + i * 50, `node[${i}].x must round-trip`);
      assert.equal(reloaded.nodes[i].y, 200 + i * 30, `node[${i}].y must round-trip`);
    }
  });
});

// ---------------------------------------------------------------------------
// loadKbDescriptor
// ---------------------------------------------------------------------------

describe('loadKbDescriptor', () => {
  it('parses id, name, scope, desc', () => {
    const p = writeFixture('kb.yaml', KB_FIXTURE);
    const kb = loadKbDescriptor(p);
    assert.equal(kb.id, 'cycles');
    assert.equal(kb.name, 'Cycle Patterns');
    assert.equal(kb.scope, 'flow');
    assert.equal(kb.desc, 'Accumulated cross-cycle patterns and retros.');
    assert.equal(kb.path, p);
  });
});

// ---------------------------------------------------------------------------
// loadCatalog
// ---------------------------------------------------------------------------

describe('loadCatalog', () => {
  it('parses all five sections', () => {
    const p = writeFixture('catalog.yaml', CATALOG_FIXTURE);
    const catalog = loadCatalog(p);
    assert.equal(catalog.sdks.length, 1);
    assert.equal(catalog.sdks[0].id, 'claude');
    assert.equal(catalog.sdks[0].available, true);
    assert.equal(catalog.models.length, 1);
    assert.equal(catalog.models[0].tier, 'sonnet');
    assert.equal(catalog.tools.length, 2);
    assert.equal(catalog.mcps.length, 1);
    assert.equal(catalog.hooks.length, 1);
    assert.equal(catalog.path, p);
  });

  it('missing section → []', () => {
    const partial = `sdks:\n  - { id: claude, name: Claude Agent SDK, available: true }\n`;
    const p = writeFixture('catalog-partial.yaml', partial);
    const catalog = loadCatalog(p);
    assert.deepEqual(catalog.models, []);
    assert.deepEqual(catalog.tools, []);
    assert.deepEqual(catalog.mcps, []);
    assert.deepEqual(catalog.hooks, []);
  });
});

// ---------------------------------------------------------------------------
// discoverProjects (disk scan — replaces the projects.yaml registry)
// ---------------------------------------------------------------------------

describe('discoverProjects', () => {
  it('discovers a project dir that carries .forge/project.json', () => {
    const forgeRoot = join(tmpDir, 'disc-cfg');
    const projDir = join(forgeRoot, 'projects', 'betterado', '.forge');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'project.json'), '{"name":"betterado"}', 'utf8');

    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'betterado');
    assert.equal(found[0].path, 'projects/betterado');
    assert.equal(found[0].hasConfig, true);
  });

  it('flags a project dir missing .forge/project.json (hasConfig=false)', () => {
    const forgeRoot = join(tmpDir, 'disc-nocfg');
    mkdirSync(join(forgeRoot, 'projects', 'half-onboarded'), { recursive: true });

    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'half-onboarded');
    assert.equal(found[0].hasConfig, false);
  });

  it('slugifies a mixed-case dir name to a SLUG_RE id', () => {
    const forgeRoot = join(tmpDir, 'disc-slug');
    mkdirSync(join(forgeRoot, 'projects', 'trafficGame'), { recursive: true });

    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'trafficgame');
    assert.equal(found[0].path, 'projects/trafficGame');
  });

  it('returns sorted entries and tolerates a missing projects root', () => {
    const forgeRoot = join(tmpDir, 'disc-sort');
    for (const n of ['zeta', 'alpha']) mkdirSync(join(forgeRoot, 'projects', n), { recursive: true });
    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.deepEqual(found.map((p) => p.id), ['alpha', 'zeta']);

    // missing projects root → empty list (not a throw)
    assert.deepEqual(discoverProjects(join(tmpDir, 'does-not-exist'), tmpDir), []);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('loaders throw with file path in message on malformed YAML', () => {
    const p = writeFixture('bad.yaml', '{ not yaml: [');
    assert.throws(
      () => loadFlowDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadFlowDefinition throws with path on missing required field (id)', () => {
    const noId = FLOW_FIXTURE.replace('id: forge-cycle\n', '');
    const p = writeFixture('flow-no-id.yaml', noId);
    assert.throws(
      () => loadFlowDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadAgentDefinition throws with path on malformed content', () => {
    // Write a SKILL.md that has YAML frontmatter but missing required fields
    const dir = join(tmpDir, 'bad-agent');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'SKILL.md');
    writeFileSync(p, '---\nphase: foo\n---\nno name or description\n', 'utf8');
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadKbDescriptor throws with path on malformed YAML', () => {
    const p = writeFixture('bad-kb.yaml', '{ not yaml: [');
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadCatalog throws with path on malformed YAML', () => {
    const p = writeFixture('bad-catalog.yaml', '{ not yaml: [');
    assert.throws(
      () => loadCatalog(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

});

// ---------------------------------------------------------------------------
// loadAgentDefinition — legacy SKILL.md guard
// ---------------------------------------------------------------------------

describe('loadAgentDefinition legacy guard', () => {
  it('throws with "not a studio SKILL.md" message when frontmatter has no runtime block', () => {
    const p = writeAgentFixture('legacy-throw-agent', LEGACY_AGENT_FIXTURE);
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('not a studio SKILL.md'),
          `Expected "not a studio SKILL.md" in error: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('isStudioAgent still returns false for legacy SKILL.md without throwing', () => {
    const p = writeAgentFixture('legacy-is-studio-agent', LEGACY_AGENT_FIXTURE);
    assert.equal(isStudioAgent(p), false);
  });
});

// ---------------------------------------------------------------------------
// loadAgentDefinition — enum field guards
// ---------------------------------------------------------------------------

describe('loadAgentDefinition enum guards', () => {
  it('throws on invalid brainAccess value with descriptive message', () => {
    const bad = AGENT_FIXTURE.replace('brainAccess: none', 'brainAccess: invalid-value');
    const p = writeAgentFixture('bad-brain-access-agent', bad);
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('brainAccess') && err.message.includes('mandatory|advisory|none'),
          `Expected enum message for brainAccess: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws on invalid runtime.strategy value with descriptive message', () => {
    const bad = AGENT_FIXTURE.replace('  strategy: fixed', '  strategy: unknown-strategy');
    const p = writeAgentFixture('bad-strategy-agent', bad);
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('strategy') && err.message.includes('fixed|range'),
          `Expected enum message for strategy: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws on invalid kb scope value with descriptive message', () => {
    const bad = KB_FIXTURE.replace('scope: flow', 'scope: bad-scope');
    const p = writeFixture('bad-scope-kb.yaml', bad);
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('scope') && err.message.includes('project|flow|agent-integration'),
          `Expected enum message for scope: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition — empty budgets round-trip
// ---------------------------------------------------------------------------

describe('serializeAgentDefinition empty budgets round-trip', () => {
  it('agent without budget fields survives load→serialize→load with all budget fields undefined', () => {
    const noBudgets = AGENT_FIXTURE.replace(
      /^budgets:\n  iterationCap: 15\n/m,
      '',
    );
    const p = writeAgentFixture('no-budgets-agent', noBudgets);
    const original = loadAgentDefinition(p);

    // All budget fields should be undefined → deepEqual {}
    assert.deepEqual(original.budgets, {
      iterationFloor: undefined,
      iterationCap: undefined,
      maxTurnsPerIteration: undefined,
      wedgeKillMs: undefined,
    });

    const serialized = serializeAgentDefinition(original);

    const rtDir = join(tmpDir, 'no-budgets-agent-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, serialized, 'utf8');

    const reloaded = loadAgentDefinition(rtPath);
    assert.deepEqual(reloaded.budgets, original.budgets);
  });
});

// ---------------------------------------------------------------------------
// listAgentDefinitions
// ---------------------------------------------------------------------------

describe('listAgentDefinitions', () => {
  it('returns sorted studio agents, skipping legacy', () => {
    const skillsDir = join(tmpDir, 'skills-list');
    mkdirSync(skillsDir, { recursive: true });

    // Write two studio agents and one legacy
    for (const name of ['zulu', 'alpha']) {
      const d = join(skillsDir, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'SKILL.md'), AGENT_FIXTURE.replace('name: tester', `name: ${name}`), 'utf8');
    }
    const legDir = join(skillsDir, 'legacy');
    mkdirSync(legDir, { recursive: true });
    writeFileSync(join(legDir, 'SKILL.md'), LEGACY_AGENT_FIXTURE, 'utf8');

    const defs = listAgentDefinitions(skillsDir);
    assert.equal(defs.length, 2);
    assert.equal(defs[0].slug, 'alpha');
    assert.equal(defs[1].slug, 'zulu');
  });
});
