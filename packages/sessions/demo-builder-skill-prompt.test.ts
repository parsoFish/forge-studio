/**
 * Lane R4-23 WI-2 — acceptance tests for re-authoring the demo-builder
 * generate-step prompt onto `skills/demo-builder/SKILL.md` turn sections
 * (see the authoritative design at `_wave5/.../R4-23-design.md`: the
 * `<!-- turn: <id> -->` SKILL.md convention + the `loadSkillTurnPrompt` /
 * `splitSkillTurnSections` loader contract landing in `orchestrator/skill-path.ts`
 * via WI-1). WI-2 moves the generate-step's INSTRUCTION PROSE (the three
 * branch bodies — per-element / composed / legacy — plus the update-mode
 * guidance) out of `packages/sessions/demo-builder-runner.ts` and into the skill.
 * The runner keeps injecting only DATA: project name/repo path, operator
 * guidance/feedback, the ordered element-step list, the element generator
 * bodies, and the forge base stylesheet.
 *
 * These are the ATs WI-2 must satisfy. THEY ARE IMMUTABLE — an implementer
 * may not weaken an assertion to make it pass; a legitimate rename (e.g. of
 * the turn ids) must still make every AT below pass as written, because the
 * fixtures pin the turn-id convention this design document plans
 * (`generate-element` / `generate-composed` / `generate-legacy`) as part of
 * the accepted contract (see "design ambiguity resolved" note in the PR /
 * session report this file shipped with).
 *
 * Each AT and what it kills:
 *   AT-1 prose-left-the-TS   — an implementer who copy-pastes the prose into
 *                              SKILL.md but forgets to DELETE it from the .ts
 *                              (intent still lives in two places).
 *   AT-2 no fail-open remains — an implementer who keeps the old
 *                              `You are the forge demo-builder agent.`
 *                              fallback or the runner-private `loadSkillPrompt`
 *                              (the declared-data-fails-open antipattern).
 *   AT-3 loaded-AND-USED +
 *        selection            — an implementer who concatenates ALL turn
 *                              sections into every prompt instead of
 *                              selecting the one matching the branch.
 *   AT-4 fail-loud            — an implementer who silently falls back to
 *                              SOME default prompt when the fixture skill has
 *                              no turn markers, instead of throwing.
 *   AT-5 data-half preserved  — an implementer who moves data (not just
 *                              prose) into SKILL.md, breaking per-run
 *                              injection of project/repo/guidance/feedback.
 *   AT-6 demoTaskLines
 *        contract survives    — an implementer who removes/renames
 *                              `demoTaskLines` or breaks its ordering
 *                              contract, silently breaking the R4-07
 *                              descriptor-parity test
 *                              (`orchestrator/demo-descriptor-parity.test.ts`).
 *
 * Harness idiom mirrors `orchestrator/demo-builder-runner.test.ts`: seed
 * `projectRoot/_demo/<sid>/status.json` via `writeSessionStatus`, inject a
 * stub `queryFn` that simulates the agent's file writes, and (new to this
 * file) inject `skillPromptPath` fixtures to drive/observe turn selection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runDemoBuilderTurn,
  demoSessionDir,
  demoTaskLines,
  DEMO_SKILL_REL_PATH,
  DEMO_HTML_REL_PATH,
  type DemoBuilderStatus,
} from './demo-builder-runner.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from '@forge/kernel';
import { listDemoElements } from '../../orchestrator/studio/registry.ts';
import type { DemoStep } from '@forge/contracts/studio/types.ts';
import { splitSkillTurnSections } from '@forge/agents/skill-path.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const RUNNER_TS_PATH = join(FORGE_ROOT, 'packages', 'sessions', 'demo-builder-runner.ts');
const SKILL_MD_PATH = join(FORGE_ROOT, 'skills', 'demo-builder', 'SKILL.md');

/** Normalise whitespace on both sides before comparing — the moved sentences
 *  are built today by multi-line array-join concatenation in the .ts, so a
 *  byte-for-byte substring check would be brittle to reformatting either side. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Shared scaffolding — mirrors orchestrator/demo-builder-runner.test.ts's setup().
// ---------------------------------------------------------------------------

const OPERATOR_GUIDANCE_SENTINEL = 'OPERATOR-GUIDANCE-SENTINEL-4471: keep it dark and minimal.';

function setup(overrides?: Partial<DemoBuilderStatus>, demoProcess?: DemoStep[]): {
  projectRoot: string;
  repoPath: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'demo-skillprompt-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(join(repoPath, '.forge'), { recursive: true });
  writeFileSync(
    join(repoPath, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: { local: { cmd: ['npm', 'test'] } },
      demoProcess: demoProcess ?? [
        { kind: 'capture', text: 'Run the CLI on a sample.' },
        { kind: 'verify', text: 'Output matches the golden file.' },
      ],
    }),
  );
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-14T00-00-00';
  const sessionDir = demoSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: sessionId,
    project: 'skillprompt-demo',
    project_repo_path: repoPath,
    phase: 'generating',
    iteration: 1,
    prompt: OPERATOR_GUIDANCE_SENTINEL,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

const loggerFor = (logsRoot: string, sid: string) => createLogger(`_demo-${sid}`, logsRoot);

/** Simulates the agent writing the composer skill + sample DEMO.html
 *  (legacy / composed branches). */
