/**
 * Seed-data integration tests (ADR 027, M0 Task 4).
 *
 * Resolves paths from the repo root (process.cwd()), same precedent as
 * derive.test.ts.  These tests do I/O against the real repo files — kept
 * separate from validate.test.ts (which is pure, no I/O).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { loadFlowDefinition, listAgentDefinitions, loadCatalog, discoverProjects, loadKbDescriptor } from './registry.ts';
import { validateFlow, validateCatalog, validateDiscoveredProjects, validateKb, validateAgent } from './validate.ts';
import { resolveProjectsDir } from '../config.ts';
import { MODEL_BY_TIER } from '../phase-agent.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// seed flows (forge-cycle retired in S8/DEC-3 — see the forge-reflect test below
// + the forge-develop / forge-architect coverage in flow-runner.test.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

test('catalog loads and validates clean', () => {
  const catalogPath = join(ROOT, 'studio/catalog.yaml');
  const catalog = loadCatalog(catalogPath);
  const findings = validateCatalog(catalog);
  const errors = findings.filter((f) => f.level === 'error');

  assert.deepEqual(
    errors,
    [],
    `catalog has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
});

test('catalog model ids cover MODEL_BY_TIER (lockstep)', () => {
  const catalogPath = join(ROOT, 'studio/catalog.yaml');
  const catalog = loadCatalog(catalogPath);
  const catalogModelIds = new Set(catalog.models.map((m) => m.id));

  for (const [tier, modelId] of Object.entries(MODEL_BY_TIER)) {
    assert.ok(
      catalogModelIds.has(modelId),
      `MODEL_BY_TIER.${tier} = "${modelId}" is not present among catalog model ids — update studio/catalog.yaml`,
    );
  }
});

// ---------------------------------------------------------------------------
// projects (auto-discovered from disk — B1)
// ---------------------------------------------------------------------------

test('disk-discovered projects validate clean (no error-level findings)', () => {
  const projectsDir = resolveProjectsDir(ROOT);
  const findings = validateDiscoveredProjects(discoverProjects(projectsDir, ROOT));
  const errors = findings.filter((f: { level: string }) => f.level === 'error');

  assert.deepEqual(
    errors,
    [],
    `discovered projects have error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// KB descriptors
// ---------------------------------------------------------------------------

test('brain/forge-dev/kb.yaml loads, validates clean, scope is agent-integration', () => {
  const kbPath = join(ROOT, 'brain/forge-dev/kb.yaml');
  const kb = loadKbDescriptor(kbPath);
  const findings = validateKb(kb);
  const errors = findings.filter((f) => f.level === 'error');

  assert.deepEqual(
    errors,
    [],
    `forge-dev kb has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
  assert.equal(kb.scope, 'agent-integration', 'forge-dev kb.scope must be "agent-integration"');
});

test('brain/cycles/kb.yaml loads, validates clean, scope is flow', () => {
  const kbPath = join(ROOT, 'brain/cycles/kb.yaml');
  const kb = loadKbDescriptor(kbPath);
  const findings = validateKb(kb);
  const errors = findings.filter((f) => f.level === 'error');

  assert.deepEqual(
    errors,
    [],
    `cycles kb has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
  assert.equal(kb.scope, 'flow', 'cycles kb.scope must be "flow"');
});

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

test('listAgentDefinitions returns the studio agent roster', () => {
  const agents = listAgentDefinitions(join(ROOT, 'skills'));
  const slugs = agents.map((a) => a.slug).sort();

  assert.deepEqual(
    slugs,
    [
      'architect',
      'brain-ingest',
      'developer-ralph',
      'developer-unifier',
      'project-manager',
      'reflector',
      // WS-A: the release-finalizer is a phase agent (full studio frontmatter,
      // mirrors reflector) — it runs post-approval, pre-merge.
      'release-finalizer',
    ],
    `Expected the 7-agent studio roster; got: ${slugs.join(', ')}`,
  );
});

test('all studio agents validateAgent with zero ERROR-level findings', () => {
  const agents = listAgentDefinitions(join(ROOT, 'skills'));
  for (const agent of agents) {
    const findings = validateAgent(agent);
    const errors = findings.filter((f) => f.level === 'error');
    assert.deepEqual(
      errors,
      [],
      `agent "${agent.slug}" has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// brain-ingest agent (M3-5: studio frontmatter added)
// ---------------------------------------------------------------------------

test('brain-ingest agent loads and validateAgent returns zero errors', () => {
  const agents = listAgentDefinitions(join(ROOT, 'skills'));
  const brainIngest = agents.find((a) => a.slug === 'brain-ingest');

  assert.ok(brainIngest !== undefined, 'brain-ingest must be discoverable as a studio agent');
  assert.strictEqual(brainIngest.brainAccess, 'mandatory', 'brain-ingest brainAccess must be mandatory');
  assert.strictEqual(brainIngest.runtime.strategy, 'fixed', 'brain-ingest runtime strategy must be fixed');
  assert.ok(brainIngest.composition.skills.includes('brain-query'), 'brain-ingest must compose brain-query');

  const findings = validateAgent(brainIngest);
  const errors = findings.filter((f) => f.level === 'error');
  assert.deepEqual(
    errors,
    [],
    `brain-ingest agent has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// forge-reflect flow (S8: the third flow that replaces the forge-cycle monolith)
// ---------------------------------------------------------------------------

test('forge-reflect flow loads and validateFlow returns zero errors', () => {
  const flowPath = join(ROOT, 'studio/flows/forge-reflect/flow.yaml');
  const agents = listAgentDefinitions(join(ROOT, 'skills'));
  const agentMap = new Map(agents.map((a) => [a.slug, a]));

  const flow = loadFlowDefinition(flowPath);

  assert.strictEqual(flow.id, 'forge-reflect');
  assert.strictEqual(flow.disposable, true, 'forge-reflect must be disposable:true (zero-gate rule)');
  assert.ok(flow.nodes.some((n) => n.agent === 'reflector'), 'must have a reflector node');
  assert.strictEqual(flow.edges.length, 0, 'forge-reflect has no edges (single-node, merge-triggered flow)');
  assert.deepEqual(flow.triggers, [], 'forge-reflect has no flow-engine triggers (merge-triggered via finalize-merged)');

  const findings = validateFlow(flow, agentMap);
  const errors = findings.filter((f) => f.level === 'error');
  assert.deepEqual(
    errors,
    [],
    `forge-reflect flow has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// Stage C — per-flow kickoff + the declaration-driven reflect trigger
// ---------------------------------------------------------------------------

test('seed flows declare their kickoff kind', () => {
  const cases: Array<[string, string]> = [
    ['forge-architect', 'idea'],
    ['forge-develop', 'initiative-select'],
    ['forge-reflect', 'trigger-only'],
  ];
  for (const [id, kind] of cases) {
    const flow = loadFlowDefinition(join(ROOT, `studio/flows/${id}/flow.yaml`));
    assert.deepEqual(flow.kickoff, { kind }, `${id} must declare kickoff.kind=${kind}`);
  }
});

test('forge-develop declares the merged→forge-reflect trigger (single source for reflect firing)', () => {
  const flow = loadFlowDefinition(join(ROOT, 'studio/flows/forge-develop/flow.yaml'));
  assert.deepEqual(flow.triggers, [{ on: 'merged', flow: 'forge-reflect' }]);
});
