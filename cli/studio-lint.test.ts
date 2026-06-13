/**
 * Unit tests for studio-lint.ts.
 *
 * Covers:
 *   1. Real-repo smoke test — runStudioLint(process.cwd()) exits clean (0 errors).
 *   2. Broken flow (node references unknown agent) → errorCount > 0, finding names the flow.
 *   3. Missing studio/ dir entirely → errorCount > 0, finding names the missing path.
 *   4. KB with bad slug → error surfaces.
 *   5. No brain kb.yaml files present → NOT an error in M0 (kb-absence is fine).
 *   6. Duplicate KB ids → error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStudioLint } from './studio-lint.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'studio-lint-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Minimal valid SKILL.md content — just enough for registry.isStudioAgent + loadAgentDefinition. */
function validSkillMd(slug: string): string {
  return `---
name: ${slug}
description: A test agent.
purpose: Does things.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  hooks: []
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent does things.
`;
}

/** Minimal valid flow.yaml content. */
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

/** Minimal valid catalog.yaml. */
function validCatalogYaml(): string {
  return `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
hooks: []
`;
}

/** Minimal valid projects.yaml. */
function validProjectsYaml(): string {
  return `projects:
  - { id: my-project, path: /home/user/my-project }
`;
}

/** Minimal valid kb.yaml. */
function validKbYaml(id: string): string {
  return `id: ${id}
name: Test KB
scope: flow
desc: A test knowledge base.
`;
}

// ---------------------------------------------------------------------------
// Build a fully valid fixture root
// ---------------------------------------------------------------------------

function buildValidRoot(opts: {
  agentSlug?: string;
  flowId?: string;
  kbId?: string;
  includeKb?: boolean;
} = {}): string {
  const {
    agentSlug = 'test-agent',
    flowId = 'test-flow',
    kbId = 'test-kb',
    includeKb = false,
  } = opts;

  const root = tmpRoot();

  // skills/<slug>/SKILL.md
  const skillDir = join(root, 'skills', agentSlug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd(agentSlug));

  // studio/flows/<flowId>/flow.yaml
  const flowDir = join(root, 'studio', 'flows', flowId);
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml(flowId, agentSlug));

  // studio/catalog.yaml
  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());

  // studio/projects.yaml
  writeFileSync(join(root, 'studio', 'projects.yaml'), validProjectsYaml());

  // optionally add brain/x/kb.yaml
  if (includeKb) {
    const kbDir = join(root, 'brain', 'test-brain');
    mkdirSync(kbDir, { recursive: true });
    writeFileSync(join(kbDir, 'kb.yaml'), validKbYaml(kbId));
  }

  return root;
}

// ---------------------------------------------------------------------------
// Test 1: real repo smoke test
// ---------------------------------------------------------------------------

test('runStudioLint on the real repo produces 0 errors', () => {
  const result = runStudioLint(process.cwd());
  assert.ok(Array.isArray(result.findings), 'findings should be an array');
  assert.strictEqual(
    result.errorCount,
    0,
    `Expected 0 errors but got ${result.errorCount}:\n` +
      result.findings
        .filter((f) => f.level === 'error')
        .map((f) => `  [${f.object}] ${f.check}: ${f.message}`)
        .join('\n'),
  );
});

// ---------------------------------------------------------------------------
// Test 2: broken flow — agent reference to unknown slug
// ---------------------------------------------------------------------------