function makeWritingQueryFn(capture?: (prompt: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
      writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design (fixture)');
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0.02 };
    }
    return gen();
  };
}

/** Simulates the agent writing ONLY a per-element project-side skill + the
 *  sample (targetElement branch). */
function makeElementWritingQueryFn(elementId: string, capture?: (prompt: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo', elementId), { recursive: true });
      writeFileSync(join(cwd, '.forge', 'skills', 'demo', elementId, 'SKILL.md'), `# ${elementId} element (fixture)`);
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>element fragment</body></html>');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

// ---------------------------------------------------------------------------
// AT-1 — prose-left-the-TS (grep-assert, both files read from disk at test time)
// ---------------------------------------------------------------------------

// Verified present in demo-builder-runner.ts TODAY (base c45e3892) by running:
//   python3 -c "... substring search, whitespace-normalised ..."
// against the file — all five returned IN_TS=True IN_SKILL=False. Quoting the
// verification below in each entry's comment (grep output summarised — see the
// session report for the raw run) rather than re-deriving it at test time,
// since the assertions THEMSELVES are the live re-check on every run.
const MOVED_SENTENCES: Array<{ label: string; text: string }> = [
  {
    // packages/sessions/demo-builder-runner.ts:709 (demoTaskLines, `target` branch).
    // Verified present in the .ts today; absent from SKILL.md today.
    label: 'element branch — "Author/refine the project-side element-skill at"',
    text: 'Author/refine the project-side element-skill at',
  },
  {
    // packages/sessions/demo-builder-runner.ts:724 (demoTaskLines, composed branch).
    // Verified present in the .ts today; absent from SKILL.md today.
    label: 'composed branch — "the composer that reads those fragments IN THIS ORDER"',
    text: 'the composer that reads those fragments IN THIS ORDER',
  },
  {
    // packages/sessions/demo-builder-runner.ts:736 (demoTaskLines, legacy branch).
    // Verified present in the .ts today; absent from SKILL.md today.
    label: "legacy branch — \"the reusable generator that renders a before/after HTML demo of an INITIATIVE'S CHANGES\"",
    text: "the reusable generator that renders a before/after HTML demo of an INITIATIVE'S CHANGES",
  },
  {
    // packages/sessions/demo-builder-runner.ts:309 (runGenerateStep, mode==='update' block).
    // Verified present in the .ts today; absent from SKILL.md today.
    label: 'update-mode — "UPDATE MODE: a locked demo already exists"',
    text: 'UPDATE MODE: a locked demo already exists',
  },
  {
    // packages/sessions/demo-builder-runner.ts:724 (demoTaskLines, composed branch,
    // same paragraph as the composer sentence above — a distinct sentence).
    // Verified present in the .ts today; absent from SKILL.md today.
    label: 'composed branch grounding — "Ground every fragment in a real before/after … REAL output, never fabricated."',
    text: 'Ground every fragment in a real before/after of a representative recent change (use git log/diff; REAL output, never fabricated).',
  },
];

test('AT-1: prose-left-the-TS — 5 distinctive instruction sentences (all 3 branches + update-mode) moved from the runner .ts into skills/demo-builder/SKILL.md', () => {
  const tsNorm = norm(readFileSync(RUNNER_TS_PATH, 'utf8'));
  const skillNorm = norm(readFileSync(SKILL_MD_PATH, 'utf8'));

  for (const { label, text } of MOVED_SENTENCES) {
    const needle = norm(text);
    assert.ok(
      !tsNorm.includes(needle),
      `${label}: must be ABSENT from packages/sessions/demo-builder-runner.ts (the prose must move to SKILL.md) — it is still there`,
    );
    assert.ok(
      skillNorm.includes(needle),
      `${label}: must be PRESENT in skills/demo-builder/SKILL.md — it is not there`,
    );
  }
});

// ---------------------------------------------------------------------------
// AT-2 — no fail-open remains
// ---------------------------------------------------------------------------

test('AT-2: no fail-open remains — the generic fallback prompt string and the runner-private loadSkillPrompt are both gone from demo-builder-runner.ts', () => {
  const tsText = readFileSync(RUNNER_TS_PATH, 'utf8');
  assert.ok(
    !tsText.includes('You are the forge demo-builder agent.'),
    'the fail-open fallback prompt string must be removed — a fail-open here would ship an agent turn with NO task instructions and no signal',
  );
  assert.ok(
    !tsText.includes('loadSkillPrompt('),
    'the runner-private loadSkillPrompt function/call must be deleted — the runner must route through the shared loadSkillTurnPrompt loader (orchestrator/skill-path.ts) instead',
  );
});

// ---------------------------------------------------------------------------
// AT-3 — loaded-AND-USED + selection (fixture skillPromptPath, unique sentinels)
// ---------------------------------------------------------------------------

const BASE_SENTINEL = 'BASE-SENTINEL-9f3a2b (shared preamble — proves the fixture skillPromptPath was actually loaded)';
const ELEMENT_ONLY_SENTINEL = 'ELEMENT-ONLY-SENTINEL-71c4';
const COMPOSED_ONLY_SENTINEL = 'COMPOSED-ONLY-SENTINEL-52e9';
const LEGACY_ONLY_SENTINEL = 'LEGACY-ONLY-SENTINEL-8d16';

/** A fixture SKILL.md carrying one uniquely-sentineled section per planned
 *  turn id (`generate-element` / `generate-composed` / `generate-legacy`) —
 *  this pins the turn-id convention the design document plans; see the file
 *  header. */
function writeSelectionFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'demo-builder-fixture-'));
  const p = join(dir, 'demo-builder-SKILL.md');
  writeFileSync(
    p,
    [
      '---',
      'name: demo-builder',
      '---',
      '',
      BASE_SENTINEL,
      '',
      '<!-- turn: generate-element -->',
      ELEMENT_ONLY_SENTINEL,
      '',
      '<!-- turn: generate-composed -->',
      COMPOSED_ONLY_SENTINEL,
      '',
      '<!-- turn: generate-legacy -->',
      LEGACY_ONLY_SENTINEL,
      '',
    ].join('\n'),
  );
  return p;
}

