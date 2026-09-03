/**
 * Lane R4-23, WI-1 — ACCEPTANCE TESTS for the shared skill-turn-section
 * loader (`orchestrator/skill-path.ts`: `splitSkillTurnSections` +
 * `loadSkillTurnPrompt`) and its first consumer, the `instructions` kind
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
 *   AT-6  the instructions kind still concatenates the WHOLE skill file
 *         instead of selecting the `interview`/`draft` turn section — proven
 *         by a sentinel unique to the OTHER turn leaking into the prompt.
 *   AT-7  the instructions kind keeps (or reintroduces) a fail-open default
 *         prompt instead of propagating the loader's fail-loud throw.
 *   AT-8  the prose migration accidentally drops or renames a DATA label the
 *         runner injects (project, repo path, operator brief, prior Q&A) —
 *         green at base; it stays as a non-regression pin.
 *   AT-9  the instruction prose named here (see MOVED_SENTENCES below for its
 *         base-commit provenance) never actually leaves the .ts, or never
 *         actually lands in SKILL.md, i.e.
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
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

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
} from '@forge/sessions/kinds/instructions.ts';
import { writeSessionStatus, type QueryFn } from '@forge/sessions/interactive-session.ts';
import { createLogger } from '@forge/kernel';

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
/** Anchored on FORGE_ROOT, not a hand-counted `..` chain (COMMON §15.14). */
const INSTRUCTIONS_KIND_TS = join(FORGE_ROOT, 'packages', 'sessions', 'kinds', 'instructions.ts');

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
 * moves from the instructions kind into `skills/instructions-creator/SKILL.md`.
 * These are exact substrings copied from the instructions runner at base
 * commit `c45e3892` (then `orchestrator/instructions-runner.ts`, now
 * `packages/sessions/kinds/instructions.ts`), verified present there by grep
 * before this test was written.
 * (all three matched; see the WI-1 report for the exact commands run). Each
 * is a single, un-split JS string literal in the source today (no `+`
 * concatenation crosses the substring), so no source reconstruction is
 * needed on the .ts side — only whitespace-collapsing on the SKILL.md side,
 * where the mover is free to re-wrap the prose across markdown lines.
 */
