/**
 * R4-22 WI-0 — GOLDEN-CAPTURE BASELINE for the 4 legacy interactive runners.
 *
 * Pins the EXACT `{prompt, options}` object each runner hands its injected
 * `queryFn` today, plus the turn's returned result and the `status.json` it
 * leaves behind, so an upcoming dispatch fork in `packages/agents/agent-run.ts` (routing
 * these four session kinds onto a shared entry point) can prove byte-level
 * no-behavioural-delta against this pin. This is a GREEN-ON-ARRIVAL
 * characterization test — no production code changes for it — so it proves
 * itself by MUTATION, not by starting red (see the mutation-proof log in the
 * WI-0 report, not restated here).
 *
 * The 4 runners + the phase driven (one real-LLM-turn phase per runner):
 *   - architect-runner.ts        runArchitectTurn        phase: interviewing
 *       (a `done:false` interview round — ONE queryFn call, ends at
 *       awaiting-answers; starting at `drafting` instead would also work but
 *       `interviewing` needs no upstream explore/draft state to fake).
 *   - instructions-runner.ts     runInstructionsTurn      phase: drafting
 *       (explicitly the phase named in the WI-0 brief).
 *   - demo-builder-runner.ts     runDemoBuilderTurn       phase: generating
 *       (explicitly the phase named in the WI-0 brief).
 *   - kinds/project-brain.ts       runProjectBrainTurn      phase: analyzing
 *       (explicitly the phase named in the WI-0 brief).
 *
 * Injection seam: `queryFn` + `skillPromptPath` (every runner's own
 * `RunXTurnInput` type) — the SAME DI seam each runner's own `*.test.ts`
 * already uses. `skillPromptPath` is pointed at a small fixture string
 * literal (not the live `skills/<name>/SKILL.md`) so this pin is sensitive
 * to a PROMPT-ASSEMBLY regression (what this WI-0 baseline exists to catch)
 * without also being coupled to unrelated SKILL.md prose edits — the model +
 * `allowedTools` in the captured `options` still come from the REAL
 * `skills/<name>/SKILL.md` frontmatter via each runner's `deriveAgentSpec`
 * call at module load (ADR-024) — that part is NOT overridable through
 * `skillPromptPath` and is captured verbatim, since a fork changing the tool
 * grant/model reaching `queryFn` is exactly one of the wrong implementations
 * this pin must kill.
 *
 * `brainCwd` (architect) / `forgeRoot` (instructions, demo-builder,
 * project-brain) are pointed at the test's own empty mkdtemp root — it has
 * no `brain/`, `studio/instruction-seeds/`, `studio/demo-elements/`, or
 * `studio/demo/forge-demo.css` — so brain-index injection / seed-matching /
 * element-composition / base-CSS-inlining all take their real, CODE-PATH-
 * DETERMINISTIC "absent" branches instead of embedding whatever the live
 * forge repo's brain/skill-library content happens to be today. This keeps
 * the fixtures focused on THIS WI's target (runner dispatch → `queryFn`
 * plumbing) instead of coupling them to unrelated brain/library content
 * churn — the same category of "expected diff, trust it" the existing
 * `pm.json` / `demo-agent.json` fixture-move notes document for SKILL.md
 * prose, applied one layer earlier by not even reading the real content in
 * the first place.
 *
 * What each fixture KILLS (the wrong implementations this pin must catch —
 * primarily aimed at the R4-22 dispatch fork in `packages/agents/agent-run.ts` this WI-0
 * baseline exists to gate, but equally any accidental runner-internals
 * regression):
 *   - interactive-architect.json: a fork that routes an `_architect` session
 *     turn through a DIFFERENT runner (any other runner's prompt-preamble /
 *     option shape would fail the comparison), or that changes the
 *     interview prompt text, the injected brain-index framing, the model,
 *     the `allowedTools` grant, or drops/renames a field of the emitted
 *     `RunArchitectTurnResult` (`phase`/`wrote`/`questions`) or the
 *     `_architect/<sid>/status.json` this turn leaves behind.
 *   - interactive-instructions.json: a fork that routes an `_instructions`
 *     session turn through a different runner, or that changes the draft
 *     prompt text/framing, the model, the `allowedTools` grant, or the
 *     `RunInstructionsTurnResult` (`phase`/`wrote`/`draftPath`) shape or the
 *     `status.json` this turn leaves behind.
 *   - interactive-demo-builder.json: a fork that routes a `_demo` session
 *     turn through a different runner, or that changes the generate prompt
 *     (demoProcess framing, base-CSS block, task lines), the model,
 *     `allowedTools`/`disallowedTools`/`maxTurns`/`permissionMode`/`cwd`, or
 *     the `RunDemoBuilderTurnResult` shape or `status.json`.
 *   - interactive-project-brain.json: a fork that routes a `_project-brain`
 *     session turn through a different runner, or that changes the analyze
 *     prompt (`buildAnalyzePlan`'s ordinary project-repo-read branch), the
 *     model, `allowedTools`/`disallowedTools`/`maxTurns`/`cwd`, or the
 *     `RunProjectBrainTurnResult` shape or `status.json`.
 *
 * Normalized (genuinely volatile, not a behavioural signal):
 *   - the mkdtemp root (appears in `cwd`, in every session/status/wrote path,
 *     and inside the rendered prompts' path references) -> `<TMP>`.
 *   - the `AbortController` instance every runner attaches to `options` ->
 *     a fixed marker (a fresh controller is constructed every call; only its
 *     PRESENCE, not its identity, is a behavioural signal — handled
 *     generically by `normalizeForSnapshot`).
 *   - `status.json`'s `updated_at` (stamped from `Date.now()` on every write,
 *     including the SEEDED status BEFORE the turn ever runs, since
 *     `write{Status,SessionStatus}` always re-stamps it) -> `<TIMESTAMP>`,
 *     captured from the ACTUAL post-turn value and substituted (never a
 *     guessed literal).
 *
 * Bootstrap / regenerate (per fixture, or the whole file):
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test packages/sessions/interactive-runners-golden.test.ts
 * (or delete a fixture) rewrites it from the current code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runArchitectTurn, writeStatus, type ArchitectStatus } from './kinds/architect.ts';
import { runInstructionsTurn, instructionsSessionDir, type InstructionsStatus } from './kinds/instructions.ts';
import {
  runDemoBuilderTurn,
  demoSessionDir,
  DEMO_SKILL_REL_PATH,
  DEMO_HTML_REL_PATH,
  type DemoBuilderStatus,
} from './kinds/demo-builder.ts';
import { runProjectBrainTurn, projectBrainSessionDir, type ProjectBrainStatus } from './kinds/project-brain.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from '@forge/kernel';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from '../../orchestrator/test-fixtures/spawn-capture/normalize.ts';

const FIXTURES_DIR = resolve(import.meta.dirname, '..', '..', 'orchestrator', 'test-fixtures', 'spawn-capture');
const FIXTURE_ARCHITECT = join(FIXTURES_DIR, 'interactive-architect.json');
const FIXTURE_INSTRUCTIONS = join(FIXTURES_DIR, 'interactive-instructions.json');
const FIXTURE_DEMO_BUILDER = join(FIXTURES_DIR, 'interactive-demo-builder.json');
const FIXTURE_PROJECT_BRAIN = join(FIXTURES_DIR, 'interactive-project-brain.json');

const SESSION_ID = '2026-01-01T00-00-00';

// Fixture skill-prompt bodies — deliberately NOT the live skills/*/SKILL.md
// (see file header). Each is a small, distinctive literal so a one-byte
// mutation during the WI-0 mutation proof is trivial to grep-confirm.
// R4-23 (v2): each runner now sources its per-turn task prose from its own
// `SKILL.md` via `loadSkillTurnPrompt`, which selects ONE `<!-- turn: id -->`
// section and fails loud when the requested id is absent. The fixtures below
// therefore carry EVERY turn id their runner can request, each with distinct
// text — so the captured prompt proves not just "a skill was read" but
// "the RIGHT section was selected for this phase". A v1 single-line fixture
// would now make the runner throw, which is the fail-loud contract working.
//
// These stay fixture strings, not the live `skills/<name>/SKILL.md`, for the
// same reason as v1: the pin must be sensitive to a PROMPT-ASSEMBLY
// regression without being coupled to unrelated SKILL.md prose edits. What
// the pin now additionally kills: a runner that requests the wrong turn id
// for its phase, or that concatenates every section instead of selecting one.
const ARCHITECT_SKILL_FIXTURE = [
  'You are the forge architect (golden-capture fixture v2).',
  '',
  '<!-- turn: interview -->',
  'FIXTURE architect INTERVIEW turn.',
  '',
  '<!-- turn: explore -->',
  'FIXTURE architect EXPLORE turn.',
  '',
  '<!-- turn: draft -->',
  'FIXTURE architect DRAFT turn.',
  '',
  '<!-- turn: draft-force-emit -->',
  'FIXTURE architect FORCE-EMIT turn.',
].join('\n');
const INSTRUCTIONS_SKILL_FIXTURE = [
  'You are the forge instructions-creator (golden-capture fixture v2).',
  '',
  '<!-- turn: interview -->',
  'FIXTURE instructions INTERVIEW turn (init mode).',
  '',
  '<!-- turn: interview-edit -->',
  'FIXTURE instructions INTERVIEW turn (edit mode).',
  '',
  '<!-- turn: draft -->',
  'FIXTURE instructions DRAFT turn (init mode).',
  '',
  '<!-- turn: draft-edit -->',
  'FIXTURE instructions DRAFT turn (edit mode).',
].join('\n');
const DEMO_BUILDER_SKILL_FIXTURE = [
  'You are the forge demo-builder (golden-capture fixture v2).',
  '',
  '<!-- turn: generate-element -->',
  'FIXTURE demo-builder GENERATE-ELEMENT turn.',
  '',
  '<!-- turn: generate-composed -->',
  'FIXTURE demo-builder GENERATE-COMPOSED turn.',
  '',
  '<!-- turn: generate-legacy -->',
  'FIXTURE demo-builder GENERATE-LEGACY turn.',
].join('\n');
const PROJECT_BRAIN_SKILL_FIXTURE = [
  'You are the forge project-brain builder (golden-capture fixture v2).',
  '',
  '<!-- turn: analyze-project-repo -->',
  'FIXTURE project-brain ANALYZE-PROJECT-REPO turn.',
  '',
  '<!-- turn: analyze-cycle-archives -->',
  'FIXTURE project-brain ANALYZE-CYCLE-ARCHIVES turn.',
].join('\n');

