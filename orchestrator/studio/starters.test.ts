/**
 * Validates the curated Studio starter library (studio/starters/).
 * These are templates, not live agents/flows, so `forge studio lint` does not
 * scan them — this test is their integrity gate (ADR-033): every starter agent
 * passes validateAgent, and the basic flow passes validateFlow against the
 * agents the starters instantiate to.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { AgentDefinition } from './types.ts';
import { loadAgentDefinition, loadFlowDefinition, loadCatalog } from './registry.ts';
import { validateAgent, validateFlow } from './validate.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTERS = join(ROOT, 'studio', 'starters');
const AGENT_SLUGS = ['plan', 'dev', 'review'] as const;

const validModelIds = new Set(
  loadCatalog(join(ROOT, 'studio', 'catalog.yaml')).models.map((m) => m.id),
);

function errors(findings: { level: string; message: string }[]): string[] {
  return findings.filter((f) => f.level === 'error').map((f) => f.message);
}

describe('studio starter library', () => {
  const agents = new Map<string, AgentDefinition>();

  for (const slug of AGENT_SLUGS) {
    it(`starter agent "${slug}" is a valid, clean-room studio agent`, () => {
      const def = loadAgentDefinition(join(STARTERS, 'agents', slug, 'SKILL.md'));
      agents.set(def.slug, def);

      assert.equal(def.slug, slug);
      assert.deepEqual(errors(validateAgent(def, validModelIds)), [], `${slug}: ${errors(validateAgent(def, validModelIds)).join('; ')}`);

      // clean-room invariants: no forge-brain coupling, no composed phase skills
      assert.equal(def.brainAccess, 'none', `${slug} must not couple to the forge brain`);
      assert.deepEqual(def.composition.skills, [], `${slug} must not compose forge phase skills`);
    });
  }

  it('basic flow is a valid plan → dev → review flow with a human gate', () => {
    // ensure the agent map is populated (load directly so test order doesn't matter)
    for (const slug of AGENT_SLUGS) {
      if (!agents.has(slug)) {
        agents.set(slug, loadAgentDefinition(join(STARTERS, 'agents', slug, 'SKILL.md')));
      }
    }

    const flow = loadFlowDefinition(join(STARTERS, 'flows', 'basic.yaml'));
    assert.deepEqual(errors(validateFlow(flow, agents)), [], errors(validateFlow(flow, agents)).join('; '));

    assert.deepEqual(
      flow.nodes.map((n) => n.id),
      ['plan', 'dev', 'review'],
      'basic flow must be exactly plan → dev → review',
    );
    assert.ok(
      flow.nodes.some((n) => Boolean(n.gate)),
      'basic flow must carry a human gate (zero-gate flows are rejected)',
    );
  });
});
