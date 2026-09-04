import { REPO_ROOT, setupRealAuthoring } from './test-fixtures/interactive-runner-fixtures.ts';
import { logger, neverCalledQueryFn, noopAgentQueryFn, snapshotDir } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';

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
// live `/api/studio/community-refresh/start` route (apps/forge/ui-bridge.ts) seeded
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
