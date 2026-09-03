/**
 * The INSTRUCTIONS RUNNER's composed prompt — what a real turn actually hands
 * the agent.
 *
 * These drive `runInstructionsTurn` with a capturing `queryFn` and assert on
 * the prompt it built. What each kills: AT-6 the kind still concatenating the
 * WHOLE skill file instead of selecting the interview/draft section, proven by
 * a sentinel unique to the OTHER turn leaking in · AT-7 a fail-open default
 * prompt surviving instead of the loader's fail-loud throw · AT-8 the prose
 * migration dropping or renaming a DATA label the runner injects (project,
 * repo path, operator brief, prior Q&A) · R2-AT-1 the "existing AGENTS.md
 * above" phrasing and the ordering of the `## Existing` data block against the
 * skill text · R2-AT-3 a mode branch being SHOWN rather than SELECTED, so the
 * agent sees the inapplicable branch too.
 *
 * ROUND 2 (R2-AT-*). An adversarial review of the landed WI-1 commit
 * (90cbc634) found real defects in the composed prompt and in the loader
 * itself. Those ATs were written BEFORE any fix landed, on the same rule as
 * AT-1..AT-10: an implementer may make them PASS by fixing the defect each
 * comment describes; it may NOT edit them to make them pass.
 *
 * SPLIT FROM a 1,027-line file along the three concerns its own banners
 * declare — LOADER, INSTRUCTIONS RUNNER, GREP-ASSERT — with each round-2 AT
 * filed under the concern it actually tests rather than under its number. The
 * three parts are `unit/skill-turn-sections` (the pure loader),
 * `integration/instructions-turn-prompt` (the composed prompt a real turn
 * produces) and `contract/skill-md-prose-migration` (the prose actually left
 * the .ts and reached SKILL.md). The split retires the file's
 * `scripts/baselines/file-size.json` row rather than re-keying it: a move
 * cannot retire an exemption, only a split can.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runInstructionsTurn,
  instructionsSessionDir,
  type InstructionsStatus,
} from '@forge/sessions/kinds/instructions.ts';
import { writeSessionStatus, type QueryFn } from '@forge/sessions/interactive-session.ts';
import { createLogger } from '@forge/kernel';

/** Write `content` to a fresh tmpdir under `<name>` and return the file path.
 *  Duplicated into the parts of this split that need it rather than exported
 *  from a `.test.ts` — the precedent this package already set in
 *  `regression/failure-classifier.rate-limit.test.ts`. */
function writeFixture(label: string, filename: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `skill-turn-${label}-`));
  const p = join(dir, filename);
  writeFileSync(p, content);
  return p;
}

/** A minimal `_instructions/<sid>` session dir + status.json, mirroring the
 *  established harness idiom in `instructions-runner.test.ts`. */
function setupSession(overrides?: Partial<InstructionsStatus>): {
  projectRoot: string;
  repoPath: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'skill-turn-prompt-session-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(repoPath, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-14T00-00-00';
  const sessionDir = instructionsSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: InstructionsStatus = {
    session_id: sessionId,
    project: 'skillturn-demo',
    project_repo_path: repoPath,
    phase: 'interviewing',
    round: 1,
    prompt: 'Document the CLI entry points and the release process.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

const logger = (logsRoot: string, sid: string) => createLogger(`_instructions-${sid}`, logsRoot);

/** A `queryFn` that records every prompt it is called with and always
 *  returns `response` as the turn's structured output. */
function capturingQueryFn(response: unknown): { queryFn: QueryFn; prompts: string[] } {
  const prompts: string[] = [];
  const queryFn: QueryFn = ({ prompt }) => {
    prompts.push(prompt);
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: response };
    }
    return gen();
  };
  return { queryFn, prompts };
}

