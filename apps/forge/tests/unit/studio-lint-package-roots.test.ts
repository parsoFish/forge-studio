/**
 * SEAM F1 (operator ruling item 81), studio-lint's skill-lint half: a
 * package-owned skill (`packages/<pkg>/skills/<slug>/SKILL.md`) is linted
 * exactly like a `skills/`-owned one — split out of `studio-lint.test.ts`
 * (whose own `check-file-size.mjs` exemption, 1,111 lines, is a ceiling, not
 * a licence) rather than grown past it.
 *
 * Fixture helpers are local copies of `studio-lint.test.ts`'s own
 * (`tmpRoot`/`validSkillMd`/`validFlowYaml`/`validCatalogYaml`/
 * `seedValidCommunityRegistry`/`seedValidProject`) — those are private to
 * that file, and this file's own scope is narrow enough that duplicating the
 * small set it needs costs less than exporting a shared fixture module for
 * one consumer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runStudioLint } from '../../studio-lint.ts';

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-lint-pkg-roots-test-'));
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

function seedValidCommunityRegistry(root: string): void {
  const dir = join(root, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'registry.yaml'),
    `meta:
  schemaVersion: 2
  lastRefresh: null
sources: {}
items: []
`,
  );
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

test('SEAM F1: a deliberately broken package-owned SKILL.md is linted, naming it; a valid package sibling lints clean', () => {
  const root = tmpRoot();

  // Good agent (skills/, required seed root)
  const goodSlug = 'good-agent';
  const goodDir = join(root, 'skills', goodSlug);
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(goodDir, 'SKILL.md'), validSkillMd(goodSlug));

  // Good package-owned skill (packages/demo-pkg/skills/) — valid.
  const goodPkgSlug = 'good-pkg-agent';
  const goodPkgDir = join(root, 'packages', 'demo-pkg', 'skills', goodPkgSlug);
  mkdirSync(goodPkgDir, { recursive: true });
  writeFileSync(join(goodPkgDir, 'SKILL.md'), validSkillMd(goodPkgSlug));

  // Deliberately broken package-owned skill — same defect shape as
  // `studio-lint.test.ts`'s "corrupt studio SKILL.md" case: a runtime block
  // (isStudioAgent -> true) but an invalid brainAccess value.
  const badPkgSlug = 'bad-pkg-agent';
  const badPkgDir = join(root, 'packages', 'demo-pkg', 'skills', badPkgSlug);
  mkdirSync(badPkgDir, { recursive: true });
  writeFileSync(
    join(badPkgDir, 'SKILL.md'),
    `---
name: ${badPkgSlug}
description: A corrupt package-owned agent.
library: true
purpose: Does bad things.
brainAccess: bogus
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

This package-owned agent is broken.
`,
  );

  const flowDir = join(root, 'studio', 'flows', 'good-flow');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml('good-flow', goodSlug));

  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  seedValidCommunityRegistry(root);
  seedValidProject(root);

  const result = runStudioLint(root);

  const badLoadErrors = result.findings.filter(
    (f) => f.level === 'error' && f.object === `agent:${badPkgSlug}` && f.check === 'load',
  );
  assert.strictEqual(
    badLoadErrors.length,
    1,
    `Expected exactly 1 agent:${badPkgSlug} load error, got: ${JSON.stringify(result.findings)}`,
  );

  const goodPkgErrors = result.findings.filter(
    (f) => f.level === 'error' && f.object === `agent:${goodPkgSlug}`,
  );
  assert.strictEqual(goodPkgErrors.length, 0, `the valid package sibling must lint clean, got: ${JSON.stringify(goodPkgErrors)}`);

  assert.strictEqual(
    result.errorCount,
    1,
    `Expected errorCount=1 (only the broken package skill), got ${result.errorCount}:\n${JSON.stringify(result.findings, null, 2)}`,
  );

  cleanup(root);
});

test('SEAM F1: the SAME slug as a real directory under skills/ AND a package root is a loud, named error finding — never "first root wins"', () => {
  const root = tmpRoot();

  const dupSlug = 'dup-agent';
  const skillsSide = join(root, 'skills', dupSlug);
  mkdirSync(skillsSide, { recursive: true });
  writeFileSync(join(skillsSide, 'SKILL.md'), validSkillMd(dupSlug));

  const pkgSide = join(root, 'packages', 'demo-pkg', 'skills', dupSlug);
  mkdirSync(pkgSide, { recursive: true });
  writeFileSync(join(pkgSide, 'SKILL.md'), validSkillMd(dupSlug));

  const flowDir = join(root, 'studio', 'flows', 'good-flow');
  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, 'flow.yaml'), validFlowYaml('good-flow', dupSlug));

  writeFileSync(join(root, 'studio', 'catalog.yaml'), validCatalogYaml());
  seedValidCommunityRegistry(root);
  seedValidProject(root);

  const result = runStudioLint(root);

  // At least one — several independent library lint passes (skill-trust,
  // skill-refs, tool-fence) each enumerate `listSkillDirs` on their own and
  // each report the SAME real defect from their own vantage point, so the
  // count is pass-count-coupled; what matters is that it is reported at all,
  // loudly, naming both real paths — never silently "first root wins".
  const dupFindings = result.findings.filter(
    (f) => f.level === 'error' && f.object === 'studio:agents' && f.message.includes(dupSlug),
  );
  assert.ok(dupFindings.length >= 1, `expected at least 1 duplicate-slug finding, got: ${JSON.stringify(result.findings)}`);
  for (const finding of dupFindings) {
    assert.match(finding.message, new RegExp(skillsSide.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(finding.message, new RegExp(pkgSide.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  cleanup(root);
});
