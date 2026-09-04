import { setupRealAuthoring } from './test-fixtures/interactive-runner-fixtures.ts';
import { type TestStatus, loadFixtureDescriptor, logger, neverCalledQueryFn, noopAgentQueryFn, setup, snapshotDir } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';
import { SLUG_RE } from '@forge/agents/skill-path.ts';

// ---------------------------------------------------------------------------
// Finding 5 (orchestrator-ruled design change, NOT yet implemented): the
// finalize destination must NOT be the live skills registry
// (`skillsDir(forgeRoot)` == `<forgeRoot>/skills`, the tree production agent
// discovery actually scans — `listAgentDefinitions`/`discoverRuntimeAgentIds`
// treat ANY `SKILL.md` carrying a `runtime:` key as dispatchable, no slug
// gate). Ruling: the destination becomes a dedicated, NON-scanned root
// `<forgeRoot>/_interactive-library/<packageId>/...` (underscore-prefixed,
// matching `_queue`/`_logs`), and `packageId` must be slug-validated. Three
// pins: (a) lands under _interactive-library/, not skills/; (b) skills/ is
// not created as a side effect when absent; (c) a non-slug packageId is
// refused.
// ---------------------------------------------------------------------------

// Kills: the current `libraryRoot = skillsDir(forgeRoot)` — a finalize that
// installs a session-produced package into the SAME tree
// `listAgentDefinitions`/`discoverRuntimeAgentIds` scan for dispatchable
// agents (orchestrator/flow-runner.ts:1285, apps/forge/ui-bridge.ts:1678). Pins
// (a) the correct destination root and (b) that a fresh forgeRoot's
// (previously absent) skills/ is never auto-created as a side effect of a
// finalize that should never have touched it. Uses ITS OWN valid-slug
// packageId (not the shared fixture's ISO-shaped sessionId) so this test
// stays green independent of whichever order Finding 5(c)'s slug gate lands
// in — an invalid packageId would otherwise make this test's own finalize
// fail for an unrelated reason.
test('Finding 5(a)+(b): finalize lands the package under <forgeRoot>/_interactive-library/, NOT <forgeRoot>/skills, and does not create skills/ as a side effect', async () => {
  const { forgeRoot, logsRoot } = setup();
  const projectRoot = mkdtempSync(join(tmpdir(), 'interactive-runner-f5ab-proj-'));
  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const packageId = 'finding5-valid-slug';
  assert.match(packageId, SLUG_RE, 'arrange: packageId fixture must itself be a genuinely valid slug (SLUG_RE) or the test is vacuous');
  const sessionDir = join(projectRoot, descriptor.turnSpec!.kindDir, packageId);

  // Precondition, asserted before reading any verdict — doubles as pin (b)'s
  // baseline: skills/ must not pre-exist so a later re-appearance is
  // unambiguously this finalize's own doing.
  assert.ok(!existsSync(join(forgeRoot, 'skills')), 'arrange: forgeRoot/skills must not pre-exist');

  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: packageId, phase: 'committing', updated_at: new Date().toISOString() });
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(stagingDir, { recursive: true });
  const STAGED_CONTENT = '# committed package (Finding 5)\ncontent-marker-f5ab\n';
  writeFileSync(join(stagingDir, 'README.md'), STAGED_CONTENT);
  assert.equal(readFileSync(join(stagingDir, 'README.md'), 'utf8'), STAGED_CONTENT, 'arrange: staged file present');
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'committing', 'arrange: seeded status must start in committing');

  const result = await runInteractiveTurn(descriptor, {
    sessionId: packageId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: neverCalledQueryFn(),
    logger: logger(logsRoot, packageId),
  });

  assert.equal(result.phase, 'committed');
  assert.ok(result.wrote.length > 0, 'the finalize step must report at least one written path');
  const expectedLibraryRoot = join(forgeRoot, '_interactive-library');
  const liveSkillsRoot = join(forgeRoot, 'skills');
  for (const p of result.wrote) {
    assert.ok(
      p.startsWith(expectedLibraryRoot + '/') || p.startsWith(expectedLibraryRoot + '\\'),
      `written path must land under the dedicated, non-scanned _interactive-library/ root, not: ${p}`,
    );
    assert.ok(
      !p.startsWith(liveSkillsRoot),
      `written path must NOT land under forgeRoot/skills (the live, scanned skill-discovery tree): ${p}`,
    );
  }
  assert.ok(
    !existsSync(liveSkillsRoot),
    'forgeRoot/skills must not be created as a side effect of a finalize that never needed it',
  );
});

