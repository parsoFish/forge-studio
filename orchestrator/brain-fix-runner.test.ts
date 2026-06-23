/**
 * Tests for brain-fix-runner.ts.
 *
 * Uses an injectable queryFn seam (mirroring architect-runner.test.ts) and a
 * minimal brain/ fixture (mirroring cli/brain-lint.test.ts) so no live LLM or
 * live forge brain is touched.
 *
 * Two key assertions:
 *   (a) start + end events are written to _logs/_brainfix-<runId>/events.jsonl
 *   (b) the verification gate sets cleared=true when the agent fixed the file
 *       and cleared=false when it didn't
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runBrainFixTurn, type QueryFn } from './brain-fix-runner.ts';

// ---------------------------------------------------------------------------
// Helpers — minimal brain fixture (same pattern as cli/brain-lint.test.ts)
// ---------------------------------------------------------------------------

/**
 * Build a minimal forge-root tempdir with a brain/ that contains one theme
 * missing the `description` field in its frontmatter — a known 'agent'-tier
 * finding (kind ~ 'frontmatter.missing-field').
 *
 * Returns { forgeRoot, themePath } so callers can inspect/mutate the theme.
 */
function buildFixture(): { forgeRoot: string; themePath: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'brain-fix-runner-test-'));
  const brain = join(forgeRoot, 'brain');
  const cyclesThemes = join(brain, 'cycles', 'themes');
  const cyclesDir = join(brain, 'cycles');
  const forgeDevDir = join(brain, 'forge-dev');

  mkdirSync(cyclesThemes, { recursive: true });
  mkdirSync(forgeDevDir, { recursive: true });

  // Required index stubs so checkIndexSync doesn't trip on missing index files.
  writeFileSync(join(brain, 'INDEX.md'), '# Brain\n\nnavigation hub.\n');
  for (const cat of ['patterns', 'antipatterns', 'decisions', 'operations']) {
    writeFileSync(join(cyclesDir, `${cat}.md`), `# ${cat}\n`);
  }
  for (const cat of ['decisions', 'reference']) {
    writeFileSync(join(forgeDevDir, `${cat}.md`), `# ${cat}\n`);
  }

  // Write a theme that is MISSING the required `description` field.
  // checkFrontmatter flags this as 'agent' tier.
  const themePath = join(cyclesThemes, 'no-description.md');
  writeFileSync(
    themePath,
    [
      '---',
      'title: test theme',
      // description is intentionally ABSENT
      'category: pattern',
      'created_at: 2026-01-01T00:00:00Z',
      'updated_at: 2026-01-01T00:00:00Z',
      'keywords: []',
      'related_themes: []',
      '---',
      '',
      '# theme body',
      '',
      'Some content here.',
    ].join('\n') + '\n',
  );

  return { forgeRoot, themePath };
}

/** Minimal skills/brain-fix/SKILL.md stub so loadSkillPrompt succeeds. */
function seedSkillMd(forgeRoot: string): void {
  const dir = join(forgeRoot, 'skills', 'brain-fix');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# Brain-Fix\n\nApply a single targeted fix.\n');
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Fake queryFns
// ---------------------------------------------------------------------------

/**
 * A queryFn that simulates the agent actually editing the file: when invoked,
 * it writes the missing `description` field into the theme's frontmatter, then
 * yields a successful SDK result. This lets the verification gate find the
 * finding cleared.
 */
function makeFakeQueryThatFixes(themePath: string): QueryFn {
  return ({ prompt: _prompt, options: _opts }) => {
    async function* gen(): AsyncGenerator<unknown> {
      // Simulate the agent editing the file to add the missing description.
      const original = readFileSync(themePath, 'utf8');
      const patched = original.replace(
        'title: test theme\n',
        'title: test theme\ndescription: A test description added by the fix agent.\n',
      );
      writeFileSync(themePath, patched);
      // Yield an assistant tool-use event (drives hex bursts) then a result.
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: themePath } }],
        },
      };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.001 };
    }
    return gen();
  };
}

/**
 * A queryFn that does NOT edit the file — simulates a failed / no-op agent
 * turn so the verification gate should return cleared=false.
 */
