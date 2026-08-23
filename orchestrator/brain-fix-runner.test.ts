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
import { REDACTED_THINKING_MARKER } from './interactive-session.ts';

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

// W6-B1: brain-fix drove its own raw SDK stream loop with NO text/thinking
// sink at all before this change — this pins BOTH landing now, plus the
// unsampled Read tool_use contract every interactive-shaped runner shares.
test('W6-B1: reasoning + thinking blocks are forwarded to the log (kind: reasoning / thinking), redacted_thinking coalesces, and Read tool_use events are unsampled', async () => {
  const { forgeRoot, themePath } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const runId = 'test-run-thinking';
    const READ_CALLS = 6;
    const queryFn: QueryFn = () => {
      async function* gen(): AsyncGenerator<unknown> {
        const reads = Array.from({ length: READ_CALLS }, (_, i) => ({
          type: 'tool_use', name: 'Read', input: { file_path: `f${i}.md` },
        }));
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: '  inspecting the frontmatter  ' },
              { type: 'thinking', thinking: '  weighing where to add the field  ' },
              { type: 'redacted_thinking', data: 'opaque-1' },
              { type: 'redacted_thinking', data: 'opaque-2' }, // consecutive — must coalesce
              ...reads,
            ],
          },
        };
        yield { type: 'result', subtype: 'success', total_cost_usd: 0 };
      }
      return gen();
    };

    await runBrainFixTurn({
      runId,
      kbId: 'forge',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      forgeRoot,
      queryFn,
    });

    const logPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
    const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    const reasoningEvents = events.filter((e) => e.metadata?.kind === 'reasoning');
    assert.equal(reasoningEvents.length, 1);
    assert.equal(reasoningEvents[0].message, 'inspecting the frontmatter');

    const thinkingEvents = events.filter((e) => e.metadata?.kind === 'thinking');
    assert.equal(thinkingEvents.length, 2, 'one real thinking row + ONE coalesced row for the two consecutive redacted markers');
    assert.equal(thinkingEvents[0].message, 'weighing where to add the field');
    assert.equal(thinkingEvents[1].message, REDACTED_THINKING_MARKER);

    const readToolUses = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool === 'Read');
    assert.equal(readToolUses.length, READ_CALLS, 'sampler opts {readOnlySampleRate:1, cap:200} — every Read emitted, none sampled out');
  } finally {
    cleanup(forgeRoot);
  }
});

// ---------------------------------------------------------------------------
// W8-B2 — the verification lens must cover the file it is verifying.
//
// WHICH WRONG IMPLEMENTATION THIS KILLS: verifying with
// `runBrainLint({scope:'single-file'})` alone. `checkSourceLinks` and
// `checkDanglingEdges` are CHECK_SCOPE 'forge-themes' and iterate
// `readThemeFiles`, which never walks brain/projects/*/themes/ — so for a
// PROJECT theme they produced no finding at all and `cleared` came back
// unconditionally true. That is why the live 2026-08-22 drain reported a link
// repointed at a second dead path as cleared. Every fixture in this file
// before now lived under brain/cycles/themes, where the defect cannot exist.
// ---------------------------------------------------------------------------

/** A project theme (ADR 035: brain/projects/<name>/themes/) carrying a link
 *  that resolves to nothing, plus a dangling related_themes entry. */
function buildProjectThemeFixture(): { forgeRoot: string; themePath: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'brain-fix-project-scope-'));
  const brain = join(forgeRoot, 'brain');
  mkdirSync(join(brain, 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(brain, 'forge-dev'), { recursive: true });
  writeFileSync(join(brain, 'INDEX.md'), '# Brain\n');
  const themes = join(brain, 'projects', 'gitpulse', 'themes');
  mkdirSync(themes, { recursive: true });
  writeFileSync(join(brain, 'projects', 'gitpulse', 'patterns.md'), '# patterns\n\n- [broken-link-theme](./themes/broken-link-theme.md)\n');
  const themePath = join(themes, 'broken-link-theme.md');
  writeFileSync(themePath, [
    '---',
    'title: broken link theme',
    'description: carries a link that resolves to nothing.',
    'category: pattern',
    'created_at: 2026-01-01T00:00:00Z',
    'updated_at: 2026-01-01T00:00:00Z',
    'related_themes: [no-such-theme-anywhere]',
    '---',
    '',
    '# broken link theme',
    '',
    'See [eval-driven development](../../../forge/themes/eval-driven-development.md).',
    '',
  ].join('\n'));
  return { forgeRoot, themePath };
}

test('W8-B2: a PROJECT theme whose broken link the turn never fixed reports cleared=false (it used to report true unconditionally)', async () => {
  const { forgeRoot, themePath } = buildProjectThemeFixture();
  seedSkillMd(forgeRoot);
  try {
    const result = await runBrainFixTurn({
      runId: 'w8b2-project-scope-links',
      kbId: 'gitpulse',
      file: themePath,
      check: 'checkSourceLinks',
      kind: 'links.broken',
      message: 'broken link: ../../../forge/themes/eval-driven-development.md',
      forgeRoot,
      queryFn: makeFakeQueryThatDoesNothing(),
    });
    assert.equal(result.cleared, false);
  } finally {
    cleanup(forgeRoot);
  }
});

test('W8-B2: the same holds for a PROJECT theme dangling related_themes entry', async () => {
  const { forgeRoot, themePath } = buildProjectThemeFixture();
  seedSkillMd(forgeRoot);
  try {
    const result = await runBrainFixTurn({
      runId: 'w8b2-project-scope-edges',
      kbId: 'gitpulse',
      file: themePath,
      check: 'checkDanglingEdges',
      kind: 'edge.dangling',
      message: 'dangling related_themes entry: "no-such-theme-anywhere"',
      forgeRoot,
      queryFn: makeFakeQueryThatDoesNothing(),
    });
    assert.equal(result.cleared, false);
  } finally {
    cleanup(forgeRoot);
  }
});

test('W8-B2: a project-theme finding the turn genuinely DOES fix still reports cleared=true — the lens was widened, not stuck closed', async () => {
  const { forgeRoot, themePath } = buildProjectThemeFixture();
  seedSkillMd(forgeRoot);
  const realTarget = join(forgeRoot, 'brain', 'cycles', 'themes', 'eval-driven-development.md');
  writeFileSync(realTarget, '---\ntitle: edd\ndescription: d.\ncategory: pattern\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n---\n\n# edd\n');
  try {
    const fixingQuery: QueryFn = () => {
      async function* gen(): AsyncGenerator<unknown> {
        writeFileSync(themePath, readFileSync(themePath, 'utf8').replace(
          '../../../forge/themes/eval-driven-development.md',
          '../../../cycles/themes/eval-driven-development.md',
        ));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0 };
      }
      return gen();
    };
    const result = await runBrainFixTurn({
      runId: 'w8b2-project-scope-fixed',
      kbId: 'gitpulse',
      file: themePath,
      check: 'checkSourceLinks',
      kind: 'links.broken',
      message: 'broken link',
      forgeRoot,
      queryFn: fixingQuery,
    });
    assert.equal(result.cleared, true);
  } finally {
    cleanup(forgeRoot);
  }
});
