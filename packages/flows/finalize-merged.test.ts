/**
 * Tests for the F-W5-7 finalize sweep — selection + re-claim logic. The
 * per-cycle closure→reflector action is injected (`finalizeOne`) so these stay
 * git/SDK-free; the real chain is exercised end-to-end by a live cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { finalizeMergedReadyForReview } from './finalize-merged.ts';
import { runClosure as realRunClosure } from './phases/closure.ts';
import { writeWorkItem, type WorkItem } from './work-item.ts';

// Captured ONCE at module load — the stable cwd to restore to after the
// real-runClosure integration test's chdir (real `runClosure`/
// `promoteMergedToDone` default to a cwd-relative `_queue`, same convention
// as closure.test.ts).
const MODULE_CWD = process.cwd();

function setup(): { root: string; queueRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'finalize-'));
  const queueRoot = join(root, '_queue');
  // R4-11-F1 adds `merged/`, the transient pass-through a confirmed merge
  // lands in before this sweep promotes it on to `done/` in the same call.
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  // SEC-02 round 3: the two containment roots the sweep checks against.
  // `forge init` creates both on a real install (orchestrator/init.ts
  // `layoutDirs`), and a containment root that does not exist fails CLOSED —
  // so a fixture without them would report `error` for every manifest.
  mkdirSync(join(root, '_worktrees'), { recursive: true });
  mkdirSync(join(root, 'projects', 'demo'), { recursive: true });
  return { root, queueRoot };
}

// SEC-02 round 3: the sweep now containment-checks `worktree_path` AND
// `project_repo_path` against their own distinct roots, so this helper no longer
// writes one value into both. `project_repo_path` gets the real repo shape
// (`<forgeRoot>/projects/demo`); `worktree_path` stays the caller's, which the
// fixtures now site under a legitimate root instead of a bare `<root>/wt`.
function writeManifest(queueRoot: string, state: string, id: string, worktreePath: string): void {
  const projectRepoPath = join(dirname(queueRoot), 'projects', 'demo');
  const body = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${projectRepoPath}`,
    "created_at: '2026-05-30T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: pending',
    'origin: architect',
    `worktree_path: ${worktreePath}`,
    '---',
    `# ${id}`,
    '',
  ].join('\n');
  writeFileSync(join(queueRoot, state, `${id}.md`), body);
}

test('finalize: merged PR → re-claimed to in-flight + finalizeOne run → finalized', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-merged', wt);
    const calls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      finalizeOne: async (input) => { calls.push(input.initiativeId); return true; },
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.deepEqual(calls, ['INIT-2026-05-30-merged']);
    // Re-claimed: out of ready-for-review/, into in-flight/ for closure's move.
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', 'INIT-2026-05-30-merged.md')), false);
    assert.equal(existsSync(join(queueRoot, 'in-flight', 'INIT-2026-05-30-merged.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// R4-09-F1 — the default finalize fires reflect FROM forge-develop's declared
// {on: merged, target: {kind: agent, ref: reflector}} trigger, resolved through
// the reflect agent's `reflection-close` band hook (the real reflector def on
// disk), not a hardcoded slug. Asserts EXACTLY ONE reflect per merge (the
// atomic-cutover AC — never zero, never two).
test('finalize: merged → fires reflect once from the agent-target declaration (band-hook resolved)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-decl', wt);
    const reflectCalls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      // No finalizeOne override → exercises makeDefaultFinalizeOne; inject its
      // closure + reflector action + trigger source so the test stays git/SDK-
      // free. loadAgentDef is NOT injected → the REAL reflector SKILL.md
      // (reflection-close band) resolves the agent target, proving the cutover
      // routes the production declaration to reflect.
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async (input) => { reflectCalls.push(input.initiativeId); },
      loadFlowTriggers: () => [{ on: 'merged', target: { kind: 'agent', ref: 'reflector' } }],
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.deepEqual(reflectCalls, ['INIT-2026-05-30-decl'], 'exactly one reflect must fire from the declaration');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// R4-09-F1 — the merge-time handler is band-specific: an `on: merged`
// agent-target whose def does NOT declare the `reflection-close` band is
// unhandled (loud), and reflect does NOT fire. Proves the dispatch is not
// "any agent target fires reflect". Injects loadAgentDef so this stays
// hermetic (no dependency on a non-reflect agent's SKILL.md).
test('finalize: merged → non-reflect agent-target is unhandled, reflect does NOT fire', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-notreflect', wt);
    let reflected = false;
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async () => { reflected = true; },
      loadFlowTriggers: () => [{ on: 'merged', target: { kind: 'agent', ref: 'some-other-agent' } }],
      // A def that declares a DIFFERENT band (not reflection-close).
      loadAgentDef: () => ({ composition: { guards: ['wi-contract'] } }) as never,
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized'], 'still finalizes (merge confirmed)');
    assert.equal(reflected, false, 'a non-reflection-close agent target must not fire reflect');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: merged but NO declared merge-trigger → reflect does NOT fire (declaration-driven)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-nodecl', wt);
    let reflected = false;
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async () => { reflected = true; },
      loadFlowTriggers: () => [], // the flow declares no merge trigger
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized'], 'still finalizes (merge confirmed)');
    assert.equal(reflected, false, 'no declaration → no reflect (proves it is not hardcoded)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TESTS (forge-f9g fix, W8-A1) — a scoped `on: merged` trigger now
// enforces `projects:` at the SAME structural choke point
// (`decideTriggerProjectScope`) every other trigger kind reaches, even
// though this dispatch is inline (never staged through
// `drainFlowRunRequests`). `writeManifest` always writes `project: demo`
// (the fixture's project binding), so scoping the trigger to `['demo']` is
// in-scope and scoping it to a different project is out-of-scope.
// ---------------------------------------------------------------------------

test('finalize: [forge-f9g] a scoped on:merged trigger fires reflect when the manifest project is a declared member', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-08-23-inscope', wt);
    const reflectCalls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async (input) => { reflectCalls.push(input.initiativeId); },
      loadFlowTriggers: () => [
        { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: ['demo'] } as never,
      ],
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.deepEqual(
      reflectCalls,
      ['INIT-2026-08-23-inscope'],
      'the manifest project ("demo") is a declared member of projects: ["demo"] — reflect must fire',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: [forge-f9g] an out-of-scope on:merged trigger does NOT fire reflect, and the skip lands in the cycle event log (typed, observable, never silent)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-08-23-oos';
    const cycleId = `2026-08-23T00-00-00_${id}`;
    const body = [
      '---',
      `initiative_id: ${id}`,
      'project: demo',
      `project_repo_path: ${join(root, 'projects', 'demo')}`,
      "created_at: '2026-08-23T00:00:00.000Z'",
      'iteration_budget: 2',
      'cost_budget_usd: 1',
      'phase: pending',
      'origin: architect',
      `worktree_path: ${wt}`,
      `cycle_id: ${cycleId}`,
      '---',
      `# ${id}`,
      '',
    ].join('\n');
    writeFileSync(join(queueRoot, 'ready-for-review', `${id}.md`), body);

    const logsRoot = join(root, '_logs');
    let reflected = false;
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot,
      confirmMerge: () => true,
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async () => { reflected = true; },
      loadFlowTriggers: () => [
        { on: 'merged', target: { kind: 'agent', ref: 'reflector' }, projects: ['some-other-project'] } as never,
      ],
    });

    assert.deepEqual(results.map((r) => r.status), ['finalized'], 'still finalizes (merge confirmed) — only reflect is skipped');
    assert.equal(reflected, false, 'the manifest project ("demo") is NOT a member of projects: ["some-other-project"] — reflect must not fire');

    const eventsPath = join(logsRoot, cycleId, 'events.jsonl');
    assert.ok(existsSync(eventsPath), 'cycle events.jsonl exists');
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.trim());
    const skip = lines
      .map((l) => JSON.parse(l) as { message?: string; event_type?: string; metadata?: Record<string, unknown> })
      .find((e) => e.message === 'finalize.trigger-skipped-out-of-scope');
    assert.ok(skip, `expected a finalize.trigger-skipped-out-of-scope event in the cycle log — got messages: ${JSON.stringify(lines.map((l) => JSON.parse(l).message))}`);
    assert.equal(skip!.metadata?.on, 'merged');
    assert.equal(skip!.metadata?.event_project, 'demo');
    assert.deepEqual(skip!.metadata?.projects, ['some-other-project']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: threads the manifest-persisted cycle_id into finalizeOne (ADR 026 lineage)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-05-30-lineage';
    // Manifest carries an explicit cycle_id (the one runCycle persisted at first claim).
    const body = [
      '---',
      `initiative_id: ${id}`,
      'project: demo',
      `project_repo_path: ${wt}`,
      "created_at: '2026-05-30T00:00:00.000Z'",
      'iteration_budget: 2',
      'cost_budget_usd: 1',
      'phase: pending',
      'origin: architect',
      `worktree_path: ${wt}`,
      'cycle_id: 2026-05-30T01-02-03_' + id,
      '---',
      `# ${id}`,
      '',
    ].join('\n');
    writeFileSync(join(queueRoot, 'ready-for-review', `${id}.md`), body);
    let threaded: string | undefined;
    await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      finalizeOne: async (input) => { threaded = input.cycleId; return true; },
    });
    assert.equal(threaded, '2026-05-30T01-02-03_' + id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: open PR → left in ready-for-review, finalizeOne NOT called', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-open', wt);
    let called = false;
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      confirmMerge: () => false,
      finalizeOne: async () => { called = true; return true; },
    });
    assert.deepEqual(results.map((r) => r.status), ['still-open']);
    assert.equal(called, false);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', 'INIT-2026-05-30-open.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: merged with pending fix work-items still finalizes, but surfaces the drop (B2, non-silent)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-05-30-merged-pending';
    // A post-send-back worktree (ADR 040): a review-fix work item compiled by
    // the send-back loop onto the initiative's own `.forge/work-items/`
    // queue, still `pending` when the operator merged anyway.
    const fixWi: WorkItem = {
      work_item_id: 'WI-9',
      initiative_id: id,
      status: 'pending',
      depends_on: [],
      acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
      files_in_scope: ['pkg/foo.go'],
      estimated_iterations: 1,
      quality_gate_cmd: ['go', 'test', './...'],
      origin: 'review-fix',
      body: '# WI-9 — review-fix concern',
    };
    writeWorkItem(fixWi, wt);
    writeManifest(queueRoot, 'ready-for-review', id, wt);
    let finalized = false;
    const notes: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true, // operator merged despite pending concerns
      finalizeOne: async () => { finalized = true; return true; },
      notify: (m) => notes.push(m),
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.equal(finalized, true, 'merge is terminal — finalize wins over the drain');
    assert.ok(
      notes.some((n) => /pending fix work-item/.test(n) && n.includes('WI-9')),
      `expected a non-silent drop note listing the WI id, got ${JSON.stringify(notes)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: worktree gone → no-worktree, skipped (no re-claim)', async () => {
  const { root, queueRoot } = setup();
  try {
    // SEC-02 round 3: "gone" must be a LEGITIMATE-but-absent worktree location
    // (the real shape: `<forgeRoot>/_worktrees/<initiative_id>`, deleted after
    // the cycle). A bare `<root>/gone` is out of bounds, which the guard now
    // correctly reports as `error` — a different case from "it was cleaned up",
    // which is what this test is about.
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-nowt', join(root, '_worktrees', 'INIT-2026-05-30-nowt'));
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      confirmMerge: () => true,
      finalizeOne: async () => true,
    });
    assert.deepEqual(results.map((r) => r.status), ['no-worktree']);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', 'INIT-2026-05-30-nowt.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 2.10 reflector pipeline honesty: closure has already moved the manifest to
// done/ by the time the reflect trigger fires — a reflector throw here used to
// bubble to the per-file catch as status 'error' with the cycle already closed
// and NOTHING in events.jsonl marking the loss (the July silent-loss pattern).
test('finalize: reflector throw after confirmed merge → cycle.reflection-lost recorded, finalize still completes', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-05-30-lost';
    const cycleId = `2026-05-30T01-02-03_${id}`;
    const body = [
      '---',
      `initiative_id: ${id}`,
      'project: demo',
      `project_repo_path: ${wt}`,
      "created_at: '2026-05-30T00:00:00.000Z'",
      'iteration_budget: 2',
      'cost_budget_usd: 1',
      'phase: pending',
      'origin: architect',
      `worktree_path: ${wt}`,
      `cycle_id: ${cycleId}`,
      '---',
      `# ${id}`,
      '',
    ].join('\n');
    writeFileSync(join(queueRoot, 'ready-for-review', `${id}.md`), body);

    const logsRoot = join(root, '_logs');
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot,
      confirmMerge: () => true,
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async () => { throw new Error('rate_limit_error: usage limit reached'); },
      loadFlowTriggers: () => [{ on: 'merged', target: { kind: 'agent', ref: 'reflector' } }],
    });

    assert.deepEqual(
      results.map((r) => r.status),
      ['finalized'],
      'the merge finalization completed — a lost reflection must not report the finalize itself as error',
    );

    const eventsPath = join(logsRoot, cycleId, 'events.jsonl');
    assert.ok(existsSync(eventsPath), 'cycle events.jsonl exists');
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.trim());
    const lost = lines
      .map((l) => JSON.parse(l) as { message?: string; event_type?: string; metadata?: Record<string, unknown> })
      .find((e) => e.message === 'cycle.reflection-lost');
    assert.ok(lost, 'expected cycle.reflection-lost in the cycle event log');
    assert.equal(lost!.event_type, 'error');
    assert.equal(lost!.metadata?.cause, 'crash');
    assert.equal(lost!.metadata?.crash_kind, 'transient', 'rate-limit classifies as environment pressure');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// R4-11-F1 — every other test above injects `runClosure`/`promoteMergedToDone`
// to stay git/SDK-free (per the file-top comment: "the real chain is
// exercised end-to-end by a live cycle"). This test closes that gap for the
// NEW merged/ hop specifically: it calls the REAL `runClosure` +
// `promoteMergedToDone` from ./phases/closure.ts (not stubs), so the
// ready-for-review → in-flight (re-claim) → merged (real closure terminal
// move) → done (real promoteMergedToDone, same sweep) round-trip is
// exercised for real, not asserted only through mocked call-count spies.
// `runClosure` is wrapped (not stubbed) purely to hand it a synthetic
// `confirmMerge` on the CycleInput it builds internally — the production
// `makeDefaultFinalizeOne` never threads the outer `deps.confirmMerge`
// through to closure's own `input.confirmMerge` (that's deliberate: closure
// independently re-confirms the merge itself, see the file-top doc comment),
// so without this the real closure would shell out to `gh pr view` and fail
// in a hermetic test. The worktree is deliberately NOT a git repo, so
// closure's `initiativeBranch` throws/returns null and `alignLocalToRemote`
// (real git fetch/prune against a remote) is skipped — no git or gh
// plumbing is exercised, only the queue-directory state machine.
test('finalize: real runClosure + promoteMergedToDone round-trip ready-for-review → merged → done in one sweep (integration, no closure/queue mocks)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'projects', 'demo', 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-05-30-real-closure';
    writeManifest(queueRoot, 'ready-for-review', id, wt);

    // Real runClosure/promoteMergedToDone default to a cwd-relative `_queue`.
    process.chdir(root);
    try {
      const results = await finalizeMergedReadyForReview({
        queueRoot,
        logsRoot: join(root, '_logs'),
        confirmMerge: () => true, // outer gate: treat the PR as merged, re-claim
        runClosure: (input, logger, reviewerOutcome) =>
          realRunClosure({ ...input, confirmMerge: () => true }, logger, reviewerOutcome),
        // No declared merge trigger → reflect does not fire (that path is
        // covered by the earlier declaration-driven tests); isolates this
        // test to the closure/queue round-trip.
        loadFlowTriggers: () => [],
      });
      assert.deepEqual(results.map((r) => r.status), ['finalized']);
    } finally {
      process.chdir(MODULE_CWD);
    }

    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${id}.md`)), false, 'left ready-for-review');
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${id}.md`)), false, 'left in-flight (closure moved it on)');
    assert.equal(existsSync(join(queueRoot, 'merged', `${id}.md`)), false, 'merged/ is a pass-through — promoted on to done/ in the same sweep');
    assert.equal(existsSync(join(queueRoot, 'done', `${id}.md`)), true, 'landed in done/ via the real merged→done promotion');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SEC-02 round 3 — a THIRD entry point into the manifest-poisoning threat
// model neither round 1 (`packages/flows/bridge-recovery.ts` ingest + `cli/forge-
// requeue.ts`) nor round 2 (`packages/flows/bridge-studio-runs.ts`'s `applyReviewVerdict`)
// could reach: this periodic sweep, driven by a TIMER, not an HTTP route.
// `cycle_id` is already guarded (`isSafeCycleId`, line ~330 above), but its two
// siblings on the SAME manifest read are not:
//   worktreePath = m.worktree_path ?? ''       (line ~285)
//   projectRepoPath = m.project_repo_path ?? '' (line ~286)
// `worktreePath` flows straight into `confirmMerge(worktreePath)` with NO
// containment check at all; `projectRepoPath` flows into `CycleInput` and on
// into `finalizeOne` (the real closure/reflect chain in production). Both
// confirmed live (manual repro, before these tests were written): a poisoned
// `worktree_path` reaches `confirmMerge` directly, and a poisoned
// `project_repo_path` reaches `finalizeOne`'s `CycleInput` directly — status
// 'finalized' either way, no error, no containment at all.
// ---------------------------------------------------------------------------

/** Like the file's own `writeManifest`, but with independently-settable
 *  worktree_path / project_repo_path / cycle_id — the existing helper hard-
 *  codes the SAME value for both path fields, which cannot isolate one
 *  field's escape from the other. */
