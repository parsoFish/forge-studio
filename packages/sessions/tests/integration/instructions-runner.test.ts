/**
 * Tests for the instructions-creator runner (Stage A). The SDK sits behind an
 * injectable `queryFn`, so the full state machine runs without a live LLM. Each
 * test uses a fresh tempdir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runInstructionsTurn,
  instructionsSessionDir,
  instructionsAgentSpec,
  INSTRUCTIONS_MODEL,
  DRAFT_FILENAME,
  type InstructionsStatus,
} from '../../kinds/instructions.ts';
import { REDACTED_THINKING_MARKER, type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';
import { createLogger } from '@forge/kernel';

function makeQueryFn(spec: { interview?: unknown; draft?: unknown }): QueryFn {
  return ({ prompt }) => {
    let structured: unknown = null;
    if (prompt.includes('the interview step')) structured = spec.interview;
    else if (prompt.includes('draft AGENTS.md')) structured = spec.draft;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };
}

function setup(overrides?: Partial<InstructionsStatus>): {
  projectRoot: string;
  repoPath: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'instr-runner-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(repoPath, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-06-24T10-00-00';
  const sessionDir = instructionsSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: InstructionsStatus = {
    session_id: sessionId,
    project: 'demo',
    project_repo_path: repoPath,
    phase: 'interviewing',
    round: 1,
    prompt: 'Set up AGENTS.md for this TypeScript CLI.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

const logger = (logsRoot: string, sid: string) => createLogger(`_instructions-${sid}`, logsRoot);

test('interviewing → needs answers: writes questions.json + status awaiting-answers', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup();
  const queryFn = makeQueryFn({
    interview: {
      done: false,
      questions: [
        {
          question: 'What must agents never touch?',
          header: 'Off-limits',
          options: [
            { label: 'Generated code', description: 'Treat dist/ as read-only.' },
            { label: 'Nothing special', description: 'No locked areas.' },
          ],
        },
      ],
    },
  });

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-answers');
  assert.equal(result.questions?.length, 1);
  assert.ok(existsSync(join(sessionDir, 'questions.json')));
  assert.equal(readSessionStatus<InstructionsStatus>(sessionDir)?.phase, 'awaiting-answers');
});

test('interviewing → done flows straight through to drafting → awaiting-verdict + AGENTS.draft.md', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup();
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'Off-limits?', answer: 'dist/ is generated' }] }]),
  );
  const queryFn = makeQueryFn({
    interview: { done: true },
    draft: { agents_md: '# Demo CLI\n\nBuild: `npm run build`. Test: `npm test`.\n\n## Conventions\n\n- dist/ is generated — never edit by hand.' },
  });

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  const draftPath = join(sessionDir, DRAFT_FILENAME);
  assert.ok(existsSync(draftPath));
  assert.match(readFileSync(draftPath, 'utf8'), /Demo CLI/);
  assert.equal(readSessionStatus<InstructionsStatus>(sessionDir)?.phase, 'awaiting-verdict');
});

test('W6-B1: drafting turn forwards thinking + coalesced redacted_thinking to the event log, and Read tool_use events are unsampled', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'drafting' });
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
            { type: 'thinking', thinking: '  weighing the AGENTS.md structure  ' },
            { type: 'redacted_thinking', data: 'opaque-1' },
            { type: 'redacted_thinking', data: 'opaque-2' }, // consecutive — must coalesce
            ...reads,
          ],
        },
      };
      yield { type: 'result', total_cost_usd: 0, structured_output: { agents_md: '# Demo CLI\n' } };
    }
    return gen();
  };

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  const events = readFileSync(join(logsRoot, `_instructions-${sessionId}`, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

  const thinkingEvents = events.filter((e) => e.metadata?.kind === 'thinking');
  assert.equal(thinkingEvents.length, 2, 'one real thinking row + ONE coalesced row for the two consecutive redacted markers');
  assert.equal(thinkingEvents[0].message, 'weighing the AGENTS.md structure');
  assert.equal(thinkingEvents[1].message, REDACTED_THINKING_MARKER);

  const readToolUses = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool === 'Read');
  assert.equal(readToolUses.length, READ_CALLS, 'sampler opts {readOnlySampleRate:1, cap:200} — every Read emitted, none sampled out');
});

test('finalizing: writes the approved draft to <repo>/AGENTS.md + status committed', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'finalizing' });
  writeFileSync(join(sessionDir, DRAFT_FILENAME), '# Demo CLI\n\nBuild: `npm run build`.\n');

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn: makeQueryFn({}), logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'committed');
  const agentsPath = join(repoPath, 'AGENTS.md');
  assert.ok(existsSync(agentsPath));
  assert.match(readFileSync(agentsPath, 'utf8'), /Demo CLI/);
  assert.equal(result.agentsPath, agentsPath);
  assert.equal(readSessionStatus<InstructionsStatus>(sessionDir)?.phase, 'committed');
});

test('drafting bakes operator revision feedback into the draft prompt', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ phase: 'drafting' });
  writeFileSync(join(sessionDir, 'feedback.md'), 'Add the lint command and drop the marketing intro.');
  let draftPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    if (prompt.includes('draft AGENTS.md')) draftPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md') ? { agents_md: '# Demo\n\nLint: `npm run lint`.' } : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.match(draftPrompt, /Revision feedback/);
  assert.match(draftPrompt, /drop the marketing intro/);
});

test('draft: empty agents_md throws a clear, recoverable error', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'drafting' });
  const queryFn = makeQueryFn({ draft: { agents_md: '   ' } });
  await assert.rejects(
    () => runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) }),
    /empty AGENTS\.md content/,
  );
});

test('briefing turn is a no-op (the operator provides notes before the agent runs)', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'briefing', mode: 'edit' });
  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn: makeQueryFn({}), logger: logger(logsRoot, sessionId) });
  assert.equal(result.phase, 'briefing');
  assert.equal(result.wrote.length, 0);
});

test('edit mode: the draft prompt carries the existing AGENTS.md + an UPDATE framing', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setup({ phase: 'drafting', mode: 'edit' });
  writeFileSync(join(repoPath, 'AGENTS.md'), '# Existing\n\nKeep the lint command: npm run lint.');
  let draftPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    if (prompt.includes('draft AGENTS.md')) draftPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md') ? { agents_md: '# Existing\n\nKeep the lint command: npm run lint.\n\n## Added\n\nUse conventional commits.' } : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };
  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });
  assert.equal(result.phase, 'awaiting-verdict');
  assert.match(draftPrompt, /Existing AGENTS\.md/, 'existing file injected as context');
  assert.match(draftPrompt, /Keep the lint command/, 'the actual file content is included');
  assert.match(draftPrompt, /REVISED to/, 'framed as a revision, not a fresh draft');
});

test('awaiting-answers turn is a no-op (bridge owns the wait state)', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'awaiting-answers' });
  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn: makeQueryFn({}), logger: logger(logsRoot, sessionId) });
  assert.equal(result.phase, 'awaiting-answers');
  assert.equal(result.wrote.length, 0);
});

test('missing status.json throws a clear error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'instr-runner-'));
  await assert.rejects(
    runInstructionsTurn({ sessionId: 'nope', projectRoot: join(root, 'p'), queryFn: makeQueryFn({}) }),
    /no status\.json/,
  );
});

test('ADR-024: instructionsAgentSpec derives phase, tier (sonnet), and read-only tools from SKILL.md', () => {
  // W7-C3 review (A-M10): the frontmatter is ADR-024's single source of
  // intent, so it must AGREE with the phase the runner emits (sessions-kinds-25);
  // it still said `architect` while every event row said `instructions`.
  assert.equal(instructionsAgentSpec.phase, 'instructions');
  assert.equal(instructionsAgentSpec.tier, 'sonnet');
  assert.equal(INSTRUCTIONS_MODEL, 'claude-sonnet-4-6');
  assert.deepEqual([...instructionsAgentSpec.allowedTools], ['Read', 'Grep', 'Glob', 'Bash']);
  // Read-only: never Write/Edit (the runner writes AGENTS.md, not the agent).
  assert.ok(!instructionsAgentSpec.allowedTools.includes('Write'));
  assert.ok(!instructionsAgentSpec.allowedTools.includes('Edit'));
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam)
// ---------------------------------------------------------------------------

test('status.modelTier is honored: an operator-requested "opus" reaches queryFn as options.model', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'drafting', modelTier: 'opus' });
  let capturedModel: string | undefined;
  const queryFn: QueryFn = ({ prompt, options }) => {
    if (prompt.includes('draft AGENTS.md')) capturedModel = (options as { model?: string }).model;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md') ? { agents_md: '# Demo\n\nBuild: `npm run build`.' } : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.equal(capturedModel, 'claude-opus-4-8');
});

test('status.modelTier absent resolves to the unchanged default (sonnet) — byte-identical prior behavior', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'drafting' });
  let capturedModel: string | undefined;
  const queryFn: QueryFn = ({ prompt, options }) => {
    if (prompt.includes('draft AGENTS.md')) capturedModel = (options as { model?: string }).model;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md') ? { agents_md: '# Demo\n\nBuild: `npm run build`.' } : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(capturedModel, INSTRUCTIONS_MODEL);
  assert.equal(capturedModel, 'claude-sonnet-4-6');
});

test('status.modelTier outside the declared range throws naming the value and the allowed set', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'drafting', modelTier: 'haiku' });
  await assert.rejects(
    () => runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn: makeQueryFn({ draft: { agents_md: 'x' } }), logger: logger(logsRoot, sessionId) }),
    /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/,
  );
});

test('R3-05-F3: a matching-shape project injects seeds into the draft prompt + records composed ids in the footer', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'drafting' });
  // A forge root with an instruction-seed library.
  const seedsRoot = mkdtempSync(join(tmpdir(), 'seeds-root-'));
  const seedDir = join(seedsRoot, 'studio', 'instruction-seeds');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(
    join(seedDir, 'typescript-node.md'),
    '---\nid: typescript-node\ntitle: TS/Node\nkind: language\nappliesTo: [typescript]\nscope: both\nprovenance: forge CLAUDE.md\n---\n\nUse tsc --noEmit.\n',
  );
  // A repo whose shape matches (package.json + tsconfig → typescript).
  writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5' } }));
  writeFileSync(join(repoPath, 'tsconfig.json'), '{}');

  let draftPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    if (prompt.includes('draft AGENTS.md')) draftPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md')
        ? { agents_md: '# Demo\n\nBuild: `npm run build`.', composed_seed_ids: ['typescript-node', 'not-matched-id'] }
        : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, forgeRoot: seedsRoot, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  // The matched seed was injected into the draft prompt.
  assert.match(draftPrompt, /Matching instruction seeds/);
  assert.match(draftPrompt, /seed: typescript-node/);
  // The footer records ONLY the actually-matched composed id (the hallucinated one dropped).
  const draft = readFileSync(join(sessionDir, DRAFT_FILENAME), 'utf8');
  assert.match(draft, /forge:composed-instruction-seeds: typescript-node/);
  assert.doesNotMatch(draft, /not-matched-id/);

  rmSync(seedsRoot, { recursive: true, force: true });
});

test('R3-05-F3: a no-match project falls back to a from-scratch draft (no seed section, no footer)', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'drafting' });
  const seedsRoot = mkdtempSync(join(tmpdir(), 'seeds-root-'));
  const seedDir = join(seedsRoot, 'studio', 'instruction-seeds');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(
    join(seedDir, 'go-x.md'),
    '---\nid: go-x\ntitle: Go\nkind: language\nappliesTo: [go]\nscope: project\nprovenance: p\n---\n\nUse gofmt.\n',
  );
  // A TypeScript repo — the only seed is Go, so nothing matches.
  writeFileSync(join(repoPath, 'package.json'), '{}');

  let draftPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    if (prompt.includes('draft AGENTS.md')) draftPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md') ? { agents_md: '# Demo\n\nBuilt from scratch.' } : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, forgeRoot: seedsRoot, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.doesNotMatch(draftPrompt, /Matching instruction seeds/);
  const draft = readFileSync(join(sessionDir, DRAFT_FILENAME), 'utf8');
  assert.doesNotMatch(draft, /forge:composed-instruction-seeds/);

  rmSync(seedsRoot, { recursive: true, force: true });
});

test('R3-05-F3: edit-mode revision does not duplicate the composed-seeds footer (idempotent)', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'drafting', mode: 'edit' });
  const seedsRoot = mkdtempSync(join(tmpdir(), 'seeds-root-'));
  const seedDir = join(seedsRoot, 'studio', 'instruction-seeds');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(
    join(seedDir, 'typescript-node.md'),
    '---\nid: typescript-node\ntitle: TS/Node\nkind: language\nappliesTo: [typescript]\nscope: both\nprovenance: forge CLAUDE.md\n---\n\nUse tsc.\n',
  );
  // Existing AGENTS.md ALREADY carries a footer (from a prior compose).
  writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5' } }));
  writeFileSync(
    join(repoPath, 'AGENTS.md'),
    '# Demo\n\nBuild: `npm run build`.\n\n<!-- forge:composed-instruction-seeds: typescript-node -->\n',
  );

  // The LLM echoes the existing file (footer included) as the revised draft.
  const queryFn: QueryFn = ({ prompt }) => {
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft AGENTS.md')
        ? { agents_md: '# Demo\n\nBuild: `npm run build`. Test: `npm test`.\n\n<!-- forge:composed-instruction-seeds: typescript-node -->', composed_seed_ids: ['typescript-node'] }
        : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, forgeRoot: seedsRoot, logger: logger(logsRoot, sessionId) });

  const draft = readFileSync(join(sessionDir, DRAFT_FILENAME), 'utf8');
  const footerCount = (draft.match(/forge:composed-instruction-seeds/g) ?? []).length;
  assert.equal(footerCount, 1, `exactly one footer after an edit-mode revision, got ${footerCount}`);
  rmSync(seedsRoot, { recursive: true, force: true });
});

test("W7-C3 (sessions-kinds-25): every event row carries phase 'instructions' — never 'architect'", async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  const queryFn = makeQueryFn({
    interview: {
      done: false,
      questions: [{ question: 'Anything off-limits?', header: 'Off-limits', options: [] }],
    },
  });

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  const events = readFileSync(join(logsRoot, `_instructions-${sessionId}`, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.ok(events.length > 0, 'the turn emitted events');
  for (const e of events) {
    assert.equal(e.phase, 'instructions', `event ${e.event_type} "${e.message}" filed under phase "${e.phase}" — instructions work must not be attributed to the architect phase`);
  }
});
