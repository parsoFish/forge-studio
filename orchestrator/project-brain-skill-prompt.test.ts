/**
 * Lane R4-23 WI-3 — pinned acceptance tests for the project-brain-builder
 * analyze-step prompt re-authoring onto SKILL.md turn sections.
 *
 * Design: /tmp/claude-1000/-home-parso-forge/dc809830-dc6f-42bf-a93a-3697c90571f6/scratchpad/R4-23-design.md
 * (the `<!-- turn: <id> -->` SKILL.md convention + the shared
 * `loadSkillTurnPrompt` / `splitSkillTurnSections` loader contract that WI-1
 * lands in `orchestrator/skill-path.ts`).
 *
 * Today (base `c45e3892`), `runAnalyzeStep` in
 * `orchestrator/project-brain-builder-runner.ts` loads the ENTIRE
 * `skills/project-brain-builder/SKILL.md` verbatim via a private, fail-open
 * `loadSkillPrompt()` and then hand-composes the real task instructions
 * (headers, the write contract, the evidence-source sentence) as TypeScript
 * string literals in the exported `buildAnalyzePlan`. WI-3 must move that
 * instruction PROSE into `skills/project-brain-builder/SKILL.md` as two named
 * turn sections (`analyze-project-repo` for the ordinary project-repo-read
 * branch, `analyze-cycle-archives` for the `kb_binding: {kind:'flow', band}`
 * branch) and leave the runner injecting only DATA (project name, working
 * directory, staging directory, operator guidance, and the `binding.ref` /
 * `binding.band` values).
 *
 * What each AT kills:
 *   AT-1 — an implementation that copy-pastes the prose into SKILL.md but
 *          forgets to delete it from the .ts (intent still lives in two
 *          places, TS half still "wins" per ADR-024's complaint), OR that
 *          rewords the prose instead of moving it verbatim.
 *   AT-2 — an implementation that keeps the private fail-open
 *          `loadSkillPrompt` / `'You are the forge project-brain builder.'`
 *          fallback around "just in case" instead of deleting it (the
 *          declared-data-fails-open antipattern the design explicitly bans).
 *   AT-3 — an implementation that loads SKILL.md but CONCATENATES every turn
 *          section instead of SELECTING the right one per branch (so both
 *          branches' sentinels would leak into every prompt), or that gets
 *          the branch→turn-id mapping backwards, or that doesn't thread the
 *          right `cwd` per branch.
 *   AT-4 — an implementation that silently falls back to SOME default prompt
 *          when the turn section is missing, instead of throwing loud with a
 *          message an operator can act on.
 *   AT-5 — an implementation that, while moving prose, accidentally also
 *          moves or drops runner-injected DATA (project name / paths /
 *          operator guidance) that must stay in TypeScript.
 *
 * These are IMMUTABLE acceptance tests for WI-3 — an implementer may not
 * weaken, skip, or delete any assertion here to make the suite pass; the
 * fix belongs in `orchestrator/project-brain-builder-runner.ts` and
 * `skills/project-brain-builder/SKILL.md`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runProjectBrainTurn,
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from './project-brain-builder-runner.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { cyclesRawDir } from './brain-paths.ts';

const RUNNER_TS_PATH = resolve(import.meta.dirname, 'project-brain-builder-runner.ts');
const SKILL_MD_PATH = resolve(import.meta.dirname, '..', 'skills', 'project-brain-builder', 'SKILL.md');

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function readRunnerSource(): string {
  return readFileSync(RUNNER_TS_PATH, 'utf8');
}

function readSkillMd(): string {
  return readFileSync(SKILL_MD_PATH, 'utf8');
}

function setupSession(opts: {
  forgeRoot: string;
  project: string;
  prompt?: string;
  kb_binding?: ProjectBrainStatus['kb_binding'];
}): { projectRoot: string; sessionDir: string; sessionId: string } {
  const projectRoot = join(opts.forgeRoot, 'projects', opts.project);
  const sessionId = '2026-08-14T00-00-00';
  const sessionDir = projectBrainSessionDir(projectRoot, sessionId);
  mkdirSync(projectRoot, { recursive: true });
  writeSessionStatus<ProjectBrainStatus>(sessionDir, {
    session_id: sessionId,
    project: opts.project,
    project_repo_path: projectRoot,
    phase: 'analyzing',
    prompt: opts.prompt ?? 'focus on the build + test conventions',
    updated_at: new Date().toISOString(),
    ...(opts.kb_binding ? { kb_binding: opts.kb_binding } : {}),
  } as ProjectBrainStatus);
  return { projectRoot, sessionDir, sessionId };
}

/** Captures the prompt + `options.cwd` a `runAgentTurn` call handed to `queryFn`,
 *  and runs `effect()` (typically: stage theme files) before yielding a result
 *  so `runAnalyzeStep` sees staged output and doesn't throw "no theme files". */
