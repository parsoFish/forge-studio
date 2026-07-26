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
  assert.equal(instructionsAgentSpec.phase, 'architect');
  assert.equal(instructionsAgentSpec.tier, 'sonnet');
  assert.equal(INSTRUCTIONS_MODEL, 'claude-sonnet-4-6');
  assert.deepEqual([...instructionsAgentSpec.allowedTools], ['Read', 'Grep', 'Glob', 'Bash']);
  // Read-only: never Write/Edit (the runner writes AGENTS.md, not the agent).
  assert.ok(!instructionsAgentSpec.allowedTools.includes('Write'));
  assert.ok(!instructionsAgentSpec.allowedTools.includes('Edit'));
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

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, seedsRoot, logger: logger(logsRoot, sessionId) });

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

  const result = await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, seedsRoot, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.doesNotMatch(draftPrompt, /Matching instruction seeds/);
  const draft = readFileSync(join(sessionDir, DRAFT_FILENAME), 'utf8');
  assert.doesNotMatch(draft, /forge:composed-instruction-seeds/);

  rmSync(seedsRoot, { recursive: true, force: true });
});
