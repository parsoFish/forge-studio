/**
 * ADR 024 seam — the PhaseAgentSpec primitive (model-by-tier resolution).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODEL_BY_TIER, modelForSpec, type PhaseAgentSpec } from './phase-agent.ts';

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