test('AT-3a: targetElement scenario selects the generate-element turn section only', async () => {
  const composedProcess: DemoStep[] = [{ kind: 'capture', text: 'capture the cli', element: 'cli-capture' }];
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'generating', targetElement: 'cli-capture' }, composedProcess);
  const skillPromptPath = writeSelectionFixture();
  let captured = '';
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    skillPromptPath,
    queryFn: makeElementWritingQueryFn('cli-capture', (p) => { captured = p; }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });
  assert.ok(captured.includes(BASE_SENTINEL), 'the fixture skillPromptPath must actually be loaded (shared preamble present)');
  assert.ok(captured.includes(ELEMENT_ONLY_SENTINEL), 'the generate-element turn section must reach the prompt for a targetElement scenario');
  assert.ok(!captured.includes(COMPOSED_ONLY_SENTINEL), 'the generate-composed turn section must NOT leak into a targetElement scenario');
  assert.ok(!captured.includes(LEGACY_ONLY_SENTINEL), 'the generate-legacy turn section must NOT leak into a targetElement scenario');
});

test('AT-3b: composed (multi-element, no targetElement) scenario selects the generate-composed turn section only', async () => {
  const composedProcess: DemoStep[] = [
    { kind: 'capture', text: 'capture the cli', element: 'cli-capture' },
    { kind: 'verify', text: 'npm test', element: 'test-evidence' },
  ];
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'generating' }, composedProcess);
  const skillPromptPath = writeSelectionFixture();
  let captured = '';
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    skillPromptPath,
    queryFn: makeWritingQueryFn((p) => { captured = p; }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });
  assert.ok(captured.includes(BASE_SENTINEL), 'the fixture skillPromptPath must actually be loaded (shared preamble present)');
  assert.ok(captured.includes(COMPOSED_ONLY_SENTINEL), 'the generate-composed turn section must reach the prompt for a composed scenario');
  assert.ok(!captured.includes(ELEMENT_ONLY_SENTINEL), 'the generate-element turn section must NOT leak into a composed scenario');
  assert.ok(!captured.includes(LEGACY_ONLY_SENTINEL), 'the generate-legacy turn section must NOT leak into a composed scenario');
});