function stubQueryFn(capture: { prompt?: string; cwd?: unknown }, effect: () => void): QueryFn {
  return (params) => {
    capture.prompt = params.prompt;
    capture.cwd = (params.options as { cwd?: unknown } | undefined)?.cwd;
    async function* gen(): AsyncGenerator<unknown> {
      effect();
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

const SENTINEL_REPO = 'SENTINEL-PROJECT-REPO-7f3a1c';
const SENTINEL_ARCHIVES = 'SENTINEL-CYCLE-ARCHIVES-9c1de2';

/** A fixture skill file carrying the two turn sections WI-3's branches must
 *  select between, each with its own unique sentinel — proves SELECTION, not
 *  concatenation (AT-3), and is reused (data-half only, sentinels ignored) by
 *  AT-5 so that AT is decoupled from the real (still-prose-only) SKILL.md. */
function writeTwoTurnFixture(dir: string): string {
  const p = join(dir, 'two-turn-skill-fixture.md');
  writeFileSync(
    p,
    [
      '---',
      'name: project-brain-builder (fixture)',
      '---',
      'Shared base preamble for the fixture skill.',
      '',
      '<!-- turn: analyze-project-repo -->',
      `Ordinary-branch turn section. ${SENTINEL_REPO}`,
      '',
      '<!-- turn: analyze-cycle-archives -->',
      `Cycle-archives-branch turn section. ${SENTINEL_ARCHIVES}`,
      '',
    ].join('\n'),
  );
  return p;
}

// ---------------------------------------------------------------------------
// AT-1 — prose left the TS, landed in SKILL.md (both files read from disk).
// ---------------------------------------------------------------------------

/**
 * Each entry's `text` is verified present in
 * orchestrator/project-brain-builder-runner.ts TODAY (grep evidence in the
 * WI-3 handoff report — every line number cited was checked with
 * `grep -nF` against base `c45e3892` before this file was written). After
 * WI-3, each must have MOVED: gone from the .ts, present in SKILL.md.
 *
 * The evidence-source sentence (.ts line 225 at base) is split into its two
 * fixed (non-interpolated) halves — it straddles `${binding.ref}` and
 * `${binding.band}` — per the WI-3 brief's own instruction to assert the
 * PROSE FRAME moved while the runner keeps supplying the VALUES (checked
 * separately, in AT-3, against the composed prompt).
 */
const MOVED_SENTENCES: { label: string; text: string }[] = [
  {
    label: 'shared closing write-contract instruction (both branches, .ts lines 227 & 245 at base)',
    text: 'Author 3–6 theme `.md` files plus a `profile.md` into the staging directory. Then stop.',
  },
  {
    label: 'cycle-archives branch task header (.ts line 216 at base)',
    text: '## Your task this turn: read the CYCLE ARCHIVES and author the review-insights brain.',
  },
  {
    label: 'ordinary branch task header (.ts line 236 at base)',
    text: '## Your task this turn: read the project and author its initial brain.',
  },
  {
    label: 'evidence-source frame, prefix half (.ts line 225 at base — before ${binding.ref})',
    text: 'this KB has no project repo — read the',
  },
  {
    label:
      "evidence-source frame, middle half (.ts line 225 at base — between \\`${binding.ref}\\` and \\`${binding.band}\\`)",
    text: "flow's archived cycles under the cycle archives dir above, and synthesize the durable patterns from each cycle's logged",
  },
];

test('AT-1: moved instruction prose is present in SKILL.md and absent from the runner .ts', () => {
  const runnerSrc = normalizeWs(readRunnerSource());
  const skillMd = normalizeWs(readSkillMd());
  for (const { label, text } of MOVED_SENTENCES) {
    const needle = normalizeWs(text);
    assert.ok(
      !runnerSrc.includes(needle),
      `${label}: instruction prose "${text}" must have LEFT orchestrator/project-brain-builder-runner.ts (still found there — it must live in SKILL.md only)`,
    );
    assert.ok(
      skillMd.includes(needle),
      `${label}: instruction prose "${text}" must live in skills/project-brain-builder/SKILL.md (not found there)`,
    );
  }
});

// ---------------------------------------------------------------------------
// AT-2 — no fail-open remains.
// ---------------------------------------------------------------------------

test('AT-2: no fail-open remains — the private loadSkillPrompt() and its hardcoded preamble fallback are both gone', () => {
  const runnerSrc = readRunnerSource();
  assert.ok(
    !/function\s+loadSkillPrompt\s*\(/.test(runnerSrc),
    'a private loadSkillPrompt(...) function must no longer exist in project-brain-builder-runner.ts — the analyze-step prompt must load through the shared skill-turn loader instead',
  );
  assert.ok(
    !runnerSrc.includes('You are the forge project-brain builder.'),
    'the fail-open fallback preamble "You are the forge project-brain builder." must be deleted — the loader must fail LOUD, never silently substitute a bare preamble (declared-data-fails-open antipattern)',
  );
});

// ---------------------------------------------------------------------------
// AT-3 — loaded AND used: correct turn section selected per branch, correct
// cwd per branch, and the evidence-source VALUES still reach the prompt even
// though the surrounding prose FRAME (AT-1) moved to SKILL.md.
// ---------------------------------------------------------------------------

test('AT-3: analyze-step selects analyze-project-repo (ordinary branch) vs analyze-cycle-archives (flow+band branch) — selection, not concatenation, with the right cwd each time', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-skillprompt-'));
  try {
    const skillPromptPath = writeTwoTurnFixture(forgeRoot);

    // -- ordinary branch: no kb_binding at all (the historical default). --
    const ordinary = setupSession({ forgeRoot, project: 'demoproj' });
    const staging1 = join(ordinary.sessionDir, 'themes');
    const cap1: { prompt?: string; cwd?: unknown } = {};
    await runProjectBrainTurn({
      sessionId: ordinary.sessionId,
      projectRoot: ordinary.projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      skillPromptPath,
      queryFn: stubQueryFn(cap1, () => {
        mkdirSync(staging1, { recursive: true });
        writeFileSync(join(staging1, 'profile.md'), '# demoproj profile\n');
        writeFileSync(join(staging1, 'structure.md'), '---\nname: structure\n---\n# s\n');
      }),
    });
    assert.ok(cap1.prompt, 'ordinary-branch prompt was captured from the injected queryFn');
    assert.ok(
      cap1.prompt!.includes(SENTINEL_REPO),
      'ordinary branch (no kb_binding) must select the analyze-project-repo turn section',
    );
    assert.ok(
      !cap1.prompt!.includes(SENTINEL_ARCHIVES),
      'ordinary branch must NOT also carry the analyze-cycle-archives turn section (proves selection, not concatenation of every turn)',
    );
    assert.equal(
      cap1.cwd,
      ordinary.projectRoot,
      'ordinary branch must hand the agent turn cwd: status.project_repo_path',
    );

    // -- band branch: kb_binding {kind:'flow', ref, band}. ----------------
    const band = setupSession({
      forgeRoot,
      project: 'demoproj2',
      prompt: '',
      kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
    });
    const staging2 = join(band.sessionDir, 'themes');
    const cap2: { prompt?: string; cwd?: unknown } = {};
    await runProjectBrainTurn({
      sessionId: band.sessionId,
      projectRoot: band.projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      skillPromptPath,
      queryFn: stubQueryFn(cap2, () => {
        mkdirSync(staging2, { recursive: true });
        writeFileSync(join(staging2, 'profile.md'), '# review-insights profile\n');
      }),
    });
    assert.ok(cap2.prompt, 'band-branch prompt was captured from the injected queryFn');
    assert.ok(
      cap2.prompt!.includes(SENTINEL_ARCHIVES),
      'band branch (kb_binding.kind==="flow" with a band) must select the analyze-cycle-archives turn section',
    );
    assert.ok(
      !cap2.prompt!.includes(SENTINEL_REPO),
      'band branch must NOT also carry the analyze-project-repo turn section (proves selection, not concatenation of every turn)',
    );
    assert.equal(
      cap2.cwd,
      cyclesRawDir(forgeRoot),
      'band branch must hand the agent turn cwd: the cycle-archives dir (cyclesRawDir), never the project repo',
    );

    // The evidence-source PROSE FRAME moved to SKILL.md (AT-1); the runner
    // must still supply the actual binding.ref / binding.band VALUES as data
    // somewhere in the composed prompt.
    assert.ok(cap2.prompt!.includes('forge-develop'), 'binding.ref ("forge-develop") value must still reach the composed prompt as data');
    assert.ok(cap2.prompt!.includes('review-band'), 'binding.band ("review-band") value must still reach the composed prompt as data');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-4 — fail-loud: a skillPromptPath with no turn markers THROWS, naming the
// skill and the turn id it needed.
// ---------------------------------------------------------------------------

test('AT-4: fail-loud — a skillPromptPath fixture with no turn markers makes runProjectBrainTurn THROW, naming the skill + turn id (never a silent default prompt)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-skillprompt-noturn-'));
  try {
    const skillPromptPath = join(forgeRoot, 'no-markers-skill-fixture.md');
    writeFileSync(skillPromptPath, 'A plain skill prose file with no <!-- turn: ... --> markers at all.\n');

    // -- ordinary branch (wants turn id analyze-project-repo). ------------
    const ordinary = setupSession({ forgeRoot, project: 'demoproj' });
    let ordinaryThrew = false;
    try {
      await runProjectBrainTurn({
        sessionId: ordinary.sessionId,
        projectRoot: ordinary.projectRoot,
        forgeRoot,
        logsRoot: join(forgeRoot, '_logs'),
        skillPromptPath,
        queryFn: stubQueryFn({}, () => {}),
      });
    } catch (err) {
      ordinaryThrew = true;
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /project-brain-builder/i, `error must name the skill (got: "${msg}")`);
      assert.match(msg, /analyze-project-repo/, `error must name the turn id it needed (got: "${msg}")`);
    }
    assert.ok(
      ordinaryThrew,
      'runProjectBrainTurn must THROW (fail loud) for the ordinary branch when the skillPromptPath fixture has no turn sections — it must never fall back to a silent default prompt',
    );

    // -- band branch (wants turn id analyze-cycle-archives) — same contract,
    //    its OWN turn id named in the message. ----------------------------
    const band = setupSession({
      forgeRoot,
      project: 'demoproj2',
      kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
    });
    let bandThrew = false;
    try {
      await runProjectBrainTurn({
        sessionId: band.sessionId,
        projectRoot: band.projectRoot,
        forgeRoot,
        logsRoot: join(forgeRoot, '_logs'),
        skillPromptPath,
        queryFn: stubQueryFn({}, () => {}),
      });
    } catch (err) {
      bandThrew = true;
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /project-brain-builder/i, `error must name the skill (got: "${msg}")`);
      assert.match(msg, /analyze-cycle-archives/, `error must name the turn id it needed (got: "${msg}")`);
    }
    assert.ok(
      bandThrew,
      'runProjectBrainTurn must THROW (fail loud) for the band branch too, naming its own turn id (analyze-cycle-archives) — never a silent default prompt',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-5 — data-half preserved: runner-injected DATA still reaches the composed
// prompt in the same labelled form, independent of whatever prose moved.
// This AT MAY legitimately be green already at base (today's buildAnalyzePlan
// already assembles this data correctly) — it still pins the invariant so a
// WI-3 implementation that accidentally drops or moves this data can't pass.
// ---------------------------------------------------------------------------

test('AT-5: data-half preserved — Project / working-dir / staging-dir / operator-focus lines still reach the composed prompt', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-datahalf-'));
  try {
    const skillPromptPath = writeTwoTurnFixture(forgeRoot);

    // -- empty operator guidance → the placeholder text must appear. ------
    const ordinary = setupSession({ forgeRoot, project: 'demoproj', prompt: '' });
    const staging1 = join(ordinary.sessionDir, 'themes');
    const cap1: { prompt?: string } = {};
    await runProjectBrainTurn({
      sessionId: ordinary.sessionId,
      projectRoot: ordinary.projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      skillPromptPath,
      queryFn: stubQueryFn(cap1, () => {
        mkdirSync(staging1, { recursive: true });
        writeFileSync(join(staging1, 'profile.md'), '# demoproj profile\n');
      }),
    });
    const prompt1 = cap1.prompt!;
    assert.ok(prompt1.includes('Project: demoproj'), 'the "Project: <name>" line must reach the composed prompt');
    assert.ok(
      prompt1.includes(`Project repo (your working directory — READ from here): ${ordinary.projectRoot}`),
      'the ordinary-branch working-directory line (label + the correct absolute path) must reach the composed prompt',
    );
    assert.ok(
      prompt1.includes(
        `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging1}`,
      ),
      'the absolute staging-directory line must reach the composed prompt',
    );
    assert.ok(
      prompt1.includes('_(none — author a faithful, well-rounded initial brain)_'),
      'the empty-guidance placeholder text must reach the composed prompt when status.prompt is empty',
    );

    // -- non-empty operator guidance → the real text must appear verbatim. --
    const withGuidance = setupSession({
      forgeRoot,
      project: 'demoproj3',
      prompt: 'focus tightly on error handling',
    });
    const staging2 = join(withGuidance.sessionDir, 'themes');
    const cap2: { prompt?: string } = {};
    await runProjectBrainTurn({
      sessionId: withGuidance.sessionId,
      projectRoot: withGuidance.projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      skillPromptPath,
      queryFn: stubQueryFn(cap2, () => {
        mkdirSync(staging2, { recursive: true });
        writeFileSync(join(staging2, 'profile.md'), '# demoproj3 profile\n');
      }),
    });
    assert.ok(
      cap2.prompt!.includes('focus tightly on error handling'),
      'a non-empty operator guidance string must reach the composed prompt verbatim',
    );

    // -- the band branch's working-directory line (cycle-archives label). --
    const band = setupSession({
      forgeRoot,
      project: 'demoproj4',
      prompt: '',
      kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
    });
    const staging3 = join(band.sessionDir, 'themes');
    const cap3: { prompt?: string } = {};
    await runProjectBrainTurn({
      sessionId: band.sessionId,
      projectRoot: band.projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      skillPromptPath,
      queryFn: stubQueryFn(cap3, () => {
        mkdirSync(staging3, { recursive: true });
        writeFileSync(join(staging3, 'profile.md'), '# review-insights profile\n');
      }),
    });
    assert.ok(
      cap3.prompt!.includes('Project: demoproj4'),
      'the "Project: <name>" line must reach the composed prompt on the band branch too',
    );
    assert.ok(
      cap3.prompt!.includes(`Cycle archives (your working directory — READ from here): ${cyclesRawDir(forgeRoot)}`),
      'the band-branch working-directory line (label + the cycle-archives absolute path) must reach the composed prompt',
    );
    assert.ok(
      cap3.prompt!.includes(
        `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging3}`,
      ),
      'the absolute staging-directory line must reach the composed prompt on the band branch too',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
