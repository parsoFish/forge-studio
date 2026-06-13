/**
 * Unit tests for orchestrator/pm-invocation.ts — ADR 024 seam.
 *
 * Verifies:
 *   1. `pmAgentSpec` shape (phase / skill / tier / tools).
 *   2. `PM_MODEL` derives from the spec (not hard-coded).
 *   3. `buildPmSystemPrompt` carries the key invariants the agent must see.
 *   4. `renderPmUserPrompt` is dynamic-only (no bulk static prose duplicated
 *      from SKILL.md; carries the dynamic bindings).
 *
 * No SDK, no network, no shell — pure unit / file-read tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pmAgentSpec,
  PM_MODEL,
  PM_ALLOWED_TOOLS,
  PM_DISALLOWED_TOOLS,
  buildPmSystemPrompt,
  renderPmUserPrompt,
  renderProjectContextBlock,
} from './pm-invocation.ts';
import { modelForSpec } from './phase-agent.ts';

// ---------------------------------------------------------------------------
// 1. pmAgentSpec shape
// ---------------------------------------------------------------------------

test('pmAgentSpec: phase is project-manager', () => {
  assert.equal(pmAgentSpec.phase, 'project-manager');
});

test('pmAgentSpec: skill points to skills/project-manager/SKILL.md', () => {
  assert.equal(pmAgentSpec.skill, 'skills/project-manager/SKILL.md');
});

test('pmAgentSpec: tier is sonnet', () => {
  assert.equal(pmAgentSpec.tier, 'sonnet');
});

test('pmAgentSpec: allowedTools matches PM_ALLOWED_TOOLS', () => {
  // Cast to mutable to call deepEqual without readonly mismatch
  assert.deepEqual([...pmAgentSpec.allowedTools], [...PM_ALLOWED_TOOLS]);
});

test('pmAgentSpec: disallowedTools matches PM_DISALLOWED_TOOLS', () => {
  assert.deepEqual([...pmAgentSpec.disallowedTools], [...PM_DISALLOWED_TOOLS]);
});

test('pmAgentSpec: allowedTools includes Read, Glob, Write, Edit (needs them for brain + WI authoring)', () => {
  for (const t of ['Read', 'Glob', 'Write', 'Edit'] as const) {
    assert.ok(pmAgentSpec.allowedTools.includes(t), `missing tool: ${t}`);
  }
});

test('pmAgentSpec: disallowedTools bans Bash (PM must not run commands) and web tools', () => {
  for (const t of ['Bash', 'WebFetch', 'WebSearch'] as const) {
    assert.ok(pmAgentSpec.disallowedTools.includes(t), `missing banned tool: ${t}`);
  }
});

// ---------------------------------------------------------------------------
// 2. PM_MODEL derives from the spec
// ---------------------------------------------------------------------------

test('PM_MODEL equals modelForSpec(pmAgentSpec) — single source', () => {
  assert.equal(PM_MODEL, modelForSpec(pmAgentSpec));
});

test('PM_MODEL is sonnet (behaviour-preserving: same model as before migration)', () => {
  assert.equal(PM_MODEL, 'claude-sonnet-4-6');
});

// ---------------------------------------------------------------------------
// 3. buildPmSystemPrompt invariants (table-driven)
// ---------------------------------------------------------------------------

const SYS = buildPmSystemPrompt(process.cwd());

test('buildPmSystemPrompt: is substantive (> 2000 chars)', () => {
  assert.ok(SYS.length > 2000, `system prompt too short: ${SYS.length} chars`);
});

test('buildPmSystemPrompt: contains all key invariants', () => {
  // brain-first mandate
  assert.ok(
    SYS.includes('pm.brain-skipped') || SYS.includes('brain/'),
    'should reference the brain-first enforcement or brain path',
  );
  // non-interactive framing
  assert.ok(SYS.toLowerCase().includes('non-interactiv'), 'should state the non-interactive operating mode');
  // at least one sharp-gate example
  const hasSharpGate =
    SYS.includes('node:test') ||
    SYS.includes('--experimental-strip-types') ||
    SYS.includes('pytest') ||
    SYS.includes('go test') ||
    SYS.includes('bats');
  assert.ok(hasSharpGate, 'should include at least one sharp-gate example (node:test / pytest / go test / bats)');
  // no-shell-pipeline gate rule
  const hasPipelineRule =
    SYS.includes('bash -c') || SYS.includes('shell pipeline') || SYS.includes('NEVER wrap');
  assert.ok(hasPipelineRule, 'should state the no-shell-pipeline / no-chain gate rule');
  // hidden-coupling mention
  assert.ok(
    SYS.includes('detectHiddenCoupling') || SYS.includes('hidden-coupling') || SYS.includes('Hidden-coupling'),
    'should reference the hidden-coupling check',
  );
  // YAML-quoting rule
  assert.ok(
    SYS.includes('double quotes') || SYS.includes('YAML') || SYS.includes('quoting'),
    'should state the YAML quoting rule for given/when/then',
  );
  // project-manager skill contract heading
  assert.ok(SYS.includes('project-manager'), 'should include the skill contract section');
});

// ---------------------------------------------------------------------------
// 4. renderPmUserPrompt — dynamic bindings + no bulk static prose
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  initiativeId: 'INIT-2026-06-07-test',
  manifestRelPath: '_queue/in-flight/INIT-2026-06-07-test.md',
  worktreeRelPath: '/tmp/projects/myproject',
  projectName: 'myproject',
};

test('renderPmUserPrompt: contains all dynamic bindings', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  const EXPECTED = [
    'INIT-2026-06-07-test',
    'myproject',
    '_queue/in-flight/INIT-2026-06-07-test.md',
    '/tmp/projects/myproject',
  ];
  for (const s of EXPECTED) {
    assert.ok(prompt.includes(s), `missing binding: ${s}`);
  }
});

test('renderPmUserPrompt: includes project context block when provided', () => {
  const prompt = renderPmUserPrompt({
    ...BASE_INPUT,
    projectContext: { packageJson: '{"name":"myproject","scripts":{"test":"node --test"}}' },
  });
  assert.ok(prompt.includes('package.json'), 'should contain the project context heading');
  assert.ok(prompt.includes('node --test'), 'should inline the package.json content');
});

test('renderPmUserPrompt: omits project context block when not provided', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(!prompt.includes('Project context'), 'should not include project context when absent');
});

test('renderPmUserPrompt: includes gateRecipe when provided', () => {
  const prompt = renderPmUserPrompt({
    ...BASE_INPUT,
    gateRecipe: '## Gate recipe\n\n`go test -tags all -run <Prefix> ./...`',
  });
  assert.ok(prompt.includes('Gate recipe'));
  assert.ok(prompt.includes('go test'));
});

test('renderPmUserPrompt: omits gateRecipe block when not provided', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(!prompt.includes('Gate recipe'));
});

test('renderPmUserPrompt: does NOT duplicate bulk static prose from SKILL.md', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  // The detailed static rules live in SKILL.md (system prompt) — the user prompt must NOT re-embed them.
  const BANNED = [
    'detectHiddenCoupling',
    'Concrete sharp-gate patterns',
    'Self-check (last step before stopping)',
    'YAML quoting',
  ];
  for (const s of BANNED) {
    assert.ok(!prompt.includes(s), `static prose leaked into user prompt: ${s}`);
  }
});

test('renderPmUserPrompt: is concise (< 3000 chars without project context)', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(prompt.length < 3000, `user prompt is too long (${prompt.length} chars) — static prose may have leaked in`);
});

// ---------------------------------------------------------------------------
// 5. renderProjectContextBlock (kept as an export — callers depend on it)
// ---------------------------------------------------------------------------

test('renderProjectContextBlock: returns empty string when no context provided', () => {
  assert.equal(renderProjectContextBlock(undefined), '');
});

test('renderProjectContextBlock: returns empty string when context is empty object', () => {
  assert.equal(renderProjectContextBlock({}), '');
});

test('renderProjectContextBlock: inlines package.json content when provided', () => {
  const block = renderProjectContextBlock({ packageJson: '{"name":"x"}' });
  assert.ok(block.includes('package.json'));
  assert.ok(block.includes('"name":"x"'));
});

test('renderProjectContextBlock: inlines pyproject.toml when provided', () => {
  const block = renderProjectContextBlock({ pyprojectToml: '[tool.pytest]' });
  assert.ok(block.includes('pyproject.toml'));
});

test('renderProjectContextBlock: inlines Cargo.toml when provided', () => {
  const block = renderProjectContextBlock({ cargoToml: '[package]\nname = "x"' });
  assert.ok(block.includes('Cargo.toml'));
});

test('renderPmUserPrompt: includes instructions section when instructions provided', () => {
  const prompt = renderPmUserPrompt({
    ...BASE_INPUT,
    instructions: 'TypeScript strict. No hardcoded values.',
  });
  assert.ok(prompt.includes('## Project instructions (injected by forge)'), 'should include instructions header');
  assert.ok(prompt.includes('TypeScript strict'), 'should include instructions text');
});

test('renderPmUserPrompt: does NOT include instructions header when instructions absent', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(!prompt.includes('## Project instructions (injected by forge)'), 'should not include instructions header when absent');
});
