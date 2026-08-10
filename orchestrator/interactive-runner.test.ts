/**
 * R4-22 WI-3 (T3, acceptance tests) — pins the contract for the generic
 * interactive-turn runner, `orchestrator/interactive-runner.ts`, BEFORE it
 * exists (ADR-043 §2: docs/decisions/043-generic-interactive-surface.md).
 *
 * `runInteractiveTurn(descriptor, ctx)` is the ONE spine every future
 * `turnSpec`-bearing session kind runs through instead of a bespoke
 * `orchestrator/*-runner.ts`. It owns, once: the SEC-04 containment preamble
 * (`resolveGuardedPath(projectRoot, [kindDir, sessionId])` →
 * `guardedReadSessionStatus`), the ADR-024 spec/model/prompt derivation
 * (`deriveAgentSpec(skillPathRelative(agent))` → `modelForSpec`), the shared
 * telemetry (`createLogger` / `makeToolEventSink` / `flushIteration(1)`), and
 * the phase-table dispatch loop (`status.phase` → matching `turnSpec.phases`
 * row → run the row's `step` → advance to `next`).
 *
 * RED-NOW: this whole suite fails at import time
 * ("Cannot find module './interactive-runner.ts'") because the module does
 * not exist yet — see the run output recorded in this WI's report. No
 * implementation code lives in this file.
 *
 * ---------------------------------------------------------------------------
 * FIXTURE DESIGN
 * ---------------------------------------------------------------------------
 *
 * No real `studio/session-kinds.yaml` row carries a `turnSpec` yet (that
 * lands with a later WI), so every test here builds its OWN tiny forgeRoot
 * with its own `studio/session-kinds.yaml` and loads descriptors through the
 * REAL `loadSessionKinds` parse path (studio/session-kinds.ts) rather than a
 * hand-built object literal — three rows, all shaped exactly like ADR-043
 * §1's own worked example:
 *
 *   - `test-kind`               — the ADR's 4-phase table verbatim
 *                                 (analyzing→agent, awaiting-review→noop,
 *                                 committing→finalize(copyStagingToLibrary),
 *                                 committed→terminal), kindDir `_interactivetest`.
 *   - `test-kind-bad-finalizer` — a `committing` phase naming a finalizer id
 *                                 that does NOT exist in FINALIZERS.
 *   - `test-kind-bad-kinddir`   — a `kindDir` that is itself a traversal
 *                                 string (`../evil-escape`).
 *
 * `agent: project-brain-builder` — a REAL skill already on this branch
 * (skills/project-brain-builder/SKILL.md, `allowed-tools: […, Write]`,
 * `runtime: {sdk: claude, strategy: fixed, model: claude-sonnet-4-6}`) so
 * `deriveAgentSpec(skillPathRelative(descriptor.agent))` resolves for real
 * instead of throwing on a fabricated agent id — the ADR-024 derivation leg
 * is exercised genuinely, only the LLM call itself is stubbed via `queryFn`.
 *
 * ---------------------------------------------------------------------------
 * MY CALL, on the parts ADR-043 / the WI-3 brief leave open (stated
 * explicitly, mirroring the WI-2 finalizers suite's own precedent, so the
 * implementer has one target):
 * ---------------------------------------------------------------------------
 *
 *   1. `FinalizerContext.libraryRoot` / `.packageId` derivation from
 *      `ctx.forgeRoot` + the session is UNSPECIFIED by ADR-043 and the WI-3
 *      brief — there is no `turnSpec` field, no `ctx` field, and no existing
 *      config constant anywhere in the repo that names it (grepped; the only
 *      precedent is the WI-2 finalizers suite's OWN test-local guess,
 *      `join(forgeRoot, 'library')`). The finalize-step test (AT-3) does NOT
 *      assert a hardcoded destination path for this reason: it asserts
 *      exclusively through the runner's OWN return contract (`result.wrote`
 *      entries must exist on disk and byte-match the staged content), which
 *      holds regardless of which literal directory the implementer picks. As
 *      a filesystem-precondition hedge only (copyStagingToLibrary's own
 *      contract requires its `libraryRoot` to already exist —
 *      `realpathSync` throws otherwise), the fixture pre-creates BOTH
 *      plausible candidates (`<forgeRoot>/library` and
 *      `<forgeRoot>/studio/library`) so the test does not spuriously fail on
 *      "containment root does not exist" for a reason unrelated to the
 *      runner's actual correctness. Flagged in the WI-3 report as a real
 *      open question, not silently resolved here.
 *   2. `result.artifacts` semantics are entirely unpinned by ADR-043's
 *      signature (`Record<string, unknown>` with no key contract stated
 *      anywhere). Left unasserted throughout this file rather than guessed —
 *      pinning invented keys here would dictate an implementation choice
 *      nobody has actually made yet.
 *   3. The local `TestStatus` shape (`{ session_id, phase, updated_at }`) is
 *      this file's own minimal status-file fixture — `runInteractiveTurn` is
 *      generic over any `{ phase: string, … }` JSON, mirroring how
 *      `guardedReadSessionStatus<S>` is generic in interactive-session.ts.
 *
 * Every test asserts its seeded precondition (the status file's phase, or an
 * outside canary's content / a directory's entry list) BEFORE invoking
 * `runInteractiveTurn` and reading any verdict, per this initiative's T3
 * discipline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// RED-NOW: this module does not exist yet — see the report for the exact
// failure this import produces.
import { runInteractiveTurn } from './interactive-runner.ts';

import { loadSessionKinds, type SessionKindDescriptor } from './studio/session-kinds.ts';
import { writeSessionStatus, readSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from './logging.ts';

// ---------------------------------------------------------------------------
// Fixture yaml — three rows, all real-parsed through loadSessionKinds.
// ---------------------------------------------------------------------------

const FIXTURE_SESSION_KINDS_YAML = `
- id: test-kind
  agent: project-brain-builder
  title: Interactive Runner Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
      - { phase: committing, step: finalize, finalizer: copyStagingToLibrary, next: committed }
      - { phase: committed, step: terminal }
- id: test-kind-bad-finalizer
  agent: project-brain-builder
  title: Interactive Runner Test Kind (unregistered finalizer)
  stages: [committing]
  defaultStage: committing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-badfin
    style: agent
    phases:
      - { phase: committing, step: finalize, finalizer: totallyBogusFinalizerId, next: committed }
      - { phase: committed, step: terminal }
- id: test-kind-bad-kinddir
  agent: project-brain-builder
  title: Interactive Runner Test Kind (traversal kindDir)
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: "../evil-escape"
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
`;

// ---------------------------------------------------------------------------
// Shared fixture helpers — every test builds its own isolated tempdir tree;
// nothing depends on process.cwd() or ambient state.
// ---------------------------------------------------------------------------

type TestStatus = { session_id: string; phase: string; updated_at: string };

type Fixture = {
  root: string;
  forgeRoot: string;
  projectRoot: string;
  logsRoot: string;
  /** The "good" test-kind's session id + dir (kindDir=_interactivetest). */
  sessionId: string;
  sessionDir: string;
};

