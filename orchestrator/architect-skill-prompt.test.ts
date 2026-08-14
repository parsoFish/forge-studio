/**
 * Acceptance tests for R4-23 WI-4 — re-authoring the architect runner's three
 * prompts (interview / explore / draft, + the draft-force-emit retry) so
 * instruction PROSE moves out of `orchestrator/architect-runner.ts` and into
 * named `<!-- turn: ... -->` sections of `skills/architect/SKILL.md`, while
 * the runner keeps injecting only DATA + control flow (lane design:
 * `_wave5/parks/R4-23-design.md` and the WI-4 brief).
 *
 * `_wave5/parks/R4-22-F4-architect-migration.md` §2 catalogued four
 * architect-specific hazards a naive migration could silently drop. This
 * file pins all four so a re-authoring PR that breaks any of them fails a
 * test, not a code-review skim:
 *
 *   1. §2a brain-first injection (ADR-010) — the brain-navigation-index
 *      block must stay FIRST, composed in TS, with its per-phase framing
 *      sentence intact, in ALL THREE prompts.               → AT-5
 *   2. §2b fail-open `exploring` — an explore-stage crash must be swallowed
 *      and the session must still advance to drafting.       → AT-6
 *   3. §2c forced-emit retry — an empty first draft must trigger exactly one
 *      retry whose prompt is the original PLUS an appended instruction, not
 *      a rebuilt prompt; still-empty must throw the named error.  → AT-7
 *   4. §2e the local `runStructured`'s `brainReads` narrowing (only `brain/`
 *      paths survive into `brain_context`) — the un-fixtured silent-drop
 *      risk the park file calls out.                          → AT-8
 *
 * AT-1..AT-4 are the per-WI acceptance shape from the lane design (grep the
 * prose out of the .ts, prove SKILL.md turn selection is loaded AND used,
 * prove a marker-less/missing-turn fixture fails loud). AT-5..AT-8 are the
 * HAZARD PINS above — they assert behaviour that must NOT change and are
 * therefore expected to be GREEN already, at base, before any re-authoring
 * lands; AT-1..AT-4 assert the NEW mechanism and are expected to be RED at
 * base. ALL EIGHT are immutable acceptance tests for WI-4 — do not weaken
 * an assertion to make the suite pass; fix the implementation instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runArchitectTurn,
  writeStatus,
  type ArchitectStatus,
  type QueryFn,
} from './architect-runner.ts';
import { createLogger } from './logging.ts';

const HERE = import.meta.dirname;
const ARCHITECT_RUNNER_TS = join(HERE, 'architect-runner.ts');
const ARCHITECT_SKILL_MD = join(HERE, '..', 'skills', 'architect', 'SKILL.md');

// ---------------------------------------------------------------------------
// Shared test harness — mirrors architect-runner.test.ts's setupSession/logger
// idiom exactly (SEC-04: project_repo_path must be genuinely contained under
// <forgeRoot>/projects/, matching production's `join(ctx.projectsRoot, ...)`).
// ---------------------------------------------------------------------------

function setupSession(overrides?: Partial<ArchitectStatus>): {
  projectRoot: string;
  logsRoot: string;
  queueRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'arch-skillprompt-'));
  const projectRoot = join(root, 'projects', 'project');
  const logsRoot = join(root, '_logs');
  const queueRoot = join(root, '_queue');
  const sessionId = '2026-05-29T10-00-00';
  const sessionDir = join(projectRoot, '_architect', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: ArchitectStatus = {
    session_id: sessionId,
    project: 'demo',
    project_repo_path: projectRoot,
    phase: 'interviewing',
    round: 1,
    idea: 'Add a dark-mode toggle to the settings page.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeStatus(sessionDir, status);
  return { projectRoot, logsRoot, queueRoot, sessionId, sessionDir };
}

function logger(logsRoot: string, sessionId: string) {
  return createLogger(`_architect-${sessionId}`, logsRoot);
}

/** A valid draft response with exactly one initiative — used everywhere a
 *  test needs the draft step to succeed without triggering the forced-emit
 *  retry (that retry has its own dedicated AT). */
function validDraftOutput(): unknown {
  return {
    vision: 'v',
    initiatives: [
      { slug: 'x', title: 'X', iteration_budget: 2, cost_budget_usd: 3, body: 'Given a, when b, then c.' },
    ],
  };
}

/** A valid explore-step response (non-empty, passes runExploreStep's item
 *  validation) — used where a test needs exploring to succeed normally. */
function validExploreOutput(): unknown {
  return {
    edgeCases: [{ title: 't', detail: 'd', disposition: 'covered' }],
    brainConstraints: [{ constraint: 'c', source: 's' }],
    exploreSummary: 'sum',
  };
}