test('AT-3c: no-elements-configured (legacy) scenario selects the generate-legacy turn section only', async () => {
  // Default setup() demoProcess has capture/verify steps with NO `element`
  // field — no elements configured at all (the legacy branch).
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'generating' });
  const skillPromptPath = writeSelectionFixture();
  let captured = '';
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    skillPromptPath,
    queryFn: makeWritingQueryFn((p) => { captured = p; }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });
  assert.ok(captured.includes(BASE_SENTINEL), 'the fixture skillPromptPath must actually be loaded (shared preamble present)');
  assert.ok(captured.includes(LEGACY_ONLY_SENTINEL), 'the generate-legacy turn section must reach the prompt for a no-elements-configured scenario');
  assert.ok(!captured.includes(ELEMENT_ONLY_SENTINEL), 'the generate-element turn section must NOT leak into a legacy scenario');
  assert.ok(!captured.includes(COMPOSED_ONLY_SENTINEL), 'the generate-composed turn section must NOT leak into a legacy scenario');
});

// ---------------------------------------------------------------------------
// AT-4 — fail-loud
// ---------------------------------------------------------------------------

test('AT-4: a skillPromptPath fixture with no turn markers makes the generate turn THROW, naming the skill and the turn id — never a silent default prompt', async () => {
  // Legacy (no-elements-configured) scenario, driving the expected
  // 'generate-legacy' turn id. A queryFn that WOULD succeed if reached is
  // deliberately used (not a noop) so a base-line "no throw at all" failure
  // is unambiguous, rather than accidentally rejecting for an unrelated
  // reason (e.g. "no DEMO.html produced").
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'generating' });
  const dir = mkdtempSync(join(tmpdir(), 'demo-builder-fixture-nomarkers-'));
  const skillPromptPath = join(dir, 'demo-builder-SKILL.md');
  writeFileSync(skillPromptPath, '---\nname: demo-builder\n---\n\nJust prose. No turn markers anywhere in this fixture.\n');

  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId,
      projectRoot,
      forgeRoot: FORGE_ROOT,
      skillPromptPath,
      queryFn: makeWritingQueryFn(),
      logger: loggerFor(logsRoot, sessionId),
      logsRoot,
    }),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must throw an Error');
      assert.match(err.message, /demo-builder/, 'the thrown message must name the skill ("demo-builder")');
      assert.match(err.message, /generate-legacy/, 'the thrown message must name the turn id it could not find ("generate-legacy" for a no-elements-configured scenario)');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// AT-5 — data-half preserved
// ---------------------------------------------------------------------------

test('AT-5: the composed prompt still carries the runner-injected DATA half — project name, repo path, operator guidance, operator feedback, the forge base stylesheet, and the ordered element list', async () => {
  const composedProcess: DemoStep[] = [
    { kind: 'present', text: 'lead', element: 'narrative' },
    { kind: 'capture', text: 'capture the cli', element: 'cli-capture' },
    { kind: 'verify', text: 'npm test', element: 'test-evidence' },
  ];
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup(
    { phase: 'generating', project: 'AT5-DATA-PROJECT' },
    composedProcess,
  );
  const feedbackSentinel = 'AT5-FEEDBACK-SENTINEL-2201: make it punchier.';
  writeFileSync(join(sessionDir, 'feedback.md'), feedbackSentinel);

  let captured = '';
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFn((p) => { captured = p; }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });

  assert.ok(captured.includes('Project: AT5-DATA-PROJECT'), 'project name must be injected verbatim, in the "Project: <name>" form');
  assert.ok(captured.includes(repoPath), 'the project repo path must be injected verbatim');
  assert.ok(captured.includes(OPERATOR_GUIDANCE_SENTINEL), "the operator's look-and-feel guidance text must be injected verbatim");
  assert.ok(captured.includes(feedbackSentinel), 'the operator feedback.md content must be injected verbatim when it exists');

  const cssText = readFileSync(join(FORGE_ROOT, 'studio', 'demo', 'forge-demo.css'), 'utf8');
  const cssLine = cssText.split('\n').find((l) => l.includes('--bg:'));
  assert.ok(cssLine, 'sanity: the real forge base stylesheet must define --bg somewhere');
  assert.ok(captured.includes(cssLine!.trim()), 'the forge base stylesheet must be inlined into the prompt as a fenced block, verbatim from disk');
  assert.ok(captured.includes('```css'), 'the base stylesheet must remain fenced as a css code block');

  const ids = ['narrative', 'cli-capture', 'test-evidence'];
  const positions = ids.map((id) => {
    const i = captured.indexOf(id);
    assert.ok(i !== -1, `element id "${id}" must appear in the composed prompt`);
    return i;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i]! > positions[i - 1]!, 'the ordered element-step list must preserve demoProcess step order (narrative, cli-capture, test-evidence)');
  }
});