test('broken flow (unknown agent ref) → errorCount > 0, finding names the flow', () => {
  const root = tmpRoot();

  // skills/real-agent/SKILL.md
  const skillDir = join(root, 'skills', 'real-agent');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd('real-agent'));

  // studio/flows/bad/flow.yaml — references 'ghost' which doesn't exist
  const flowDir = join(root, 'studio', 'flows', 'bad');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(
    join(flowDir, 'flow.yaml'),
    `id: bad
name: Bad Flow
version: 1
goal: Test bad agent ref.
project: null
kb: null
costCeilingUsd: 10
origin: seed
disposable: true
nodes:
  - { id: step1, agent: ghost }
edges: []
triggers: []
`,
  );
  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  writeFileSync(join(root, 'studio', 'projects.yaml'), validProjectsYaml());

  const result = runStudioLint(root);

  assert.ok(result.errorCount > 0, `Expected errors but got ${result.errorCount}`);
  const flowFinding = result.findings.find((f) => f.object.includes('flow:bad'));
  assert.ok(
    flowFinding !== undefined,
    `Expected a finding with object containing 'flow:bad', got: ${JSON.stringify(result.findings.map((f) => f.object))}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 3: missing studio/ dir entirely → errors naming the missing paths
// ---------------------------------------------------------------------------

test('missing studio/ dir entirely → errorCount > 0, finding names missing path', () => {
  const root = tmpRoot();
  // No studio/ dir, no skills/ dir — just an empty root

  const result = runStudioLint(root);

  assert.ok(result.errorCount > 0, 'Expected errors when studio/ is missing');

  // At least one finding should mention the missing studio path
  const mentionsStudio = result.findings.some(
    (f) => f.message.includes('studio') || f.object.includes('studio'),
  );
  assert.ok(
    mentionsStudio,
    `Expected a finding mentioning 'studio', got: ${JSON.stringify(result.findings.map((f) => ({ object: f.object, message: f.message })))}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 4: KB with bad slug → error surfaces
// ---------------------------------------------------------------------------

test('kb.yaml with bad slug → error', () => {
  const root = buildValidRoot();

  // Add a brain/x/kb.yaml with a bad id
  const kbDir = join(root, 'brain', 'some-brain');
  mkdirSync(kbDir, { recursive: true });
  writeFileSync(
    join(kbDir, 'kb.yaml'),
    `id: Bad Slug!!
name: Bad KB
scope: flow
desc: Has an invalid id.
`,
  );

  const result = runStudioLint(root);

  assert.ok(result.errorCount > 0, 'Expected errors for bad KB slug');
  const kbFinding = result.findings.find((f) => f.object.startsWith('kb:'));
  assert.ok(
    kbFinding !== undefined,
    `Expected a kb: finding, got: ${JSON.stringify(result.findings.map((f) => f.object))}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 5: No brain/*/kb.yaml present → NOT an error
// ---------------------------------------------------------------------------

test('no brain/*/kb.yaml files → no kb-specific errors', () => {
  const root = buildValidRoot({ includeKb: false });
  // brain/ dir doesn't exist at all

  const result = runStudioLint(root);

  const kbErrors = result.findings.filter(
    (f) => f.level === 'error' && f.object.startsWith('kb:'),
  );
  assert.strictEqual(
    kbErrors.length,
    0,
    `Expected no kb errors when no kb.yaml files present, got: ${JSON.stringify(kbErrors)}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 6: Duplicate KB ids across files → error
// ---------------------------------------------------------------------------

test('duplicate kb ids across brain/*/kb.yaml → error', () => {
  const root = buildValidRoot({ includeKb: false });

  // Two kb.yaml files with the same id
  const kbDir1 = join(root, 'brain', 'brain-a');
  const kbDir2 = join(root, 'brain', 'brain-b');
  mkdirSync(kbDir1, { recursive: true });
  mkdirSync(kbDir2, { recursive: true });
  writeFileSync(join(kbDir1, 'kb.yaml'), validKbYaml('shared-id'));
  writeFileSync(join(kbDir2, 'kb.yaml'), validKbYaml('shared-id'));

  const result = runStudioLint(root);

  assert.ok(result.errorCount > 0, 'Expected errors for duplicate kb ids');
  const dupFinding = result.findings.find(
    (f) => f.level === 'error' && f.message.toLowerCase().includes('duplicate'),
  );
  assert.ok(
    dupFinding !== undefined,
    `Expected a duplicate-kb finding, got: ${JSON.stringify(result.findings.map((f) => f.message))}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 7: one corrupt studio SKILL.md (bad brainAccess) + one valid agent
//         → exactly one agent:<bad> load error; valid agent still resolves;
//           flow referencing the valid agent produces no agent-ref error
// ---------------------------------------------------------------------------

test('corrupt studio SKILL.md produces per-skill error; valid sibling still lints clean', () => {
  const root = tmpRoot();

  // Good agent
  const goodSlug = 'good-agent';
  const goodDir = join(root, 'skills', goodSlug);
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(goodDir, 'SKILL.md'), validSkillMd(goodSlug));

  // Bad agent — has runtime (so isStudioAgent → true) but invalid brainAccess value
  const badSlug = 'bad-agent';
  const badDir = join(root, 'skills', badSlug);
  mkdirSync(badDir, { recursive: true });
  writeFileSync(
    join(badDir, 'SKILL.md'),
    `---
name: ${badSlug}
description: A corrupt agent.
purpose: Does bad things.
brainAccess: bogus
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  hooks: []
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent is broken.
`,
  );

  // Flow that references only the good agent
  const flowDir = join(root, 'studio', 'flows', 'good-flow');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml('good-flow', goodSlug));

  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  writeFileSync(join(root, 'studio', 'projects.yaml'), validProjectsYaml());

  const result = runStudioLint(root);

  // Exactly one agent load error, for the bad skill
  const agentLoadErrors = result.findings.filter(
    (f) => f.level === 'error' && f.object === `agent:${badSlug}` && f.check === 'load',
  );
  assert.strictEqual(
    agentLoadErrors.length,
    1,
    `Expected exactly 1 agent:${badSlug} load error, got: ${JSON.stringify(result.findings)}`,
  );

  // No agent-ref errors for the good agent's flow
  const agentRefErrors = result.findings.filter(
    (f) => f.level === 'error' && f.check === 'agent-ref',
  );
  assert.strictEqual(
    agentRefErrors.length,
    0,
    `Expected 0 agent-ref errors, got: ${JSON.stringify(agentRefErrors)}`,
  );

  // Total error count should be exactly 1 (just the bad agent load)
  assert.strictEqual(
    result.errorCount,
    1,
    `Expected errorCount=1, got ${result.errorCount}:\n${JSON.stringify(result.findings, null, 2)}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 8: no skills/ dir at all → error finding with object 'studio:agents'
// ---------------------------------------------------------------------------

test('missing skills/ dir → error finding with object "studio:agents"', () => {
  const root = tmpRoot();

  // studio dir present with minimum valid files, but no skills/ dir
  const flowDir = join(root, 'studio', 'flows', 'any-flow');
  mkdirSync(flowDir, { recursive: true });
  // flow references a non-existent agent — but the error we assert is specifically the studio:agents/load one
  writeFileSync(
    join(flowDir, 'flow.yaml'),
    `id: any-flow
name: Any Flow
version: 1
goal: Test.
project: null
kb: null
costCeilingUsd: 10
origin: seed
disposable: true
nodes:
  - { id: step1, agent: some-agent }
edges: []
triggers: []
`,
  );
  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  writeFileSync(join(root, 'studio', 'projects.yaml'), validProjectsYaml());

  const result = runStudioLint(root);

  const agentsLoadError = result.findings.find(
    (f) => f.level === 'error' && f.object === 'studio:agents' && f.check === 'load',
  );
  assert.ok(
    agentsLoadError !== undefined,
    `Expected an error finding with object "studio:agents" and check "load", got: ${JSON.stringify(result.findings.map((f) => ({ object: f.object, check: f.check, level: f.level })))}`,
  );

  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 9: flow dir-name != flow.id → dir-name error
// ---------------------------------------------------------------------------

test('flow dir "my-cycle" with id "other-name" → dir-name error', () => {
  const root = tmpRoot();

  // skills/test-agent/SKILL.md
  const agentSlug = 'test-agent';
  const skillDir = join(root, 'skills', agentSlug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), validSkillMd(agentSlug));

  // studio/flows/my-cycle/flow.yaml — id is 'other-name', dir is 'my-cycle'
  const flowDir = join(root, 'studio', 'flows', 'my-cycle');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml('other-name', agentSlug));

  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  writeFileSync(join(root, 'studio', 'projects.yaml'), validProjectsYaml());

  const result = runStudioLint(root);

  const dirNameError = result.findings.find(
    (f) => f.level === 'error' && f.object === 'flow:my-cycle' && f.check === 'dir-name',
  );
  assert.ok(
    dirNameError !== undefined,
    `Expected a dir-name error for flow:my-cycle, got: ${JSON.stringify(result.findings.map((f) => ({ object: f.object, check: f.check, level: f.level, message: f.message })))}`,
  );
  assert.ok(
    dirNameError.message.includes('other-name') && dirNameError.message.includes('my-cycle'),
    `Expected message to mention both ids, got: "${dirNameError.message}"`,
  );

  cleanup(root);
});