/**
 * A queryFn that returns `responses[callIndex]` (by CALL ORDER, not by
 * sniffing prompt content) — deliberately implementation-agnostic. The
 * hazard-pin ATs (5-8) rely on the FIXED CONTROL-FLOW ORDER the park file
 * documents (interview | exploring-then-drafting | drafting), not on prose
 * text that this very lane is moving around, so they must not key off
 * strings like "the exploration step" that could legitimately relocate to
 * SKILL.md.
 */
function makeOrderedQueryFn(responses: unknown[]): { queryFn: QueryFn; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  const queryFn: QueryFn = ({ prompt }) => {
    prompts.push(prompt);
    const structured = i < responses.length ? responses[i] : null;
    i += 1;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };
  return { queryFn, prompts };
}

// ---------------------------------------------------------------------------
// AT-1 — prose left the TS, landed in SKILL.md (grep-assert)
// ---------------------------------------------------------------------------

/** Whitespace/quote/concatenation-normalise both sides: today's runner
 *  prose is built as multi-line `'...' + '...'` string concatenations, so a
 *  byte-exact substring search across the raw .ts text would miss it. */
function normalizeProse(text: string): string {
  return text
    .replace(/[`'"]/g, '')
    .replace(/\s*\+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('AT-1 (prose-left-the-TS): 5 distinctive instruction sentences — covering all 4 turns — are absent from architect-runner.ts and present in SKILL.md', () => {
  const runnerSrc = readFileSync(ARCHITECT_RUNNER_TS, 'utf8');
  const skillMd = readFileSync(ARCHITECT_SKILL_MD, 'utf8');
  const normRunner = normalizeProse(runnerSrc);
  const normSkill = normalizeProse(skillMd);

  // Each sentence verified present in architect-runner.ts BEFORE this lane by
  // direct grep (line numbers as of base commit c45e3892):
  //   interview             L547  "Decide whether you have enough to draft a coherent, releasable initiative"
  //   explore               L688  "Before drafting, ENUMERATE what could break or be forgotten"
  //   draft                 L867  "Produce one or more coherent, releasable initiatives"
  //   draft (build order)   L874  "If a later initiative would fail without an earlier one merged first"
  //   draft-force-emit      L925  "You have already done enough research (this turn and the interview rounds). Do NOT call any more tools."
  const movedSentences: Array<{ turn: string; sentence: string }> = [
    { turn: 'interview', sentence: 'Decide whether you have enough to draft a coherent, releasable initiative' },
    { turn: 'explore', sentence: 'Before drafting, ENUMERATE what could break or be forgotten' },
    { turn: 'draft', sentence: 'Produce one or more coherent, releasable initiatives' },
    { turn: 'draft (build order)', sentence: 'If a later initiative would fail without an earlier one merged first' },
    {
      turn: 'draft-force-emit',
      sentence: 'You have already done enough research (this turn and the interview rounds). Do NOT call any more tools.',
    },
  ];

  for (const { turn, sentence } of movedSentences) {
    const norm = normalizeProse(sentence);
    assert.ok(
      !normRunner.includes(norm),
      `[${turn}] instruction prose must have been DELETED from architect-runner.ts (still found there): "${sentence}"`,
    );
    assert.ok(
      normSkill.includes(norm),
      `[${turn}] instruction prose must live in skills/architect/SKILL.md (not found there): "${sentence}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// AT-2 — no fail-open remains
// ---------------------------------------------------------------------------

test('AT-2 (no-fail-open-remains): architect-runner.ts deletes the "You are the forge architect." fallback and its private loadSkillPrompt', () => {
  const runnerSrc = readFileSync(ARCHITECT_RUNNER_TS, 'utf8');
  assert.ok(
    !runnerSrc.includes('You are the forge architect.'),
    'the fail-open fallback prompt string must be deleted — after this lane the task instructions live ' +
      'in SKILL.md, so a fail-open silently ships an agent with NO task at all (the declared-data-fails-open antipattern)',
  );
  assert.ok(
    !/function\s+loadSkillPrompt\s*\(/.test(runnerSrc),
    'the private loadSkillPrompt helper must be deleted — every runner routes through the shared, ' +
      'fail-LOUD loadSkillTurnPrompt (orchestrator/skill-path.ts) with no caller-local fallback',
  );
});

// ---------------------------------------------------------------------------
// AT-3 — loaded AND used, with correct per-turn selection
// ---------------------------------------------------------------------------

function buildFixtureSkill(sentinels: {
  base: string;
  interview: string;
  explore: string;
  draft: string;
  forceEmit: string;
}): string {
  return [
    `# Fixture architect skill ${sentinels.base}`,
    '',
    '<!-- turn: interview -->',
    `## interview turn ${sentinels.interview}`,
    '',
    '<!-- turn: explore -->',
    `## explore turn ${sentinels.explore}`,
    '',
    '<!-- turn: draft -->',
    `## draft turn ${sentinels.draft}`,
    '',
    '<!-- turn: draft-force-emit -->',
    `## draft-force-emit turn ${sentinels.forceEmit}`,
    '',
  ].join('\n');
}

test('AT-3 (loaded-AND-USED + per-turn selection): the interview prompt carries ONLY the interview section sentinel; the draft prompt carries ONLY the draft section sentinel', async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'arch-skill-fixture-'));
  const skillPromptPath = join(fixtureDir, 'SKILL.md');
  const S = {
    base: 'SENTINEL_BASE_9f2c',
    interview: 'SENTINEL_INTERVIEW_a11c',
    explore: 'SENTINEL_EXPLORE_b22d',
    draft: 'SENTINEL_DRAFT_c33e',
    forceEmit: 'SENTINEL_FORCEEMIT_d44f',
  };
  writeFileSync(skillPromptPath, buildFixtureSkill(S));

  // --- interviewing turn: one done:false round, the cheapest interview call ---
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'interviewing' });
    const { queryFn, prompts } = makeOrderedQueryFn([
      { done: false, questions: [{ question: 'Q?', header: 'hdr', options: [{ label: 'A', description: 'a' }] }] },
    ]);
    await runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn, skillPromptPath,
      logger: logger(logsRoot, sessionId),
    });
    const prompt = prompts[0];
    assert.ok(prompt.includes(S.interview), 'interview turn prompt must carry the interview section sentinel');
    assert.ok(!prompt.includes(S.explore), 'interview turn prompt must NOT carry the explore section sentinel');
    assert.ok(!prompt.includes(S.draft), 'interview turn prompt must NOT carry the draft section sentinel');
    assert.ok(!prompt.includes(S.forceEmit), 'interview turn prompt must NOT carry the draft-force-emit section sentinel');
  }

  // --- drafting turn: status.phase already 'drafting' — one draft call ---
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'drafting' });
    const { queryFn, prompts } = makeOrderedQueryFn([validDraftOutput()]);
    await runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn, skillPromptPath,
      logger: logger(logsRoot, sessionId),
    });
    const prompt = prompts[0];
    assert.ok(prompt.includes(S.draft), 'draft turn prompt must carry the draft section sentinel');
    assert.ok(!prompt.includes(S.interview), 'draft turn prompt must NOT carry the interview section sentinel');
    assert.ok(!prompt.includes(S.explore), 'draft turn prompt must NOT carry the explore section sentinel');
    assert.ok(
      !prompt.includes(S.forceEmit),
      'draft turn prompt must NOT carry the draft-force-emit section sentinel (that only applies to the retry)',
    );
  }
});