function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-10T00-00-00';
  const sessionDir = join(projectRoot, '_interactivetest', sessionId);
  return { root, forgeRoot, projectRoot, logsRoot, sessionId, sessionDir };
}

function loadFixtureDescriptor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

const logger = (logsRoot: string, sid: string) => createLogger(`_interactive-runner-test-${sid}`, logsRoot);

/** A queryFn stub that fails the test outright if ever invoked — proves a
 *  containment/dispatch rejection happens BEFORE any turn logic runs. */
function neverCalledQueryFn(): QueryFn {
  return () => {
    throw new Error('queryFn must not be called for this test — the runner must refuse before reaching a turn');
  };
}

/** Recursively snapshot a directory as a sorted { relPath: content } map, for
 *  byte-for-byte before/after comparison. Absent dir ⇒ {}. */
function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(current: string, rel: string): void {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) out[relPath] = readFileSync(abs, 'utf8');
    }
  }
  if (existsSync(dir)) walk(dir, '');
  return out;
}

// ---------------------------------------------------------------------------
// AT-1 (ADR criterion 1): analyzing + style:agent/step:agent runs the agent
// turn, writes staging, advances to awaiting-review.
// ---------------------------------------------------------------------------

// Kills: a runner that never actually invokes the `style` primitive
// (queryFn never called, so the agent's writes never happen); a runner that
// ignores the phase row's `next` and leaves `status.phase` at `analyzing`;
// a runner that advances the in-memory result but never persists the new
// phase to status.json on disk.
test('turnSpec analyzing (style:agent, step:agent): runs the agent turn, writes staging, advances to awaiting-review', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'analyzing', 'arrange: seeded status must start in analyzing');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  let queryFnCalled = false;
  const queryFn: QueryFn = () => {
    queryFnCalled = true;
    async function* gen(): AsyncGenerator<unknown> {
      // Simulates the agent's own Write-tool side effect (queryFn is
      // stubbed; the runner does not itself know what the agent will write).
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

  assert.ok(queryFnCalled, 'the agent-style primitive must actually invoke queryFn');
  assert.equal(result.phase, 'awaiting-review');
  assert.ok(existsSync(join(sessionDir, 'staging', 'output.md')), 'the file the agent turn wrote must be on disk');
  assert.equal(
    readSessionStatus<TestStatus>(sessionDir)?.phase,
    'awaiting-review',
    'status.json on disk must reflect the advanced phase, not just the in-memory result',
  );
  assert.ok(Array.isArray(result.wrote) && result.wrote.length > 0, 'wrote must report something for a writing step');
  assert.ok(result.artifacts !== undefined && typeof result.artifacts === 'object', 'artifacts must be present (an object) on the result shape');
});

