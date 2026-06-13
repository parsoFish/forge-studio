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

import { loadFlowDefinition, listAgentDefinitions, loadCatalog, loadProjectsRegistry, loadKbDescriptor } from './registry.ts';
import { validateFlow, validateCatalog, validateProjectsRegistry, validateKb, validateAgent } from './validate.ts';
import { MODEL_BY_TIER } from '../phase-agent.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// forge-cycle flow
// ---------------------------------------------------------------------------

test('forge-cycle flow loads and validates clean', () => {
  const flowPath = join(ROOT, 'studio/flows/forge-cycle/flow.yaml');
  const agents = listAgentDefinitions(join(ROOT, 'skills'));
  const agentMap = new Map(agents.map((a) => [a.slug, a]));

  const flow = loadFlowDefinition(flowPath);
  const findings = validateFlow(flow, agentMap);
  const errors = findings.filter((f) => f.level === 'error');

  assert.deepEqual(
    errors,
    [],
    `forge-cycle flow has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
  );
});

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
// projects registry
// ---------------------------------------------------------------------------

test('projects registry loads and validates clean', () => {
  const projectsPath = join(ROOT, 'studio/projects.yaml');
  const reg = loadProjectsRegistry(projectsPath);
  const findings = validateProjectsRegistry(reg);
  const errors = findings.filter((f) => f.level === 'error');

  assert.deepEqual(
    errors,
    [],
    `projects registry has error-level findings:\n${JSON.stringify(errors, null, 2)}`,
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

test('listAgentDefinitions returns exactly 5 studio agents', () => {
  const agents = listAgentDefinitions(join(ROOT, 'skills'));
  const slugs = agents.map((a) => a.slug).sort();

  assert.deepEqual(
    slugs,
    ['architect', 'developer-ralph', 'developer-unifier', 'project-manager', 'reflector'],
    `Expected exactly 5 studio agents; got: ${slugs.join(', ')}`,
  );
});

test('all 5 studio agents validateAgent with zero ERROR-level findings', () => {
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
