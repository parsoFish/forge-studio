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
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

// RED-NOW: this module does not exist yet — see the report for the exact
// failure this import produces.
import { runInteractiveTurn } from './interactive-runner.ts';

import { loadSessionKinds, type SessionKindDescriptor } from './studio/session-kinds.ts';
import { writeSessionStatus, readSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from './logging.ts';
import { modelForSpec } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { skillPathRelative, SLUG_RE } from './skill-path.ts';

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
- id: test-kind-ghost-next-agent
  agent: project-brain-builder
  title: Interactive Runner Test Kind (Finding 1 - ghost next, agent step)
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-ghostnext-agent
    style: agent
    phases:
      - { phase: analyzing, step: agent, next: ghost-next-phase }
- id: test-kind-ghost-next-finalize
  agent: project-brain-builder
  title: Interactive Runner Test Kind (Finding 1 - ghost next, finalize step)
  stages: [committing]
  defaultStage: committing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-ghostnext-finalize
    style: agent
    phases:
      - { phase: committing, step: finalize, finalizer: copyStagingToLibrary, next: ghost-next-phase }
- id: test-kind-no-writes-declared
  agent: project-brain-builder
  title: Interactive Runner Test Kind (P1 - no writes declared, true carve-out)
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-nowrites
    style: agent
    phases:
      - { phase: analyzing, step: agent, next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;
// NOTE (Finding 1 fixtures): both "-ghost-next-*" rows above declare a
// `next` naming a phase absent from their OWN `phases` list. This is
// deliberately NOT rejected by loadSessionKinds (a purely structural
// parse — see parseTurnSpec's own doc comment) nor by this file's
// loadFixtureDescriptor helper, which calls ONLY loadSessionKinds, never
// validateSessionKinds (the separate semantic/lint pass that DOES have a
// CHECK_TURNSPEC_DANGLING_NEXT rule, used by `forge studio lint`, not by
// the runtime runInteractiveTurn path this suite exercises). That split is
// exactly Finding 1's live gap: the static lint can catch an authoring
// typo, but the generic runner itself has no equivalent runtime defense —
// a session whose `next` was valid at lint time but drifts (or a
// lint-skipped hand-edit) still bricks a live session today.

// ---------------------------------------------------------------------------
// Shared fixture helpers — every test builds its own isolated tempdir tree;
// nothing depends on process.cwd() or ambient state.
// ---------------------------------------------------------------------------

type TestStatus = { session_id: string; phase: string; updated_at: string; package_id?: string; modelTier?: string };

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

/** A queryFn stub for an `agent`-style step that does no filesystem work of
 *  its own (unlike AT-1's stub) — used by tests where the fixture ALREADY
 *  planted whatever staging/ content matters and only needs the turn to
 *  complete normally so the runner reaches its post-turn dispatch logic
 *  (the `next`-write / listWrittenFiles code this file's new pins target). */
function noopAgentQueryFn(): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
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
// W6-B1: thinking forwarding + unsampled interactive tool events.
// ---------------------------------------------------------------------------

// Kills: a runner that never wires onThinking through to runAgentTurn (no
// 'thinking'-kind log rows at all); one that leaks redacted_thinking's own
// opaque data instead of the literal marker; one that doesn't coalesce a run
// of identical marker rows; one that still samples Read calls 1-in-4 (the
// unattended-phase default) instead of passing the interactive-turn sampler
// opts {readOnlySampleRate:1, cap:200}.
test('W6-B1: onThinking forwards thinking + coalesced redacted_thinking to the event log, and tool_use events are effectively unsampled', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const READ_CALLS = 8; // > the unattended-phase default readOnlySampleRate=4 would sample this down
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      const reads = Array.from({ length: READ_CALLS }, (_, i) => ({
        type: 'tool_use', name: 'Read', input: { file_path: `f${i}.md` },
      }));
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '  weighing the staging write  ' },
            { type: 'redacted_thinking', data: 'opaque-bytes-1' },
            { type: 'redacted_thinking', data: 'opaque-bytes-2' }, // consecutive — must coalesce
            ...reads,
          ],
        },
      };
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged\n');
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  const testLogger = logger(logsRoot, sessionId);
  const result = await runInteractiveTurn(descriptor, {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: testLogger,
  });
  assert.equal(result.phase, 'awaiting-review');

  const events = readFileSync(testLogger.logFilePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  const thinkingEvents = events.filter((e) => e.metadata?.kind === 'thinking');
  assert.equal(thinkingEvents.length, 2, 'one real thinking row + ONE coalesced row for the two consecutive redacted markers');
  assert.equal(thinkingEvents[0].message, 'weighing the staging write');
  assert.equal(thinkingEvents[1].message, '[thinking redacted]', 'the exact literal marker, never the block\'s own opaque data');

  const readToolEvents = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool === 'Read');
  assert.equal(
    readToolEvents.length,
    READ_CALLS,
    'interactive turns pass sampler opts {readOnlySampleRate:1, cap:200} — every Read is emitted, none sampled out',
  );
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
  writeSessionStatus<TestStatus>(sessionDir, { session_id: sessionId, phase: 'committing', updated_at: new Date().toISOString(), package_id: 'at3-finalize-package' });
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
// agents (orchestrator/flow-runner.ts:1285, cli/ui-bridge.ts:1678). Pins
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
// (orchestrator/skill-path.ts:43, `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/` — a
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
// (`orchestrator/skill-path.ts`'s `FORGE_ROOT`, computed from
// `import.meta.dirname` — i.e. THIS repo checkout) regardless of
// `ctx.forgeRoot`, so `descriptor.agent: creation-agent` resolves against the
// real, already-shipped `skills/creation-agent/SKILL.md` for free; only the
// finalizer's library-root writes and the log root need a throwaway forgeRoot
// so this suite never touches the real repo's `_interactive-library/`.
// ===========================================================================

