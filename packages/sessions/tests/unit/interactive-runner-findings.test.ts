import { type TestStatus, loadFixtureDescriptor, logger, neverCalledQueryFn, noopAgentQueryFn, setup } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';
import { modelForSpec } from '@forge/agents/phase-agent.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { skillPathRelative } from '@forge/agents/skill-path.ts';

// =============================================================================
// R4-22 WI-3 adversarial-review round — four reviewer-confirmed findings
// (Finding 1, Finding 2/3, Finding 4, Finding 5), pinned as RED tests against
// the REAL module (not a hypothetical). Findings 1-4 are reviewer-reproduced
// defects in the shipped spine; Finding 5 is an orchestrator-ruled design
// change the current code has not yet implemented. TEST-WRITER ONLY — no
// implementation code lives in this file.
// =============================================================================

// ---------------------------------------------------------------------------
// Finding 1 (reviewer-reproduced): `phaseRow.next` is written to status.json
// unconditionally whenever it is set, with NO check that `next` names a real
// row in turnSpec.phases. Reproduced: a turnSpec with `next: ghost-next-phase`
// runs the turn successfully, returns `{"phase":"ghost-next-phase",...}`,
// PERSISTS that phase to status.json, and only the NEXT invocation throws —
// bricking the session a turn late with no recovery but a manual status.json
// edit. Two call sites share the defect: runAgentStyleStep (~313-316) and
// runFinalizeStep (~376-379) — pinned separately below since they are
// separate code paths that could be fixed (or left unfixed) independently.
// ---------------------------------------------------------------------------

// Kills: a runner that writes `phaseRow.next` to status.json unconditionally
// whenever it is set, without checking it names a real row in
// turnSpec.phases (interactive-runner.ts runAgentStyleStep, ~313-316).
// Reviewer-reproduced: today this turn resolves SUCCESSFULLY with
// result.phase === "ghost-next-phase" and status.json is advanced to it —
// the throw only happens on the NEXT turn, a session-bricking typo
// discovered one turn late. This pin requires the throw on THIS triggering
// turn, and requires status.json to remain un-advanced (the artifact, not
// just the caught error, is the proof).
test('Finding 1: an agent-step phase whose `next` names a phase absent from turnSpec.phases throws LOUD on the triggering turn and does NOT persist the ghost phase to status.json', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-ghost-next-agent');
  assert.equal(descriptor.turnSpec?.phases[0]?.next, 'ghost-next-phase', 'arrange: fixture next must genuinely be dangling');
  const sessionId = 'ghost-next-agent-001';
  const sessionDir = join(projectRoot, descriptor.turnSpec!.kindDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

  await assert.rejects(
    () =>
      runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot,
        logsRoot,
        queryFn: noopAgentQueryFn(),
        logger: logger(logsRoot, sessionId),
      }),
    /ghost-next-phase/,
    'must throw on the SAME turn that declares the ghost `next`, naming the offending value',
  );

  assert.equal(
    readSessionStatus<TestStatus>(sessionDir)?.phase,
    'analyzing',
    'status.json on disk must NOT have been advanced to the ghost phase — asserting the ARTIFACT, not merely that a throw happened',
  );
});

// Kills: runFinalizeStep's identical unconditional `next` write
// (interactive-runner.ts ~376-379) — the same defect at the OTHER call site
// the finding names. The finalizer itself (copyStagingToLibrary) succeeds
// normally here (a real staged file, a real destination) — the bug is
// strictly in what happens to status.json AFTER a successful finalize.
test('Finding 1: a finalize-step phase whose `next` names a phase absent from turnSpec.phases throws LOUD on the triggering turn and does NOT persist the ghost phase to status.json', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-ghost-next-finalize');
  assert.equal(descriptor.turnSpec?.phases[0]?.next, 'ghost-next-phase', 'arrange: fixture next must genuinely be dangling');
  const sessionId = 'ghost-next-finalize-001';
  const sessionDir = join(projectRoot, descriptor.turnSpec!.kindDir, sessionId);
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'x.md'), 'x');
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'committing', updated_at: new Date().toISOString() });
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'committing', 'arrange: seeded status must start in committing');

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
    /ghost-next-phase/,
    'must throw on the SAME turn that declares the ghost `next`, naming the offending value',
  );

  assert.equal(
    readSessionStatus<TestStatus>(sessionDir)?.phase,
    'committing',
    'status.json on disk must NOT have been advanced to the ghost phase — asserting the ARTIFACT, not merely that a throw happened',
  );
});

