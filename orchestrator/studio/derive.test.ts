/**
 * Frontmatter-regression lock for ADR-027 M2 ws-3: invocation files now derive
 * from SKILL.md (single source), so the M0 dual-source deep-equal became a
 * tautology. This test replaces it: assert each derived spec deep-equals an
 * EXPLICIT expected literal (the known-good values). Any frontmatter regression
 * (wrong tool list, wrong tier/model, wrong phase key) will surface here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveAgentSpec, executionPathForSurface, agentCapabilityDescriptor, FORGE_ROOT } from './derive.ts';
import { listAgentDefinitions } from './registry.ts';
import type { AgentDefinition } from './types.ts';

// ---------------------------------------------------------------------------
// Explicit expected-literal assertions (frontmatter-regression lock, M2-3)
// ---------------------------------------------------------------------------

test('deriveAgentSpec: project-manager spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/project-manager/SKILL.md'), {
    phase: 'project-manager',
    skill: 'skills/project-manager/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
    disallowedTools: ['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch'],
    sdk: 'claude',
  });
});

test('deriveAgentSpec: developer-loop spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/developer-ralph/SKILL.md'), {
    phase: 'developer-loop',
    skill: 'skills/developer-ralph/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
    sdk: 'claude',
  });
});

test('deriveAgentSpec: unifier spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/developer-unifier/SKILL.md'), {
    phase: 'unifier',
    skill: 'skills/developer-unifier/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
    sdk: 'claude',
  });
});

test('deriveAgentSpec: reflector spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/reflector/SKILL.md'), {
    phase: 'reflector',
    skill: 'skills/reflector/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
    sdk: 'claude',
  });
});

// ---------------------------------------------------------------------------
// Negative tests via in-memory tmp fixtures
// ---------------------------------------------------------------------------

/** Write a minimal studio SKILL.md into a tmp dir and return its absolute path. */
function writeTmpSkill(dir: string, frontmatter: string): string {
  const skillDir = mkdtempSync(join(dir, 'skill-'));
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, `---\n${frontmatter}\n---\n\n# Body\n`);
  return skillPath;
}

const VALID_BASE = `name: test-agent
description: A test agent.
phase: test
surface: unattended
purpose: Test things.
composition:
  skills: []
  tools: []
  mcps: []
  hooks: []
brainAccess: advisory
interactivity: Fully autonomous.
allowed-tools: [Read]
disallowed-tools: [Bash]
budgets: {}
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6`;

test('deriveAgentSpec throws when frontmatter has no phase field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-neg-'));
  try {
    const fm = VALID_BASE.replace('phase: test\n', '');
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, '/'),
      /cannot derive spec — no phase field/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec: strategy:range derives spec at cheapest tier (haiku < sonnet)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range')
      .replace('model: claude-sonnet-4-6', 'range:\n  - claude-haiku-4-5-20251001\n  - claude-sonnet-4-6');
    const skillPath = writeTmpSkill(dir, fm);
    // Must NOT throw; spec.tier = cheapest in range = haiku
    const spec = deriveAgentSpec(skillPath, process.cwd());
    assert.equal(spec.tier, 'haiku');
    assert.equal(spec.phase, 'test');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec: strategy:range with opus+haiku derives at haiku (cheapest)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range')
      .replace('model: claude-sonnet-4-6', 'range:\n  - claude-opus-4-8\n  - claude-haiku-4-5-20251001');
    const skillPath = writeTmpSkill(dir, fm);
    const spec = deriveAgentSpec(skillPath, process.cwd());
    assert.equal(spec.tier, 'haiku');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec throws when strategy:range has no range field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range');
    // model key is kept — should still fail because range is missing
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, process.cwd()),
      /strategy:range requires a non-empty range field/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec throws when model is not in MODEL_BY_TIER', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-neg-'));
  try {
    const fm = VALID_BASE.replace('model: claude-sonnet-4-6', 'model: gpt-4-turbo');
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, '/'),
      /unknown model gpt-4-turbo/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ----- 2026-07-11: cwd-independence -----