function writeManifestFields(
  queueRoot: string,
  state: string,
  id: string,
  fields: { worktreePath: string; projectRepoPath: string; cycleId: string },
): void {
  const body = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${fields.projectRepoPath}`,
    "created_at: '2026-05-30T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: pending',
    'origin: architect',
    `worktree_path: ${fields.worktreePath}`,
    `cycle_id: ${fields.cycleId}`,
    '---',
    `# ${id}`,
    '',
  ].join('\n');
  writeFileSync(join(queueRoot, state, `${id}.md`), body);
}

test('(RED) [SEC-02 round 3] worktree_path outside the forge root: sweep does not crash, the manifest degrades to status:error, and confirmMerge is NEVER invoked with the poisoned path', async () => {
  const { root, queueRoot } = setup();
  const outside = mkdtempSync(join(tmpdir(), 'finalize-r3-wt-outside-'));
  try {
    const nestedDir = join(outside, 'nested');
    mkdirSync(nestedDir, { recursive: true });
    const sentinelFile = join(nestedDir, 'secret.txt');
    const sentinelBytes = 'SENTINEL-R3-WT-BYTES-9d31c7a2\n';
    writeFileSync(sentinelFile, sentinelBytes);

    const id = 'INIT-2026-05-30-r3-wt-escape';
    // A LEGITIMATE project_repo_path — isolates the escape to worktree_path only.
    const repo = join(root, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });
    writeManifestFields(queueRoot, 'ready-for-review', id, {
      worktreePath: outside, // THE ATTACK
      projectRepoPath: repo,
      cycleId: `2026-05-30T01-02-03_${id}`,
    });

    const confirmCalls: string[] = [];
    const finalizeCalls: unknown[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: (wt: string) => { confirmCalls.push(wt); return true; },
      finalizeOne: async (input) => { finalizeCalls.push(input); return true; },
    });

    // PRIMARY: the pre-existing outside directory must survive untouched.
    assert.equal(existsSync(outside), true, 'sentinel directory must still exist');
    assert.equal(existsSync(sentinelFile), true, 'nested sentinel file must still exist');
    assert.equal(readFileSync(sentinelFile, 'utf8'), sentinelBytes, 'sentinel bytes must be BYTE-IDENTICAL');

    // The pin: assert on the stub's call record, not a status string alone.
    assert.ok(
      !confirmCalls.includes(outside),
      `confirmMerge must NEVER be invoked with the poisoned worktree_path — got calls: ${JSON.stringify(confirmCalls)}`,
    );

    // The sweep itself must not crash: it degrades to this ONE manifest's
    // existing per-manifest error path.
    const result = results.find((r) => r.initiativeId === id);
    assert.ok(result, `expected a result entry for ${id} — got ${JSON.stringify(results)}`);
    assert.equal(
      result!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' (the sweep's existing per-manifest error path) — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('(RED) [SEC-02 round 3] project_repo_path outside <forgeRoot>/projects: sweep does not crash, the manifest degrades to status:error, and nothing downstream (finalizeOne) receives the poisoned path', async () => {
  const { root, queueRoot } = setup();
  const outsideRepo = mkdtempSync(join(tmpdir(), 'finalize-r3-repo-outside-'));
  try {
    const id = 'INIT-2026-05-30-r3-repo-escape';
    // A LEGITIMATE worktree_path — isolates the escape to project_repo_path only.
    const wt = join(root, '_worktrees', id);
    mkdirSync(wt, { recursive: true });
    writeManifestFields(queueRoot, 'ready-for-review', id, {
      worktreePath: wt,
      projectRepoPath: outsideRepo, // THE ATTACK
      cycleId: `2026-05-30T01-02-03_${id}`,
    });

    const finalizeCalls: Array<{ projectRepoPath: string }> = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      finalizeOne: async (input) => { finalizeCalls.push(input as { projectRepoPath: string }); return true; },
    });

    // The pin: nothing downstream may ever see the poisoned projectRepoPath.
    assert.ok(
      !finalizeCalls.some((c) => c.projectRepoPath === outsideRepo),
      `finalizeOne (the downstream closure/reflect chain) must NEVER be invoked with the poisoned project_repo_path — got calls: ${JSON.stringify(finalizeCalls)}`,
    );

    const result = results.find((r) => r.initiativeId === id);
    assert.ok(result, `expected a result entry for ${id} — got ${JSON.stringify(results)}`);
    assert.equal(
      result!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' (the sweep's existing per-manifest error path) — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRepo, { recursive: true, force: true });
  }
});