// Note (per lane instructions): the data half above is expected to legitimately
// be GREEN already at base — this AT still pins real value because it will go
// RED the moment an implementer starts moving DATA (not just prose) into
// SKILL.md, or drops a data field while re-authoring the prompt assembly.

// ---------------------------------------------------------------------------
// AT-6 — the exported demoTaskLines contract survives
// ---------------------------------------------------------------------------

test('AT-6: the demoTaskLines export contract survives — composed-branch output lists every element id in descriptor order, both directly and via the runner-composed prompt', async () => {
  // Mirrors orchestrator/demo-descriptor-parity.test.ts's shared fixture
  // (deliberately NOT alphabetical, so order-preservation is actually
  // asserted, not accidentally true because of a sort).
  const FIXTURE_STEPS: Array<DemoStep & { element: string }> = [
    { kind: 'capture', text: 'record the CLI before/after', element: 'cli-capture' },
    { kind: 'verify', text: 'encode the gate result', element: 'test-evidence' },
    { kind: 'present', text: 'one-line essence', element: 'narrative' },
  ];
  const byId = new Map(listDemoElements(FORGE_ROOT).map((e) => [e.id, e]));
  for (const s of FIXTURE_STEPS) {
    assert.ok(byId.has(s.element), `sanity: fixture element "${s.element}" must exist in the real forge demo-element library`);
  }
  const ids = FIXTURE_STEPS.map((s) => s.element);

  // Secondary assertion — demoTaskLines() called directly. If the implementer
  // renames or removes this export, this import fails to compile/resolve;
  // if they break its output contract, this assertion fails.
  const directLines = demoTaskLines({
    status: { project_repo_path: '/unused' } as unknown as DemoBuilderStatus,
    composed: true,
    elementSteps: FIXTURE_STEPS,
    byId,
  }).join('\n');
  const directPositions = ids.map((id) => {
    const i = directLines.indexOf(id);
    assert.ok(i !== -1, `demoTaskLines() direct output must include element id "${id}"`);
    return i;
  });
  for (let i = 1; i < directPositions.length; i += 1) {
    assert.ok(directPositions[i]! > directPositions[i - 1]!, 'demoTaskLines() direct output must preserve descriptor order');
  }

  // Primary assertion — the SAME contract observed end-to-end through the
  // real runner's fully-composed prompt (what the R4-07 descriptor-parity
  // guarantee actually depends on in production).
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'generating' }, FIXTURE_STEPS);
  let captured = '';
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFn((p) => { captured = p; }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });
  const runnerPositions = ids.map((id) => {
    const i = captured.indexOf(id);
    assert.ok(i !== -1, `the runner-composed prompt must include element id "${id}"`);
    return i;
  });
  for (let i = 1; i < runnerPositions.length; i += 1) {
    assert.ok(runnerPositions[i]! > runnerPositions[i - 1]!, 'the runner-composed prompt must preserve descriptor order');
  }
});

// Note (per lane instructions): this AT is expected to legitimately be GREEN
// already at base — demoTaskLines and its ordering contract already exist and
// already work. It still pins real value as a regression guard: it goes RED
// the instant an implementer drops/renames the export, stops calling it from
// the composed branch, or breaks step ordering while re-authoring the prompt.

// ===========================================================================
// ROUND 2 — adversarial-review acceptance tests (R4-23 WI-2 round-2).
//
// AT-1..AT-6 above pin a HAND-PICKED handful of moved sentences. The round-2
// review found that the WI-2 fold silently DROPPED two whole instructions
// nobody's hand-picked list happened to name, and left no positional-drift
// check at all. AT-7..AT-10 close that gap:
//   AT-7  (Part A) — a FROZEN, exhaustive no-content-loss catalog: every
//         distinct pre-lane instruction, not just 6 hand-picked sentences.
//   AT-8  (Part B) — per-SECTION reachability: a sentence surviving in the
//         FILE is still a loss if only one of the two multi-fragment
//         branches (generate-composed / generate-legacy) can see it.
//   AT-9  (Part C) — positional-reference integrity: no turn section may
//         call a data item "above" when that data is emitted after it.
//   AT-10 (Part D) — the project-repo write transaction (ensureStudioBranch
//         → dispatch → commitStudioChange) must survive a mid-turn throw.
// ===========================================================================

// ---------------------------------------------------------------------------
// AT-7 — Part A: frozen no-content-loss set.
//
// Every entry's `text` was verified present, at base c45e3892, in the cited
// source (`source`) by direct reading of `git show c45e3892:<path>` (see the
// session investigation this file shipped with). Two entries are KNOWN
// DROPPED per the round-2 design brief's explicit callout and are expected
// to make this AT RED today — that is the point: it pins the fix.
// ---------------------------------------------------------------------------