// Surfaced by INIT-2026-07-10-framework-auth-parity: the orchestrated demo
// capture spawns `forge demo capture` with cwd = the PROJECT WORKTREE; every
// phase-invocation module calls deriveAgentSpec('skills/<phase>/SKILL.md') at
// module load, and the old cwd default made that resolution explode
// (ENOENT → capture_ok:false) in any process not started from the forge root.
test('deriveAgentSpec default root is the forge install root, not process.cwd()', () => {
  const prev = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'derive-cwd-'));
  try {
    process.chdir(dir);
    const spec = deriveAgentSpec('skills/project-manager/SKILL.md');
    assert.equal(spec.phase, 'project-manager', 'spec resolves from a non-forge cwd');
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// executionPathForSurface (R2-01-F5) — pure mapping, no I/O
// ---------------------------------------------------------------------------

test("executionPathForSurface('interactive') → 'interactive'", () => {
  assert.equal(executionPathForSurface('interactive'), 'interactive');
});

test("executionPathForSurface('unattended') → 'unattended'", () => {
  assert.equal(executionPathForSurface('unattended'), 'unattended');
});

test("executionPathForSurface('operator-triggered') → 'unattended' (describes the launch, not mid-run interactivity)", () => {
  assert.equal(executionPathForSurface('operator-triggered'), 'unattended');
});

test("executionPathForSurface('both') → 'unattended' (safe default; unattended-with-optional-pause)", () => {
  assert.equal(executionPathForSurface('both'), 'unattended');
});

test('executionPathForSurface(undefined) → \'unattended\' (absent surface, e.g. architect)', () => {
  assert.equal(executionPathForSurface(undefined), 'unattended');
});

test("executionPathForSurface('some-unknown-value') → 'unattended' (unknown default)", () => {
  assert.equal(executionPathForSurface('some-unknown-value'), 'unattended');
});

// ---------------------------------------------------------------------------
// agentCapabilityDescriptor (R2-02-F1) — pure mapping, no I/O
// ---------------------------------------------------------------------------

/** Minimal AgentDefinition fixture; override only what a given test cares about. */
function baseAgentDefFixture(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'fixture-agent',
    name: 'Fixture Agent',
    description: 'A fixture agent for descriptor tests.',
    purpose: 'Testing descriptor computation.',
    composition: { skills: [], tools: [], mcps: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: '# Fixture\n',
    path: '/fixture/skills/fixture-agent/SKILL.md',
    ...overrides,
  };
}

test('agentCapabilityDescriptor: surface unattended → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: 'unattended' });
  assert.deepEqual(agentCapabilityDescriptor(def), { interactive: false, runtimeSdks: ['claude'] });
});

test('agentCapabilityDescriptor: surface interactive → interactive:true', () => {
  const def = baseAgentDefFixture({ surface: 'interactive' });
  assert.deepEqual(agentCapabilityDescriptor(def), { interactive: true, runtimeSdks: ['claude'] });
});

test('agentCapabilityDescriptor: surface operator-triggered → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: 'operator-triggered' });
  assert.equal(agentCapabilityDescriptor(def).interactive, false);
});

test('agentCapabilityDescriptor: surface both → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: 'both' });
  assert.equal(agentCapabilityDescriptor(def).interactive, false);
});

test('agentCapabilityDescriptor: absent surface → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: undefined });
  assert.equal(agentCapabilityDescriptor(def).interactive, false);
});

test('agentCapabilityDescriptor: runtimeSdks is a one-element set from runtime.sdk', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: 'codex', strategy: 'fixed', model: 'gpt' } });
  assert.deepEqual(agentCapabilityDescriptor(def).runtimeSdks, ['codex']);
});

test('agentCapabilityDescriptor: empty-string runtime.sdk yields empty runtimeSdks (defensive)', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: '', strategy: 'fixed', model: 'x' } });
  assert.deepEqual(agentCapabilityDescriptor(def).runtimeSdks, []);
});

// Real-roster guard: every in-tree studio agent computes without throwing, and
// `interactive` always agrees with executionPathForSurface — the descriptor
// must never diverge from the reused mapper it's built on.
test('agentCapabilityDescriptor: computes for every real roster agent, interactive matches executionPathForSurface', () => {
  const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
  assert.ok(defs.length > 0, 'roster must be non-empty');
  for (const def of defs) {
    const descriptor = agentCapabilityDescriptor(def);
    assert.equal(
      descriptor.interactive,
      executionPathForSurface(def.surface) === 'interactive',
      `${def.slug}: interactive must match executionPathForSurface(surface)`,
    );
    assert.ok(Array.isArray(descriptor.runtimeSdks), `${def.slug}: runtimeSdks must be an array`);
  }
});
