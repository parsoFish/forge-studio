/**
 * ADR 024 seam — the PhaseAgentSpec primitive + the first concrete instance
 * (the unifier). Verifies the model resolves from the tier (behavior-preserving:
 * the unifier still runs on Sonnet) and the spec is well-formed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODEL_BY_TIER, modelForSpec, type PhaseAgentSpec } from './phase-agent.ts';
import { unifierAgentSpec, UNIFIER_MODEL } from './unifier-invocation.ts';

test('MODEL_BY_TIER maps each tier to its concrete model id', () => {
  assert.equal(MODEL_BY_TIER.haiku, 'claude-haiku-4-5-20251001');
  assert.equal(MODEL_BY_TIER.sonnet, 'claude-sonnet-4-6');
  assert.equal(MODEL_BY_TIER.opus, 'claude-opus-4-8');
});

test('modelForSpec resolves the spec tier to a model', () => {
  const spec: PhaseAgentSpec = {
    phase: 'demo',
    skill: 'skills/x/SKILL.md',
    tier: 'haiku',
    allowedTools: ['Read'],
    disallowedTools: [],
  };
  assert.equal(modelForSpec(spec), 'claude-haiku-4-5-20251001');
});

test('unifierAgentSpec composes the developer-unifier skill at the sonnet tier', () => {
  assert.equal(unifierAgentSpec.phase, 'unifier');
  assert.equal(unifierAgentSpec.skill, 'skills/developer-unifier/SKILL.md');
  assert.equal(unifierAgentSpec.tier, 'sonnet');
  assert.ok(unifierAgentSpec.allowedTools.length > 0, 'has a tool allow-list');
});

test('UNIFIER_MODEL is derived from the spec (behavior preserved: Sonnet)', () => {
  assert.equal(UNIFIER_MODEL, modelForSpec(unifierAgentSpec));
  assert.equal(UNIFIER_MODEL, 'claude-sonnet-4-6');
});
