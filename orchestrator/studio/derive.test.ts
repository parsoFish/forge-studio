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

import { deriveAgentSpec } from './derive.ts';

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
  });
});

test('deriveAgentSpec: developer-loop spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/developer-ralph/SKILL.md'), {
    phase: 'developer-loop',
    skill: 'skills/developer-ralph/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
  });
});

test('deriveAgentSpec: unifier spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/developer-unifier/SKILL.md'), {
    phase: 'unifier',
    skill: 'skills/developer-unifier/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
  });
});

test('deriveAgentSpec: reflector spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/reflector/SKILL.md'), {
    phase: 'reflector',
    skill: 'skills/reflector/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
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
