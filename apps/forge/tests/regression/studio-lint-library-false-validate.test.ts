/**
 * forge-e3v — REAL-ENTRY-POINT acceptance tests, driven through the ACTUAL
 * `forge studio lint` entry point (`runStudioLint`, `apps/forge/studio-lint.ts`).
 *
 * `apps/forge/studio-lint.ts` gated `loadAgentDefinition`/`validateAgent` on
 * `isStudioAgent()` (the flow-composable ROSTER gate, `library !== false`),
 * so every `library: false` agent that DOES declare a `runtime:` block
 * (brain-fix, creation-agent, instructions-creator, onboarding-agent shape)
 * got NO check beyond `validateLibraryFlag` — `surface`/`materials`/
 * `runtime.loopStrategy`/etc were never validated for it. The fix widens the
 * "is this a loadable agent def" gate to `isUnfilteredStudioAgent()` (no
 * roster filter) while keeping `agentMap` (flow-composability) on the
 * original, narrower `isStudioAgent()` result.
 *
 * Own file rather than appended to `apps/forge/tests/unit/studio-lint.test.ts`:
 * that file is already over the 800-line cap and baselined at 1111 lines in
 * `scripts/baselines/file-size.json` — the ratchet is a ceiling, not a
 * licence, so a new fixture goes in a fresh file (fixture conventions
 * `tmpRoot`/`validSkillMd`/`validFlowYaml`/`buildValidRoot` copied from that
 * file, per this directory's own stated convention — see
 * `apps/forge/tests/regression/studio-lint-hooks.test.ts`'s header).
 *
 * RUN: node --test --experimental-strip-types apps/forge/tests/regression/studio-lint-library-false-validate.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStudioLint } from '../../studio-lint.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — copied conventions, not reinvented (see file header).
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-lint-e3v-'));
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'session-kinds.yaml'), '[]\n', 'utf8');
  return root;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function validSkillMd(slug: string): string {
  return `---
name: ${slug}
description: A test agent.
library: true
purpose: Does things.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: [Task, Agent]
---
## Process

This agent does things.
`;
}

function validFlowYaml(id: string, agentSlug: string): string {
  return `id: ${id}
name: Test Flow
version: 1
goal: Test goal.
project: null
kb: null
costCeilingUsd: 10
origin: seed
disposable: true
nodes:
  - { id: step1, agent: ${agentSlug} }
edges: []
triggers: []
`;
}

function validCatalogYaml(): string {
  return `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
guards: []
`;
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

function buildValidRoot(opts: { agentSlug?: string; flowId?: string } = {}): string {
  const { agentSlug = 'test-agent', flowId = 'test-flow' } = opts;
  const root = tmpRoot();

  const skillDir = join(root, 'skills', agentSlug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd(agentSlug));

  const flowDir = join(root, 'studio', 'flows', flowId);
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml(flowId, agentSlug));

  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  seedValidProject(root);

  return root;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('a "library: false" agent WITH a runtime block still runs validateAgent — an error-level defect is not lint-clean', () => {
  const root = buildValidRoot({ agentSlug: 'has-library' });

  const internalSlug = 'internal-agent-with-defect';
  const internalDir = join(root, 'skills', internalSlug);
  mkdirSync(internalDir, { recursive: true });
  writeFileSync(
    join(internalDir, 'SKILL.md'),
    `---
name: ${internalSlug}
description: An internal/system agent, dispatched directly, never composed into a flow.
library: false
purpose: Does internal things.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: [Task, Agent]
surface: not-a-real-surface
---
## Process

Internal only.
`,
  );

  const result = runStudioLint(root);

  const surfaceError = result.findings.find(
    (f) => f.level === 'error' && f.object === `agent:${internalSlug}` && f.check === 'surface/enum',
  );
  assert.ok(
    surfaceError !== undefined,
    `Expected a surface/enum error for agent:${internalSlug} (validateAgent must run for library:false agents too) — got: ${JSON.stringify(result.findings.filter((f) => f.object === `agent:${internalSlug}`))}`,
  );

  cleanup(root);
});

test('a "library: false" agent WITH a runtime block is NOT added to the flow-composable agent map (roster stays library:true-only)', () => {
  const root = buildValidRoot({ agentSlug: 'has-library' });

  const internalSlug = 'internal-agent-not-composable';
  const internalDir = join(root, 'skills', internalSlug);
  mkdirSync(internalDir, { recursive: true });
  writeFileSync(join(internalDir, 'SKILL.md'), validSkillMd(internalSlug).replace('library: true', 'library: false'));

  // A flow node that references the library:false agent — must fail the
  // SAME "unknown agent" check a flow referencing a nonexistent slug would,
  // because that agent was never added to the roster agentMap.
  const flowDir = join(root, 'studio', 'flows', 'bad-flow');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml('bad-flow', internalSlug));

  const result = runStudioLint(root);

  const flowError = result.findings.find((f) => f.object === 'flow:bad-flow' && f.level === 'error');
  assert.ok(
    flowError !== undefined,
    `Expected a flow error referencing the non-roster agent "${internalSlug}" — got: ${JSON.stringify(result.findings.filter((f) => f.object === 'flow:bad-flow'))}`,
  );

  cleanup(root);
});