// Kills: the absence of ANY slug validation on `FinalizerContext.packageId`
// (today only the generic `isSafeSegment` runs, via `resolveGuardedPath`
// inside copyStagingToLibrary) — a raw session id lands as a directory name
// verbatim. Uses the shared fixture's own ISO-shaped sessionId
// ('2026-08-10T00-00-00') as the deliberately-invalid packageId: it starts
// with a digit and contains uppercase 'T', both illegal under SLUG_RE
// (packages/agents/skill-path.ts:43, `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/` — a
// leading lowercase letter is required), while still passing today's looser
// isSafeSegment check — exactly the gap the finding names.
test('Finding 5(c): a packageId that is not a valid slug (per SLUG_RE) is refused, not silently accepted into an oddly-named library directory', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  // Precondition, asserted before reading any verdict.
  assert.doesNotMatch(sessionId, SLUG_RE, 'arrange: fixture sessionId must genuinely be an invalid slug or the test is vacuous');

  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'committing', updated_at: new Date().toISOString() });
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'README.md'), '# package\n');
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'committing', 'arrange: seeded status must start in committing');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  await assert.rejects(
    () =>
      runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot,
        logsRoot,
        queryFn: neverCalledQueryFn(),
        logger: logger(logsRoot, sessionId),
      }),
    /slug/i,
    'a non-slug packageId must be refused loudly, not silently accepted into the library under an oddly-named directory',
  );
});

// ===========================================================================
// R4-21 phase 2, WI-1 (_wave5/unit-specs/R4-21-phase2.md) — the REAL
// "authoring" descriptor, loaded from the REAL, checked-in
// studio/session-kinds.yaml (REPO_ROOT — NOT a hand-built fixture object and
// NOT the synthetic FIXTURE_SESSION_KINDS_YAML above), drives
// runInteractiveTurn end to end. Every test above in this file proves the
// GENERIC turnSpec-runner mechanism against a synthetic `test-kind` fixture
// (already real production code, unaffected by phase 2). These three tests
// prove something the generic-mechanism suite structurally cannot: that the
// REAL "authoring" row in the checked-in YAML (D1 — ADR-043 §1 verbatim)
// actually carries the right kindDir/style/phases/writes/finalizer/next
// values — a typo or drift in that ONE production file (e.g. `writes:
// [package]` instead of `[staging]`, or a `finalizer:` id that doesn't match
// FINALIZER_IDS) would pass every synthetic-fixture test above unchanged,
// because those tests never read this file at all.
//
// forgeRoot is still an ISOLATED tmp dir (never the real repo root) — see
// interactive-runner.ts's own header note: `deriveAgentSpec`/`skillPath`
// resolve the agent's SKILL.md against the REAL forge install
// (`packages/agents/skill-path.ts`'s `FORGE_ROOT`, computed from
// `import.meta.dirname` — i.e. THIS repo checkout) regardless of
// `ctx.forgeRoot`, so `descriptor.agent: creation-agent` resolves against the
// real, already-shipped `skills/creation-agent/SKILL.md` for free; only the
// finalizer's library-root writes and the log root need a throwaway forgeRoot
// so this suite never touches the real repo's `_interactive-library/`.
// ===========================================================================