// MANDATORY positive control: without this the suite would pass against a
// guard that rejects everything, which is not a guard.
test('non-regression [SEC-02 round 3]: a legitimate worktree_path + project_repo_path still finalizes exactly as before, confirmMerge invoked once with the real path', async () => {
  const { root, queueRoot } = setup();
  try {
    const id = 'INIT-2026-05-30-r3-legit';
    const wt = join(root, '_worktrees', id);
    mkdirSync(wt, { recursive: true });
    const repo = join(root, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });
    writeManifestFields(queueRoot, 'ready-for-review', id, {
      worktreePath: wt,
      projectRepoPath: repo,
      cycleId: `2026-05-30T01-02-03_${id}`,
    });

    const confirmCalls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: (w: string) => { confirmCalls.push(w); return true; },
      finalizeOne: async () => true,
    });

    assert.deepEqual(results.map((r) => r.status), ['finalized'], `expected the legitimate manifest to still finalize — got ${JSON.stringify(results)}`);
    assert.deepEqual(confirmCalls, [wt], `expected confirmMerge invoked exactly once with the real worktree path — got ${JSON.stringify(confirmCalls)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [SEC-02 round 3] mixed sweep: a poisoned manifest degrades to status:error while its LEGITIMATE sibling in the SAME sweep still finalizes (per-manifest fault isolation)', async () => {
  const { root, queueRoot } = setup();
  const outside = mkdtempSync(join(tmpdir(), 'finalize-r3-mixed-outside-'));
  try {
    const repo = join(root, 'projects', 'demo');
    mkdirSync(repo, { recursive: true });

    const badId = 'INIT-2026-05-30-r3-mixed-bad';
    writeManifestFields(queueRoot, 'ready-for-review', badId, {
      worktreePath: outside, // THE ATTACK
      projectRepoPath: repo,
      cycleId: `2026-05-30T01-02-03_${badId}`,
    });

    const goodId = 'INIT-2026-05-30-r3-mixed-good';
    const goodWt = join(root, '_worktrees', goodId);
    mkdirSync(goodWt, { recursive: true });
    writeManifestFields(queueRoot, 'ready-for-review', goodId, {
      worktreePath: goodWt,
      projectRepoPath: repo,
      cycleId: `2026-05-30T01-02-04_${goodId}`,
    });

    const confirmCalls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: (w: string) => { confirmCalls.push(w); return true; },
      finalizeOne: async () => true,
    });

    const badResult = results.find((r) => r.initiativeId === badId);
    const goodResult = results.find((r) => r.initiativeId === goodId);
    assert.ok(badResult, `expected a result entry for the poisoned manifest — got ${JSON.stringify(results)}`);
    assert.ok(goodResult, `expected a result entry for the legitimate manifest — got ${JSON.stringify(results)}`);
    assert.equal(
      badResult!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' (an element fault, not a collection failure) — got ${JSON.stringify(badResult)}`,
    );
    assert.equal(
      goodResult!.status,
      'finalized',
      `expected the sibling LEGITIMATE manifest to still finalize in the SAME sweep — got ${JSON.stringify(goodResult)}`,
    );
    assert.ok(!confirmCalls.includes(outside), `confirmMerge must never be invoked with the poisoned path — got ${JSON.stringify(confirmCalls)}`);
    assert.ok(confirmCalls.includes(goodWt), `confirmMerge must still be invoked with the legitimate sibling's real path — got ${JSON.stringify(confirmCalls)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