const REPO_ROOT = resolve(import.meta.dirname, '..');

type RealAuthoringFixture = {
  root: string;
  forgeRoot: string;
  projectRoot: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
  descriptor: SessionKindDescriptor;
};

/** Loads the REAL "authoring" descriptor from REPO_ROOT and builds an
 *  isolated (never-the-real-repo) forgeRoot/projectRoot/logsRoot tree whose
 *  session dir matches the descriptor's OWN declared `turnSpec.kindDir` —
 *  never a hardcoded `_authoring` literal, so a kindDir drift in the real
 *  yaml surfaces as a containment failure in the tests below rather than a
 *  silently-mismatched fixture path. */
function setupRealAuthoring(): RealAuthoringFixture {
  const descriptor = loadSessionKinds(REPO_ROOT).find((d) => d.id === 'authoring');
  // Fixture precondition — see the "MUST-precede-verdict" discipline this
  // file already follows: fail the arrangement loudly, naming what's missing,
  // rather than letting a later assertion's failure be ambiguous about
  // whether the REAL yaml is missing the row entirely vs. missing turnSpec.
  if (!descriptor) throw new Error('test fixture bug: REPO_ROOT/studio/session-kinds.yaml has no "authoring" descriptor at all');
  if (!descriptor.turnSpec) {
    throw new Error(
      'REPO_ROOT/studio/session-kinds.yaml "authoring" row has no turnSpec — this IS the RED this suite pins ' +
        '(R4-21 phase 2, WI-1, D1): loadSessionKinds(REPO_ROOT) must return "authoring" WITH a turnSpec whose 4 ' +
        'phase rows deep-equal ADR-043 §1\'s table before this fixture (and every test below) can run at all.',
    );
  }
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-real-authoring-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(forgeRoot, { recursive: true });
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-11T00-00-00';
  const sessionDir = join(projectRoot, descriptor.turnSpec.kindDir, sessionId);
  return { root, forgeRoot, projectRoot, logsRoot, sessionId, sessionDir, descriptor };
}

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
// `POST /api/studio/authoring/start` (cli/ui-bridge.ts) writes the
// operator's free-text prompt to prompt.md, but `buildTurnPrompt` (this
// module) composes the turn prompt from SKILL.md + the phase row + a JSON
// dump of status.json — it never reads prompt.md. The intended production
// fix is that `writeAuthoringSession` (cli/ui-bridge.ts, pinned separately
// in cli/ui-bridge-authoring-start.test.ts) also persists the prompt into
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