function makeFakeQueryThatDoesNothing(): QueryFn {
  return (_params) => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0 };
    }
    return gen();
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('(a) start + end events written to _logs/_brainfix-<runId>/events.jsonl', async () => {
  const { forgeRoot, themePath } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const runId = 'test-run-events';
    await runBrainFixTurn({
      runId,
      kbId: 'forge',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      fixHint: 'Add a description field to the YAML frontmatter.',
      forgeRoot,
      queryFn: makeFakeQueryThatFixes(themePath),
    });

    const logPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
    const raw = readFileSync(logPath, 'utf8');
    const events = raw.trim().split('\n').map((l) => JSON.parse(l));

    const startEv = events.find((e) => e.event_type === 'start');
    const endEv = events.find((e) => e.event_type === 'end');

    assert.ok(startEv, 'start event must be written');
    assert.equal(startEv.phase, 'reflection');
    assert.equal(startEv.skill, 'brain-fix');
    assert.ok(startEv.message.includes('brain-fix.start'));

    assert.ok(endEv, 'end event must be written');
    assert.equal(endEv.phase, 'reflection');
    assert.equal(endEv.skill, 'brain-fix');
    assert.ok(endEv.message.includes('brain-fix.end'));
    assert.equal(endEv.metadata?.kind, 'frontmatter.missing-field');
    assert.equal(endEv.metadata?.file, themePath);
  } finally {
    cleanup(forgeRoot);
  }
});

test('(b) cleared=true when the agent added the missing description field', async () => {
  const { forgeRoot, themePath } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const result = await runBrainFixTurn({
      runId: 'test-run-cleared',
      kbId: 'forge',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      fixHint: 'Add a description field to the YAML frontmatter.',
      forgeRoot,
      queryFn: makeFakeQueryThatFixes(themePath),
    });

    assert.equal(result.runId, 'test-run-cleared');
    assert.equal(result.cleared, true, 'expected cleared=true after the agent fixed the file');
  } finally {
    cleanup(forgeRoot);
  }
});

test('(b) cleared=false when the agent made no edit', async () => {
  const { forgeRoot, themePath } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const result = await runBrainFixTurn({
      runId: 'test-run-not-cleared',
      kbId: 'forge',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      fixHint: 'Add a description field to the YAML frontmatter.',
      forgeRoot,
      queryFn: makeFakeQueryThatDoesNothing(),
    });

    assert.equal(result.runId, 'test-run-not-cleared');
    assert.equal(result.cleared, false, 'expected cleared=false when the agent did nothing');
  } finally {
    cleanup(forgeRoot);
  }
});

test('tool_use events from the agent stream are emitted to the log', async () => {
  const { forgeRoot, themePath } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const runId = 'test-run-tooluse';
    await runBrainFixTurn({
      runId,
      kbId: 'forge',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      forgeRoot,
      queryFn: makeFakeQueryThatFixes(themePath),
    });

    const logPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
    const events = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const toolUses = events.filter((e) => e.event_type === 'tool_use' || e.event_type === 'file_change');
    // The fake query yields an Edit tool_use block — should produce at least one event.
    assert.ok(toolUses.length >= 1, `expected tool events, got ${toolUses.length}`);
  } finally {
    cleanup(forgeRoot);
  }
});

test('end event metadata carries cleared, kind, and file', async () => {
  const { forgeRoot, themePath } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const runId = 'test-run-end-metadata';
    await runBrainFixTurn({
      runId,
      kbId: 'forge',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      forgeRoot,
      queryFn: makeFakeQueryThatDoesNothing(),
    });

    const logPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
    const events = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const endEv = events.find((e) => e.event_type === 'end');
    assert.ok(endEv, 'end event must exist');
    assert.equal(typeof endEv.metadata.cleared, 'boolean');
    assert.equal(endEv.metadata.kind, 'frontmatter.missing-field');
    assert.equal(endEv.metadata.file, themePath);
    assert.equal(endEv.metadata.runId, runId);
  } finally {
    cleanup(forgeRoot);
  }
});
