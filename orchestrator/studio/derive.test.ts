/**
 * No-drift lock for ADR-027 M0 ws-4: until M2 flips invocation files to
 * single-source, any change to either the hardcoded PhaseAgentSpec constants
 * or the SKILL.md frontmatter must update both sides. This test locks them
 * together by asserting deep equality between the two representations.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveAgentSpec } from './derive.ts';
import { pmAgentSpec } from '../pm-invocation.ts';
import { devAgentSpec } from '../dev-invocation.ts';
import { unifierAgentSpec } from '../unifier-invocation.ts';
import { reflectorAgentSpec } from '../reflector-invocation.ts';

// architect excluded: it has no PhaseAgentSpec constant until the
// architect-runner migrates to the derived spec (roadmap M2-4, ADR-024 gap).
// Update this list in M2 when architect gains its PhaseAgentSpec constant (M2-4).
const CASES = [
  ['skills/project-manager/SKILL.md', pmAgentSpec],
  ['skills/developer-ralph/SKILL.md', devAgentSpec],
  ['skills/developer-unifier/SKILL.md', unifierAgentSpec],
  ['skills/reflector/SKILL.md', reflectorAgentSpec],
] as const;

for (const [skill, hardcoded] of CASES) {
  test(`derived spec deep-equals hardcoded: ${hardcoded.phase}`, () => {
    // No-drift lock (roadmap M0 ws-4): until M2 flips invocation files to
    // single-source, any change to either side must update both.
    assert.deepEqual(deriveAgentSpec(skill), {
      ...hardcoded,
      allowedTools: [...hardcoded.allowedTools],
      disallowedTools: [...hardcoded.disallowedTools],
    });
  });
}

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

test('deriveAgentSpec throws when runtime strategy is range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-neg-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range')
      .replace('model: claude-sonnet-4-6', 'range: [claude-sonnet-4-6, claude-haiku-4-5-20251001]');
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, '/'),
      /runtime must be strategy:fixed with a model/,
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