// ---------------------------------------------------------------------------
// AT-4 — fail loud
// ---------------------------------------------------------------------------

test('AT-4 (fail-loud): a marker-less skill fixture makes the turn THROW, naming the skill and the turn id', async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'arch-skill-nomarker-'));
  const skillPromptPath = join(fixtureDir, 'SKILL.md');
  writeFileSync(skillPromptPath, '# No turn markers here\n\nJust prose, no `<!-- turn: ... -->` sections.\n');

  const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'interviewing' });
  // done:false (with a question) returns right after the ONE interview call
  // (the cheapest interview scenario) — done:true would fall through into
  // exploring/drafting in the SAME call and confound this AT with the
  // unrelated "no initiatives" error once those later calls also see no
  // structured output, rather than isolating the interview turn's own
  // loader failure.
  const { queryFn } = makeOrderedQueryFn([
    { done: false, questions: [{ question: 'Q?', header: 'hdr', options: [{ label: 'A', description: 'a' }] }] },
  ]);

  await assert.rejects(
    () => runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn, skillPromptPath,
      logger: logger(logsRoot, sessionId),
    }),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an Error, not resolve with a silent default prompt');
      assert.match(err.message, /architect/i, 'error message must name the skill ("architect")');
      assert.match(err.message, /interview/i, 'error message must name the turn id ("interview")');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// AT-5 — HAZARD PIN: ADR-010 brain-first injection survives (park §2a)
// ---------------------------------------------------------------------------

const FRAMING_INTERVIEW =
  'Read relevant brain theme files listed below before answering. Your first tool calls must be Read against brain/ paths.';