// ---------------------------------------------------------------------------
// AT-2 (ADR criterion 2): awaiting-review + step:noop leaves the session dir
// byte-for-byte unchanged and does not advance the phase.
// ---------------------------------------------------------------------------

// Kills: a runner that unconditionally rewrites status.json (bumping
// updated_at, or worse, the phase itself) even on a step with no `next`; a
// runner that falls through an unhandled `noop` case to some default
// advance-and-write behavior.
test('turnSpec awaiting-review (step:noop): leaves the session dir byte-for-byte unchanged and does not advance the phase', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'awaiting-review', updated_at: new Date().toISOString() });
  writeFileSync(join(sessionDir, 'staging_marker.txt'), 'pre-existing content that must survive untouched');
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'awaiting-review', 'arrange: seeded status must start in awaiting-review');

  const before = snapshotDir(sessionDir);
  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const result = await runInteractiveTurn(descriptor, {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: neverCalledQueryFn(),
    logger: logger(logsRoot, sessionId),
  });

  const after = snapshotDir(sessionDir);
  assert.deepEqual(after, before, 'a noop step must not touch the session dir filesystem at all — asserted on the ARTIFACT, not just the returned phase');
  assert.equal(result.phase, 'awaiting-review', 'phase must not advance past a noop row (it declares no `next`)');
});

// ---------------------------------------------------------------------------
// AT-3 (ADR criterion 3): committing + step:finalize runs copyStagingToLibrary
// and advances to committed; a real file lands in the library.
// ---------------------------------------------------------------------------

// Kills: a runner that advances the phase to `committed` without actually
// invoking the finalizer (a hardcoded "committing -> committed" transition
// with no real copy); a runner that reports a fabricated `wrote` list whose
// paths were never actually written.
test('turnSpec committing (step:finalize, finalizer:copyStagingToLibrary): runs the finalizer, advances to committed, and a real file lands on disk', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  // Hedge (see file header "MY CALL" #1): pre-create both plausible library
  // root candidates so copyStagingToLibrary's own precondition (its
  // containment root must already exist) cannot spuriously fail this test
  // for a reason unrelated to the runner's correctness.
  mkdirSync(join(forgeRoot, 'library'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'library'), { recursive: true });

  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'committing', updated_at: new Date().toISOString() });
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(stagingDir, { recursive: true });
  const STAGED_CONTENT = '# committed package\ncontent-marker-9f3a\n';
  writeFileSync(join(stagingDir, 'README.md'), STAGED_CONTENT);
  // Precondition, asserted before reading any verdict.
  assert.equal(readFileSync(join(stagingDir, 'README.md'), 'utf8'), STAGED_CONTENT, 'arrange: staged file must be present before running the turn');
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'committing', 'arrange: seeded status must start in committing');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const result = await runInteractiveTurn(descriptor, {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: neverCalledQueryFn(),
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'committed');
  assert.ok(Array.isArray(result.wrote) && result.wrote.length > 0, 'the finalize step must report at least one written path');
  for (const p of result.wrote) {
    assert.ok(existsSync(p), `every reported written path must actually exist on disk: ${p}`);
  }
  const landed = result.wrote.some((p: string) => existsSync(p) && readFileSync(p, 'utf8') === STAGED_CONTENT);
  assert.ok(landed, `at least one written file must carry the staged content verbatim — a real file, not just a phase flip; wrote=${JSON.stringify(result.wrote)}`);
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'committed', 'status.json on disk must reflect the advanced phase');
});

// ---------------------------------------------------------------------------
// AT-4 (ADR criterion 4): an unhandled status.phase throws loud, naming it.
// ---------------------------------------------------------------------------

// Kills: a runner that silently no-ops (returns the unrecognised phase
// unchanged, `wrote: []`) instead of throwing — the declared-data-fails-open
// antipattern this initiative explicitly guards against.
test('an unhandled status.phase absent from turnSpec.phases throws loud, naming the offending phase', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'ghost-phase-not-in-table', updated_at: new Date().toISOString() });
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<TestStatus>(sessionDir)?.phase, 'ghost-phase-not-in-table', 'arrange');

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
    /ghost-phase-not-in-table/,
  );
});

// ---------------------------------------------------------------------------
// AT-5 (ADR criterion 5): containment — a traversal-shaped sessionId / kindDir
// is refused before any filesystem write; the outside artifact is
// byte-unchanged.
// ---------------------------------------------------------------------------

