/**
 * ADR 024 seam — the PhaseAgentSpec primitive (model-by-tier resolution).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODEL_BY_TIER, modelForSpec, resolveSessionModel, type PhaseAgentSpec } from './phase-agent.ts';

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

// ---------------------------------------------------------------------------
// resolveSessionModel — ADR-043 §3 amendment (wave-6 kickoff model-tier seam)
// ---------------------------------------------------------------------------

const FIXED_SPEC: PhaseAgentSpec = {
  phase: 'instructions',
  skill: 'skills/instructions-creator/SKILL.md',
  tier: 'sonnet',
  allowedTools: ['Read'],
  disallowedTools: [],
};

const RANGE_SPEC: PhaseAgentSpec = {
  phase: 'instructions',
  skill: 'skills/instructions-creator/SKILL.md',
  tier: 'sonnet',
  allowedTools: ['Read'],
  disallowedTools: [],
  allowedTiers: ['sonnet', 'opus'],
};

test('resolveSessionModel: absent requestedTier resolves exactly like modelForSpec (fixed spec)', () => {
  assert.equal(resolveSessionModel(FIXED_SPEC), modelForSpec(FIXED_SPEC));
  assert.equal(resolveSessionModel(FIXED_SPEC), 'claude-sonnet-4-6');
});

test('resolveSessionModel: absent requestedTier resolves exactly like modelForSpec (range spec)', () => {
  assert.equal(resolveSessionModel(RANGE_SPEC), modelForSpec(RANGE_SPEC));
  assert.equal(resolveSessionModel(RANGE_SPEC), 'claude-sonnet-4-6');
});

test('resolveSessionModel: requestedTier within the range resolves to its model', () => {
  assert.equal(resolveSessionModel(RANGE_SPEC, 'opus'), 'claude-opus-4-8');
  assert.equal(resolveSessionModel(RANGE_SPEC, 'sonnet'), 'claude-sonnet-4-6');
});

test('resolveSessionModel: requestedTier outside the range throws naming the value and the allowed set', () => {
  assert.throws(
    () => resolveSessionModel(RANGE_SPEC, 'haiku'),
    /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/,
  );
});

test('resolveSessionModel: requestedTier equal to a fixed spec\'s own tier is accepted', () => {
  assert.equal(resolveSessionModel(FIXED_SPEC, 'sonnet'), 'claude-sonnet-4-6');
});

test('resolveSessionModel: requestedTier mismatching a fixed spec\'s tier throws naming the value and the allowed set', () => {
  assert.throws(
    () => resolveSessionModel(FIXED_SPEC, 'opus'),
    /requested model tier "opus".*allowed tier\(s\): sonnet/,
  );
});