const MOVED_SENTENCES = [
  'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the complete AGENTS.md content,',
  'Inspect the repo with your read tools, then decide whether you can write an',
  // T2 RULING (R4-23 round 2): this entry originally pinned
  // '...existing AGENTS.md ABOVE per the change-notes...'. That made AT-9 and
  // R2-AT-1a/b mutually unsatisfiable — R2-AT-1 forbids the stale positional
  // word "above" from reaching a live prompt, while this AT demanded the
  // sentence containing it be present in SKILL.md. The first implementer
  // "resolved" the contradiction by parking the superseded wording in a dead
  // `legacy-wording-archive` turn section no runner ever loads: prose added to
  // a shipped artifact purely to satisfy a grep. The AT was the defective
  // half, so it is corrected here — pin the clause that is INVARIANT under
  // re-anchoring (everything up to the positional word), not the positional
  // word itself. Recorded in the PR body.
  'You are UPDATING the existing AGENTS.md',
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

test('AT-9: the moved instruction prose has LEFT kinds/instructions.ts and now lives in SKILL.md (private loadSkillPrompt is gone)', () => {
  const runnerSrc = readFileSync(INSTRUCTIONS_KIND_TS, 'utf8');
  const skillMd = readFileSync(
    join(import.meta.dirname, '..', '..', 'skills', 'instructions-creator', 'SKILL.md'),
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

test('AT-10: no fail-open default-prompt literal remains in kinds/instructions.ts', () => {
  const runnerSrc = readFileSync(INSTRUCTIONS_KIND_TS, 'utf8');
  assert.ok(
    !runnerSrc.includes('You are the forge instructions-creator agent.'),
    'the fail-open fallback literal must be deleted — loadSkillTurnPrompt fails loud instead',
  );
});

// ===========================================================================
// ROUND 2 — adversarial-review-driven ATs (R2-AT-1..7). An adversarial review
// of the landed WI-1 commit (90cbc634) found real defects in the composed
// prompt and in the loader itself. These ATs are written BEFORE any fix
// lands (test-writer role, same as AT-1..10 above): an implementer may make
// them PASS by fixing the real defect described in each comment; it may NOT
// edit this file to make them pass.
// ===========================================================================

/**
 * Whitespace-tolerant phrase containment: `skills/instructions-creator/SKILL.md`
 * is hand-wrapped markdown prose, so a multi-word pinned phrase can straddle a
 * source line-wrap (e.g. "the existing\nAGENTS.md above" — a newline where a
 * plain-space regex would expect a single space). Reuses the file's existing
 * `collapseWhitespace` helper (defined below, hoisted) on BOTH sides so a pin
 * matches regardless of where the markdown happens to wrap.
 */
function promptContains(haystack: string, needle: string): boolean {
  return collapseWhitespace(haystack).toLowerCase().includes(collapseWhitespace(needle).toLowerCase());
}

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
// R2-AT-2 — no instruction content was silently dropped by the migration. A
// frozen list of every distinct instruction sentence the agent received
// BEFORE this refactor (base commit c45e3892), reconstructed from BOTH
// `skills/instructions-creator/SKILL.md` AND the two prompt-building arrays
// in `orchestrator/instructions-runner.ts` (interview + draft, both mode
// branches). Each entry must still be reachable in today's
// `skills/instructions-creator/SKILL.md` (whitespace-collapsed substring
// match) — either verbatim, or (where the mover deliberately generalised
// rather than kept the sentence verbatim) via a distinctive clause of it,
// noted inline. `## Turn shape` / `### Interview step` / `### Draft step`
// are section HEADERS, not instruction sentences, and are excluded — the
// content they introduced is covered by the sentences below (now under
// `<!-- turn: interview -->` / `<!-- turn: draft -->`). The unchanged
// preamble ("What AGENTS.md is for" bullets, the rest of "Read-only
// contract") is represented by two samples rather than exhaustively
// enumerated, since `git diff c45e3892 HEAD -- skills/instructions-creator/SKILL.md`
// shows ZERO diff hunks in that region — it is provably untouched, so
// per-bullet pins would only re-prove "identity is identity".
//
// Every entry below was verified against the base text with a throwaway
// whitespace-collapsed substring check before this test was written; only
// the "read manifests, CI config, ..." entry came back ABSENT from today's
// SKILL.md — that is the one real drop this AT pins.
//
// Reuses `collapseWhitespace` already defined above (AT-9's helper).
// ---------------------------------------------------------------------------

type FrozenSentence = { source: string; sentence: string; note?: string };

const FROZEN_SENTENCES_BASE_C45E3892: FrozenSentence[] = [
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence:
      'Decide whether you have enough to write a coherent, accurate AGENTS.md WITHOUT unresolved ' +
      'ambiguity about commands, conventions, or constraints.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence: 'read manifests, CI config, existing CLAUDE.md/AGENTS.md, a few source files',
    note:
      'GENUINELY DROPPED — the full base sentence was "First inspect the repo (read manifests, ' +
      'CI config, existing CLAUDE.md/AGENTS.md, a few source files)." This distinctive clause ' +
      '(WHAT to inspect) survives nowhere post-refactor: only the generic "Inspect the repo with ' +
      'your read tools, then decide..." sentence (sourced from instructions-runner.ts, see below) ' +
      'remains. This entry is EXPECTED TO FAIL right now — it is the pin for the review finding.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence:
      "Ask only what unblocks an accurate draft — things the code cannot tell you (intended " +
      "audience, what's off-limits, release conventions).",
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence: 'Stop as soon as more questions would only refine.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (interview step, base)',
    sentence: 'question, header ≤12 chars, 2–4 options each with label + description',
    note:
      'Base wraps this clause in "AskUserQuestion shape (...)"; today it reads "AskUserQuestion ' +
      'shape: ...". Re-wrapped, not reworded — pin the clause, not the wrapper punctuation.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md (draft step, base)',
    sentence: "Fold in the operator's interview answers and any resolved revision feedback.",
  },
  {
    source: 'skills/instructions-creator/SKILL.md (draft step, base)',
    sentence: "Lead with the project's purpose; keep every command copied-accurate; keep it tight.",
  },
  {
    source: 'skills/instructions-creator/SKILL.md (draft step, base — no composed_seed_ids field yet)',
    sentence: 'the complete AGENTS.md content, ready to write verbatim to the repo root.',
    note:
      "Base SKILL.md's Return-shape lacked composed_seed_ids (that field lived only in the " +
      'runner .ts at base — see the init-draft-branch entry below); pin the clause the two ' +
      'versions share rather than either exact "Return {...}" literal.',
  },
  {
    source: 'skills/instructions-creator/SKILL.md ("## Turn shape" framing, base)',
    sentence: 'and the interview so far',
    note:
      "Base: \"Each turn the runner gives you the project, the operator's brief, and the " +
      'interview so far, and asks you for ONE of two structured outputs:". The data-block framing ' +
      "sentence was deliberately reworded (it now also explains the Mode: line) — pin the clause " +
      'common to both rather than the whole sentence.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runInterviewStep, edit-mode branch, base)',
    // T2 RULING (R4-23 round 2): split around the positional word "above",
    // which R2-AT-1a/b legitimately forbids from reaching a live prompt (the
    // `## Existing AGENTS.md` data block it referred to is now BELOW the skill
    // text, not above it). Pinning the whole original sentence would have made
    // the two ATs mutually unsatisfiable and forced dead prose into the shipped
    // SKILL.md. Both halves of the instruction are still pinned — only the
    // stale positional word is released. Recorded in the PR body.
    sentence: 'You are UPDATING the existing AGENTS.md',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runInterviewStep, edit-mode branch, base) — second half',
    sentence:
      'per the change-notes. You can usually ' +
      'proceed without questions — return `{ "done": true }`. Only return ' +
      '`{ "done": false, "questions": [...] }` (1-4 AskUserQuestion-shaped) if a note is genuinely ambiguous.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runInterviewStep, init-mode branch, base)',
    sentence:
      'Inspect the repo with your read tools, then decide whether you can write an accurate ' +
      'AGENTS.md without unresolved ambiguity. If yes, return `{ "done": true }`. Otherwise ' +
      'return `{ "done": false, "questions": [...] }` with 1-4 high-leverage questions in the AskUserQuestion shape.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runDraftStep, edit-mode branch, base)',
    // T2 RULING (R4-23 round 2): split around the positional word "above" —
    // same reasoning as the interview edit-mode entry above.
    sentence:
      'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the existing ' +
      'AGENTS.md',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runDraftStep, edit-mode branch, base) — second half',
    sentence:
      ", REVISED to incorporate the operator's change-notes. Preserve everything " +
      'they did not ask to change; keep commands copy-accurate; keep it tight. List any seed ids ' +
      'you composed from in composed_seed_ids.',
  },
  {
    source: 'orchestrator/instructions-runner.ts (runDraftStep, init-mode branch, base)',
    sentence:
      'Return `{ "agents_md": "<full markdown>", "composed_seed_ids": [...] }` — the complete ' +
      'AGENTS.md content, ready to write verbatim to the repo root. Keep commands copy-accurate; ' +
      'keep it tight. List any seed ids you composed from in composed_seed_ids ([] if none applied).',
  },
  {
    source:
      'skills/instructions-creator/SKILL.md (unchanged preamble sample 1 — proves the untouched region is still covered)',
    sentence:
      "Author the project's **AGENTS.md** — the single source of agent instructions for a " +
      'managed project — the way `claude init` does: explore the real code, ask the operator ' +
      'what only they can answer, draft, and let them confirm or revise before anything is written.',
  },
  {
    source:
      'skills/instructions-creator/SKILL.md (unchanged preamble sample 2 — proves the untouched region is still covered)',
    sentence: 'You have read tools only (Read, Grep, Glob, Bash). You never write files.',
  },
];

test("R2-AT-2: every distinct pre-refactor instruction sentence (SKILL.md + both instructions-runner.ts prompt arrays, base c45e3892) is still reachable in today's SKILL.md", () => {
  const skillMd = readFileSync(
    join(import.meta.dirname, '..', '..', 'skills', 'instructions-creator', 'SKILL.md'),
    'utf8',
  );
  const collapsedSkillMd = collapseWhitespace(skillMd);

  const missing = FROZEN_SENTENCES_BASE_C45E3892.filter(
    ({ sentence }) => !collapsedSkillMd.includes(collapseWhitespace(sentence)),
  );

  assert.deepEqual(
    missing.map((m) => `[${m.source}] "${m.sentence}"${m.note ? ` — ${m.note}` : ''}`),
    [],
    'every pre-refactor instruction sentence/clause must still be reachable in SKILL.md; the ' +
      'array above (if non-empty) names exactly what was silently dropped',
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

// ---------------------------------------------------------------------------
// R2-AT-4 — a duplicate turn id must be refused, not silently last-write-wins
// (today `splitSkillTurnSections` does `turns.set(id, ...)`, so a repeated
// `<!-- turn: draft -->` silently drops the first section).
// ---------------------------------------------------------------------------

test('R2-AT-4: splitSkillTurnSections THROWS on a document with two sections carrying the same turn id, naming the duplicated id', () => {
  const doc = [
    'Base preamble.',
    '',
    '<!-- turn: draft -->',
    'First draft body.',
    '',
    '<!-- turn: draft -->',
    'Second draft body (duplicate id — must be refused, not last-write-wins).',
    '',
  ].join('\n');

  assert.throws(
    () => skillPathMod.splitSkillTurnSections(doc),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('draft'),
        `message should name the duplicated turn id "draft", got: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// R2-AT-5 — a marker DOCUMENTED inside a fenced code block is not a real
// section boundary.
// ---------------------------------------------------------------------------

test('R2-AT-5: a <!-- turn: ... --> marker written inside a fenced code block (documenting the syntax) is not treated as a real section boundary', () => {
  const doc = [
    'Base preamble.',
    '',
    'The turn-marker syntax looks like this:',
    '```md',
    '<!-- turn: example -->',
    '## Some turn',
    '```',
    '',
    'End of base preamble sentinel: BASE_TAIL_af03c1',
  ].join('\n');

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 0, 'the fenced-block marker must not be parsed as a real turn boundary');
  assert.equal(base, doc, 'the fenced block stays inside base verbatim, byte-for-byte');
});

// ---------------------------------------------------------------------------
// R2-AT-6 — a malformed marker id is diagnosable: the thrown message must
// mention the near-miss marker line, not just report "no turns available"
// while a marker is visibly present two lines away.
// ---------------------------------------------------------------------------

test('R2-AT-6a: an uppercase near-miss marker ("<!-- turn: Interview -->") is named in the fail-loud message', () => {
  const path = writeFixture(
    'at-r2-6a',
    'skill.md',
    [
      'Base preamble.',
      '',
      '<!-- turn: Interview -->',
      '## Interview (uppercase id — does not match the marker id shape)',
      'Interview body.',
      '',
    ].join('\n'),
  );

  assert.throws(
    () => skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'interview', skillPromptPath: path }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('<!-- turn: Interview -->'),
        `message should mention the malformed marker line, not just say no turns are available ` +
          `while one visibly sits two lines away, got: ${err.message}`,
      );
      return true;
    },
  );
});