// ---------------------------------------------------------------------------
// Finding 2/3 (reviewer-reproduced): `listWrittenFiles` silently drops a
// guard-rejected entry (`if (p === null) continue;`) instead of throwing —
// unlike its own claimed sibling, `interactive-finalizers.ts`'s
// `discoverStagingEntries`, which THROWS a named error on the identical
// rejection shape. Both shapes fail CLOSED (no disclosure/write escape) but
// `result.wrote` silently under-reports. Two escape shapes, both pinned
// below, PLUS the deliberate legitimate-negative carve-out that must
// survive whatever fix lands.
// ---------------------------------------------------------------------------

// Kills: `listWrittenFiles`'s `if (p === null) continue;` (interactive-
// runner.ts ~408-434) silently dropping a guard-rejected entry found while
// walking a `writes:` dir. Reviewer-reproduced shape 1: a symlink planted
// INSIDE an otherwise-real `writes:` dir, pointing outside the session.
// Today this entry simply vanishes from `result.wrote` with zero signal;
// this pin requires a named, entry-identifying throw instead, matching
// `discoverStagingEntries`'s own convention (interactive-finalizers.ts
// ~208-212).
test('Finding 2/3: a guard-rejected FILE symlink inside a writes: dir throws a named error identifying the offending entry, not a silent drop', async (t) => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(stagingDir, { recursive: true });
  const outsideDir = mkdtempSync(join(tmpdir(), 'interactive-runner-f23-outside-'));
  const outsideFile = join(outsideDir, 'secret.txt');
  const SECRET_BYTES = 'SECRET-OUTSIDE-CONTENT-f23a';
  writeFileSync(outsideFile, SECRET_BYTES);
  const evilLink = join(stagingDir, 'evil-link.txt');
  try {
    symlinkSync(outsideFile, evilLink);
  } catch {
    t.skip('symlink creation unavailable in this environment');
    return;
  }
  assert.ok(lstatSync(evilLink).isSymbolicLink(), 'arrange: evil-link.txt must genuinely be a symlink or the test is vacuous');
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  await assert.rejects(
    () =>
      runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot,
        logsRoot,
        queryFn: noopAgentQueryFn(),
        logger: logger(logsRoot, sessionId),
      }),
    /evil-link/,
    'a guard-rejected entry inside a writes: dir must throw a NAMED error identifying the offending entry — matching discoverStagingEntries\'s own convention, not silently "continue"',
  );

  assert.equal(readFileSync(outsideFile, 'utf8'), SECRET_BYTES, 'the outside file must be byte-unchanged (this is a disclosure-signal fix, not a containment fix — both shapes already fail closed)');
});

// Kills: the same `if (p === null) continue;` drop, at the TOP-LEVEL
// `writes:` dir itself. Reviewer-reproduced shape 2: the declared `writes:`
// dir is ITSELF a symlink pointing outside the session. Today this
// collapses to `result.wrote: []` with zero signal — INDISTINGUISHABLE from
// the legitimate "this phase hasn't populated writes: yet" case (the next
// test pins that legitimate case must still return `[]`, not throw, so a
// fix cannot conflate the two).
test('Finding 2/3: a writes: dir that is ITSELF a symlink to an outside dir throws a named error, not a silent wrote:[] indistinguishable from "not yet populated"', async (t) => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  const outsideDir = mkdtempSync(join(tmpdir(), 'interactive-runner-f23-dirsym-outside-'));
  writeFileSync(join(outsideDir, 'marker.txt'), 'OUTSIDE-DIR-MARKER-f23b');
  const stagingPath = join(sessionDir, 'staging');
  try {
    symlinkSync(outsideDir, stagingPath);
  } catch {
    t.skip('symlink creation unavailable in this environment');
    return;
  }
  assert.ok(lstatSync(stagingPath).isSymbolicLink(), 'arrange: staging must genuinely be a symlink or the test is vacuous');
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  await assert.rejects(
    () =>
      runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot,
        logsRoot,
        queryFn: noopAgentQueryFn(),
        logger: logger(logsRoot, sessionId),
      }),
    /staging/,
    'a writes: dir that is itself a guard-rejected symlink must throw a named error — collapsing to wrote:[] is exactly the finding\'s reported ambiguity with the legitimate "not yet populated" case',
  );
});

