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
 * `packages/sessions/kinds/project-brain.ts` loads the ENTIRE
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
 * fix belongs in `packages/sessions/kinds/project-brain.ts` and
 * `skills/project-brain-builder/SKILL.md`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

import {
  runProjectBrainTurn,
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from '../../kinds/project-brain.ts';
import { writeSessionStatus, type QueryFn } from '@forge/sessions/interactive-session.ts';
import { cyclesRawDir } from '@forge/knowledge/brain-paths.ts';
import { splitSkillTurnSections } from '@forge/agents/skill-path.ts';

// M4 sessions s3: re-anchored on `FORGE_ROOT` when this file moved into the
// package's `tests/unit/` bucket (COMMON §15.14 — a move breaks the files that
// were already right). A hand-counted `..` chain from `import.meta.dirname` is
// depth-coupled to wherever the test happens to sit; `FORGE_ROOT` is the repo
// root by construction, so a later re-bucket cannot silently re-point these at
// a file that does not exist. The runner it reads is now the ported kind
// module (`packages/sessions/kinds/project-brain.ts`).
const RUNNER_TS_PATH = resolve(FORGE_ROOT, 'packages', 'sessions', 'kinds', 'project-brain.ts');
const SKILL_MD_PATH = resolve(FORGE_ROOT, 'skills', 'project-brain-builder', 'SKILL.md');

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
 * packages/sessions/kinds/project-brain.ts TODAY (grep evidence in the
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
    // T2 RULING (R4-23 round 2): this entry originally pinned
    // "...under the cycle archives dir ABOVE, and synthesize...". That made
    // AT-1 and AT-8 mutually unsatisfiable — AT-8 forbids the stale positional
    // word from reaching a live prompt (the `Cycle archives (...)` data line it
    // pointed at is emitted AFTER the turn section, proven by index comparison
    // in AT-8 itself), while this AT demanded the sentence containing it be
    // present in SKILL.md. The same conflict arose in WI-1 and was resolved the
    // same way there (commit 35f7e2a7): the AT is the defective half, so it is
    // split around the positional word. Both halves of the instruction stay
    // pinned; only the word that has to change is released. The alternative —
    // parking the stale sentence somewhere no runner reads it — is the
    // dead-prose-to-satisfy-a-grep antipattern this lane has already rejected
    // once. Recorded in the PR body.
    label:
      "evidence-source frame, middle half (.ts line 225 at base — between \\`${binding.ref}\\` and \\`${binding.band}\\`), split around the re-anchored positional word",
    text: "flow's archived cycles under",
  },
  {
    label: 'evidence-source frame, tail half (.ts line 225 at base — after the re-anchored positional reference)',
    text: "and synthesize the durable patterns from each cycle's logged",
  },
];