test('R2-AT-6b: an underscore near-miss marker ("<!-- turn: interview_step -->") is named in the fail-loud message', () => {
  const path = writeFixture(
    'at-r2-6b',
    'skill.md',
    [
      'Base preamble.',
      '',
      '<!-- turn: interview_step -->',
      '## Interview step (underscore id — does not match the marker id shape)',
      'Interview body.',
      '',
    ].join('\n'),
  );

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'interview-step', skillPromptPath: path }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('<!-- turn: interview_step -->'),
        `message should mention the malformed marker line, not just say no turns are available ` +
          `while one visibly sits two lines away, got: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// R2-AT-7 — CRLF input must split correctly with no stray `\r` left behind.
// ---------------------------------------------------------------------------

test('R2-AT-7: a CRLF-line-ended SKILL.md splits correctly with no stray \\r left in base or any section body', () => {
  const doc = [
    'Base preamble line one.',
    'Base preamble line two.',
    '',
    '<!-- turn: draft -->',
    '## Draft turn',
    'Draft body line.',
    '',
  ].join('\r\n');

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 1, 'the CRLF-ended marker line must still be recognised as a turn boundary');
  assert.ok(turns.has('draft'));
  assert.match(base, /Base preamble line one\./);
  assert.doesNotMatch(base, /\r/, 'no stray \\r characters may remain in base');
  const draftSection = turns.get('draft')!;
  assert.match(draftSection, /Draft body line\./);
  assert.doesNotMatch(draftSection, /\r/, 'no stray \\r characters may remain in the section body');
});