// Kills: a runner that path.joins projectRoot/kindDir/sessionId directly
// (or otherwise builds a raw path) instead of routing every segment through
// resolveGuardedPath — a naive join would normalize the traversal away
// rather than refuse it outright.
test('SEC-04: a traversal-shaped sessionId is refused before any write; the outside canary stays byte-unchanged', async () => {
  const { root, forgeRoot, projectRoot, logsRoot } = setup();
  const canaryPath = join(root, 'outside-canary.txt');
  writeFileSync(canaryPath, 'SECRET-CANARY-MUST-NOT-CHANGE');
  const beforeCanary = readFileSync(canaryPath, 'utf8');
  const beforeProjectEntries = existsSync(projectRoot) ? readdirSync(projectRoot) : [];
  // Precondition, asserted before reading any verdict.
  assert.equal(beforeCanary, 'SECRET-CANARY-MUST-NOT-CHANGE', 'arrange: canary seeded');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  let thrown: Error | undefined;
  try {
    await runInteractiveTurn(descriptor, {
      sessionId: '../../../etc/passwd',
      projectRoot,
      forgeRoot,
      logsRoot,
      queryFn: neverCalledQueryFn(),
      logger: logger(logsRoot, 'sec04-sid'),
    });
    assert.fail('expected runInteractiveTurn to reject a traversal-shaped sessionId');
  } catch (err) {
    thrown = err as Error;
  }

  assert.ok(thrown, 'must throw');
  assert.doesNotMatch(
    thrown!.message,
    /queryFn must not be called/,
    'must be refused by the containment preamble, not by reaching (and failing inside) a turn',
  );
  assert.equal(readFileSync(canaryPath, 'utf8'), beforeCanary, 'the outside canary must be byte-unchanged');
  assert.deepEqual(
    existsSync(projectRoot) ? readdirSync(projectRoot) : [],
    beforeProjectEntries,
    'no new entry may appear under projectRoot — the rejection happens before any filesystem write',
  );
});

// Kills: a runner that trusts descriptor.turnSpec.kindDir as pre-safe
// (it is authored data, but still flows into a filesystem path) instead of
// passing it through resolveGuardedPath as its own segment.
test('SEC-04: a traversal-shaped kindDir is refused before any write; the outside canary stays byte-unchanged', async () => {
  const { root, forgeRoot, projectRoot, logsRoot } = setup();
  const canaryPath = join(root, 'outside-canary.txt');
  writeFileSync(canaryPath, 'SECRET-CANARY-MUST-NOT-CHANGE-2');
  const beforeCanary = readFileSync(canaryPath, 'utf8');
  const beforeProjectEntries = existsSync(projectRoot) ? readdirSync(projectRoot) : [];
  // Precondition, asserted before reading any verdict.
  assert.equal(beforeCanary, 'SECRET-CANARY-MUST-NOT-CHANGE-2', 'arrange: canary seeded');

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-bad-kinddir');
  assert.equal(descriptor.turnSpec?.kindDir, '../evil-escape', 'arrange: fixture kindDir is traversal-shaped');

  let thrown: Error | undefined;
  try {
    await runInteractiveTurn(descriptor, {
      sessionId: 'sess-001',
      projectRoot,
      forgeRoot,
      logsRoot,
      queryFn: neverCalledQueryFn(),
      logger: logger(logsRoot, 'sec04-kinddir'),
    });
    assert.fail('expected runInteractiveTurn to reject a traversal-shaped kindDir');
  } catch (err) {
    thrown = err as Error;
  }

  assert.ok(thrown, 'must throw');
  assert.doesNotMatch(
    thrown!.message,
    /queryFn must not be called/,
    'must be refused by the containment preamble, not by reaching (and failing inside) a turn',
  );
  assert.equal(readFileSync(canaryPath, 'utf8'), beforeCanary, 'the outside canary must be byte-unchanged');
  assert.deepEqual(
    existsSync(projectRoot) ? readdirSync(projectRoot) : [],
    beforeProjectEntries,
    'no new entry may appear under projectRoot — the rejection happens before any filesystem write',
  );
});

// ---------------------------------------------------------------------------
// AT-6 (ADR criterion 6): a finalizer id absent from FINALIZERS fails loud.
// ---------------------------------------------------------------------------

// Kills: a runner that resolves the finalize step through a hardcoded
// switch/if-chain instead of `resolveFinalizer` (the registry), or one that
// treats an unresolved finalizer id as a silent no-op / phase-advances-anyway.
test('a turnSpec finalizer id absent from FINALIZERS fails loud rather than silently skipping the finalize step', async () => {
  const { forgeRoot, logsRoot } = setup();
  const projectRoot = mkdtempSync(join(tmpdir(), 'interactive-runner-badfin-proj-'));
  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-bad-finalizer');
  const sessionId = 'sess-badfin-001';
  const sessionDir = join(projectRoot, descriptor.turnSpec!.kindDir, sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'x.md'), 'x');
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
    /totallyBogusFinalizerId/,
  );
});