// R4-21 phase 2, WI-1 — the REAL "authoring" descriptor (REPO_ROOT) drives
// runInteractiveTurn. This file uses flat `test()` throughout (no
// `describe()`), matching the rest of this file's existing style.

// Kills: a "staging" typo anywhere in the real yaml's authoring turnSpec
  // (writes:, kindDir:, style:, phase names, next:) — every one of those
  // would make THIS test fail even though the synthetic test-kind fixture
  // above (AT-1) stays green, because AT-1 never reads this file.
  test('WI1-A: the real authoring descriptor at analyzing (style:agent, step:agent) runs the agent turn, writes staging/, advances to awaiting-review', async () => {
    const fx = setupRealAuthoring();
    mkdirSync(fx.sessionDir, { recursive: true });
    writeSessionStatus<TestStatus>(fx.sessionDir, { session_id: fx.sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
    // Precondition, asserted before reading any verdict.
    assert.equal(readSessionStatus<TestStatus>(fx.sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

    let queryFnCalled = false;
    const queryFn: QueryFn = () => {
      queryFnCalled = true;
      async function* gen(): AsyncGenerator<unknown> {
        // Simulates the real creation-agent's own Write-tool side effect
        // (queryFn is stubbed here — the SDK call itself is out of scope for
        // a unit acceptance test; the LIVE PROOF run exercises the real SDK).
        mkdirSync(join(fx.sessionDir, 'staging'), { recursive: true });
        writeFileSync(join(fx.sessionDir, 'staging', 'SKILL.md'), '# Authored Skill\n\nBody.\n');
        yield { type: 'result', total_cost_usd: 0.01 };
      }
      return gen();
    };

    const result = await runInteractiveTurn(fx.descriptor, {
      sessionId: fx.sessionId,
      projectRoot: fx.projectRoot,
      forgeRoot: fx.forgeRoot,
      logsRoot: fx.logsRoot,
      queryFn,
      logger: logger(fx.logsRoot, fx.sessionId),
    });

    assert.ok(queryFnCalled, 'the real authoring turnSpec\'s analyzing phase must actually invoke the agent-style primitive');
    assert.equal(result.phase, 'awaiting-review', 'the real authoring turnSpec\'s analyzing row must declare next: awaiting-review');
    assert.ok(existsSync(join(fx.sessionDir, 'staging', 'SKILL.md')), 'the file the agent turn wrote under staging/ must be on disk');
    assert.equal(
      readSessionStatus<TestStatus>(fx.sessionDir)?.phase,
      'awaiting-review',
      'status.json on disk must reflect the advanced phase',
    );
  });

  // Kills: a runner (or a real-yaml drift) that treats awaiting-review as
  // anything other than a true no-op for the real authoring kind.
  test('WI1-B: the real authoring descriptor at awaiting-review (step:noop) leaves the session dir byte-for-byte unchanged and does not advance the phase', async () => {
    const fx = setupRealAuthoring();
    mkdirSync(fx.sessionDir, { recursive: true });
    writeSessionStatus<TestStatus>(fx.sessionDir, { session_id: fx.sessionId, phase: 'awaiting-review', updated_at: new Date().toISOString() });
    writeFileSync(join(fx.sessionDir, 'staging_marker.txt'), 'pre-existing content that must survive untouched');
    // Precondition, asserted before reading any verdict.
    assert.equal(readSessionStatus<TestStatus>(fx.sessionDir)?.phase, 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

    const before = snapshotDir(fx.sessionDir);
    const result = await runInteractiveTurn(fx.descriptor, {
      sessionId: fx.sessionId,
      projectRoot: fx.projectRoot,
      forgeRoot: fx.forgeRoot,
      logsRoot: fx.logsRoot,
      queryFn: neverCalledQueryFn(),
      logger: logger(fx.logsRoot, fx.sessionId),
    });

    const after = snapshotDir(fx.sessionDir);
    assert.deepEqual(after, before, 'a noop step must not touch the session dir filesystem at all — asserted on the ARTIFACT');
    assert.equal(result.phase, 'awaiting-review', 'phase must not advance past the real authoring turnSpec\'s awaiting-review row');
  });

  // Kills: a runner (or a real-yaml drift) whose committing row names the
  // wrong finalizer id, or whose `next` doesn't land on "committed" — proven
  // against the D-4 destination this WI makes load-bearing:
  // <forgeRoot>/_interactive-library/demo-skill/SKILL.md (the unit-spec's own
  // literal worked example).
  test('WI1-C: the real authoring descriptor at committing (step:finalize, finalizer:copyStagingToLibrary), package_id:"demo-skill" — lands staging/SKILL.md at <forgeRoot>/_interactive-library/demo-skill/SKILL.md and advances to committed', async () => {
    const fx = setupRealAuthoring();
    mkdirSync(fx.sessionDir, { recursive: true });
    writeSessionStatus<TestStatus>(fx.sessionDir, {
      session_id: fx.sessionId,
      phase: 'committing',
      updated_at: new Date().toISOString(),
      package_id: 'demo-skill',
    });
    const stagingDir = join(fx.sessionDir, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    const STAGED_CONTENT = '# Authored Skill\n\nBody.\n';
    writeFileSync(join(stagingDir, 'SKILL.md'), STAGED_CONTENT);
    // Preconditions, asserted before reading any verdict.
    assert.equal(readFileSync(join(stagingDir, 'SKILL.md'), 'utf8'), STAGED_CONTENT, 'arrange: staged SKILL.md must be present before running the turn');
    assert.equal(readSessionStatus<TestStatus>(fx.sessionDir)?.phase, 'committing', 'arrange: seeded status must start in committing');
    const landedPath = join(fx.forgeRoot, '_interactive-library', 'demo-skill', 'SKILL.md');
    assert.equal(existsSync(landedPath), false, 'arrange: nothing must exist at the landing path before the turn runs');

    const result = await runInteractiveTurn(fx.descriptor, {
      sessionId: fx.sessionId,
      projectRoot: fx.projectRoot,
      forgeRoot: fx.forgeRoot,
      logsRoot: fx.logsRoot,
      queryFn: neverCalledQueryFn(),
      logger: logger(fx.logsRoot, fx.sessionId),
    });

    assert.equal(result.phase, 'committed');
    assert.ok(existsSync(landedPath), `expected the staged file to land at ${landedPath} — got wrote=${JSON.stringify(result.wrote)}`);
    assert.equal(readFileSync(landedPath, 'utf8'), STAGED_CONTENT, 'the landed file must carry the staged content verbatim');
    assert.equal(readSessionStatus<TestStatus>(fx.sessionDir)?.phase, 'committed', 'status.json on disk must reflect the advanced phase');
});

// ===========================================================================
// R4-21 phase 2, pin round 3 (T3, adversarial-review round 3) —
// _wave5/unit-specs/R4-21-phase2.md P1 (remaining contracts) + P4.
// REPRODUCED/ruled by a LIVE adversarial-review round against the real
// checked-in `authoring` descriptor. TEST-WRITER ONLY — no implementation
// code lives in this file. The P1 missing-dir refusal is pinned IN PLACE
// above (superseding the old "Finding 2/3 carve-out" test — see that test's
// own updated header for the full old/new rationale); the three remaining
// P1 contracts (present-but-empty is the SAME refusal, no writes: declared
// is the TRUE surviving carve-out, and the happy path is unaffected) plus
// P4 are pinned here.
// ===========================================================================

// Kills: an implementation of the P1 refusal that only checks
// `!existsSync(writesDir)` (missing) and misses the equally-empty
// present-but-empty case — "the turn produced nothing" must cover BOTH
// shapes identically, per the unit spec's own wording ("is the same refusal
// as a missing one").
test('P1: a declared writes: dir that EXISTS but is EMPTY is the SAME refusal as a missing one — both mean "the turn produced nothing"', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  const statusPath = join(sessionDir, 'status.json');
  const statusBefore = readFileSync(statusPath, 'utf8');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  // This queryFn creates staging/ but writes NOTHING into it — present, but
  // empty; the second shape of "the turn produced nothing".
  const emptyDirQueryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  await assert.rejects(
    () =>
      runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot,
        logsRoot,
        queryFn: emptyDirQueryFn,
        logger: logger(logsRoot, sessionId),
      }),
    (err: Error) => {
      assert.match(err.message, /test-kind/, 'error must name the session kind');
      assert.match(err.message, /analyzing/, 'error must name the phase');
      assert.match(err.message, /staging/, 'error must name the empty writes: entry');
      return true;
    },
  );

  // Sanity, asserted AFTER the run (this precondition is what the stub agent
  // did DURING the call, not something seedable beforehand): staging/ must
  // genuinely exist-but-be-empty, or this test is vacuous.
  assert.ok(existsSync(join(sessionDir, 'staging')), 'sanity: staging/ must have been created by the stub agent');
  assert.deepEqual(readdirSync(join(sessionDir, 'staging')), [], 'sanity: staging/ must genuinely be empty, or this test is vacuous');
  assert.equal(readFileSync(statusPath, 'utf8'), statusBefore, 'status.json must be BYTE-UNCHANGED after the refusal');
});

// Kills: an over-fix that refuses ANY phase row producing zero files,
// regardless of whether writes: was declared at all — P1's refusal is
// specifically about a DECLARED contract going unfulfilled, not "the agent
// didn't write anything this turn" in general. A phase row that never
// claims to write anything must stay a true no-op carve-out. Proven by
// mutation (see this WI's report): a temporary unconditional
// "wrote.length===0 -> throw" added right after listWrittenFiles turns this
// test red; reverted afterward.
test('P1 (true carve-out, must survive the fix): a phase row that declares NO writes: at all, and produces no files, still advances normally', async () => {
  const { forgeRoot } = setup();
  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-no-writes-declared');
  assert.equal(
    descriptor.turnSpec?.phases[0]?.writes,
    undefined,
    'arrange: fixture phase row must genuinely declare no writes: or this test is vacuous',
  );
  const sessionId = 'no-writes-declared-001';
  const projectRoot = mkdtempSync(join(tmpdir(), 'interactive-runner-nowrites-proj-'));
  const logsRoot = join(mkdtempSync(join(tmpdir(), 'interactive-runner-nowrites-logs-')), '_logs');
  const sessionDir = join(projectRoot, descriptor.turnSpec!.kindDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

  const result = await runInteractiveTurn(descriptor, {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: noopAgentQueryFn(),
    logger: logger(logsRoot, sessionId),
  });

  assert.deepEqual(result.wrote, [], 'a phase declaring no writes: at all must yield wrote: []');
  assert.equal(result.phase, 'awaiting-review', 'the phase must still advance normally — declaring no writes: is not itself an error');
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'awaiting-review', 'status.json on disk must reflect the advanced phase');
});

// Positive control for P1 (the happy path must be unaffected by the new
// refusal): a declared writes: dir that DOES contain a real file advances
// normally, exactly like AT-1 above — colocated here for narrative locality
// with the two refusal tests; AT-1 (top of this file) already carries this
// exact mechanism's own mutation-proof ("Kills:" comment there), so it is
// not re-derived from scratch here.
test('P1 (positive control): a declared writes: dir that DOES contain a file still advances normally', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  const result = await runInteractiveTurn(descriptor, {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-review', 'a populated declared writes: dir must still advance normally');
  assert.ok(result.wrote.length > 0, 'wrote must report the real file');
});

// ---------------------------------------------------------------------------
// P4 — the operator's description must reach the agent's turn prompt.
//
// `POST /api/studio/authoring/start` (apps/forge/ui-bridge.ts) writes the
// operator's free-text prompt to prompt.md, but `buildTurnPrompt` (this
// module) composes the turn prompt from SKILL.md + the phase row + a JSON
// dump of status.json — it never reads prompt.md. The intended production
// fix is that `writeAuthoringSession` (apps/forge/ui-bridge.ts, pinned separately
// in apps/forge/ui-bridge-authoring-start.test.ts) also persists the prompt into
// status.json. This is the OTHER half of that pin: WITH a status carrying a
// `prompt` field, proves the actual prompt string handed to queryFn contains
// the operator's text — the end-to-end proof the words actually reach the
// model, not just that they get written to a file nothing reads.
// ---------------------------------------------------------------------------

// Kills: a buildTurnPrompt that narrows its status dump to a fixed field set
// (e.g. `{phase: status.phase}`) instead of serializing the whole status
// object — which would silently drop a `prompt` field even once
// writeAuthoringSession starts writing one. Proven by mutation (see this
// WI's report): temporarily narrowing buildTurnPrompt's JSON.stringify to
// `{phase: status.phase}` turns this test red; reverted afterward.
test('P4: with status.prompt present, the actual prompt string handed to queryFn CONTAINS the operator\'s text — the end-to-end proof the words reach the model', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  const OPERATOR_TEXT = 'Build a hook that blocks commits containing TODO markers, marker-f4c2ab';
  writeSessionStatus<TestStatus & { prompt?: string }>(sessionDir, {
    session_id: sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
    prompt: OPERATOR_TEXT,
  });
  // Precondition, asserted before reading any verdict.
  assert.equal(
    readSessionStatus<TestStatus & { prompt?: string }>(sessionDir)?.prompt,
    OPERATOR_TEXT,
    'arrange: seeded status must carry the operator prompt',
  );

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  let captured: { prompt: string } | undefined;
  const queryFn: QueryFn = (params) => {
    captured = params;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  await runInteractiveTurn(descriptor, {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.ok(captured, 'queryFn must have been invoked with a captured call record');
  assert.ok(
    captured!.prompt.includes(OPERATOR_TEXT),
    `the actual prompt string handed to queryFn must CONTAIN the operator's text verbatim — got prompt=${JSON.stringify(captured!.prompt)}`,
  );
});

// ===========================================================================
// W7-C2 T1 review (P0-2 / finding A5) — feedback.md is CONSUME-ONCE.
//
// `readOperatorFeedback` runs on EVERY `step: agent` turn, not only the one a
// revise triggered, and nothing used to clear the file: round 1's corrections
// kept riding round 2's and round 3's prompts, silently steering turns the
// operator never aimed. Proven on the real generic spine below.
// ===========================================================================

test('C2-FIX-A5-2: an agent turn folds feedback.md into its prompt and then CONSUMES it — the next turn is not re-steered by the previous round\'s words', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  const FEEDBACK = 'Make the button blue, marker-a5c0de';
  writeFileSync(join(sessionDir, 'feedback.md'), FEEDBACK, 'utf8');
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const prompts: string[] = [];
  const queryFn: QueryFn = (params) => {
    prompts.push(params.prompt);
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });
  assert.ok(prompts[0].includes(FEEDBACK), `turn 1 must actually carry the operator's words: ${JSON.stringify(prompts[0])}`);
  assert.equal(existsSync(join(sessionDir, 'feedback.md')), false, 'the note is consumed once it has been folded into a prompt');

  // A SECOND turn from the same phase (the shape a redraft takes) must not
  // re-inject the already-applied round.
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });
  assert.equal(prompts.length, 2);
  assert.ok(!prompts[1].includes(FEEDBACK), `turn 2 must NOT be re-steered by round 1's words: ${JSON.stringify(prompts[1])}`);
});


