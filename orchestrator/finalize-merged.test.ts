/**
 * Tests for the F-W5-7 finalize sweep — selection + re-claim logic. The
 * per-cycle closure→reflector action is injected (`finalizeOne`) so these stay
 * git/SDK-free; the real chain is exercised end-to-end by a live cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { finalizeMergedReadyForReview } from './finalize-merged.ts';
import { runClosure as realRunClosure } from './phases/closure.ts';
import { seedStaticUnifierItem, appendReviewUnifierItems } from './unifier-items.ts';
import { writeWorkItemStatus } from './work-item.ts';

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
  return { root, queueRoot };
}

function writeManifest(queueRoot: string, state: string, id: string, worktreePath: string): void {
  const body = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${worktreePath}`,
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
    const wt = join(root, 'wt');
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

// Stage C — the default finalize fires reflect FROM forge-develop's declared
// {on: merged, flow: forge-reflect} trigger, not a hardcoded runReflector call.
test('finalize: merged → fires reflect from the develop declaration (default path)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-decl', wt);
    const reflectCalls: string[] = [];
    const results = await finalizeMergedReadyForReview({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => true,
      // No finalizeOne override → exercises makeDefaultFinalizeOne; inject its
      // closure + reflector + trigger source so the test stays git/SDK-free.
      runClosure: async () => ({ outcome: 'merged', merged: true }),
      runReflector: async (input) => { reflectCalls.push(input.initiativeId); },
      loadFlowTriggers: () => [{ on: 'merged', flow: 'forge-reflect' }],
    });
    assert.deepEqual(results.map((r) => r.status), ['finalized']);
    assert.deepEqual(reflectCalls, ['INIT-2026-05-30-decl'], 'reflect must fire from the declaration');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: merged but NO declared merge-trigger → reflect does NOT fire (declaration-driven)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
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

test('finalize: threads the manifest-persisted cycle_id into finalizeOne (ADR 026 lineage)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
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
    const wt = join(root, 'wt');
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

test('finalize: merged with pending UWIs still finalizes, but surfaces the drop (B2, non-silent)', async () => {
  const { root, queueRoot } = setup();
  try {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    const id = 'INIT-2026-05-30-merged-pending';
    // A post-send-back worktree: UWI-1 complete, UWI-2/3 still pending.
    const uwi1 = seedStaticUnifierItem(wt, { initiativeId: id, estimatedIterations: 6, qualityGateCmd: ['go', 'test', './...'] });
    writeWorkItemStatus(uwi1, 'complete');
    appendReviewUnifierItems({
      worktreePath: wt,
      initiativeId: id,
      concern: { rationale: 'r', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }] },
      projectGateCmd: ['go', 'test', './...'],
      estimatedIterations: 6,
    });
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
    assert.ok(notes.some((n) => /pending review work-item/.test(n)), `expected a non-silent drop note, got ${JSON.stringify(notes)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalize: worktree gone → no-worktree, skipped (no re-claim)', async () => {
  const { root, queueRoot } = setup();
  try {
    writeManifest(queueRoot, 'ready-for-review', 'INIT-2026-05-30-nowt', join(root, 'gone'));
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
    const wt = join(root, 'wt');
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
      loadFlowTriggers: () => [{ on: 'merged', flow: 'forge-reflect' }],
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
    const wt = join(root, 'wt');
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
