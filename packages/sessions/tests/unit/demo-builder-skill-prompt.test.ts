import { OPERATOR_GUIDANCE_SENTINEL, promptPathSource, SKILL_MD_PATH, loggerFor, makeWritingQueryFn, norm, setup } from './test-fixtures/demo-builder-skill-prompt-setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel';
import { runDemoBuilderTurn } from '../../kinds/demo-builder.ts';
import { demoTaskLines } from '../../kinds/demo-generate.ts';
import type { DemoBuilderStatus } from '../../kinds/demo-session-store.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { listDemoElements } from '@forge/library';
import type { DemoStep } from '@forge/contracts';

// ---------------------------------------------------------------------------
// AT-1 — prose-left-the-TS (grep-assert, both files read from disk at test time)
// ---------------------------------------------------------------------------

// Each entry's comment cites where the prose sat at base c45e3892 (then
// `demo-builder-runner.ts`, now `kinds/demo-builder.ts`); the assertions
// below are the live re-check on every run.
const MOVED_SENTENCES: Array<{ label: string; text: string }> = [
  // Bead forge-mfv5.2.8 retargeted this list: the three composer/element
  // branch sentences it used to carry named output the bead deletes. What it
  // pins now is the same property over the one generate turn — its task prose
  // lives in the SKILL, not in the runner.
  {
    label: 'generate-declaration — the narrowing rule for a targeted element',
    text: 'change only the steps bound to it and carry every other step over unchanged',
  },
  {
    label: 'generate-declaration — the sample is what the declaration drives',
    text: 'a sample of what the declaration drives',
  },
  {
    label: 'update-mode — "UPDATE MODE: a declaration is already locked"',
    text: 'UPDATE MODE: a declaration is already locked',
  },
  {
    // AMENDED by bead 6.11.49: this instruction lives in the `ground-it` turn,
    // whose pass has Bash; AT-10 below pins that no generate section carries it.
    label: 'grounding instruction — moved to the ground-it turn by the two-pass split (6.11.49)',
    text: 'render an actual before/after of it — real output on both sides, not a mock.',
  },
];