/** Whitespace-tolerant phrase containment: `skills/instructions-creator/SKILL.md`
 *  is hand-wrapped markdown prose, so a multi-word pinned phrase can straddle a
 *  source line-wrap (e.g. "the existing\nAGENTS.md above" — a newline where a
 *  plain-space regex would expect a single space). Collapses whitespace on BOTH
 *  sides so a pin matches regardless of where the markdown happens to wrap.
 *  `collapseWhitespace` is duplicated here from the prose-migration part for
 *  the same reason every other helper in this split is. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function promptContains(haystack: string, needle: string): boolean {
  return collapseWhitespace(haystack).toLowerCase().includes(collapseWhitespace(needle).toLowerCase());
}

// ---------------------------------------------------------------------------
// INSTRUCTIONS RUNNER — turn selection is loaded AND used (AT-6)
// ---------------------------------------------------------------------------

const INTERVIEW_ONLY_SENTINEL = 'SENTINEL_INTERVIEW_ONLY_7f2c9a';
const DRAFT_ONLY_SENTINEL = 'SENTINEL_DRAFT_ONLY_4b81de';

function twoTurnInstructionsFixture(): string {
  return writeFixture(
    'runner-two-turn',
    'skill.md',
    [
      'Shared base preamble for the fixture instructions-creator skill.',
      '',
      '<!-- turn: interview -->',
      '## Interview turn (fixture)',
      INTERVIEW_ONLY_SENTINEL,
      '',
      '<!-- turn: draft -->',
      '## Draft turn (fixture)',
      DRAFT_ONLY_SENTINEL,
      '',
    ].join('\n'),
  );
}

test('AT-6a: an interviewing turn selects ONLY the interview section (the draft sentinel must not leak into the prompt)', async () => {
  const fixturePath = twoTurnInstructionsFixture();
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'interviewing' });
  // done:false stops the turn at awaiting-answers so this single call is the
  // ONLY LLM call this turn makes (no cascade into the draft step).
  const { queryFn, prompts } = capturingQueryFn({
    done: false,
    questions: [{ question: 'What is off-limits?', header: 'Off-limits', options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'e' }] }],
  });

  const result = await runInstructionsTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queryFn,
    skillPromptPath: fixturePath,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-answers');
  assert.equal(prompts.length, 1, 'exactly one LLM call for the interview step');
  assert.match(prompts[0], new RegExp(INTERVIEW_ONLY_SENTINEL), 'interview section reached the prompt');
  assert.doesNotMatch(prompts[0], new RegExp(DRAFT_ONLY_SENTINEL), 'draft section must NOT leak into an interview-turn prompt');
});

test('AT-6b: a drafting turn selects ONLY the draft section (the interview sentinel must not leak into the prompt)', async () => {
  const fixturePath = twoTurnInstructionsFixture();
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'drafting' });
  const { queryFn, prompts } = capturingQueryFn({ agents_md: '# Fixture\n\nDraft content.' });

  const result = await runInstructionsTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queryFn,
    skillPromptPath: fixturePath,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.equal(prompts.length, 1, 'exactly one LLM call for the draft step');
  assert.match(prompts[0], new RegExp(DRAFT_ONLY_SENTINEL), 'draft section reached the prompt');
  assert.doesNotMatch(prompts[0], new RegExp(INTERVIEW_ONLY_SENTINEL), 'interview section must NOT leak into a drafting-turn prompt');
});

// ---------------------------------------------------------------------------
// INSTRUCTIONS RUNNER — fail-loud end-to-end (AT-7)
// ---------------------------------------------------------------------------

test('AT-7: a fixture skill with no turn markers makes runInstructionsTurn THROW (never silently falls back to a generic prompt)', async () => {
  const fixturePath = writeFixture(
    'runner-no-markers',
    'skill.md',
    'A fixture instructions-creator skill with no per-turn sections at all.\n',
  );
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'drafting' });
  // A well-formed draft response — if the runner does NOT throw (today's
  // fail-open behaviour), the turn completes normally instead of rejecting,
  // which is exactly the wrong behaviour this AT pins against.
  const { queryFn } = capturingQueryFn({ agents_md: '# Fixture\n\nShould never be reached.' });

  await assert.rejects(
    () =>
      runInstructionsTurn({
        sessionId,
        projectRoot,
        logsRoot,
        queryFn,
        skillPromptPath: fixturePath,
        logger: logger(logsRoot, sessionId),
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('instructions-creator'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('draft'), `message should name the turn id, got: ${err.message}`);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// INSTRUCTIONS RUNNER — data half preserved, REAL production skill (AT-8)
// ---------------------------------------------------------------------------

test('AT-8: a drafting prompt (real production SKILL.md, no override) still carries the runner-injected DATA half', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setupSession({
    phase: 'drafting',
    project: 'skillturn-at8-demo',
    prompt: 'Focus the docs on the release checklist and the lint gate.',
  });
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'What must agents never touch?', answer: 'dist/ is generated' }] }]),
  );
  const { queryFn, prompts } = capturingQueryFn({ agents_md: '# Demo\n\nBuild: `npm run build`.' });

  const result = await runInstructionsTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queryFn,
    // NO skillPromptPath override — exercises the real skills/instructions-creator/SKILL.md.
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.equal(prompts.length, 1);
  const prompt = prompts[0];
  assert.match(prompt, /Project: skillturn-at8-demo/, 'project label + value');
  assert.match(prompt, new RegExp(`Project repo path: ${repoPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'repo path label + value');
  assert.match(prompt, /Focus the docs on the release checklist and the lint gate\./, "the operator's brief text");
  assert.match(prompt, /What must agents never touch\?/, 'prior interview question rendered');
  assert.match(prompt, /dist\/ is generated/, 'prior interview answer rendered');
});

// ---------------------------------------------------------------------------
// R2-AT-1 — a positional reference ("the existing AGENTS.md above") must
// resolve correctly now that the `## Existing <file>` data block sits AFTER
// the composed skill text in the prompt, not before it as in the
// pre-refactor prompt. Verbatim-moving "above" from the old prompt leaves it
// pointing the wrong direction (design doc: "Re-anchor positional
// references (mandatory)").
// ---------------------------------------------------------------------------

function writeExistingAgentsMd(repoPath: string): void {
  writeFileSync(join(repoPath, 'AGENTS.md'), '# Demo project\n\nBuild: `npm test`.\n');
}

test('R2-AT-1a: real production SKILL.md, edit mode, INTERVIEW turn — no "existing AGENTS.md above" phrase, and the "## Existing" data block comes AFTER the skill text', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setupSession({ phase: 'interviewing', mode: 'edit' });
  writeExistingAgentsMd(repoPath);
  const { queryFn, prompts } = capturingQueryFn({
    done: false,
    questions: [
      {
        question: 'Anything else operators should know?',
        header: 'Anything else',
        options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'e' }],
      },
    ],
  });

  await runInstructionsTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queryFn,
    // NO skillPromptPath override — exercises the real production skill.
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(prompts.length, 1, 'exactly one LLM call for the interview step');
  const prompt = prompts[0];
  assert.ok(
    !promptContains(prompt, 'existing AGENTS.md above'),
    'no instruction sentence may refer to the existing-AGENTS.md data block by a position ' +
      '("above") — the block now sits AFTER the composed skill text, not before it',
  );
  const skillTextIdx = prompt.indexOf('Your task this turn: the interview step');
  const dataBlockIdx = prompt.indexOf('## Existing AGENTS.md');
  assert.ok(skillTextIdx !== -1, 'the skill turn-section text must reach the prompt');
  assert.ok(
    dataBlockIdx !== -1,
    'the ## Existing edit-context data block must reach the prompt (real on-disk AGENTS.md was seeded)',
  );
  assert.ok(
    skillTextIdx < dataBlockIdx,
    `the skill text (index ${skillTextIdx}) must come BEFORE the ## Existing data block (index ${dataBlockIdx}) — proving "above" points the wrong way`,
  );
});

test('R2-AT-1b: real production SKILL.md, edit mode, DRAFT turn — no "existing AGENTS.md above" phrase, and the "## Existing" data block comes AFTER the skill text', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setupSession({ phase: 'drafting', mode: 'edit' });
  writeExistingAgentsMd(repoPath);
  const { queryFn, prompts } = capturingQueryFn({ agents_md: '# Demo project (revised)\n\nBuild: `npm test`.\n' });

  await runInstructionsTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(prompts.length, 1, 'exactly one LLM call for the draft step');
  const prompt = prompts[0];
  assert.ok(
    !promptContains(prompt, 'existing AGENTS.md above'),
    'no instruction sentence may refer to the existing-AGENTS.md data block by a position ' +
      '("above") — the block now sits AFTER the composed skill text, not before it',
  );
  const skillTextIdx = prompt.indexOf('Your task this turn: draft AGENTS.md');
  const dataBlockIdx = prompt.indexOf('## Existing AGENTS.md');
  assert.ok(skillTextIdx !== -1, 'the skill turn-section text must reach the prompt');
  assert.ok(
    dataBlockIdx !== -1,
    'the ## Existing edit-context data block must reach the prompt (real on-disk AGENTS.md was seeded)',
  );
  assert.ok(
    skillTextIdx < dataBlockIdx,
    `the skill text (index ${skillTextIdx}) must come BEFORE the ## Existing data block (index ${dataBlockIdx}) — proving "above" points the wrong way`,
  );
});

// ---------------------------------------------------------------------------
// R2-AT-3 — mode branches are SELECTED, not shown both at once. Today one
// turn section contains BOTH the edit- and init-mode instruction text, so
// every turn shows the agent the inapplicable branch too (before the
// refactor, the runner's TypeScript ternary selected exactly one). This AT
// does not dictate HOW the fix is achieved (separate turn ids vs. some other
// selection) — only that exactly one branch's text reaches the agent.
// ---------------------------------------------------------------------------

const EDIT_DRAFT_DISTINCTIVE = "REVISED to incorporate the operator's change-notes";
const INIT_DRAFT_DISTINCTIVE = 'the complete AGENTS.md content, ready to write verbatim to the repo root';
const EDIT_INTERVIEW_DISTINCTIVE = 'AskUserQuestion-shaped';
const INIT_INTERVIEW_DISTINCTIVE = 'high-leverage questions in the AskUserQuestion shape';

test("R2-AT-3a: an init-mode DRAFT turn prompt must not contain the edit-branch's distinctive sentence (real production SKILL.md)", async () => {
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'drafting', mode: 'init' });
  const { queryFn, prompts } = capturingQueryFn({ agents_md: '# Demo\n\nBuild: `npm test`.\n' });

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(prompts.length, 1);
  assert.ok(
    !promptContains(prompts[0], EDIT_DRAFT_DISTINCTIVE),
    'an init-mode draft turn must not show the agent the inapplicable edit-branch instructions',
  );
});

test("R2-AT-3b: an edit-mode DRAFT turn prompt must not contain the init-branch's distinctive sentence (real production SKILL.md)", async () => {
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'drafting', mode: 'edit' });
  const { queryFn, prompts } = capturingQueryFn({ agents_md: '# Demo\n\nBuild: `npm test`.\n' });

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(prompts.length, 1);
  assert.ok(
    !promptContains(prompts[0], INIT_DRAFT_DISTINCTIVE),
    'an edit-mode draft turn must not show the agent the inapplicable init-branch instructions',
  );
});

test("R2-AT-3c: an init-mode INTERVIEW turn prompt must not contain the edit-branch's distinctive sentence (real production SKILL.md)", async () => {
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'interviewing', mode: 'init' });
  const { queryFn, prompts } = capturingQueryFn({
    done: false,
    questions: [
      { question: 'What is off-limits?', header: 'Off-limits', options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'e' }] },
    ],
  });

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(prompts.length, 1);
  assert.ok(
    !promptContains(prompts[0], EDIT_INTERVIEW_DISTINCTIVE),
    'an init-mode interview turn must not show the agent the inapplicable edit-branch instructions',
  );
});

test("R2-AT-3d: an edit-mode INTERVIEW turn prompt must not contain the init-branch's distinctive sentence (real production SKILL.md)", async () => {
  const { projectRoot, logsRoot, sessionId } = setupSession({ phase: 'interviewing', mode: 'edit' });
  const { queryFn, prompts } = capturingQueryFn({
    done: false,
    questions: [
      { question: 'What is off-limits?', header: 'Off-limits', options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'e' }] },
    ],
  });

  await runInstructionsTurn({ sessionId, projectRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(prompts.length, 1);
  assert.ok(
    !promptContains(prompts[0], INIT_INTERVIEW_DISTINCTIVE),
    'an edit-mode interview turn must not show the agent the inapplicable init-branch instructions',
  );
});