// ===========================================================================
// R4-19-F2 — the REAL "kb-cleanup" descriptor (brain-maintenance), loaded
// from the REAL, checked-in studio/session-kinds.yaml (REPO_ROOT — already
// defined above by the R4-21 phase 2 block), never a hand-built fixture.
// Mirrors setupRealAuthoring's exact pattern immediately above: every test
// in this block proves the ACTUAL production yaml row + the generic spine
// together, not just the generic mechanism (already exhaustively proven
// above against the synthetic test-kind fixture).
//
// This is also the home of this initiative's single most important
// behavioural pin: the approval gate. "awaiting-approval" deliberately
// carries NO `next` in the ADR-043-shaped table (studio/session-kinds.yaml,
// session-kinds.test.ts's own R4-19-F2 block) — driving a turn while a
// session sits there must NOT advance it. TEST-WRITER ONLY.
// ===========================================================================

type KbCleanupTestStatus = { session_id: string; phase: string; updated_at: string; kb_id?: string };

type RealKbCleanupFixture = {
  root: string;
  forgeRoot: string;
  projectRoot: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
  descriptor: SessionKindDescriptor;
};

/** Loads the REAL "kb-cleanup" descriptor from REPO_ROOT and builds an
 *  isolated (never-the-real-repo) forgeRoot/projectRoot/logsRoot tree whose
 *  session dir matches the descriptor's OWN declared `turnSpec.kindDir` —
 *  never a hardcoded `_kb-cleanup` literal, so a kindDir drift in the real
 *  yaml surfaces as a containment failure in the tests below rather than a
 *  silently-mismatched fixture path. Mirrors `setupRealAuthoring` exactly. */
function setupRealKbCleanup(): RealKbCleanupFixture {
  const descriptor = loadSessionKinds(REPO_ROOT).find((d) => d.id === 'kb-cleanup');
  if (!descriptor) {
    throw new Error(
      'test fixture bug: REPO_ROOT/studio/session-kinds.yaml has no "kb-cleanup" descriptor at all — this IS the RED ' +
        'this suite pins (R4-19-F2): the descriptor row has not been added yet (see session-kinds.test.ts\'s own R4-19-F2 block).',
    );
  }
  if (!descriptor.turnSpec) {
    throw new Error(
      'REPO_ROOT/studio/session-kinds.yaml "kb-cleanup" row has no turnSpec — this IS the RED this suite pins: loadSessionKinds(REPO_ROOT) ' +
        'must return "kb-cleanup" WITH a turnSpec whose 3 phase rows (drafting -> awaiting-approval -> applied) match the task brief\'s table.',
    );
  }
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-real-kbcleanup-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(forgeRoot, { recursive: true });
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-14T00-00-00';
  const sessionDir = join(projectRoot, descriptor.turnSpec.kindDir, sessionId);
  return { root, forgeRoot, projectRoot, logsRoot, sessionId, sessionDir, descriptor };
}

// ---------------------------------------------------------------------------
// BYPASS-REFUSAL — the most important behavioural test in this initiative.
// ---------------------------------------------------------------------------

// Kills: a turnSpec whose "awaiting-approval" phase row carries a `next`
// (silently defeating the approval gate the whole feature hinges on — a
// re-run/duplicate turn dispatch would auto-advance the session and let the
// deterministic drain + brain-fix apply an UNAPPROVED plan); a runner (or
// route) that special-cases kb-cleanup to bypass the generic noop-stays-put
// dispatch; a route wiring that invokes the apply-side finalizer logic from
// the ordinary turn-dispatch path instead of gating it behind the dedicated
// apply route's own explicit phase check.
test('R4-19-F2 BYPASS-REFUSAL: a kb-cleanup session at awaiting-approval does NOT advance when driven through runInteractiveTurn again — status.json phase unchanged, the session dir byte-for-byte unchanged, nothing written into the brain, queryFn never invoked', async () => {
  const fx = setupRealKbCleanup();
  mkdirSync(fx.sessionDir, { recursive: true });
  writeSessionStatus<KbCleanupTestStatus>(fx.sessionDir, {
    session_id: fx.sessionId,
    phase: 'awaiting-approval',
    updated_at: new Date().toISOString(),
    kb_id: 'fixture-kb',
  });
  // Preconditions, asserted before reading any verdict.
  assert.equal(readSessionStatus<KbCleanupTestStatus>(fx.sessionDir)?.phase, 'awaiting-approval', 'arrange: seeded status must start in awaiting-approval');
  assert.ok(!existsSync(join(fx.forgeRoot, 'brain')), 'arrange: no brain/ dir exists yet under the scratch forgeRoot');

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
  assert.deepEqual(after, before, 'awaiting-approval must be a true no-op — the session dir must stay byte-for-byte unchanged, asserted on the ARTIFACT, not merely the returned phase');
  assert.equal(result.phase, 'awaiting-approval', 'the phase must not advance — awaiting-approval deliberately carries no `next` in the real yaml (the approval gate)');
  assert.equal(readSessionStatus<KbCleanupTestStatus>(fx.sessionDir)?.phase, 'awaiting-approval', 'status.json on disk must still read awaiting-approval after the re-run');
  assert.ok(!existsSync(join(fx.forgeRoot, 'brain')), 'nothing may be written into the brain by a re-run sitting at the approval gate');
});