const FRAMING_EXPLORE =
  'Read the relevant brain theme files below FIRST — a brain-sourced constraint you surface here must cite its theme path as `source`.';
const FRAMING_DRAFT =
  "Read relevant Brain 2 (brain/cycles/) and Brain 3 (projects/<project>/brain/) theme files listed below as your FIRST action. Record the paths you consulted — they surface in the PLAN's Brain context section.";

test('AT-5 (HAZARD PIN — ADR-010 brain-first injection survives): the brain-navigation-index block is FIRST, carries its per-phase framing sentence + index text, and the `---` separator closes it before the skill/base text — in all three phases', async () => {
  const brainCwd = mkdtempSync(join(tmpdir(), 'arch-brain-fixture-'));
  const indexSentinel = 'SENTINEL_BRAIN_INDEX_e55a';
  mkdirSync(join(brainCwd, 'brain'), { recursive: true });
  writeFileSync(join(brainCwd, 'brain', 'INDEX.md'), `## ${indexSentinel}\n\nSome navigable theme index text.\n`);

  const fixtureDir = mkdtempSync(join(tmpdir(), 'arch-skill-brainfirst-'));
  const skillPromptPath = join(fixtureDir, 'SKILL.md');
  const S = {
    base: 'SENTINEL_BASE_7a1',
    interview: 'SENTINEL_INTERVIEW_7a2',
    explore: 'SENTINEL_EXPLORE_7a3',
    draft: 'SENTINEL_DRAFT_7a4',
    forceEmit: 'SENTINEL_FORCEEMIT_7a5',
  };
  writeFileSync(skillPromptPath, buildFixtureSkill(S));

  function assertBrainFirst(prompt: string, framingSentence: string, turnSentinel: string): void {
    assert.equal(
      prompt.indexOf('# Brain navigation index'),
      0,
      'the composed prompt must START with the brain navigation index heading',
    );
    assert.ok(
      prompt.includes(framingSentence),
      `the phase's exact framing sentence must be present verbatim: "${framingSentence}"`,
    );
    const indexIdx = prompt.indexOf(indexSentinel);
    assert.ok(indexIdx > -1, 'the seeded brain/INDEX.md content must be present in the prompt');
    const skillIdx = prompt.indexOf(turnSentinel);
    assert.ok(skillIdx > -1, 'the skill/turn text must be present in the prompt');
    // Neither the fixture's base text nor its turn sections contain '---', so
    // the closest '---' before the skill text is unambiguously the runner's
    // OWN closing separator (loadBrainIndex's internal section joins, if any,
    // all sit strictly BEFORE this one).
    const sepIdx = prompt.lastIndexOf('---', skillIdx);
    assert.ok(
      sepIdx > indexIdx,
      'a `---` separator must close the brain block, positioned after the index text',
    );
    assert.ok(skillIdx > sepIdx, 'the skill/base text must come AFTER the `---` separator, not before or inside it');
  }

  // interviewing
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'interviewing' });
    const { queryFn, prompts } = makeOrderedQueryFn([
      { done: false, questions: [{ question: 'Q?', header: 'hdr', options: [{ label: 'A', description: 'a' }] }] },
    ]);
    await runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn, skillPromptPath, brainCwd,
      logger: logger(logsRoot, sessionId),
    });
    assertBrainFirst(prompts[0], FRAMING_INTERVIEW, S.interview);
  }

  // exploring — falls through to drafting in the SAME call (park §2g#1); the
  // explore prompt is the FIRST captured prompt.
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'exploring' });
    const { queryFn, prompts } = makeOrderedQueryFn([validExploreOutput(), validDraftOutput()]);
    await runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn, skillPromptPath, brainCwd,
      logger: logger(logsRoot, sessionId),
    });
    assertBrainFirst(prompts[0], FRAMING_EXPLORE, S.explore);
  }

  // drafting
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'drafting' });
    const { queryFn, prompts } = makeOrderedQueryFn([validDraftOutput()]);
    await runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn, skillPromptPath, brainCwd,
      logger: logger(logsRoot, sessionId),
    });
    assertBrainFirst(prompts[0], FRAMING_DRAFT, S.draft);
  }
});

// ---------------------------------------------------------------------------
// AT-6 — HAZARD PIN: fail-open exploring (park §2b)
// ---------------------------------------------------------------------------

