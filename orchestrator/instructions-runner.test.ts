/**
 * Tests for the instructions-creator runner (Stage A). The SDK sits behind an
 * injectable `queryFn`, so the full state machine runs without a live LLM. Each
 * test uses a fresh tempdir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runInstructionsTurn,
  instructionsSessionDir,
  instructionsAgentSpec,
  INSTRUCTIONS_MODEL,
  DRAFT_FILENAME,
  type InstructionsStatus,
} from './instructions-runner.ts';
import { writeSessionStatus, readSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from './logging.ts';

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
  assert.equal(instructionsAgentSpec.phase, 'architect');
  assert.equal(instructionsAgentSpec.tier, 'sonnet');
  assert.equal(INSTRUCTIONS_MODEL, 'claude-sonnet-4-6');
  assert.deepEqual([...instructionsAgentSpec.allowedTools], ['Read', 'Grep', 'Glob', 'Bash']);
  // Read-only: never Write/Edit (the runner writes AGENTS.md, not the agent).
  assert.ok(!instructionsAgentSpec.allowedTools.includes('Write'));
  assert.ok(!instructionsAgentSpec.allowedTools.includes('Edit'));
});