// SUPERSEDED (R4-21 phase 2, pin round 3, T3 — P1, _wave5/unit-specs/
// R4-21-phase2.md): this test used to pin "a writes: dir that simply does
// not exist yet does NOT throw and yields wrote: []" as the deliberate
// carve-out surviving the Finding 2/3 fix (WI-3). A LATER adversarial-review
// round REPRODUCED a bigger problem sitting on top of that exact behavior:
// with the real checked-in `authoring` descriptor, an agent turn that
// yields zero files still advances analyzing -> awaiting-review and returns
// `{phase:'awaiting-review', wrote:[]}` with `staging/` not even existing —
// the operator is then shown an empty package with no error anywhere.
// Finding 2/3's own distinction (a GUARD-REJECTED entry vs. a
// genuinely-missing dir) is real and stays fixed; the distinction THIS test
// used to encode ON TOP of it (missing-dir-is-always-fine) does not survive:
// a phase row that DECLARES writes: and produces NOTHING must now refuse the
// advance loudly, whether the dir is missing or present-but-empty (see the
// P1 block near the end of this file for the full contract, including the
// TRUE surviving carve-out: a phase row that declares NO writes: at all).
//
// OLD assertion: `result.wrote` deep-equals `[]`, `result.phase` advances to
// 'awaiting-review', no throw.
// NEW assertion: `runInteractiveTurn` REJECTS, naming the session kind, the
// phase, and the empty `writes:` entry; status.json is byte-unchanged.
// Why this is a CONTRACT CORRECTION, not a weakening: the old behavior let a
// turn that produced literally nothing advance silently — a declared
// `writes:` contract enforced nowhere, exactly the declared-data-fails-open
// antipattern this campaign guards against everywhere else in this same
// file (Finding 1's ghost-`next`, Finding 2/3's guard-rejected entries). The
// new behavior makes the SAME class of turn fail LOUD instead of silently
// shipping an operator-facing empty package — strictly more protective, not
// less; nothing that was correctly rejected before is now accepted.
test('P1: a declared writes: dir that does not exist yet — the turn produced NOTHING — refuses the phase advance loudly, naming the session kind/phase/entry, and does NOT persist the ghost advance to status.json', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  // Precondition, asserted before reading any verdict: staging/ genuinely
  // absent (not merely un-checked).
  assert.ok(!existsSync(join(sessionDir, 'staging')), 'arrange: staging/ must genuinely not exist yet');
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');
  const statusPath = join(sessionDir, 'status.json');
  const statusBefore = readFileSync(statusPath, 'utf8');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  // This queryFn deliberately does NOT create staging/ — the agent simply
  // produced nothing this turn.
  await assert.rejects(
    () =>
      runInteractiveTurn(descriptor, {
        sessionId,
        projectRoot,
        forgeRoot,
        logsRoot,
        queryFn: noopAgentQueryFn(),
        logger: logger(logsRoot, sessionId),
      }),
    (err: Error) => {
      assert.match(err.message, /test-kind/, 'error must name the session kind');
      assert.match(err.message, /analyzing/, 'error must name the phase');
      assert.match(err.message, /staging/, 'error must name the empty writes: entry');
      return true;
    },
  );

  assert.equal(
    readFileSync(statusPath, 'utf8'),
    statusBefore,
    'status.json must be BYTE-UNCHANGED after the refusal — asserting the artifact, not just the thrown error',
  );
});

// ---------------------------------------------------------------------------
// Finding 4 (reviewer-confirmed test gap): AT-1's stub queryFn ignores its
// own prompt/options arguments entirely, so a defect threading the wrong
// model, an empty allowedTools, or the wrong cwd into the real turn would
// still pass unnoticed. This pin captures the {prompt, options} the spine
// actually hands queryFn and asserts the ADR-024 derivation — derived from
// the REAL helpers here, never hardcoded, so the pin cannot rot.
// ---------------------------------------------------------------------------