test('AT-1: moved instruction prose is present in SKILL.md and absent from the runner .ts', () => {
  const runnerSrc = normalizeWs(readRunnerSource());
  const skillMd = normalizeWs(readSkillMd());
  for (const { label, text } of MOVED_SENTENCES) {
    const needle = normalizeWs(text);
    assert.ok(
      !runnerSrc.includes(needle),
      `${label}: instruction prose "${text}" must have LEFT packages/sessions/kinds/project-brain.ts (still found there — it must live in SKILL.md only)`,
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
    'a private loadSkillPrompt(...) function must no longer exist in kinds/project-brain.ts — the analyze-step prompt must load through the shared skill-turn loader instead',
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

// ===========================================================================
// ROUND 2 — adversarial-review acceptance tests (R4-23 WI-3 round-2).
//
// AT-1..AT-5 above pin a HAND-PICKED handful of moved sentences plus the
// established selection/fail-loud/data-half contracts. The round-2 review
// found two further defects those ATs cannot see:
//   (a) per-SECTION reachability — the "Good themes for a fresh project"
//       guidance survives in the FILE, but only inside analyze-project-repo;
//       analyze-cycle-archives never sees it.
//   (b) a positional reference ("the cycle archives dir above") was left
//       pointing the wrong way once the turn section moved to the FRONT of
//       the composed prompt, ahead of the `Cycle archives (...)` data line
//       it used to follow.
// AT-6..AT-8 close that gap, using the REAL skills/project-brain-builder/SKILL.md
// (no skillPromptPath fixture override) so they exercise production content.
// ===========================================================================

/**
 * A session whose `forgeRoot` is deliberately NOT threaded into skill
 * resolution (see `runAnalyzeStep`'s `skillFor`, which calls
 * `loadSkillTurnPrompt` WITHOUT a `root` override — it always resolves the
 * REAL `skills/project-brain-builder/SKILL.md` via skill-path.ts's own
 * `FORGE_ROOT` default, regardless of what `forgeRoot` this runner call was
 * given). `projectRoot` stays a throwaway temp dir so nothing is written
 * into the real forge worktree.
 */
function setupRealSkillSession(opts: {
  project: string;
  prompt?: string;
  kb_binding?: ProjectBrainStatus['kb_binding'];
}): { projectRoot: string; forgeRoot: string; sessionDir: string; sessionId: string } {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'pbrain-realskill-'));
  const projectRoot = join(scratchRoot, 'projects', opts.project);
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
  return { projectRoot, forgeRoot: scratchRoot, sessionDir, sessionId };
}

// ---------------------------------------------------------------------------
// AT-6 — Part A: frozen no-content-loss set. Every entry's `text` was
// verified present, at base c45e3892, in the cited source by direct reading
// of `git show c45e3892:<path>` (see the session investigation this file
// shipped with). Unlike demo-builder's WI-2, WI-3's fold did NOT drop any
// instruction at the FILE level — its round-2 defects are a per-SECTION
// reachability gap (AT-7) and a positional-reference bug (AT-8), not a
// straight content loss. This AT is expected to be GREEN today; it still
// earns its place as a regression guard against a future re-fold that DOES
// drop something at the file level.
// ---------------------------------------------------------------------------

const FROZEN_PROJECT_BRAIN: FrozenEntry2[] = [
  {
    label: '"never invent facts" — persisting clause (generalised: code → source)',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you never do\")",
    text: "if you didn't read it, don't claim it.",
  },
  {
    label: 'never write outside the staging directory',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you never do\")",
    text: 'Never write outside the staging directory you were given.',
  },
  {
    label: 'read-the-project instruction (step 1)',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you do\", step 1)",
    text: 'Explore the repo: README, package manifest / build files, the source tree layout, tests, config, any existing CLAUDE.md/AGENTS.md. Use Read / Grep / Glob. Understand the languages, the build + test commands, the module structure, the conventions, and the notable patterns/antipatterns.',
  },
  {
    label: 'theme-authoring frontmatter contract — persisting clause (generalised: "real file path" → "real fact")',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you do\", step 2)",
    text: 'named `<kebab-slug>.md`, each with frontmatter and\n≥1 reference to a real',
  },
  {
    label: 'good-themes guidance (file-level presence only — see AT-7 for per-section reachability)',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you do\", step 2)",
    text: "Good themes for a fresh project: **structure** (module layout + entry points),\n**conventions** (naming, error handling, the project's own rules), **build &\ntest** (the exact commands + how to run a focused test), **key patterns** (the\nidioms a contributor must follow), and any **antipatterns / sharp edges** the\ncode reveals.",
  },
  {
    label: 'profile.md — persisting clause ("the planners read first")',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you do\", step 3)",
    text: 'the planners read first',
  },
  {
    label: 'operator-review closer (generalised: "Stop." prefix dropped, rest verbatim)',
    source: "c45e3892:skills/project-brain-builder/SKILL.md (\"## What you do\", step 4)",
    text: 'The operator reviews the staged themes and approves before they land in the central brain.',
  },
  {
    label: 'ordinary-branch task header',
    source: 'c45e3892:orchestrator/project-brain-builder-runner.ts (buildAnalyzePlan, ordinary branch)',
    text: '## Your task this turn: read the project and author its initial brain.',
  },
  {
    label: 'archives-branch task header',
    source: 'c45e3892:orchestrator/project-brain-builder-runner.ts (buildAnalyzePlan, flow+band branch)',
    text: '## Your task this turn: read the CYCLE ARCHIVES and author the review-insights brain.',
  },
  {
    label: 'shared closing write-contract instruction',
    source: 'c45e3892:orchestrator/project-brain-builder-runner.ts (buildAnalyzePlan, both branches)',
    text: 'Author 3–6 theme `.md` files plus a `profile.md` into the staging directory. Then stop.',
  },
  {
    label: 'evidence-source frame, opening clause (generalised: ${binding.ref} → data-line reference)',
    source: 'c45e3892:orchestrator/project-brain-builder-runner.ts (buildAnalyzePlan, flow+band branch)',
    text: 'this KB has no project repo — read the',
  },
  {
    label: 'evidence-source frame, closing clause (generalised: ${binding.band} → data-line reference)',
    source: 'c45e3892:orchestrator/project-brain-builder-runner.ts (buildAnalyzePlan, flow+band branch)',
    text: "and synthesize the durable patterns from each cycle's logged",
  },
];

type FrozenEntry2 = { label: string; source: string; text: string };

test('AT-6 (Round-2, Part A): frozen no-content-loss set — every distinct pre-lane instruction is still reachable in skills/project-brain-builder/SKILL.md (expected GREEN today — WI-3 did not drop content at the file level)', () => {
  const skillNorm = normalizeWs(readSkillMd());
  const failures: string[] = [];
  for (const entry of FROZEN_PROJECT_BRAIN) {
    if (!skillNorm.includes(normalizeWs(entry.text))) {
      failures.push(`[${entry.label}] (${entry.source}) NOT reachable in skills/project-brain-builder/SKILL.md — expected substring: "${entry.text}"`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `frozen no-content-loss set has ${failures.length} unreachable instruction(s):\n${failures.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// AT-7 — Part B: per-SECTION reachability. The "Good themes for a fresh
// project" guidance survives in the FILE (AT-6 above), but only inside
// analyze-project-repo. If the eventual fix is the identical sentence
// verbatim in both branches, great — but a legitimate fix might instead
// author an ARCHIVES-appropriate equivalent (cycle/review-insight theme
// categories look different from repo-structure categories). So rather than
// re-asserting the SAME sentence in both branches (which would over-fit to
// one specific fix), this AT asserts the underlying CONCEPT survives: each
// branch's reachable text (its shared `base` preamble + its own turn
// section) must name at least 3 of the 5 theme categories the base guidance
// established (structure / conventions / build & test / key patterns /
// antipatterns). This is unambiguous (a fixed, quotable keyword set) and
// non-vacuous (analyze-project-repo genuinely names all 5 today; an
// implementation that silently drops category guidance from EITHER branch
// fails it) without locking the fix to one exact wording.
// ---------------------------------------------------------------------------

const THEME_CATEGORY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'structure', re: /\bstructure\b/i },
  { name: 'conventions', re: /\bconventions?\b/i },
  { name: 'build & test', re: /\bbuild\b[^.]{0,40}\btest\b|\btest\b[^.]{0,40}\bbuild\b/i },
  { name: 'key patterns', re: /\bpatterns?\b/i },
  { name: 'antipatterns / sharp edges', re: /\bantipatterns?\b|\bsharp edges?\b/i },
];

/**
 * Strip the YAML frontmatter block and any fenced code block before counting
 * category keywords. Without this, the check is VACUOUS: the shared `base`
 * preamble's frontmatter `description`/`purpose` lines ("real theme pages
 * (patterns, conventions, structure)…") and the per-theme-file template's
 * `category: pattern | antipattern | decision | …` enum (inside a fenced
 * block) both mention several category words for reasons that have nothing
 * to do with THIS branch's own instructional guidance — they are identical
 * in `base` for both branches, so counting them would make analyze-project-repo
 * and analyze-cycle-archives score the same regardless of what each branch's
 * OWN turn section actually says. Verified empirically: without stripping,
 * analyze-cycle-archives scores 4/5 from `base` noise alone even though its
 * own turn section names zero categories.
 */
function stripNoise(text: string): string {
  const noFrontmatter = text.replace(/^---[\s\S]*?\n---\n/, '');
  return noFrontmatter.replace(/```[\s\S]*?```/g, '');
}

function countThemeCategories(text: string): { count: number; matched: string[] } {
  const clean = stripNoise(text);
  const matched = THEME_CATEGORY_PATTERNS.filter((p) => p.re.test(clean)).map((p) => p.name);
  return { count: matched.length, matched };
}

test('AT-7 (Round-2, Part B): the theme-CATEGORY guidance concept reaches BOTH analyze-project-repo and analyze-cycle-archives (each names ≥3 of the 5 established categories) — expected RED today (analyze-cycle-archives names only 1: "key patterns", via the unrelated word "patterns" in "durable patterns")', () => {
  const skillText = readSkillMd();
  const { base, turns } = splitSkillTurnSections(skillText);
  const repoSection = turns.get('analyze-project-repo');
  const archivesSection = turns.get('analyze-cycle-archives');
  assert.ok(repoSection !== undefined, 'sanity: SKILL.md must carry an analyze-project-repo turn section');
  assert.ok(archivesSection !== undefined, 'sanity: SKILL.md must carry an analyze-cycle-archives turn section');

  const repoReachable = `${base}\n${repoSection}`;
  const archivesReachable = `${base}\n${archivesSection}`;

  const repoResult = countThemeCategories(repoReachable);
  const archivesResult = countThemeCategories(archivesReachable);

  assert.ok(
    repoResult.count >= 3,
    `analyze-project-repo's reachable text must name ≥3 theme categories — found ${repoResult.count} (${repoResult.matched.join(', ') || 'none'})`,
  );
  assert.ok(
    archivesResult.count >= 3,
    `analyze-cycle-archives's reachable text must name ≥3 theme categories (an archives-appropriate equivalent is fine — it does not have to be the IDENTICAL sentence as analyze-project-repo) — found ${archivesResult.count} (${archivesResult.matched.join(', ') || 'none'}); before this lane this guidance lived in the shared step-2 body and reached both branches`,
  );
});

// ---------------------------------------------------------------------------
// AT-8 — Part C: positional-reference integrity. `buildAnalyzePlan`'s
// analyze-cycle-archives branch composes `[skillFor('analyze-cycle-archives'),
// '', 'Project: ...', 'Cycle archives (...): ${cwd}', ...]` — the turn
// section (carrying "...under the cycle archives dir above...") is emitted
// FIRST, then the `Cycle archives (...)` DATA LINE that phrase is trying to
// point at is emitted AFTER it. "above" is therefore backwards: proven below
// with an index comparison, not just a string-absence check, so the AT
// documents WHY the reference is wrong.
// ---------------------------------------------------------------------------

test('AT-8 (Round-2, Part C): the analyze-cycle-archives composed prompt must not call the Cycle-archives data line "above" — it is emitted below the turn section (expected RED today)', async () => {
  const { projectRoot, forgeRoot, sessionDir, sessionId } = setupRealSkillSession({
    project: 'review-insights-proj',
    kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
  });
  const staging = join(sessionDir, 'themes');
  const cap: { prompt?: string } = {};

  await runProjectBrainTurn({
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    // NO skillPromptPath — this drives the REAL skills/project-brain-builder/SKILL.md.
    queryFn: stubQueryFn(cap, () => {
      mkdirSync(staging, { recursive: true });
      writeFileSync(join(staging, 'profile.md'), '# review-insights profile\n');
    }),
  });

  const prompt = cap.prompt!;
  assert.ok(prompt.length > 200, 'sanity: the REAL skill text must have been loaded (non-trivial prompt)');

  // Prove the ordering: the turn section's own mention of "cycle archives dir"
  // sits BEFORE the `Cycle archives (...)` data line that actually names it.
  const turnMentionIdx = prompt.indexOf('cycle archives dir');
  const dataLineIdx = prompt.indexOf('Cycle archives (your working directory');
  assert.ok(turnMentionIdx !== -1, 'sanity: the turn section\'s "cycle archives dir" mention must be present');
  assert.ok(dataLineIdx !== -1, 'sanity: the `Cycle archives (...)` data line must be present');
  assert.ok(
    turnMentionIdx < dataLineIdx,
    `the turn section's mention of "cycle archives dir" (index ${turnMentionIdx}) must be positioned BEFORE the \`Cycle archives (...)\` data line (index ${dataLineIdx}) in the composed prompt — this is WHY calling that data line "above" is backwards: it is actually emitted BELOW`,
  );

  // T2 CORRECTION (round 2): this assertion was a raw `prompt.includes(...)`
  // and was FALSE-GREEN — the phrase is hand-wrapped across a newline in the
  // real SKILL.md ("...cycle\narchives dir above, and..."), so the literal
  // never matched even though the defect was present. Collapse whitespace on
  // BOTH sides before comparing, the same way the sibling prose-presence ATs
  // in this lane do. An AT that cannot see the defect it is named for is
  // worse than no AT.
  const collapsed = prompt.replace(/\s+/g, ' ');
  assert.ok(
    !collapsed.includes('the cycle archives dir above'),
    'the composed prompt must not contain the phrase "the cycle archives dir above" — the data it refers to is emitted AFTER the turn section, never before it',
  );
});
