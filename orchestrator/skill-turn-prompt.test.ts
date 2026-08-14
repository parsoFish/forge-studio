/**
 * Lane R4-23, WI-1 — ACCEPTANCE TESTS for the shared skill-turn-section
 * loader (`orchestrator/skill-path.ts`: `splitSkillTurnSections` +
 * `loadSkillTurnPrompt`) and its first consumer, `instructions-runner.ts`
 * (turns: `interview`, `draft`).
 *
 * These are IMMUTABLE acceptance tests written BEFORE the WI-1 implementation
 * lands (test-writer role). An implementer may make the assertions PASS by
 * building the feature the design doc (`R4-23-design.md`) describes — it may
 * NOT edit this file to make them pass. If an AT looks wrong once real
 * implementation work starts, that is a signal to go back to the lane
 * designer, not to loosen the assertion here.
 *
 * What each AT kills (a wrong or missing implementation this AT would catch):
 *
 *   AT-1  splitSkillTurnSections doesn't exist, or exists but leaks marker
 *         lines into `base`/section bodies, or bleeds one section's content
 *         into another (no isolation between sections).
 *   AT-2  splitSkillTurnSections mis-parses a marker-less doc as having
 *         sections (e.g. treats the whole doc as one anonymous "section").
 *   AT-3  loadSkillTurnPrompt concatenates ALL sections instead of selecting
 *         just the requested one (the exact bug this lane's own runners have
 *         today, one level up, via string concatenation of the whole file).
 *   AT-4  loadSkillTurnPrompt fails OPEN (returns a generic fallback string)
 *         on an unreadable file, a marker-less file, or an unknown turn id,
 *         instead of throwing loudly with skill/turn-id/available-ids in the
 *         message — the "declared-data-fails-open" antipattern the design
 *         doc explicitly calls out as unacceptable post-migration.
 *   AT-5  a cache keyed only by skill `name` (ignoring the explicit
 *         `skillPromptPath` override) would serve fixture A's content back
 *         for fixture B's read — breaking every runner test's DI seam.
 *   AT-6  instructions-runner.ts still concatenates the WHOLE skill file
 *         instead of selecting the `interview`/`draft` turn section — proven
 *         by a sentinel unique to the OTHER turn leaking into the prompt.
 *   AT-7  instructions-runner.ts keeps (or reintroduces) a fail-open default
 *         prompt instead of propagating the loader's fail-loud throw.
 *   AT-8  the prose migration accidentally drops or renames a DATA label the
 *         runner injects (project, repo path, operator brief, prior Q&A) —
 *         this AT is expected to be GREEN already at base (see the base run
 *         notes in the WI-1 report); it stays green as a non-regression pin.
 *   AT-9  the instruction prose named here (verified present in
 *         instructions-runner.ts at base by direct grep before this file was
 *         written — see the inline note on MOVED_SENTENCES below) never
 *         actually leaves the .ts, or never actually lands in SKILL.md, i.e.
 *         intent stays duplicated/forked instead of SKILL.md becoming the
 *         single source (the ADR-024 thesis this whole lane exists to prove).
 *   AT-10 the private `loadSkillPrompt`'s fail-open literal
 *         ("You are the forge instructions-creator agent.") survives the
 *         migration — a silent no-task agent run with no signal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Namespace import (not a named import of the two new exports): at base,
// `splitSkillTurnSections`/`loadSkillTurnPrompt` do not exist yet. A named
// `import { splitSkillTurnSections } from './skill-path.ts'` would fail
// MODULE INSTANTIATION for the whole file (an ESM "does not provide an
// export named" SyntaxError), which would hide every OTHER AT's true
// red/green state behind one shared load failure. The namespace import
// always succeeds; the missing properties just read as `undefined`, so each
// AT below fails (or passes) on its own, individually diagnosable, footing.
import * as skillPathMod from './skill-path.ts';

import {
  runInstructionsTurn,
  instructionsSessionDir,
  type InstructionsStatus,
} from './instructions-runner.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from './logging.ts';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/** Write `content` to a fresh tmpdir under `<name>` and return the file path. */
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

// ---------------------------------------------------------------------------
// LOADER — pure `splitSkillTurnSections` (AT-1, AT-2)
// ---------------------------------------------------------------------------

