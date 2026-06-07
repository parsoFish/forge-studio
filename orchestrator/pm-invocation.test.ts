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
  assert.ok(pmAgentSpec.allowedTools.includes('Read'));
  assert.ok(pmAgentSpec.allowedTools.includes('Glob'));
  assert.ok(pmAgentSpec.allowedTools.includes('Write'));
  assert.ok(pmAgentSpec.allowedTools.includes('Edit'));
});

test('pmAgentSpec: disallowedTools bans Bash (PM must not run commands) and web tools', () => {
  assert.ok(pmAgentSpec.disallowedTools.includes('Bash'));
  assert.ok(pmAgentSpec.disallowedTools.includes('WebFetch'));
  assert.ok(pmAgentSpec.disallowedTools.includes('WebSearch'));
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
// 3. buildPmSystemPrompt invariants
// ---------------------------------------------------------------------------

test('buildPmSystemPrompt: contains brain-first mandate wording', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  assert.ok(
    sys.includes('pm.brain-skipped') || sys.includes('brain/'),
    'should reference the brain-first enforcement or brain path',
  );
});

test('buildPmSystemPrompt: contains non-interactive framing', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  assert.ok(
    sys.toLowerCase().includes('non-interactiv'),
    'should state the non-interactive operating mode',
  );
});

test('buildPmSystemPrompt: contains at least one sharp-gate example', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  // Any of the concrete sharp-gate patterns from SKILL.md suffice
  const hasSharpGate =
    sys.includes('node:test') ||
    sys.includes('--experimental-strip-types') ||
    sys.includes('pytest') ||
    sys.includes('go test') ||
    sys.includes('bats');
  assert.ok(hasSharpGate, 'should include at least one sharp-gate example (node:test / pytest / go test / bats)');
});

test('buildPmSystemPrompt: contains the no-shell-pipeline gate rule', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  const hasPipelineRule =
    sys.includes('bash -c') || sys.includes('shell pipeline') || sys.includes('NEVER wrap');
  assert.ok(hasPipelineRule, 'should state the no-shell-pipeline / no-chain gate rule');
});

test('buildPmSystemPrompt: contains hidden-coupling mention', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  assert.ok(
    sys.includes('detectHiddenCoupling') || sys.includes('hidden-coupling') || sys.includes('Hidden-coupling'),
    'should reference the hidden-coupling check',
  );
});

test('buildPmSystemPrompt: contains YAML-quoting rule', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  assert.ok(
    sys.includes('double quotes') || sys.includes('YAML') || sys.includes('quoting'),
    'should state the YAML quoting rule for given/when/then',
  );
});

test('buildPmSystemPrompt: contains the project-manager skill contract heading', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  assert.ok(sys.includes('project-manager'), 'should include the skill contract section');
});

test('buildPmSystemPrompt: is substantive (> 2000 chars)', () => {
  const sys = buildPmSystemPrompt(process.cwd());
  assert.ok(sys.length > 2000, `system prompt too short: ${sys.length} chars`);
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

test('renderPmUserPrompt: contains the initiative id', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(prompt.includes('INIT-2026-06-07-test'));
});

test('renderPmUserPrompt: contains the project name', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(prompt.includes('myproject'));
});

test('renderPmUserPrompt: contains the manifest path', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(prompt.includes('_queue/in-flight/INIT-2026-06-07-test.md'));
});

test('renderPmUserPrompt: contains the worktree path', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(prompt.includes('/tmp/projects/myproject'));
});

test('renderPmUserPrompt: contains initiative_id binding instruction', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(
    prompt.includes('INIT-2026-06-07-test'),
    'should embed the initiative_id for the frontmatter binding',
  );
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
  // The detailed static rules live in SKILL.md (system prompt) — the user prompt
  // must NOT re-embed them. Check a few strong markers.
  assert.ok(
    !prompt.includes('detectHiddenCoupling'),
    'hidden-coupling prose should live in SKILL.md, not the user prompt',
  );
  assert.ok(
    !prompt.includes('Concrete sharp-gate patterns'),
    'sharp-gate examples should live in SKILL.md, not the user prompt',
  );
  assert.ok(
    !prompt.includes('Self-check (last step before stopping)'),
    'self-check checklist should live in SKILL.md, not the user prompt',
  );
  assert.ok(
    !prompt.includes('YAML quoting'),
    'YAML quoting rule should live in SKILL.md, not the user prompt',
  );
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