// Kills: any refactor of runAgentStyleStep that threads the wrong model
// (e.g. a hardcoded default instead of `modelForSpec(deriveAgentSpec(...))`),
// an empty/wrong `allowedTools` (e.g. forgetting to pass `agentSpec.
// allowedTools` through to `runAgentTurn`), or otherwise breaks the ADR-024
// derivation chain between `descriptor.agent` and what queryFn actually
// receives — none of which AT-1 itself would catch, since AT-1's queryFn
// stub never inspects its own arguments.
test('Finding 4: the ADR-024 derivation actually threads into the queryFn call — model + allowedTools match the real skill-derived spec', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');

  let captured: { prompt: string; options?: Record<string, unknown> } | undefined;
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

  // Derive the EXPECTED values from the real helpers, exactly as the spine
  // itself does (deriveAgentSpec resolves against the REAL forge install
  // root — the default parameter — never the fixture forgeRoot; see the
  // runner's own header note) — never hardcoded literals, so this pin
  // cannot rot as the underlying SKILL.md/tier mapping changes.
  const expectedSpec = deriveAgentSpec(skillPathRelative(descriptor.agent));
  const expectedModel = modelForSpec(expectedSpec);

  const options = captured!.options ?? {};
  assert.equal(
    options.model,
    expectedModel,
    'the model handed to queryFn must be the ADR-024-derived model (modelForSpec(deriveAgentSpec(skillPathRelative(descriptor.agent)))), not a hardcoded/default one',
  );
  assert.ok(
    Array.isArray(options.allowedTools) && (options.allowedTools as unknown[]).length > 0,
    'allowedTools handed to queryFn must be present and non-empty',
  );
  // W7-A2 (sessions-kinds-V01): this phase row declares `writes: [staging]`,
  // so the write-root fence is ACTIVE for the turn — `runAgentTurn` then
  // runs in `permissionMode: 'default'` and STRIPS the fence-gated tool
  // names (Write/Edit/MultiEdit/NotebookEdit) from `allowedTools` so the SDK
  // routes those calls through `canUseTool` instead of pre-approving them
  // (both `acceptEdits` and an allowedTools entry bypass canUseTool — the
  // hole the operator's community-refresh session escaped through, before
  // that kind was retired in W8-B5b). Every NON-gated grant still equals the
  // derived spec's own grant exactly.
  const FENCE_GATED = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  assert.deepEqual(
    options.allowedTools,
    expectedSpec.allowedTools.filter((t) => !FENCE_GATED.has(t)),
    'allowedTools handed to queryFn must equal the derived spec\'s own grant minus the fence-gated tools (a writes:-declaring row arms the fence) — the "assert the call record, not just the outcome" discipline',
  );
  assert.ok(expectedSpec.allowedTools.some((t) => FENCE_GATED.has(t)), 'precondition: the fixture agent grants a gated tool, so the strip is observable');
  assert.equal(options.permissionMode, 'default', 'a fenced turn must not run under acceptEdits');
  assert.equal(typeof options.canUseTool, 'function', 'a fenced turn installs canUseTool');
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam) — status.modelTier is
// read back and resolved through resolveSessionModel on EVERY turn.
// descriptor.agent === 'project-brain-builder' here (strategy:fixed, sonnet).
// ---------------------------------------------------------------------------

test('status.modelTier equal to the fixed tier ("sonnet") is honored — reaches queryFn as options.model', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString(), modelTier: 'sonnet' });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  let capturedModel: string | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedModel = (options as { model?: string } | undefined)?.model;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(capturedModel, 'claude-sonnet-4-6');
});

test('status.modelTier absent resolves to the unchanged default — byte-identical prior behavior (pins Finding 4\'s own expectation)', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const expectedSpec = deriveAgentSpec(skillPathRelative(descriptor.agent));
  const expectedModel = modelForSpec(expectedSpec);

  let capturedModel: string | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedModel = (options as { model?: string } | undefined)?.model;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(capturedModel, expectedModel);
});

test('status.modelTier mismatching the fixed tier throws naming the value and the allowed set', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString(), modelTier: 'opus' });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  await assert.rejects(
    () => runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) }),
    /requested model tier "opus".*allowed tier\(s\): sonnet/,
  );
});