// ---------------------------------------------------------------------------
// The drafting -> awaiting-approval transition is gated on real output.
// ---------------------------------------------------------------------------

// Kills: a real "kb-cleanup" yaml row whose drafting phase omits `writes:
// [plan]` entirely (which would silently let an empty draft advance with no
// refusal — the exact ghost-turn shape the generic P1 refusal above exists
// to catch, now pinned against THIS kind's own production row rather than
// only the synthetic test-kind fixture); an implementation that special-
// cases kb-cleanup to skip that generic refusal.
test('R4-19-F2: the real kb-cleanup descriptor\'s drafting phase declares writes:[plan] — a turn that produces NOTHING under plan/ refuses the advance loudly rather than persisting a ghost turn, and status.json stays byte-unchanged', async () => {
  const fx = setupRealKbCleanup();
  mkdirSync(fx.sessionDir, { recursive: true });
  writeSessionStatus<KbCleanupTestStatus>(fx.sessionDir, {
    session_id: fx.sessionId,
    phase: 'drafting',
    updated_at: new Date().toISOString(),
    kb_id: 'fixture-kb',
  });
  const statusPath = join(fx.sessionDir, 'status.json');
  const statusBefore = readFileSync(statusPath, 'utf8');
  // Precondition, asserted before reading any verdict.
  assert.equal(readSessionStatus<KbCleanupTestStatus>(fx.sessionDir)?.phase, 'drafting', 'arrange: seeded status must start in drafting');

  await assert.rejects(
    () =>
      runInteractiveTurn(fx.descriptor, {
        sessionId: fx.sessionId,
        projectRoot: fx.projectRoot,
        forgeRoot: fx.forgeRoot,
        logsRoot: fx.logsRoot,
        // Deliberately does NOT create plan/ — the agent produced nothing.
        queryFn: noopAgentQueryFn(),
        logger: logger(fx.logsRoot, fx.sessionId),
      }),
    (err: Error) => {
      assert.match(err.message, /kb-cleanup/, 'error must name the session kind');
      assert.match(err.message, /drafting/, 'error must name the phase');
      assert.match(err.message, /plan/, 'error must name the empty writes: entry');
      return true;
    },
  );

  assert.equal(readFileSync(statusPath, 'utf8'), statusBefore, 'status.json must be BYTE-UNCHANGED after the refusal');
});

// Positive control for the test above — proves the refusal is not blanket:
// a real, populated plan/ file still advances normally to awaiting-approval.
test('R4-19-F2 (positive control): the real kb-cleanup descriptor\'s drafting phase, WITH a real plan/cleanup-plan.md written, advances normally to awaiting-approval', async () => {
  const fx = setupRealKbCleanup();
  mkdirSync(fx.sessionDir, { recursive: true });
  writeSessionStatus<KbCleanupTestStatus>(fx.sessionDir, {
    session_id: fx.sessionId,
    phase: 'drafting',
    updated_at: new Date().toISOString(),
    kb_id: 'fixture-kb',
  });
  assert.equal(readSessionStatus<KbCleanupTestStatus>(fx.sessionDir)?.phase, 'drafting', 'arrange: seeded status must start in drafting');

  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(fx.sessionDir, 'plan'), { recursive: true });
      writeFileSync(join(fx.sessionDir, 'plan', 'cleanup-plan.md'), '- [edge.dangling] brain/x/themes/y.md — repoint at z.\n');
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

  assert.equal(result.phase, 'awaiting-approval', 'the real kb-cleanup turnSpec\'s drafting row must declare next: awaiting-approval');
  assert.equal(readSessionStatus<KbCleanupTestStatus>(fx.sessionDir)?.phase, 'awaiting-approval', 'status.json on disk must reflect the advanced phase');
});