test('AT-1: splitSkillTurnSections splits base + N named sections; marker lines never appear in base or any section, and sections do not bleed into each other', () => {
  const doc = [
    '---',
    'name: fixture',
    '---',
    '',
    'Shared preamble line one.',
    'Shared preamble line two.',
    '',
    '<!-- turn: alpha -->',
    '## Alpha turn',
    'Alpha body line.',
    '',
    '<!-- turn: beta -->',
    '## Beta turn',
    'Beta body line.',
    '',
  ].join('\n');

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 2, 'exactly the two declared sections');
  assert.ok(turns.has('alpha') && turns.has('beta'));

  // base excludes both sections.
  assert.match(base, /Shared preamble line one\./);
  assert.doesNotMatch(base, /Alpha turn/);
  assert.doesNotMatch(base, /Alpha body line\./);
  assert.doesNotMatch(base, /Beta turn/);
  assert.doesNotMatch(base, /Beta body line\./);

  // each section carries only its own content.
  const alpha = turns.get('alpha')!;
  const beta = turns.get('beta')!;
  assert.match(alpha, /Alpha body line\./);
  assert.doesNotMatch(alpha, /Beta turn/);
  assert.doesNotMatch(alpha, /Beta body line\./);
  assert.match(beta, /Beta body line\./);
  assert.doesNotMatch(beta, /Alpha turn/);
  assert.doesNotMatch(beta, /Alpha body line\./);

  // marker lines themselves are stripped everywhere.
  for (const chunk of [base, alpha, beta]) {
    assert.doesNotMatch(chunk, /<!--\s*turn:/);
  }
});

test('AT-2: a doc with no <!-- turn: --> marker yields an empty turns map (base = the whole doc)', () => {
  const doc = 'Just a plain skill doc with no per-turn sections at all.\n\nSecond paragraph.\n';

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 0, 'no markers ⇒ no sections');
  assert.equal(base, doc, 'the whole doc is the base when there is nothing to split off');
  // loadSkillTurnPrompt against a marker-less doc must then THROW — see AT-4b.
});

// ---------------------------------------------------------------------------
// LOADER — `loadSkillTurnPrompt` selection + fail-loud contract (AT-3, AT-4, AT-5)
// ---------------------------------------------------------------------------

test('AT-3: loadSkillTurnPrompt returns base + ONLY the requested turn section (a sentinel unique to the OTHER section is absent)', () => {
  const SECTION_A_SENTINEL = 'SECTION_A_ONLY_c19f83';
  const SECTION_B_SENTINEL = 'SECTION_B_ONLY_e02a71';
  const path = writeFixture(
    'at3',
    'skill.md',
    [
      'Base preamble sentinel: BASE_ONLY_11ab22',
      '',
      '<!-- turn: section-a -->',
      SECTION_A_SENTINEL,
      '',
      '<!-- turn: section-b -->',
      SECTION_B_SENTINEL,
      '',
    ].join('\n'),
  );

  const prompt = skillPathMod.loadSkillTurnPrompt({
    name: 'fixture-skill',
    turnId: 'section-a',
    skillPromptPath: path,
  });

  assert.match(prompt, /BASE_ONLY_11ab22/, 'base preamble is always included');
  assert.match(prompt, new RegExp(SECTION_A_SENTINEL), 'the requested section is included');
  assert.doesNotMatch(prompt, new RegExp(SECTION_B_SENTINEL), 'the OTHER section must not leak in');
  assert.doesNotMatch(prompt, /<!--\s*turn:/, 'marker lines are stripped from the composed prompt');
});

test('AT-4a: loadSkillTurnPrompt throws fail-loud on an unreadable skillPromptPath (names skill + turn id)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-turn-at4a-'));
  const missingPath = join(dir, 'does-not-exist.md');

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({
        name: 'fixture-skill',
        turnId: 'interview',
        skillPromptPath: missingPath,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('fixture-skill'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('interview'), `message should name the turn id, got: ${err.message}`);
      return true;
    },
  );
});

test('AT-4b: loadSkillTurnPrompt throws fail-loud on a doc with no turn sections (names skill + turn id)', () => {
  const path = writeFixture('at4b', 'skill.md', 'Prose with no turn markers whatsoever.\n');

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({
        name: 'fixture-skill',
        turnId: 'interview',
        skillPromptPath: path,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('fixture-skill'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('interview'), `message should name the turn id, got: ${err.message}`);
      return true;
    },
  );
});

