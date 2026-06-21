/**
 * Unit tests for orchestrator/reflector-invocation.ts — ADR 024 seam.
 *
 * Verifies:
 *   1. `reflectorAgentSpec` is well-formed (phase / skill / tier / tools).
 *   2. `REFLECTOR_MODEL` derives from the spec's tier (behaviour-preserved: Sonnet).
 *   3. The system prompt contains the reflector's key invariants sourced from SKILL.md.
 *   4. The user prompt contains the dynamic per-cycle bindings and NOT the static prose.
 *
 * No SDK invocation; no shell commands.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  reflectorAgentSpec,
  REFLECTOR_MODEL,
  REFLECTOR_ALLOWED_TOOLS,
  REFLECTOR_DISALLOWED_TOOLS,
  buildReflectorSystemPrompt,
  renderReflectorUserPrompt,
} from './reflector-invocation.ts';
import { modelForSpec } from './phase-agent.ts';

// ---------------------------------------------------------------------------
// reflectorAgentSpec shape
// ---------------------------------------------------------------------------

test('reflectorAgentSpec: phase is "reflector"', () => {
  assert.equal(reflectorAgentSpec.phase, 'reflector');
});

test('reflectorAgentSpec: skill points to skills/reflector/SKILL.md', () => {
  assert.equal(reflectorAgentSpec.skill, 'skills/reflector/SKILL.md');
});

test('reflectorAgentSpec: tier is "sonnet"', () => {
  assert.equal(reflectorAgentSpec.tier, 'sonnet');
});

test('reflectorAgentSpec: allowedTools includes Read, Write, Bash, Grep, Glob, Edit', () => {
  const tools = reflectorAgentSpec.allowedTools;
  for (const t of ['Read', 'Write', 'Bash', 'Grep', 'Glob', 'Edit'] as const) {
    assert.ok(tools.includes(t), `missing tool: ${t}`);
  }
});

test('reflectorAgentSpec: disallowedTools bans web tools and NotebookEdit', () => {
  const denied = reflectorAgentSpec.disallowedTools;
  for (const t of ['WebFetch', 'WebSearch', 'NotebookEdit'] as const) {
    assert.ok(denied.includes(t), `missing banned tool: ${t}`);
  }
});

// ---------------------------------------------------------------------------
// REFLECTOR_MODEL derives from the spec (behaviour-preserved: Sonnet)
// ---------------------------------------------------------------------------

test('REFLECTOR_MODEL equals modelForSpec(reflectorAgentSpec)', () => {
  assert.equal(REFLECTOR_MODEL, modelForSpec(reflectorAgentSpec));
});

test('REFLECTOR_MODEL is claude-sonnet-4-6 (behaviour-preserved)', () => {
  assert.equal(REFLECTOR_MODEL, 'claude-sonnet-4-6');
});

// ---------------------------------------------------------------------------
// Re-exported tool lists match the spec
// ---------------------------------------------------------------------------

test('REFLECTOR_ALLOWED_TOOLS matches spec allowedTools', () => {
  assert.deepEqual([...reflectorAgentSpec.allowedTools], REFLECTOR_ALLOWED_TOOLS);
});

test('REFLECTOR_DISALLOWED_TOOLS matches spec disallowedTools', () => {
  assert.deepEqual([...reflectorAgentSpec.disallowedTools], REFLECTOR_DISALLOWED_TOOLS);
});

// ---------------------------------------------------------------------------
// System prompt: brain index + SKILL.md key invariants; no per-cycle data
// (table-driven — one temp dir, all invariants in a single test block)
// ---------------------------------------------------------------------------

function makeFakeBrainCwd(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-reflector-test-'));
  // brain/INDEX.md is what loadBrainIndex reads — create a minimal one.
  mkdirSync(join(dir, 'brain'), { recursive: true });
  writeFileSync(
    join(dir, 'brain', 'INDEX.md'),
    '# Brain index\n\n_(test stub)_\n',
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('buildReflectorSystemPrompt: contains all key invariants and no per-cycle data', () => {
  const { dir, cleanup } = makeFakeBrainCwd();
  try {
    const sys = buildReflectorSystemPrompt(dir);

    // Substantive content
    assert.ok(sys.length > 2000, 'system prompt should be substantive');

    // PRESENT — key invariants from SKILL.md
    assert.ok(sys.includes('Brain navigation index'), 'should include brain nav header');
    assert.ok(sys.includes('reflector skill contract'), 'should embed skill contract header');
    assert.ok(
      sys.includes('brain_consulted') || sys.includes('brain reads are recorded'),
      'should carry the brain-first production gate signal',
    );
    assert.ok(
      sys.includes('direct') && sys.includes('Write'),
      'should carry the direct-write brain rule',
    );
    assert.ok(sys.includes('retention: auto'), 'should include cycle archive retention placeholder');
    assert.ok(sys.includes('cited_by: []'), 'should include cycle archive cited_by placeholder');
    assert.ok(sys.includes('ingested_by: reflector'), 'should include cycle archive ingested_by');
    assert.ok(sys.includes('AskUserQuestion'), 'should carry AskUserQuestion prohibition');

    // ABSENT — per-cycle dynamic data must not appear in the stable system prompt
    assert.ok(!sys.includes('INIT-2026-'), 'system prompt must not embed a real initiative id');
    assert.ok(!sys.includes('cycleId'), 'system prompt must not reference cycleId variable');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// User prompt: dynamic per-cycle bindings only
// ---------------------------------------------------------------------------

const SAMPLE_INPUT = {
  initiativeId: 'INIT-2026-06-07-reflector-test',
  cycleId: 'CYCLE-2026-06-07-001',
  manifestRelPath: '_queue/done/INIT-2026-06-07-reflector-test.md',
  eventLogRelPath: '_logs/CYCLE-2026-06-07-001/events.jsonl',
  brainGapsRelPath: '_logs/CYCLE-2026-06-07-001/brain-gaps.jsonl',
  mergedTreeRelPath: 'projects/testproj',
  projectName: 'testproj',
  userQuestionsRelPath: '_logs/CYCLE-2026-06-07-001/user-questions.md',
  userFeedbackRelPath: '_logs/CYCLE-2026-06-07-001/user-feedback.md',
  retroRelPath: '_logs/CYCLE-2026-06-07-001/retro.md',
  cycleArchiveRelPath: 'brain/cycles/_raw/CYCLE-2026-06-07-001.md',
  themesDirRelPath: 'projects/testproj/brain/themes',
  forgeThemesDirRelPath: 'brain/cycles/themes',
};

test('renderReflectorUserPrompt: contains all dynamic bindings', () => {
  const prompt = renderReflectorUserPrompt(SAMPLE_INPUT);
  const EXPECTED = [
    'INIT-2026-06-07-reflector-test',
    'CYCLE-2026-06-07-001',
    '_logs/CYCLE-2026-06-07-001/events.jsonl',
    '_logs/CYCLE-2026-06-07-001/retro.md',
    'projects/testproj/brain/themes',
    'brain/cycles/themes',
    'testproj',
  ];
  for (const s of EXPECTED) {
    assert.ok(prompt.includes(s), `missing dynamic binding: ${s}`);
  }
});

test('renderReflectorUserPrompt: does NOT contain the static skill prose (that lives in system prompt)', () => {
  const prompt = renderReflectorUserPrompt(SAMPLE_INPUT);
  // The "Reflector" heading and verbose skill body must not be duplicated here.
  assert.ok(!prompt.includes('retention: auto'), 'bulk static prose must not be in user prompt');
  assert.ok(!prompt.includes('ingested_by: reflector'), 'YAML frontmatter must not be in user prompt');
});

test('renderReflectorUserPrompt: is compact (no huge static blocks)', () => {
  const prompt = renderReflectorUserPrompt(SAMPLE_INPUT);
  // A pure dynamic brief should be well under 5 KB.
  assert.ok(prompt.length < 5000, `user prompt is too large (${prompt.length} chars) — static prose may have leaked in`);
});

// ---------------------------------------------------------------------------
// S8 — deeper retrospective (repeated actions / roadblocks / operator notes)
// and full-initiative aggregation (DEC-2)
// ---------------------------------------------------------------------------

test('renderReflectorUserPrompt: surfaces repeated actions, roadblocks, and a general-notes freeform', () => {
  const prompt = renderReflectorUserPrompt(SAMPLE_INPUT).toLowerCase();
  assert.ok(prompt.includes('repeated action'), 'Stage 1/2 must ask for repeated actions');
  assert.ok(prompt.includes('roadblock') || prompt.includes('wedge'), 'must ask for roadblocks/wedges');
  assert.ok(prompt.includes('general notes') || prompt.includes('freeform'), 'must offer a general-notes freeform question');
});

test('renderReflectorUserPrompt: scopes reflection to the whole initiative (DEC-2 threaded cycle_id)', () => {
  const prompt = renderReflectorUserPrompt(SAMPLE_INPUT).toLowerCase();
  assert.ok(prompt.includes('initiative'), 'must mention the initiative scope');
  assert.ok(
    prompt.includes('whole initiative') || prompt.includes('entire initiative') || prompt.includes('one cycle_id'),
    'must state reflection spans the whole initiative, not just the closing cycle',
  );
});

test('reflector SKILL contract (system prompt) writes the CENTRAL forge-owned brain, not the old in-repo path', () => {
  const { dir, cleanup } = makeFakeBrainCwd();
  try {
    const sys = buildReflectorSystemPrompt(dir);
    // F3/ADR-035: project themes are central under brain/projects/<name>/themes.
    assert.ok(sys.includes('brain/projects/<project>/themes'), 'should point themes at the central brain/projects/<project>/themes/');
    // The retired ADR-018 in-repo path must be gone everywhere in the contract.
    assert.ok(
      !sys.includes('projects/<project>/brain/'),
      'must not reference the retired in-repo path projects/<project>/brain/ (ADR-035)',
    );
    // The deeper retro is part of the durable contract too.
    assert.ok(sys.toLowerCase().includes('repeated action'), 'contract should cover repeated actions');
    assert.ok(sys.toLowerCase().includes('roadblock') || sys.toLowerCase().includes('wedge'), 'contract should cover roadblocks');
  } finally {
    cleanup();
  }
});