test('AT-1: prose-left-the-TS — the generate turn\'s distinctive instruction sentences live in skills/demo-builder/SKILL.md, never in the runner .ts', () => {
  const tsNorm = norm(promptPathSource());
  const skillNorm = norm(readFileSync(SKILL_MD_PATH, 'utf8'));

  for (const { label, text } of MOVED_SENTENCES) {
    const needle = norm(text);
    assert.ok(
      !tsNorm.includes(needle),
      `${label}: must be ABSENT from the kind's prompt path (kinds/demo-builder.ts + kinds/demo-generate.ts) — the prose must move to SKILL.md, and it is still there`,
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

test('AT-2: no fail-open remains — the generic fallback prompt string and the runner-private loadSkillPrompt are both gone from the kind\'s prompt path (kinds/demo-builder.ts + kinds/demo-generate.ts)', () => {
  const tsText = promptPathSource();
  assert.ok(
    !tsText.includes('You are the forge demo-builder agent.'),
    'the fail-open fallback prompt string must be removed — a fail-open here would ship an agent turn with NO task instructions and no signal',
  );
  assert.ok(
    !tsText.includes('loadSkillPrompt('),
    'the runner-private loadSkillPrompt function/call must be deleted — the runner must route through the shared loadSkillTurnPrompt loader (packages/agents/skill-path.ts) instead',
  );
});

// ---------------------------------------------------------------------------
// AT-3 — loaded-AND-USED + selection (fixture skillPromptPath, unique sentinels)
// ---------------------------------------------------------------------------

const BASE_SENTINEL = 'BASE-SENTINEL-9f3a2b (shared preamble — proves the fixture skillPromptPath was actually loaded)';
const DECLARATION_ONLY_SENTINEL = 'DECLARATION-ONLY-SENTINEL-71c4';
const GROUND_ONLY_SENTINEL = 'GROUND-ONLY-SENTINEL-3ba7 (the second pass only — must never reach the write pass, which has no Bash to ground anything with)';

/** Bead 7.3.6 (T1 ruling 642) — a generate turn runs the agent THREE times:
 *  READ, then WRITE, then GROUND. These tests are about what the WRITE pass is
 *  told, so they keep every prompt and read the second — and assert the count,
 *  so a change to the pass structure fails HERE, loudly, rather than quietly
 *  re-pointing every assertion below at a different pass. */
function writePassPrompt(prompts: readonly string[]): string {
  assert.equal(prompts.length, 3, 'a generate turn must run exactly three agent passes — read, write, ground');
  return prompts[1]!;
}

/** A fixture SKILL.md carrying one uniquely-sentineled section per turn id. */
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
      '<!-- turn: generate-declaration -->',
      DECLARATION_ONLY_SENTINEL,
      '',
      '<!-- turn: ground-it -->',
      GROUND_ONLY_SENTINEL,
      '',
    ].join('\n'),
  );
  return p;
}

// Every generate scenario — targeted element, element-bound declaration,
// free-text declaration — selects the ONE generate-declaration section
// (forge-mfv5.2.8 collapsed the three branches that each authored a skill).
const SCENARIOS: Array<{ label: string; overrides: Partial<DemoBuilderStatus>; demoProcess?: DemoStep[] }> = [
  { label: 'targetElement', overrides: { phase: 'generating', targetElement: 'cli-capture' }, demoProcess: [{ kind: 'capture', text: 'capture the cli', element: 'cli-capture' }] },
  { label: 'element-bound declaration', overrides: { phase: 'generating' }, demoProcess: [{ kind: 'capture', text: 'capture the cli', element: 'cli-capture' }, { kind: 'verify', text: 'npm test', element: 'test-evidence' }] },
  { label: 'free-text declaration', overrides: { phase: 'generating' } },
];

for (const { label, overrides, demoProcess } of SCENARIOS) {
  test(`AT-3: the ${label} scenario selects the generate-declaration section for the write pass and ground-it for the second`, async () => {
    const { projectRoot, logsRoot, sessionId } = setup(overrides, demoProcess);
    const skillPromptPath = writeSelectionFixture();
    const prompts: string[] = [];
    await runDemoBuilderTurn({
      sessionId, projectRoot, forgeRoot: FORGE_ROOT, skillPromptPath,
      queryFn: makeWritingQueryFn((p) => { prompts.push(p); }),
      logger: loggerFor(logsRoot, sessionId), logsRoot,
    });
    const captured = writePassPrompt(prompts);
    assert.ok(captured.includes(BASE_SENTINEL), 'the fixture skillPromptPath must actually be loaded (shared preamble present)');
    assert.ok(captured.includes(DECLARATION_ONLY_SENTINEL), 'the generate-declaration turn section must reach the write pass');
    assert.ok(!captured.includes(GROUND_ONLY_SENTINEL), 'the ground-it turn section must NOT reach the write pass, which has no Bash');
    assert.ok(prompts[2]!.includes(GROUND_ONLY_SENTINEL), 'the ground-it turn section must reach the SECOND pass');
  });
}

// ---------------------------------------------------------------------------
// AT-4 — fail-loud
// ---------------------------------------------------------------------------

test('AT-4: a skillPromptPath fixture with no turn markers makes the generate turn THROW, naming the skill and the turn id — never a silent default prompt', async () => {
  // Drives the one generate turn id, 'generate-declaration'. A queryFn that WOULD succeed if reached is
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
      assert.match(err.message, /generate-declaration/, 'the thrown message must name the turn id it could not find ("generate-declaration")');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// AT-5 — data-half preserved
// ---------------------------------------------------------------------------

test('AT-5: the prompt still carries the runner-injected DATA half — project name, repo path, operator guidance, operator feedback, the forge base stylesheet, and the current declaration in step order', async () => {
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

  const prompts: string[] = [];
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFn((p) => { prompts.push(p); }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });
  const captured = writePassPrompt(prompts);

  assert.ok(captured.includes('Project: AT5-DATA-PROJECT'), 'project name must be injected verbatim, in the "Project: <name>" form');
  assert.ok(captured.includes(repoPath), 'the project repo path must be injected verbatim');
  assert.ok(captured.includes(OPERATOR_GUIDANCE_SENTINEL), "the operator's look-and-feel guidance text must be injected verbatim");
  assert.ok(captured.includes(feedbackSentinel), 'the operator feedback.md content must be injected verbatim when it exists');

  const cssText = readFileSync(join(FORGE_ROOT, 'studio', 'demo', 'forge-demo.css'), 'utf8');
  const cssLine = cssText.split('\n').find((l) => l.includes('--bg:'));
  assert.ok(cssLine, 'sanity: the real forge base stylesheet must define --bg somewhere');
  assert.ok(captured.includes(cssLine!.trim()), 'the forge base stylesheet must be inlined into the prompt as a fenced block, verbatim from disk');
  assert.ok(captured.includes('```css'), 'the base stylesheet must remain fenced as a css code block');

  const steps = ['"text": "lead"', '"text": "capture the cli"', '"text": "npm test"'];
  const positions = steps.map((step) => {
    const i = captured.indexOf(step);
    assert.ok(i !== -1, `declared step ${step} must appear in the prompt`);
    return i;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i]! > positions[i - 1]!, 'the current declaration must preserve demoProcess step order (lead, capture the cli, npm test)');
  }
});

// Note (per lane instructions): the data half above is expected to legitimately
// be GREEN already at base — this AT still pins real value because it will go
// RED the moment an implementer starts moving DATA (not just prose) into
// SKILL.md, or drops a data field while re-authoring the prompt assembly.

// ---------------------------------------------------------------------------
// AT-6 — the exported demoTaskLines contract survives
// ---------------------------------------------------------------------------

test('AT-6: the demoTaskLines export contract survives — its output lists every declared step in descriptor order, both directly and via the runner-composed prompt', async () => {
  // Mirrors apps/forge/tests/contract/demo-descriptor-parity.test.ts's shared fixture
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
  const directLines = demoTaskLines({ steps: FIXTURE_STEPS, byId }).join('\n');
  const directPositions = ids.map((id) => {
    const i = directLines.indexOf(`"element": "${id}"`);
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
  const prompts: string[] = [];
  await runDemoBuilderTurn({
    sessionId,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFn((p) => { prompts.push(p); }),
    logger: loggerFor(logsRoot, sessionId),
    logsRoot,
  });
  const captured = writePassPrompt(prompts);
  const runnerPositions = ids.map((id) => {
    const i = captured.indexOf(`"element": "${id}"`);
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
// the generate turn, or breaks step ordering while re-authoring the prompt.

// ===========================================================================
// ROUND 2 — adversarial-review acceptance tests (R4-23 WI-2 round-2).
//   AT-9  (Part C) — positional-reference integrity: no turn section may
//         call a data item "above" when that data is emitted after it.
//   AT-10 (Part D) — the project-repo write transaction (ensureStudioBranch
//         → dispatch → commitStudioChange) must survive a mid-turn throw.
// AT-7 (a frozen catalog of pre-lane composer prose) and AT-8 (the composer
// quality bar reaching both composer branches) pinned the composer SKILL.md
// output bead forge-mfv5.2.8 removes; they went with it.
// ===========================================================================

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

test('AT-9 (Round-2, Part C): no stale "above" reference to data emitted after the skill/turn text, in any real generate scenario', async () => {
  async function composeRealPrompt(
    overrides: Partial<DemoBuilderStatus>,
    demoProcess?: DemoStep[],
  ): Promise<string> {
    const { projectRoot, logsRoot, sessionId } = setup(overrides, demoProcess);
    const prompts: string[] = [];
    const queryFn = makeWritingQueryFn((p) => { prompts.push(p); });
    await runDemoBuilderTurn({
      sessionId,
      projectRoot,
      forgeRoot: FORGE_ROOT,
      // NO skillPromptPath — this drives the REAL skills/demo-builder/SKILL.md.
      queryFn,
      logger: loggerFor(logsRoot, sessionId),
      logsRoot,
    });
    return writePassPrompt(prompts);
  }

  const elementProcess: DemoStep[] = [{ kind: 'capture', text: 'capture the cli', element: 'cli-capture' }];
  const composedProcess: DemoStep[] = [
    { kind: 'capture', text: 'capture the cli', element: 'cli-capture' },
    { kind: 'verify', text: 'npm test', element: 'test-evidence' },
  ];

  const branches: Array<{ label: string; prompt: string }> = [
    { label: 'targetElement', prompt: await composeRealPrompt({ phase: 'generating', targetElement: 'cli-capture' }, elementProcess) },
    { label: 'element-bound declaration', prompt: await composeRealPrompt({ phase: 'generating' }, composedProcess) },
    { label: 'free-text declaration', prompt: await composeRealPrompt({ phase: 'generating' }) },
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

  // Turn repoPath into a REAL git repo (mirrors packages/projects/tests/regression/project-repo-tx.test.ts's setupRepo()).
  execFileSync('git', ['-C', repoPath, 'init', '-b', 'main'], { stdio: 'ignore' });
  gitLine(repoPath, ['config', 'user.email', 'test@forge.dev']);
  gitLine(repoPath, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(repoPath, 'README.md'), '# project\n');
  gitLine(repoPath, ['add', '-A']);
  gitLine(repoPath, ['commit', '-m', 'init']);

  // AMENDED 2026-09-11 (bead 7.3.6, T1 ruling 593). The agent now writes TWO
  // things: partial work inside its OWN territory, and a file at the repo root
  // that is NOT its to commit. The original wrote only the root file and then
  // asserted the tree ended CLEAN — which could only pass by the commit step
  // sweeping it up, and that sweep is the defect this bead names. Two funded
  // S1 runs produced `forge-studio: demo machinery (generating)` commits of 9
  // and 10 files that were the ONBOARDING agent's leftovers, containing no
  // demo at all. A test that asserts the sweep agrees with the bug.
  const MARKER_REL = 'AGENT-PARTIAL-WORK-9c21.txt';
  const OWN_PARTIAL_REL = '.forge/demo/partial-fragment.html';
  const throwingQueryFn: QueryFn = ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      // The agent DOES write into the repo this turn ...
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      writeFileSync(join(cwd, OWN_PARTIAL_REL), '<!-- half a fragment -->\n');
      writeFileSync(join(cwd, MARKER_REL), 'partial work from an agent turn that never finished the deliverables\n');
      // ... but never produces .forge/demo/demo-process.json or
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
    // AMENDED by row 190 (forge-8vfn.8.5.28): the root write is a ground
    // breach, and the ground fence after passes 1+2 names it before the
    // missing-deliverable check runs. Still a throw after the write landed,
    // which is all the commit-scope assertions below need. Row 190b (ruling
    // 1973fa) reworded it: the fence judges project source only.
    /demo-builder runner: the read\+write pass changed the project's source \(outside [^)]*\): AGENT-PARTIAL-WORK-9c21\.txt/,
  );

  // ensureStudioBranch runs BEFORE the dispatch — that part already happens
  // today regardless of the defect.
  assert.equal(
    gitLine(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    'forge-studio',
    'the repo must be left on the forge-studio branch after the throw',
  );

  // What must ALSO have happened, unchanged in intent: the post-dispatch
  // commit step still runs when the dispatch throws, so the agent's own write
  // is committed rather than left dirty on disk.
  assert.match(
    gitLine(repoPath, ['log', '-1', '--pretty=%s']),
    /demo machinery/,
    'the post-dispatch commit ("forge-studio: demo machinery (...)") must have landed on forge-studio despite the throw',
  );
  assert.match(
    gitLine(repoPath, ['show', '--stat', '--name-only', '--format=', 'HEAD']),
    new RegExp(OWN_PARTIAL_REL.replace(/[.]/g, '\\.')),
    'the agent\'s own partial write belongs in that commit — surviving the throw is the point of this test',
  );
  // AMENDED (7.3.6): what must NOT have happened. A file at the repo root is
  // outside the demo builder's write territory; committing it under a "demo
  // machinery" subject is how another agent's work ends up in this agent's
  // history, which is what two funded runs measured.
  assert.match(
    gitLine(repoPath, ['status', '--porcelain']),
    new RegExp(MARKER_REL.replace(/[.]/g, '\\.')),
    'a file outside the demo builder\'s territory must be left uncommitted for whoever owns it',
  );
});

// ---------------------------------------------------------------------------
// AT-10 — the two-pass split's own contract, in the SKILL (bead 6.11.49).
//
// AT-1 and AT-7 above were amended to follow the grounding instruction into the
// `ground-it` turn. That alone would be a weaker pin than what it replaced: an
// instruction is allowed to be in two places, and a generate section that still
// said "capture real output" would satisfy both. This is the half that makes
// the amendment a tightening — the write pass has NO Bash, so a generate turn
// that asks for captured output asks for something the agent cannot do, which
// is exactly the shape ruling 374 recorded (two instructions fighting, and the
// skill wins).
// ---------------------------------------------------------------------------

const GROUNDING_PHRASES = [
  'Use Bash to actually check out / build / run',
  'real output on both sides, not a mock',
  'REAL output, never fabricated',
];

test('AT-10: no generate-* turn section instructs the agent to capture real output — the write pass has no Bash', () => {
  const skill = readFileSync(SKILL_MD_PATH, 'utf8');
  const sections = skill.split(/<!-- turn: /).slice(1);
  const generate = sections.filter((sec) => sec.startsWith('generate-'));
  assert.equal(generate.length, 1, 'the skill must declare exactly one generate turn (forge-mfv5.2.8)');
  const ground = sections.filter((sec) => sec.startsWith('ground-it'));
  assert.equal(ground.length, 1, 'the skill must declare the ground-it turn the second pass loads');

  for (const sec of generate) {
    const turn = sec.slice(0, sec.indexOf(' '));
    for (const phrase of GROUNDING_PHRASES) {
      assert.ok(
        !sec.includes(phrase),
        `turn "${turn}" tells the WRITE pass to ${phrase} — but that pass runs with Bash removed, so the instruction cannot be obeyed`,
      );
    }
  }
  assert.ok(
    GROUNDING_PHRASES.some((phrase) => ground[0]!.includes(phrase)),
    'the ground-it turn must carry the grounding instruction the generate turns gave up',
  );
});