/** Read+parse a JSON file fresh off disk (no caching) — used both for the
 *  PRE-turn precondition check and the POST-turn statusAfter capture. */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

type Captured = { prompt: string; options?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// architect-runner.ts — runArchitectTurn, phase: interviewing
// ---------------------------------------------------------------------------

test('runArchitectTurn (interviewing): pins the exact {prompt, options} spawn call + result + statusAfter (characterization)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'golden-architect-'));
  try {
    const projectRoot = join(root, 'projects', 'project');
    const sessionDir = join(projectRoot, '_architect', SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    const skillPromptPath = join(root, 'architect-skill-fixture.md');
    writeFileSync(skillPromptPath, ARCHITECT_SKILL_FIXTURE);

    const status: ArchitectStatus = {
      session_id: SESSION_ID,
      project: 'testproj',
      project_repo_path: projectRoot,
      phase: 'interviewing',
      round: 1,
      idea: 'Add a dark-mode toggle to the settings page.',
      updated_at: new Date(0).toISOString(),
    };
    writeStatus(sessionDir, status);

    // Precondition, established BEFORE the turn runs / any verdict is read.
    const pre = readJson(join(sessionDir, 'status.json'));
    assert.equal(pre.phase, 'interviewing', 'fixture precondition: session must start in interviewing phase');

    const logsRoot = join(root, '_logs');
    const logger = createLogger(`_architect-${SESSION_ID}`, logsRoot);

    let captured: Captured | null = null;
    const queryFn: QueryFn = ({ prompt, options }) => {
      captured = { prompt, options };
      async function* gen(): AsyncGenerator<unknown> {
        yield {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.01,
          structured_output: {
            done: false,
            questions: [
              {
                question: 'Should dark mode follow the OS setting?',
                header: 'OS sync',
                options: [
                  { label: 'Follow OS', description: 'Match the system theme automatically.' },
                  { label: 'Manual only', description: 'Operator toggles it explicitly.' },
                ],
              },
            ],
          },
        };
      }
      return gen();
    };

    const result = await runArchitectTurn({
      sessionId: SESSION_ID,
      projectRoot,
      queryFn,
      logsRoot,
      logger,
      skillPromptPath,
      brainCwd: root,
    });

    assert.equal(result.phase, 'awaiting-answers', 'sanity: the fixture must drive the turn to the interview-questions path');
    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');

    const statusAfter = readJson(join(sessionDir, 'status.json'));
    const normalized = normalizeForSnapshot(
      { spawn: captured, result, statusAfter },
      [
        { value: root, placeholder: '<TMP>' },
        { value: String(statusAfter.updated_at), placeholder: '<TIMESTAMP>' },
      ],
    );
    assertMatchesJsonSnapshot(FIXTURE_ARCHITECT, normalized);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// instructions-runner.ts — runInstructionsTurn, phase: drafting
// ---------------------------------------------------------------------------

test('runInstructionsTurn (drafting): pins the exact {prompt, options} spawn call + result + statusAfter (characterization)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'golden-instructions-'));
  try {
    const projectRoot = join(root, 'project');
    const repoPath = join(root, 'repo');
    mkdirSync(repoPath, { recursive: true });
    const sessionDir = instructionsSessionDir(projectRoot, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    const skillPromptPath = join(root, 'instructions-skill-fixture.md');
    writeFileSync(skillPromptPath, INSTRUCTIONS_SKILL_FIXTURE);

    const status: InstructionsStatus = {
      session_id: SESSION_ID,
      project: 'testproj',
      project_repo_path: repoPath,
      phase: 'drafting',
      round: 1,
      prompt: 'Set up AGENTS.md for this TypeScript CLI.',
      updated_at: new Date(0).toISOString(),
    };
    writeSessionStatus(sessionDir, status);

    const pre = readJson(join(sessionDir, 'status.json'));
    assert.equal(pre.phase, 'drafting', 'fixture precondition: session must start in drafting phase');

    const logsRoot = join(root, '_logs');
    const logger = createLogger(`_instructions-${SESSION_ID}`, logsRoot);

    let captured: Captured | null = null;
    const queryFn: QueryFn = ({ prompt, options }) => {
      captured = { prompt, options };
      async function* gen(): AsyncGenerator<unknown> {
        yield {
          type: 'result',
          total_cost_usd: 0.01,
          structured_output: { agents_md: '# Fixture AGENTS.md\n\nBuild: `npm run build`.', composed_seed_ids: [] },
        };
      }
      return gen();
    };

    const result = await runInstructionsTurn({
      sessionId: SESSION_ID,
      projectRoot,
      queryFn,
      logsRoot,
      logger,
      skillPromptPath,
      forgeRoot: root,
    });

    assert.equal(result.phase, 'awaiting-verdict', 'sanity: the fixture must drive the turn to a drafted AGENTS.md awaiting verdict');
    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');

    const statusAfter = readJson(join(sessionDir, 'status.json'));
    const normalized = normalizeForSnapshot(
      { spawn: captured, result, statusAfter },
      [
        { value: root, placeholder: '<TMP>' },
        { value: String(statusAfter.updated_at), placeholder: '<TIMESTAMP>' },
      ],
    );
    assertMatchesJsonSnapshot(FIXTURE_INSTRUCTIONS, normalized);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// demo-builder-runner.ts — runDemoBuilderTurn, phase: generating
// ---------------------------------------------------------------------------

test('runDemoBuilderTurn (generating): pins the exact {prompt, options} spawn call + result + statusAfter (characterization)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'golden-demo-builder-'));
  try {
    const projectRoot = join(root, 'project');
    const repoPath = join(root, 'repo');
    mkdirSync(join(repoPath, '.forge'), { recursive: true });
    writeFileSync(
      join(repoPath, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['npm', 'test'] } },
        demoProcess: [
          { kind: 'capture', text: 'Run the CLI on a fixture input.' },
          { kind: 'verify', text: 'Output matches the golden fixture.' },
        ],
      }),
    );
    const sessionDir = demoSessionDir(projectRoot, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    const skillPromptPath = join(root, 'demo-builder-skill-fixture.md');
    writeFileSync(skillPromptPath, DEMO_BUILDER_SKILL_FIXTURE);

    const status: DemoBuilderStatus = {
      session_id: SESSION_ID,
      project: 'testproj',
      project_repo_path: repoPath,
      phase: 'generating',
      iteration: 1,
      prompt: 'Show the before/after of the headline command, dark and minimal.',
      updated_at: new Date(0).toISOString(),
    };
    writeSessionStatus(sessionDir, status);

    const pre = readJson(join(sessionDir, 'status.json'));
    assert.equal(pre.phase, 'generating', 'fixture precondition: session must start in generating phase');

    const logsRoot = join(root, '_logs');
    const logger = createLogger(`_demo-${SESSION_ID}`, logsRoot);

    let captured: Captured | null = null;
    const queryFn: QueryFn = ({ prompt, options }) => {
      captured = { prompt, options };
      const cwd = (options?.cwd as string | undefined) ?? '.';
      async function* gen(): AsyncGenerator<unknown> {
        mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
        mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
        writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design (fixture)\n\nRender before/after HTML.');
        writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>fixture sample</body></html>');
        yield { type: 'result', total_cost_usd: 0.02 };
      }
      return gen();
    };

    const result = await runDemoBuilderTurn({
      sessionId: SESSION_ID,
      projectRoot,
      forgeRoot: root,
      queryFn,
      logsRoot,
      logger,
      skillPromptPath,
    });

    assert.equal(result.phase, 'awaiting-review', 'sanity: the fixture must drive the turn to a generated demo awaiting review');
    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');

    const statusAfter = readJson(join(sessionDir, 'status.json'));
    const normalized = normalizeForSnapshot(
      { spawn: captured, result, statusAfter },
      [
        { value: root, placeholder: '<TMP>' },
        { value: String(statusAfter.updated_at), placeholder: '<TIMESTAMP>' },
      ],
    );
    assertMatchesJsonSnapshot(FIXTURE_DEMO_BUILDER, normalized);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// kinds/project-brain.ts — runProjectBrainTurn, phase: analyzing
// ---------------------------------------------------------------------------

test('runProjectBrainTurn (analyzing): pins the exact {prompt, options} spawn call + result + statusAfter (characterization)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'golden-project-brain-'));
  try {
    const projectRoot = join(forgeRoot, 'projects', 'testproj');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'README.md'), '# testproj\n');
    const sessionDir = projectBrainSessionDir(projectRoot, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    const skillPromptPath = join(forgeRoot, 'project-brain-skill-fixture.md');
    writeFileSync(skillPromptPath, PROJECT_BRAIN_SKILL_FIXTURE);

    const status: ProjectBrainStatus = {
      session_id: SESSION_ID,
      project: 'testproj',
      project_repo_path: projectRoot,
      phase: 'analyzing',
      prompt: 'Focus on the build + test conventions.',
      updated_at: new Date(0).toISOString(),
    };
    writeSessionStatus(sessionDir, status);

    const pre = readJson(join(sessionDir, 'status.json'));
    assert.equal(pre.phase, 'analyzing', 'fixture precondition: session must start in analyzing phase');

    const logsRoot = join(forgeRoot, '_logs');
    const logger = createLogger(`_project-brain-${SESSION_ID}`, logsRoot);

    const stagingDir = join(sessionDir, 'themes');
    let captured: Captured | null = null;
    const queryFn: QueryFn = ({ prompt, options }) => {
      captured = { prompt, options };
      async function* gen(): AsyncGenerator<unknown> {
        mkdirSync(stagingDir, { recursive: true });
        writeFileSync(join(stagingDir, 'structure.md'), '---\nname: structure\n---\n# Structure (fixture)\n');
        writeFileSync(join(stagingDir, 'profile.md'), '# testproj profile (fixture)\n');
        yield { type: 'result', total_cost_usd: 0.03 };
      }
      return gen();
    };

    const result = await runProjectBrainTurn({
      sessionId: SESSION_ID,
      projectRoot,
      forgeRoot,
      queryFn,
      logsRoot,
      logger,
      skillPromptPath,
    });

    assert.equal(result.phase, 'awaiting-review', 'sanity: the fixture must drive the turn to staged themes awaiting review');
    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');

    const statusAfter = readJson(join(sessionDir, 'status.json'));
    const normalized = normalizeForSnapshot(
      { spawn: captured, result, statusAfter },
      [
        { value: forgeRoot, placeholder: '<TMP>' },
        { value: String(statusAfter.updated_at), placeholder: '<TIMESTAMP>' },
      ],
    );
    assertMatchesJsonSnapshot(FIXTURE_PROJECT_BRAIN, normalized);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