test('AT-6 (HAZARD PIN — fail-open exploring): an explore step whose structured call THROWS still advances the session to drafting, with no throw out of runArchitectTurn', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({ phase: 'exploring' });
  let calls = 0;
  const draftPrompts: string[] = [];
  const queryFn: QueryFn = ({ prompt }) => {
    calls += 1;
    if (calls === 1) {
      // The FIRST call in an 'exploring'-phase turn is always the explore
      // step (readInterview/readExploreFindings do not call queryFn).
      // Simulate a thrown stream/SDK error here.
      throw new Error('simulated explore-stage crash');
    }
    draftPrompts.push(prompt);
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: validDraftOutput() };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId, projectRoot, logsRoot, queueRoot, queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(calls, 2, 'the explore call crashed but the draft step still ran — the phase advanced past exploring');
  assert.equal(draftPrompts.length, 1, 'exactly one draft call after the fail-open explore crash');
  assert.equal(result.phase, 'awaiting-verdict', 'the turn completed via the draft step despite the explore crash');
  assert.ok(!existsSync(join(sessionDir, 'edge-cases.json')), 'no findings file — the crashed explore step wrote nothing');
});

// ---------------------------------------------------------------------------
// AT-7 — HAZARD PIN: forced-emit retry control flow (park §2c)
// ---------------------------------------------------------------------------

test('AT-7 (HAZARD PIN — forced-emit retry): empty first draft triggers exactly ONE retry whose prompt is the first prompt PLUS the appended forced-emit instruction; still-empty both times throws the named error', async () => {
  // --- succeeding retry ---
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'drafting' });
    const responses = [
      { vision: 'v', initiatives: [] }, // first call: empty → must retry
      validDraftOutput(), // forced-emit retry: succeeds
    ];
    const { queryFn, prompts } = makeOrderedQueryFn(responses);

    const result = await runArchitectTurn({
      sessionId, projectRoot, logsRoot, queueRoot, queryFn,
      logger: logger(logsRoot, sessionId),
    });

    assert.equal(prompts.length, 2, 'exactly one forced-emit retry (two structured calls total)');
    assert.ok(
      prompts[1].startsWith(prompts[0]),
      'the retry prompt must be the first prompt with the forced-emit instruction appended, not a rebuilt prompt',
    );
    const appended = prompts[1].slice(prompts[0].length);
    assert.match(appended, /## EMIT NOW — do not research further/, 'the appended tail must carry the forced-emit marker');
    assert.ok(
      prompts[1].endsWith(
        'Do NOT call any more tools. Synthesize what you already know and return the structured draft immediately, with AT LEAST ONE initiative.',
      ),
      'the forced-emit instruction must be appended at the END of the retry prompt',
    );
    assert.equal(result.phase, 'awaiting-verdict', 'the turn succeeds once the retry emits an initiative');
  }

  // --- still-empty both times ---
  {
    const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'drafting' });
    let calls = 0;
    const queryFn: QueryFn = () => {
      calls += 1;
      async function* gen(): AsyncGenerator<unknown> {
        yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: { vision: 'v', initiatives: [] } };
      }
      return gen();
    };

    await assert.rejects(
      () => runArchitectTurn({
        sessionId, projectRoot, logsRoot, queueRoot, queryFn,
        logger: logger(logsRoot, sessionId),
      }),
      /no initiatives after a forced-emit retry/,
    );
    assert.equal(calls, 2, 'gives up after exactly one forced-emit retry, not an unbounded loop');
  }
});

// ---------------------------------------------------------------------------
// AT-8 — HAZARD PIN: local runStructured's brainReads narrowing (park §2e)
// ---------------------------------------------------------------------------

test("AT-8 (HAZARD PIN — brainReads narrowing): the draft turn's PLAN.md brain-context section carries only brain/ paths, silently dropping any non-brain/ Read", async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'drafting' });
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      // Simulate the agent Reading BOTH a brain/ theme AND a plain repo file
      // during the draft turn — runStructured's `reads.filter((p) =>
      // p.includes('brain/'))` narrowing (architect-runner.ts:1379) must
      // drop the second one from brain_context, not silently keep it or
      // silently drop BOTH.
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/at8-sentinel-theme.md' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'cli/architect-plan.ts' } },
          ],
        },
      };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: validDraftOutput() };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId, projectRoot, logsRoot, queueRoot, queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.ok(result.planPath && existsSync(result.planPath));
  const planMd = readFileSync(result.planPath!, 'utf8');
  assert.match(
    planMd,
    /brain\/cycles\/themes\/at8-sentinel-theme\.md/,
    'the brain/ read must survive into the PLAN brain-context section',
  );
  assert.ok(
    !planMd.includes('cli/architect-plan.ts'),
    'a non-brain/ Read must be dropped from brainReads — this is the silent-drop hazard the park file flags ' +
      'as uncovered by any existing golden fixture',
  );
});