test('AT-4c: loadSkillTurnPrompt throws fail-loud on an unknown turn id (names skill + turn id + available ids)', () => {
  const path = writeFixture(
    'at4c',
    'skill.md',
    ['Base.', '', '<!-- turn: interview -->', 'Interview body.', '', '<!-- turn: draft -->', 'Draft body.', ''].join(
      '\n',
    ),
  );

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({
        name: 'fixture-skill',
        turnId: 'nonexistent-turn',
        skillPromptPath: path,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('fixture-skill'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('nonexistent-turn'), `message should name the requested turn id, got: ${err.message}`);
      assert.ok(msg.includes('interview'), `message should list "interview" as available, got: ${err.message}`);
      assert.ok(msg.includes('draft'), `message should list "draft" as available, got: ${err.message}`);
      return true;
    },
  );
});

test('AT-5: an explicit skillPromptPath is never served from a default-path cache — two fixtures read in sequence each return their own content', () => {
  const pathA = writeFixture('at5a', 'skill.md', ['<!-- turn: only -->', 'SENTINEL_A_9f01c3'].join('\n'));
  const pathB = writeFixture('at5b', 'skill.md', ['<!-- turn: only -->', 'SENTINEL_B_2ee784'].join('\n'));

  const first = skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'only', skillPromptPath: pathA });
  const second = skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'only', skillPromptPath: pathB });

  assert.match(first, /SENTINEL_A_9f01c3/);
  assert.doesNotMatch(first, /SENTINEL_B_2ee784/);
  assert.match(second, /SENTINEL_B_2ee784/, 'the second read must reflect fixture B, not a cached fixture A');
  assert.doesNotMatch(second, /SENTINEL_A_9f01c3/);
});

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
// GREP-ASSERT — prose left the .ts and now lives in SKILL.md (AT-9, AT-10)
// ---------------------------------------------------------------------------

/**
 * At least 3 distinctive instruction sentences the design doc's mechanism
 * moves from `instructions-runner.ts` into `skills/instructions-creator/SKILL.md`.
 * These are exact substrings copied from `orchestrator/instructions-runner.ts`
 * at base commit `c45e3892` — VERIFIED present there before this test was
 * written via:
 *   grep -n 'Return `{ "agents_md": ...' orchestrator/instructions-runner.ts   → line 420
 *   grep -n 'Inspect the repo with your read tools, ...'                      → line 347
 *   grep -n 'You are UPDATING the existing AGENTS.md ...'                     → line 344
 * (all three matched; see the WI-1 report for the exact commands run). Each
 * is a single, un-split JS string literal in the source today (no `+`
 * concatenation crosses the substring), so no source reconstruction is
 * needed on the .ts side — only whitespace-collapsing on the SKILL.md side,
 * where the mover is free to re-wrap the prose across markdown lines.
 */
const MOVED_SENTENCES = [
  'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the complete AGENTS.md content,',
  'Inspect the repo with your read tools, then decide whether you can write an',
  'You are UPDATING the existing AGENTS.md above per the change-notes. You can usually',
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

test('AT-9: the moved instruction prose has LEFT instructions-runner.ts and now lives in SKILL.md (private loadSkillPrompt is gone)', () => {
  const runnerSrc = readFileSync(join(import.meta.dirname, 'instructions-runner.ts'), 'utf8');
  const skillMd = readFileSync(
    join(import.meta.dirname, '..', 'skills', 'instructions-creator', 'SKILL.md'),
    'utf8',
  );
  const collapsedRunner = collapseWhitespace(runnerSrc);
  const collapsedSkillMd = collapseWhitespace(skillMd);

  for (const sentence of MOVED_SENTENCES) {
    const needle = collapseWhitespace(sentence);
    assert.ok(
      !collapsedRunner.includes(needle),
      `expected this instruction sentence to have LEFT instructions-runner.ts: "${sentence}"`,
    );
    assert.ok(
      collapsedSkillMd.includes(needle),
      `expected this instruction sentence to now live in SKILL.md: "${sentence}"`,
    );
  }

  assert.ok(
    !runnerSrc.includes('loadSkillPrompt'),
    'the private loadSkillPrompt helper (and every call to it) must be gone from instructions-runner.ts',
  );
});

test('AT-10: no fail-open default-prompt literal remains in instructions-runner.ts', () => {
  const runnerSrc = readFileSync(join(import.meta.dirname, 'instructions-runner.ts'), 'utf8');
  assert.ok(
    !runnerSrc.includes('You are the forge instructions-creator agent.'),
    'the fail-open fallback literal must be deleted — loadSkillTurnPrompt fails loud instead',
  );
});