type FrozenEntry = { label: string; source: string; text: string };

const FROZEN_DEMO_BUILDER: FrozenEntry[] = [
  // -- untouched region (git diff c45e3892..HEAD carries no hunk before
  //    "## The two deliverables") — two sample sentences stand in for the
  //    whole intro paragraph, per the design's untouched-region allowance. --
  {
    label: 'untouched intro — job framing ("NOT a one-off marketing page")',
    source: 'c45e3892:skills/demo-builder/SKILL.md (intro paragraph)',
    text: 'Your job is **NOT** to write a one-off marketing page for the whole project.',
  },
  {
    label: 'untouched intro — demo.json replacement',
    source: 'c45e3892:skills/demo-builder/SKILL.md (intro paragraph)',
    text: "This replaces the rigid `demo.json` contract: demos are bespoke HTML the project's own skill generates, tailored per project, scoped to what an initiative changed.",
  },
  // -- untouched "## Scope every demo" / "## Ground it in REAL output"
  //    sections — one sample sentence each. --
  {
    label: 'untouched — scope to an initiative\'s CHANGES',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## Scope every demo to an initiative\'s CHANGES")',
    text: 'The unit of a demo is "what this initiative changed", not "what the project is".',
  },
  {
    label: 'untouched — ground in real output, never fabricate',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## Ground it in REAL output")',
    text: 'Never fabricate results, fake metrics, or invent a passing run.',
  },
  // -- "## The two deliverables (every generate turn)" — removed as a
  //    SHARED section, its content folded per-branch. Deliverable #1's
  //    elaboration survives (generalised) in generate-legacy. --
  {
    label: 'deliverable #1 elaboration — what the generator skill must instruct a future agent to do',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## The two deliverables", item 1)',
    text: 'render a self-contained Forge-styled HTML demo that showcases the changes that initiative introduced — the new behaviour, the diff that matters, real captured output before vs after, the verification that makes it non-trivial',
  },
  {
    label: 'deliverable #1 — forge preflight DEMO-SKILL significance',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## The two deliverables", item 1)',
    text: 'This is also the file `forge preflight` DEMO-SKILL checks.',
  },
  {
    // KNOWN DROPPED — verified absent from both packages/sessions/demo-builder-runner.ts
    // and skills/demo-builder/SKILL.md today (see AT-1's file header + the grep
    // run recorded in this file's session report: 0 hits either side).
    label: 'KNOWN-DROPPED — deliverable #2, "find a real recent change" sourcing instruction',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## The two deliverables", item 2)',
    text: 'Use Bash + git to find one (`git log --oneline -20`; pick the most recent substantive feature commit or commit range) and render an actual before/after of it — real output on both sides, not a mock.',
  },
  // -- "## Honor the inputs" — the revision-editing discipline. --
  {
    // KNOWN DROPPED — same verification as above.
    label: 'KNOWN-DROPPED — revision discipline ("EDIT the existing skill + sample toward the feedback")',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## Honor the inputs")',
    text: "On a revision, EDIT the existing skill + sample toward the feedback; don't rebuild from scratch unless asked.",
  },
  // -- "## Contract" — one untouched bullet survives the section rewrite. --
  {
    label: 'Contract — keep the sample tight and readable',
    source: 'c45e3892:skills/demo-builder/SKILL.md ("## Contract")',
    text: 'Keep the sample tight and readable; lead with a one-line essence of the change.',
  },
  // -- packages/sessions/demo-builder-runner.ts's demoTaskLines() branch prose
  //    (moved into the three turn sections, re-anchored). --
  {
    label: 'element branch — perfect-this-element-first / do-not-build-others discipline',
    source: 'c45e3892:packages/sessions/demo-builder-runner.ts (demoTaskLines, target branch)',
    text: 'so the operator can perfect this element before composing the whole demo. Do NOT build the other elements this turn.',
  },
  {
    label: 'composed branch — composer assembly instruction',
    source: 'c45e3892:packages/sessions/demo-builder-runner.ts (demoTaskLines, composed branch)',
    text: 'the composer that reads those fragments IN THIS ORDER and assembles them into',
  },
  {
    label: 'legacy branch — deliverable #2 restated (the part that DID survive)',
    source: 'c45e3892:packages/sessions/demo-builder-runner.ts (demoTaskLines, legacy branch)',
    text: 'a real sample produced by running that generator against a representative recent change (use git log/diff; real before/after, never fabricated). This sample is what the operator reviews to judge the skill.',
  },
  {
    label: "runGenerateStep — UPDATE MODE guidance (mode==='update' block)",
    source: "c45e3892:packages/sessions/demo-builder-runner.ts (runGenerateStep, mode==='update' block)",
    text: 'UPDATE MODE: a locked demo already exists',
  },
];