// ===========================================================================
// bead forge-eip (W6-CR-3) — the writeRoots fence, driven end to end through
// runInteractiveTurn for a REAL descriptor (REPO_ROOT). Proves the WIRING
// (resolveWriteRoots deriving sessionDir/staging from the real turnSpec row,
// runAgentTurn installing the fence from it) — the pure canUseTool logic
// itself is pinned independently in interactive-session.test.ts. This is the
// "integration-shaped" test: the session's own status.json carries an
// absolute path OUTSIDE its staging/ write root — a Write to it must be
// refused even though the prompt hands the agent that path directly.
//
// Originally driven against the REAL "community-refresh" descriptor, whose
// live `/api/studio/community-refresh/start` route (cli/ui-bridge.ts) seeded
// exactly this shape (an absolute `registryPath` outside the session dir).
// That kind was retired in W8-B5b, so this now reuses `setupRealAuthoring`
// (defined above) and seeds a synthetic out-of-root path itself — the point
// being proven (wiring, not any one route's literal field name) is unchanged.
// ===========================================================================

test('bead forge-eip: the REAL authoring turn installs a canUseTool that denies a Write to a sensitive absolute path outside its write root, while still allowing the legitimate staging/ write', async () => {
  const fx = setupRealAuthoring();
  mkdirSync(fx.sessionDir, { recursive: true });
  // A sensitive absolute path OUTSIDE sessionDir/staging entirely — stands
  // in for whatever forge-root-anchored file a live route might one day hand
  // an agent via status.json (community-refresh's own registryPath used to
  // be the real-world instance of this shape).
  const sensitivePath = join(fx.forgeRoot, 'sensitive.yaml');
  mkdirSync(dirname(sensitivePath), { recursive: true });
  writeFileSync(sensitivePath, 'do-not-touch: true\n');
  writeSessionStatus(fx.sessionDir, {
    session_id: fx.sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
    prompt: 'draft a hook',
    sensitivePath,
  });

  let capturedOptions: Record<string, unknown> | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedOptions = options;
    async function* gen(): AsyncGenerator<unknown> {
      // The turn must still produce SOMETHING under staging/ (the P1
      // declared-data-fails-open check) so runInteractiveTurn completes
      // normally and this test can inspect the REAL options it built.
      mkdirSync(join(fx.sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(fx.sessionDir, 'staging', 'SKILL.md'), '---\nname: x\n---\n');
      yield { type: 'result', total_cost_usd: 0 };
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
  assert.equal(result.phase, 'awaiting-review', 'arrange: the real analyzing row must still advance normally');

  assert.ok(capturedOptions, 'queryFn must have been invoked');
  const canUseTool = capturedOptions!.canUseTool as
    | ((toolName: string, input: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>)
    | undefined;
  assert.ok(canUseTool, 'runAgentTurn must have installed a REAL canUseTool for this turn (resolveWriteRoots derived it from the real writes:[staging] row)');

  const sensitiveWrite = await canUseTool!('Write', { file_path: sensitivePath, content: 'items: [{id: "exfiltrated"}]' }, {});
  assert.equal(sensitiveWrite.behavior, 'deny', 'a Write to the sensitive out-of-root path must be refused by the fence');
  assert.equal(
    readFileSync(sensitivePath, 'utf8'),
    'do-not-touch: true\n',
    'the sensitive file must be byte-unchanged — the fence denies BEFORE any write happens',
  );

  const stagingWrite = await canUseTool!('Write', { file_path: join(fx.sessionDir, 'staging', 'evidence.md'), content: 'x' }, {});
  assert.equal(stagingWrite.behavior, 'allow', 'a Write inside the real staging/ write root must still be allowed');
});
