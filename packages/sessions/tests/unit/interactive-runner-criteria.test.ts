import { type TestStatus, loadFixtureDescriptor, logger, neverCalledQueryFn, setup, snapshotDir } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';

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