test('AT-7 (Round-2, Part A): frozen no-content-loss set — every distinct pre-lane instruction is still reachable in skills/demo-builder/SKILL.md (2 entries are KNOWN-DROPPED and pin the round-2 defect; expected RED today)', () => {
  const skillNorm = norm(readFileSync(SKILL_MD_PATH, 'utf8'));
  const failures: string[] = [];
  for (const entry of FROZEN_DEMO_BUILDER) {
    if (!skillNorm.includes(norm(entry.text))) {
      failures.push(`[${entry.label}] (${entry.source}) NOT reachable in skills/demo-builder/SKILL.md — expected substring: "${entry.text}"`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `frozen no-content-loss set has ${failures.length} unreachable instruction(s):\n${failures.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// AT-8 — Part B: per-SECTION reachability (not just per-file). The composer-
// skill quality bar must reach BOTH generate-composed and generate-legacy —
// before this lane it lived in the shared "## The two deliverables" section
// and reached every generate turn; after the fold it only survives (in full)
// inside generate-legacy.
// ---------------------------------------------------------------------------

test('AT-8 (Round-2, Part B): the composer-skill quality bar reaches BOTH generate-composed and generate-legacy turns, not just generate-legacy (expected RED today)', () => {
  const skillText = readFileSync(SKILL_MD_PATH, 'utf8');
  const { base, turns } = splitSkillTurnSections(skillText);
  const composedSection = turns.get('generate-composed');
  const legacySection = turns.get('generate-legacy');
  assert.ok(composedSection !== undefined, 'sanity: skills/demo-builder/SKILL.md must carry a generate-composed turn section');
  assert.ok(legacySection !== undefined, 'sanity: skills/demo-builder/SKILL.md must carry a generate-legacy turn section');

  const reachableComposed = norm(`${base}\n${composedSection}`);
  const reachableLegacy = norm(`${base}\n${legacySection}`);

  const QUALITY_BAR_CLAUSES = [
    'the new behaviour, the diff that matters, real captured output before vs after, the verification that makes it non-trivial',
    'forge preflight` DEMO-SKILL checks',
  ];

  for (const clause of QUALITY_BAR_CLAUSES) {
    const needle = norm(clause);
    assert.ok(
      reachableComposed.includes(needle),
      `generate-composed turn (base preamble + its own section) must carry the composer-skill quality-bar clause: "${clause}" — before this lane it lived in the shared "## The two deliverables" section and reached every generate turn`,
    );
    assert.ok(
      reachableLegacy.includes(needle),
      `generate-legacy turn (base preamble + its own section) must carry the composer-skill quality-bar clause: "${clause}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// AT-9 — Part C: positional-reference integrity across all 3 generate
// branches, composed from the REAL skills/demo-builder/SKILL.md (no
// skillPromptPath fixture override).
//
// runGenerateStep always emits `[skill, '', 'Mode: ...', 'Project: ...', ...]`
// — the skill/turn text is unconditionally FIRST, the data half unconditionally
// AFTER. So any "above" inside the skill/turn portion of the composed prompt
// would, by construction, be referring to something that has not been emitted
// yet in this prompt — it is always emitted BELOW, never above. This is not a
// blanket ban on the word "above" (architect legitimately uses it to point at
// a block earlier in the SAME section) — it is scoped to the portion of the
// prompt that precedes the data half, proven with an index comparison below.
// ---------------------------------------------------------------------------

test('AT-9 (Round-2, Part C): no stale "above" reference to data emitted after the skill/turn text, in any of the 3 real generate branches', async () => {
  async function composeRealPrompt(
    overrides: Partial<DemoBuilderStatus>,
    demoProcess?: DemoStep[],
  ): Promise<string> {
    const { projectRoot, logsRoot, sessionId } = setup(overrides, demoProcess);
    let captured = '';
    const queryFn = overrides.targetElement
      ? makeElementWritingQueryFn(overrides.targetElement, (p) => { captured = p; })
      : makeWritingQueryFn((p) => { captured = p; });
    await runDemoBuilderTurn({
      sessionId,
      projectRoot,
      forgeRoot: FORGE_ROOT,
      // NO skillPromptPath — this drives the REAL skills/demo-builder/SKILL.md.
      queryFn,
      logger: loggerFor(logsRoot, sessionId),
      logsRoot,
    });
    return captured;
  }

  const elementProcess: DemoStep[] = [{ kind: 'capture', text: 'capture the cli', element: 'cli-capture' }];
  const composedProcess: DemoStep[] = [
    { kind: 'capture', text: 'capture the cli', element: 'cli-capture' },
    { kind: 'verify', text: 'npm test', element: 'test-evidence' },
  ];

  const branches: Array<{ label: string; prompt: string }> = [
    { label: 'generate-element', prompt: await composeRealPrompt({ phase: 'generating', targetElement: 'cli-capture' }, elementProcess) },
    { label: 'generate-composed', prompt: await composeRealPrompt({ phase: 'generating' }, composedProcess) },
    { label: 'generate-legacy', prompt: await composeRealPrompt({ phase: 'generating' }) },
  ];

  for (const { label, prompt } of branches) {
    const dataStartIdx = prompt.indexOf('Mode: ');
    assert.ok(dataStartIdx > 0, `[${label}] sanity: the "Mode: ..." data line must be found, strictly after the skill/turn text`);
    const skillPortion = prompt.slice(0, dataStartIdx);
    assert.ok(
      skillPortion.length > 200,
      `[${label}] sanity: the skill portion must be non-trivial — proves the REAL skills/demo-builder/SKILL.md was actually loaded, not an empty/fixture stand-in`,
    );
    assert.ok(
      !/\babove\b/i.test(skillPortion),
      `[${label}] the skill/turn portion (everything before the first "Mode: " data line, index ${dataStartIdx}) must not reference any data item as "above" — every data line in this runner is emitted AFTER the skill text, so "above" can never correctly describe one. Skill portion tail: …${skillPortion.slice(-400)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// AT-10 — Part D: the project-repo write transaction must survive a mid-turn
// throw. `runDemoBuilderTurn` calls `ensureStudioBranch` BEFORE the phase
// dispatch and `commitStudioChange` AFTER it, with NO try/finally between —
// so a throw inside the generating step (e.g. runGenerateStep's existing
// required-file check) leaves the project repo checked out on `forge-studio`
// with the agent's writes UNCOMMITTED. Expected RED today.
// ---------------------------------------------------------------------------

function gitLine(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

test('AT-10 (Round-2, Part D): a throw inside runGenerateStep after the agent already wrote into the repo must not leave forge-studio dirty/uncommitted', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setup({ phase: 'generating' });

  // Turn repoPath into a REAL git repo (mirrors orchestrator/project-repo-tx.test.ts's setupRepo()).
  execFileSync('git', ['-C', repoPath, 'init', '-b', 'main'], { stdio: 'ignore' });
  gitLine(repoPath, ['config', 'user.email', 'test@forge.dev']);
  gitLine(repoPath, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(repoPath, 'README.md'), '# project\n');
  gitLine(repoPath, ['add', '-A']);
  gitLine(repoPath, ['commit', '-m', 'init']);

  const MARKER_REL = 'AGENT-PARTIAL-WORK-9c21.txt';
  const throwingQueryFn: QueryFn = ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      // The agent DOES write into the repo this turn ...
      writeFileSync(join(cwd, MARKER_REL), 'partial work from an agent turn that never finished the deliverables\n');
      // ... but never produces .forge/skills/demo-design/SKILL.md or
      // .forge/demo/DEMO.html, so runGenerateStep's existing required-file
      // check throws AFTER this write already landed on disk.
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId,
      projectRoot,
      forgeRoot: FORGE_ROOT,
      queryFn: throwingQueryFn,
      logger: loggerFor(logsRoot, sessionId),
      logsRoot,
    }),
    /demo-builder runner: the agent turn ended without producing/,
  );

  // ensureStudioBranch runs BEFORE the dispatch — that part already happens
  // today regardless of the defect.
  assert.equal(
    gitLine(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    'forge-studio',
    'the repo must be left on the forge-studio branch after the throw',
  );

  // What must ALSO have happened: the post-dispatch commitStudioChange step
  // (positioned AFTER the dispatch with no try/finally around it) must still
  // run when the dispatch throws — so the agent's write is committed, not left
  // dirty on disk.
  const status = gitLine(repoPath, ['status', '--porcelain']);
  assert.equal(
    status,
    '',
    `the working tree must be clean after the throw (the post-dispatch commit step must still run despite the mid-turn throw) — got dirty status:\n${status}`,
  );
  assert.match(
    gitLine(repoPath, ['log', '-1', '--pretty=%s']),
    /demo machinery/,
    'the post-dispatch commit ("forge-studio: demo machinery (...)") must have landed on forge-studio despite the throw',
  );
});
