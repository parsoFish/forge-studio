/**
 * Unit tests for orchestrator/phases/dev-binding.ts.
 *
 * Verifies the ADR 024 PhaseAgentSpec shape, the model derivation, and the
 * system + user prompt contracts. No SDK invocation, no shells.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  devAgentSpec,
  DEV_MODEL,
  DEV_ALLOWED_TOOLS,
  DEV_DISALLOWED_TOOLS,
  buildDevSystemPrompt,
  renderDevUserPrompt,
} from './dev-binding.ts';
import { modelForSpec } from '../phase-agent.ts';

// ---------------------------------------------------------------------------
// devAgentSpec shape
// ---------------------------------------------------------------------------

test('devAgentSpec has the correct phase and skill path', () => {
  assert.equal(devAgentSpec.phase, 'developer-loop');
  assert.equal(devAgentSpec.skill, 'skills/developer-ralph/SKILL.md');
});

test('devAgentSpec tier is sonnet', () => {
  assert.equal(devAgentSpec.tier, 'sonnet');
});

test('devAgentSpec.allowedTools matches DEV_ALLOWED_TOOLS', () => {
  for (const tool of DEV_ALLOWED_TOOLS) {
    assert.ok(devAgentSpec.allowedTools.includes(tool), `allowedTools should include ${tool}`);
  }
  assert.equal(devAgentSpec.allowedTools.length, DEV_ALLOWED_TOOLS.length);
});

test('devAgentSpec.disallowedTools matches DEV_DISALLOWED_TOOLS', () => {
  for (const tool of DEV_DISALLOWED_TOOLS) {
    assert.ok(devAgentSpec.disallowedTools.includes(tool), `disallowedTools should include ${tool}`);
  }
});

// ---------------------------------------------------------------------------
// DEV_MODEL derivation (behavior-preserving: must remain Sonnet)
// ---------------------------------------------------------------------------

test('DEV_MODEL is derived from devAgentSpec tier (single source)', () => {
  assert.equal(DEV_MODEL, modelForSpec(devAgentSpec));
});

test('DEV_MODEL resolves to claude-sonnet-4-6 (behavior preserved)', () => {
  assert.equal(DEV_MODEL, 'claude-sonnet-4-6');
});

// ---------------------------------------------------------------------------
// Tool allow/disallow list invariants
// ---------------------------------------------------------------------------

test('DEV_ALLOWED_TOOLS includes Bash, Read, Write, Edit (needed for tests + commits)', () => {
  for (const t of ['Bash', 'Read', 'Write', 'Edit'] as const) {
    assert.ok(DEV_ALLOWED_TOOLS.includes(t), `missing tool: ${t}`);
  }
});

test('DEV_DISALLOWED_TOOLS bans web tools', () => {
  for (const t of ['WebFetch', 'WebSearch'] as const) {
    assert.ok(DEV_DISALLOWED_TOOLS.includes(t), `missing banned tool: ${t}`);
  }
});

// ---------------------------------------------------------------------------
// System prompt — SKILL.md carries all intent (table-driven)
// ---------------------------------------------------------------------------

const SYS = buildDevSystemPrompt('/tmp/fake-brain-cwd');

test('buildDevSystemPrompt: contains all key invariants', () => {
  // Substantive
  assert.ok(SYS.length > 500, 'system prompt should be substantive');
  // Absolute-path / use-relative-paths rule (F-W5-6 blocker)
  assert.ok(
    SYS.includes('relative') || SYS.includes('worktree'),
    'system prompt must reference relative-path discipline',
  );
  // Forge brain off-limits (brain-read policy)
  assert.ok(
    SYS.includes('forge brain') || SYS.includes('forge-brain') || SYS.includes('Brains 1+2'),
    'system prompt must reference the forge-brain off-limits policy',
  );
  // "continuing not restarting" rule (scope discipline)
  assert.ok(
    SYS.toLowerCase().includes('continuing') || SYS.toLowerCase().includes('restarting'),
    'system prompt must reference the continue-not-restart discipline',
  );
  // No-hallucinated-test-passes rule
  assert.ok(
    SYS.includes('hallucinated') || SYS.toLowerCase().includes('prove it'),
    'system prompt must reference no-hallucinated-test-passes rule',
  );
  // files_in_scope advisory-not-fence rule
  assert.ok(
    SYS.includes('files_in_scope') && (SYS.includes('advisory') || SYS.includes('fence')),
    'system prompt must carry the files_in_scope advisory rule',
  );
  // creates:/verification_artifact: mandatory-output rule
  assert.ok(
    SYS.includes('creates:') || SYS.includes('verification_artifact:'),
    'system prompt must reference the mandatory creates:/verification_artifact: output rule',
  );
});

// ---------------------------------------------------------------------------
// User prompt — dynamic-only
// ---------------------------------------------------------------------------

test('renderDevUserPrompt: contains worktree absolute path (the F-W5-6 fix)', () => {
  const prompt = renderDevUserPrompt({
    initiativeId: 'INIT-test',
    workItemId: 'WI-1',
    workItemSpecRelPath: '.forge/work-items/WI-1.md',
    worktreeRelPath: '.',
    worktreePath: '/absolute/path/to/worktree',
    iteration: 1,
    iterationBudget: 5,
    costBudgetUsd: Infinity,
    filesInScope: ['src/foo.ts'],
    acceptanceCriteria: [{ given: 'A', when: 'B', then: 'C' }],
  });
  assert.ok(prompt.includes('/absolute/path/to/worktree'), 'user prompt must embed absolute worktree path');
});

test('renderDevUserPrompt: contains the WI spec relative path', () => {
  const prompt = renderDevUserPrompt({
    initiativeId: 'INIT-test',
    workItemId: 'WI-1',
    workItemSpecRelPath: '.forge/work-items/WI-1.md',
    worktreeRelPath: '.',
    worktreePath: '/tmp/wt',
    iteration: 2,
    iterationBudget: 5,
    costBudgetUsd: Infinity,
    filesInScope: [],
    acceptanceCriteria: [],
  });
  assert.ok(prompt.includes('.forge/work-items/WI-1.md'));
});

test('renderDevUserPrompt: contains the initiative id and iteration counter', () => {
  const prompt = renderDevUserPrompt({
    initiativeId: 'INIT-2026-06-test',
    workItemId: 'WI-2',
    workItemSpecRelPath: '.forge/work-items/WI-2.md',
    worktreeRelPath: '.',
    worktreePath: '/tmp/wt',
    iteration: 3,
    iterationBudget: 7,
    costBudgetUsd: Infinity,
    filesInScope: ['a.ts'],
    acceptanceCriteria: [{ given: 'G', when: 'W', then: 'T' }],
  });
  assert.ok(prompt.includes('INIT-2026-06-test'));
  assert.ok(prompt.includes('3'));
  assert.ok(prompt.includes('7'));
});

test('renderDevUserPrompt: does not repeat the static discipline rules (those live in SKILL.md)', () => {
  const prompt = renderDevUserPrompt({
    initiativeId: 'INIT-test',
    workItemId: 'WI-1',
    workItemSpecRelPath: '.forge/work-items/WI-1.md',
    worktreeRelPath: '.',
    worktreePath: '/tmp/wt',
    iteration: 1,
    iterationBudget: 5,
    costBudgetUsd: Infinity,
    filesInScope: [],
    acceptanceCriteria: [],
  });
  // The "Ralph loop discipline" header should NOT be repeated in the user prompt
  // (it lives in SKILL.md now)
  assert.ok(
    !prompt.includes('Ralph loop discipline'),
    'user prompt must not re-state Ralph loop discipline (it lives in SKILL.md)',
  );
});
