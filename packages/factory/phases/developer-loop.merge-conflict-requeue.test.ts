/**
 * Phase 4 step 7 — bounded merge-conflict requeue, exercised end-to-end
 * (real git repos, real `runRalph`, real `createWiWorktree`/`mergeAndPublish`,
 * real `runConcurrentDispatch`). Same precedent as
 * `developer-loop.wi-worktree-fanin.test.ts` and
 * `developer-loop.wi-concurrent-dispatch.test.ts`: `runDeveloperLoop` itself
 * can't be called directly in a test (its `agent` comes from a module-level
 * Claude SDK query, not injectable via `CycleInput`), so this drives the SAME
 * real building blocks `runWiDispatchTask`'s merge-conflict branch uses, at
 * the same call shape — including the bounded-retry bookkeeping
 * (`mergeConflictAttempts`, one retry before a conflict is terminal) —
 * through the real `runConcurrentDispatch` scheduler rather than a bare loop.
 *
 * `MAX_RETRIES` below mirrors developer-loop.ts's own (unexported)
 * `DEV_WI_MERGE_CONFLICT_MAX_RETRIES` — every assertion on `max_retries`
 * event metadata anchors to it, so a drift between the two would fail loudly
 * here rather than silently.
 *
 * Two scenarios: a first conflict that requeues and a clean second merge
 * that delivers (with the dependent forking only from the post-retry tip),
 * and two consecutive conflicts that exhaust the retry and terminally fail
 * the WI — with its dependent left `pending`, not cascaded to `failed`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { add } from '../worktree.ts';
import { createWiWorktree, removeWiWorktree, wiWorktreePath } from '../wi-worktree.ts';
import { createMergeQueue, mergeAndPublish, type MergeConflictDetail, type MergeQueue } from '../wi-merge-back.ts';
import {
  assertOutcomesSettled,
  GATE_FAILURE_FEEDBACK_HEADING,
  gitNetDelta,
  MERGE_CONFLICT_FEEDBACK_HEADING,
  prerequisiteBlockage,
  settleWiOutcome,
  wiDeliveryEvent,
  writeGateFeedback,
  writeMergeConflictFeedback,
  type WiOutcome,
} from './developer-loop.ts';
import { topologicalOrder, writeWorkItem, writeWorkItemStatus, type WorkItem } from '../work-item.ts';
import { run as runRalph, type AgentInvocation } from '../../loops/ralph/runner.ts';
import { makeQualityGateFromCmd } from '../../loops/ralph/stop-conditions.ts';
import { runConcurrentDispatch, type DispatchOutcome } from '../wi-dispatch-scheduler.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';

const MAX_RETRIES = 1;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function wi(id: string, dependsOn: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-11-merge-conflict-requeue',
    status: 'pending',
    depends_on: dependsOn,
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['fixture.txt'],
    quality_gate_cmd: ['true'],
    estimated_iterations: 3,
    body: '',
  };
}

function fileWritingAgent(filename: string, content: string): AgentInvocation {
  return async ({ worktreePath }) => {
    writeFileSync(join(worktreePath, filename), content);
    return { filesChanged: [filename], costUsd: 0.01 };
  };
}

type Fixture = {
  root: string;
  repo: string;
  origin: string;
  worktreesRoot: string;
  cycleWorktreePath: string;
  logger: ReturnType<typeof createLogger>;
  readEvents: () => EventLogEntry[];
  cleanup: () => void;
};

function setup(initiativeId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'forge-devloop-requeue-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  // Per the forge-project-contract (C2), every onboarded project's
  // `.gitignore` covers forge scratch — see the fan-in tests' own doc
  // comment for why this matters even in a single-agent-writes-a-file
  // fixture (ralph's autocommit `git add -A` would otherwise sweep it in).
  writeFileSync(join(repo, '.gitignore'), '.forge/\nAGENT.md\nPROMPT.md\nfix_plan.md\n');
  // Tracked so both the cycle branch and a WI branch can independently
  // change it, forcing a real content conflict at merge-back time (same
  // shape `wi-merge-back.test.ts`'s own conflict test and
  // `developer-loop.wi-worktree-fanin.test.ts`'s conflict test use).
  writeFileSync(join(repo, 'shared.txt'), 'base\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'base']);

  const worktreesRoot = join(root, '_worktrees');
  const cycleHandle = add({
    projectRepoPath: repo,
    branch: `forge/${initiativeId}`,
    worktreesRoot,
    initiativeId,
  });

  // A real bare "origin" remote — `mergeAndPublish` pushes to it on every
  // clean merge, mirroring `developer-loop.wi-concurrent-dispatch.test.ts`'s
  // fixture.
  const origin = join(root, 'origin.git');
  sh(root, ['init', '-q', '--bare', origin]);
  sh(cycleHandle.path, ['remote', 'add', 'origin', origin]);
  sh(cycleHandle.path, ['push', '-q', '-u', 'origin', `forge/${initiativeId}`]);

  const logsDir = join(root, '_logs');
  const logger = createLogger(initiativeId, logsDir);

  return {
    root,
    repo,
    origin,
    worktreesRoot,
    cycleWorktreePath: cycleHandle.path,
    logger,
    readEvents: () =>
      readFileSync(logger.logFilePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as EventLogEntry),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * The dispatch wrapper under test, mirroring `runWiDispatchTask`'s
 * merge-conflict branch from developer-loop.ts at the same call shape and
 * ordering: fork a fresh per-WI worktree from whatever the CURRENT cycle tip
 * is (every attempt re-reads `HEAD`, so a retry genuinely forks from a
 * fresh tip, not a stale one), run the agent, merge+publish through the
 * shared queue, and on a conflict either requeue (bounded by `MAX_RETRIES`,
 * never settling the WI's outcome) or conclude it failed. Every attempt that
 * actually concludes the WI goes through the SAME `settleWiOutcome` /
 * `wiDeliveryEvent` the real dispatch task uses — only the SDK-driven
 * `runRalph` invocation and the telemetry/gate scaffolding are out of scope
 * here (covered by the fan-in / concurrent-dispatch test files).
 */
function makeDispatch(opts: {
  f: Fixture;
  initiativeId: string;
  mergeQueue: MergeQueue;
  outcomes: Map<string, WiOutcome>;
  mergeConflictAttempts: Map<string, number>;
  mergeConflictDetails: Map<string, MergeConflictDetail>;
  agentFor: (item: WorkItem, attempt: number) => AgentInvocation;
  beforeRalph?: (item: WorkItem, attempt: number, worktreePath: string) => void;
  afterRalph?: (item: WorkItem, attempt: number, worktreePath: string) => void;
  /**
   * When provided, the REAL production gate wiring replaces the always-pass
   * stub: `runWiDispatchTask`'s own shape — a `makeQualityGateFromCmd` gate
   * whose `onRun` feeds `writeGateFeedback`, with `failOnHollowIter0Gate`
   * left at the runner's DEFAULT (true), so the iter-0 sharp-gate pre-check
   * genuinely fires against the injected conflict note (the re-review
   * CRITICAL the stubbed tests above bypass).
   */
  gateFor?: (item: WorkItem, attempt: number, wiWorktreePath: string) => (ctx?: { iteration: number }) => boolean | Promise<boolean>;
}): (item: WorkItem) => Promise<DispatchOutcome> {
  const workItemsDir = resolve(opts.f.cycleWorktreePath, '.forge', 'work-items');
  return async (item: WorkItem): Promise<DispatchOutcome> => {
    const specPath = resolve(workItemsDir, `${item.work_item_id}.md`);

    const blockage = prerequisiteBlockage(item, [...opts.outcomes.values()]);
    if (blockage !== 'none') {
      const status: WorkItem['status'] = blockage === 'work-failure' ? 'failed' : 'pending';
      writeWorkItemStatus(specPath, status);
      settleWiOutcome(opts.outcomes, {
        id: item.work_item_id,
        status,
        result: null,
        ...(blockage === 'environment-failure' ? { environment: true } : {}),
      });
      return { requeue: false };
    }

    const attempt = (opts.mergeConflictAttempts.get(item.work_item_id) ?? 0) + 1;
    const wiBaseSha = sh(opts.f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim();
    const wiWt = createWiWorktree({
      projectRepoPath: opts.f.repo,
      worktreesRoot: opts.f.worktreesRoot,
      initiativeId: opts.initiativeId,
      workItemId: item.work_item_id,
      startPointRef: wiBaseSha,
      cycleWorktreePath: opts.f.cycleWorktreePath,
    });

    // Conflict-context injection, mirroring `runWiDispatchTask`'s own wiring
    // in developer-loop.ts exactly: a prior conflict for this WI id means
    // this dispatch IS the requeued attempt — seed the fresh worktree with
    // the SAME `.forge/last-gate-failure.md` seam the gate-feedback loop
    // uses, before the Ralph run below. Consumed exactly once (the entry is
    // deleted), also mirroring production.
    const priorConflict = opts.mergeConflictDetails.get(item.work_item_id);
    if (priorConflict) {
      opts.mergeConflictDetails.delete(item.work_item_id);
      writeMergeConflictFeedback(wiWt.path, opts.mergeConflictAttempts.get(item.work_item_id) ?? 1, priorConflict);
    }

    let finalStatus: WorkItem['status'] = 'failed';
    let mergeConflict = false;
    let requeue = false;
    try {
      opts.beforeRalph?.(item, attempt, wiWt.path);

      const productionGate = opts.gateFor?.(item, attempt, wiWt.path);
      const result = await runRalph(
        {
          workItemSpecPath: resolve(wiWt.path, '.forge', 'work-items', `${item.work_item_id}.md`),
          worktreePath: wiWt.path,
          initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
          brainQueryResults: '',
          cycleId: opts.f.logger.cycleId,
          initiativeId: opts.initiativeId,
          // Production wiring when `gateFor` is supplied (real gate cmd +
          // onRun→writeGateFeedback + runner-DEFAULT failOnHollowIter0Gate);
          // otherwise the always-pass stub the fan-in scenarios use.
          ...(productionGate
            ? { qualityGate: productionGate }
            : { qualityGate: () => true, failOnHollowIter0Gate: false }),
        },
        opts.agentFor(item, attempt),
      );
      opts.afterRalph?.(item, attempt, wiWt.path);
      assert.equal(
        result.status,
        'complete',
        `${item.work_item_id} attempt ${attempt}'s own Ralph run must succeed — the conflict is only ever at fan-in`,
      );

      const mergeOutcome = await opts.mergeQueue.enqueue(() =>
        mergeAndPublish({
          cycleWorktreePath: opts.f.cycleWorktreePath,
          wiBranch: wiWt.branch,
          workItemId: item.work_item_id,
          specPath,
          startPointRef: wiBaseSha,
        }),
      );

      if (mergeOutcome.merged) {
        finalStatus = 'complete';
      } else {
        mergeConflict = true;
        if (attempt <= MAX_RETRIES) {
          opts.mergeConflictAttempts.set(item.work_item_id, attempt);
          opts.mergeConflictDetails.set(item.work_item_id, mergeOutcome.conflict);
          requeue = true;
        } else {
          finalStatus = 'failed';
        }
      }

      if (!requeue && finalStatus !== 'complete') {
        writeWorkItemStatus(specPath, finalStatus);
      }

      if (requeue) {
        opts.f.logger.emit({
          initiative_id: opts.initiativeId,
          phase: 'developer-loop',
          skill: 'developer-ralph',
          event_type: 'log',
          input_refs: [specPath],
          output_refs: [],
          message: 'dev-loop.merge-conflict-requeue',
          metadata: {
            work_item_id: item.work_item_id,
            attempt,
            max_retries: MAX_RETRIES,
            merge_detail: mergeOutcome.merged ? undefined : mergeOutcome.detail,
          },
        });
      } else {
        const wiDelta = gitNetDelta(wiWt.path, wiBaseSha);
        const deliveryEvent = wiDeliveryEvent(finalStatus, item.work_item_id, wiDelta);
        opts.f.logger.emit({
          initiative_id: opts.initiativeId,
          phase: 'developer-loop',
          skill: 'developer-ralph',
          event_type: 'log',
          input_refs: [wiWt.path],
          output_refs: [],
          message: deliveryEvent.message,
          metadata: deliveryEvent.metadata,
        });
        settleWiOutcome(opts.outcomes, {
          id: item.work_item_id,
          status: finalStatus,
          result: null,
          ...(mergeConflict ? { environment: true } : {}),
        });
      }
    } finally {
      // Per-WI worktrees are pure scratch — removed on every outcome
      // (success, conflict-and-requeue, or terminal conflict) so the next
      // attempt/sibling never inherits stale state, mirroring
      // `runWiDispatchTask`'s own unconditional cleanup.
      removeWiWorktree({
        projectRepoPath: opts.f.repo,
        path: wiWt.path,
        branch: wiWt.branch,
        deleteBranch: true,
      });
    }

    return { requeue };
  };
}

test('merge-conflict requeue: a first fan-in conflict requeues, a clean second merge (fresh tip, no further divergence) delivers, and the dependent forks only from the post-retry tip', async () => {
  const initiativeId = 'INIT-2026-07-11-merge-conflict-requeue-clean';
  const f = setup(initiativeId);
  try {
    const items = [wi('WI-1', []), wi('WI-2', ['WI-1'])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const mergeConflictAttempts = new Map<string, number>();
    const mergeConflictDetails = new Map<string, MergeConflictDetail>();
    const wi1AttemptCalls: number[] = [];

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      mergeConflictAttempts,
      mergeConflictDetails,
      agentFor: (item, attempt) => {
        if (item.work_item_id === 'WI-1') {
          wi1AttemptCalls.push(attempt);
          // Attempt 1 collides with the cycle branch's own divergent change
          // to shared.txt (staged in `beforeRalph` below); attempt 2 writes
          // an unrelated file, so the retry's merge is genuinely clean.
          return attempt === 1
            ? fileWritingAgent('shared.txt', 'wi-1 change\n')
            : fileWritingAgent('wi1.txt', 'wi-1 attempt 2\n');
        }
        return fileWritingAgent('wi2.txt', 'wi-2 content\n');
      },
      beforeRalph: (item, attempt, worktreePath) => {
        const failureFile = join(worktreePath, '.forge', 'last-gate-failure.md');
        if (item.work_item_id === 'WI-1' && attempt === 1) {
          // Conflict-context injection: attempt 1 is a FIRST attempt — no
          // prior conflict is known yet, so nothing should have been written
          // into this fresh worktree.
          assert.equal(existsSync(failureFile), false, 'a first attempt (no prior conflict) must get no feedback file');
          // Simulate the cycle branch moving independently while WI-1's
          // first attempt is in flight — the only way a merge conflict
          // arises at all.
          writeFileSync(join(f.cycleWorktreePath, 'shared.txt'), 'cycle change\n');
          sh(f.cycleWorktreePath, ['add', '.']);
          sh(f.cycleWorktreePath, ['commit', '-q', '-m', 'cycle: diverge']);
        }
        if (item.work_item_id === 'WI-1' && attempt === 2) {
          // Conflict-context injection: the requeued attempt's FRESH
          // worktree must already carry the conflict-guidance feedback file,
          // naming the file that conflicted — written before this hook (and
          // therefore before ANY ralph iteration) runs.
          assert.ok(existsSync(failureFile), 'the requeued attempt must find the merge-conflict feedback file');
          const body = readFileSync(failureFile, 'utf8');
          assert.match(body, /^# MERGE CONFLICT \(attempt 1\)/);
          assert.match(body, /shared\.txt/, 'the conflicting file must be named in the feedback');
        }
        if (item.work_item_id === 'WI-2') {
          // WI-2 forks its own worktree in `makeDispatch` right before this
          // hook fires — by construction that only happens once WI-1 has
          // genuinely settled `complete` (the scheduler blocks dependents
          // until then), so its tip already carries WI-1's SECOND attempt's
          // file, never its aborted first attempt's.
          const wtPath = wiWorktreePath({ worktreesRoot: f.worktreesRoot, initiativeId, workItemId: 'WI-2' });
          assert.equal(readFileSync(join(wtPath, 'wi1.txt'), 'utf8'), 'wi-1 attempt 2\n');
          assert.equal(readFileSync(join(wtPath, 'shared.txt'), 'utf8'), 'cycle change\n');
          // WI-2 never conflicts — a clean WI's first (and only) attempt
          // must get no feedback file at all.
          assert.equal(existsSync(failureFile), false, 'a WI that never conflicts must get no merge-conflict feedback file');
        }
      },
    });

    await runConcurrentDispatch({
      items: topologicalOrder(items),
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap: 2,
      dispatch,
    });

    assert.deepEqual(wi1AttemptCalls, [1, 2], 'WI-1 must be dispatched exactly twice: the conflict, then the retry');

    assertOutcomesSettled(outcomes, items);
    assert.equal(outcomes.get('WI-1')?.status, 'complete');
    assert.equal(outcomes.get('WI-2')?.status, 'complete');

    const events = f.readEvents();
    const requeueEvents = events.filter((e) => e.message === 'dev-loop.merge-conflict-requeue');
    assert.equal(requeueEvents.length, 1, 'exactly one requeue decision — only the first conflict, never the clean retry');
    assert.equal(requeueEvents[0]?.metadata?.work_item_id, 'WI-1');
    assert.equal(requeueEvents[0]?.metadata?.attempt, 1);
    assert.equal(requeueEvents[0]?.metadata?.max_retries, MAX_RETRIES);

    const deliveredForWi1 = events.filter((e) => e.message === 'dev-loop.delivered' && e.metadata?.work_item_id === 'WI-1');
    assert.equal(deliveredForWi1.length, 1, 'WI-1 delivers exactly once — the requeued attempt never fires its own delivery event');
    assert.equal(events.some((e) => e.message === 'dev-loop.discarded' && e.metadata?.work_item_id === 'WI-1'), false);
  } finally {
    f.cleanup();
  }
});

test('merge-conflict requeue: two consecutive conflicts exhaust the retry — terminal failed (merge-conflict), dependent left pending (not failed)', async () => {
  const initiativeId = 'INIT-2026-07-11-merge-conflict-requeue-terminal';
  const f = setup(initiativeId);
  try {
    const items = [wi('WI-1', []), wi('WI-2', ['WI-1'])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const mergeConflictAttempts = new Map<string, number>();
    const mergeConflictDetails = new Map<string, MergeConflictDetail>();
    const wi1AttemptCalls: number[] = [];
    let wi2Dispatched = false;

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      mergeConflictAttempts,
      mergeConflictDetails,
      agentFor: (item, attempt) => {
        if (item.work_item_id === 'WI-1') {
          wi1AttemptCalls.push(attempt);
          return fileWritingAgent('shared.txt', `wi-1 change ${attempt}\n`);
        }
        wi2Dispatched = true;
        return fileWritingAgent('wi2.txt', 'wi-2 content\n');
      },
      beforeRalph: (item, attempt, worktreePath) => {
        if (item.work_item_id === 'WI-1') {
          const failureFile = join(worktreePath, '.forge', 'last-gate-failure.md');
          if (attempt === 1) {
            assert.equal(existsSync(failureFile), false, 'a first attempt (no prior conflict) must get no feedback file');
          } else {
            // attempt 2 is the requeued attempt from attempt 1's conflict —
            // it must carry the conflict feedback even though attempt 2
            // itself is about to conflict again (terminally this time).
            assert.ok(existsSync(failureFile), 'the requeued attempt must find the merge-conflict feedback file');
            assert.match(readFileSync(failureFile, 'utf8'), /^# MERGE CONFLICT \(attempt 1\)/);
          }
          // A FRESH divergent commit on every attempt — "against the fresh
          // cycle-branch tip" per Phase 4 step 7, and this attempt conflicts
          // again regardless.
          writeFileSync(join(f.cycleWorktreePath, 'shared.txt'), `cycle change ${attempt}\n`);
          sh(f.cycleWorktreePath, ['add', '.']);
          sh(f.cycleWorktreePath, ['commit', '-q', '-m', `cycle: diverge ${attempt}`]);
        }
      },
    });

    await runConcurrentDispatch({
      items: topologicalOrder(items),
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap: 2,
      dispatch,
    });

    assert.deepEqual(wi1AttemptCalls, [1, 2], 'WI-1 must be dispatched exactly twice: the conflict, then the terminal retry');
    assert.equal(wi2Dispatched, false, 'WI-2 must never even get a worktree — it stays blocked, not run-then-discarded');

    assertOutcomesSettled(outcomes, items);
    assert.equal(outcomes.get('WI-1')?.status, 'failed');
    assert.equal(outcomes.get('WI-1')?.environment, true, 'a merge-conflict failure cascades the SAME non-cascading way an environment failure does');
    assert.equal(outcomes.get('WI-2')?.status, 'pending', 'the dependent is left queued, not cascaded to failed');

    const events = f.readEvents();
    const requeueEvents = events.filter((e) => e.message === 'dev-loop.merge-conflict-requeue');
    assert.equal(requeueEvents.length, 1, 'only the FIRST conflict requeues — the second is terminal, not a second requeue');
    assert.equal(requeueEvents[0]?.metadata?.attempt, 1);

    const discardedForWi1 = events.filter((e) => e.message === 'dev-loop.discarded' && e.metadata?.work_item_id === 'WI-1');
    assert.equal(discardedForWi1.length, 1, 'the terminal attempt reports exactly one discarded event, not one per attempt');
    assert.equal(discardedForWi1[0]?.metadata?.outcome, 'failed');
  } finally {
    f.cleanup();
  }
});

test('merge-conflict requeue through the REAL gate wiring: the iter-0 sharp-gate pre-check appends beneath the conflict note (agent turn 1 sees both), an iteration-1 failure replaces it, and the passing gate deletes it', async () => {
  const initiativeId = 'INIT-2026-07-12-merge-conflict-iter0-gate';
  const f = setup(initiativeId);
  try {
    const items = [wi('WI-1', [])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const mergeConflictAttempts = new Map<string, number>();
    const mergeConflictDetails = new Map<string, MergeConflictDetail>();

    // Every agent turn snapshots what `.forge/last-gate-failure.md` held
    // when the turn STARTED — the exact read the dev system prompt mandates
    // as the agent's first act. `iteration` here is the runner's own
    // numbering: the agent's first turn is iteration 1 (iteration 0 is the
    // sharp-gate pre-check, which runs BEFORE the agent exists).
    const seen: { attempt: number; iteration: number; feedback: string | null }[] = [];
    const snapshotFeedback = (worktreePath: string): string | null => {
      const p = join(worktreePath, '.forge', 'last-gate-failure.md');
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      mergeConflictAttempts,
      mergeConflictDetails,
      // THE REAL PRODUCTION PATH (re-review CRITICAL): a real gate command
      // run by makeQualityGateFromCmd, its onRun feeding writeGateFeedback,
      // and failOnHollowIter0Gate left at the runner's default (true) — so
      // the iter-0 pre-check genuinely runs the gate against the fresh fork
      // and reports a failure into the same file as the conflict note.
      gateFor: (_item, _attempt, wiWtPath) =>
        makeQualityGateFromCmd(wiWtPath, ['test', '-f', 'wi1.txt'], (info) => writeGateFeedback(wiWtPath, info)),
      agentFor: (_item, attempt) =>
        async ({ worktreePath, iteration }) => {
          seen.push({ attempt, iteration, feedback: snapshotFeedback(worktreePath) });
          if (attempt === 1) {
            // One turn: satisfy the gate AND make the edit that will collide
            // with the cycle branch's divergent change staged in beforeRalph.
            writeFileSync(join(worktreePath, 'shared.txt'), 'wi-1 change\n');
            writeFileSync(join(worktreePath, 'wi1.txt'), 'wi-1 attempt 1\n');
            return { filesChanged: ['shared.txt', 'wi1.txt'], costUsd: 0.01 };
          }
          if (iteration === 1) {
            // Requeued attempt, first REAL turn: leave the gate failing so
            // the post-turn iteration-1 gate check exercises the
            // replace-entirely contract on the next turn's read.
            writeFileSync(join(worktreePath, 'notes.txt'), 'orienting on the conflict feedback\n');
            return { filesChanged: ['notes.txt'], costUsd: 0.01 };
          }
          // Second turn: satisfy the gate WITHOUT touching shared.txt — the
          // rebased approach the conflict note instructs — so the retry
          // merges clean.
          writeFileSync(join(worktreePath, 'wi1.txt'), 'wi-1 attempt 2\n');
          return { filesChanged: ['wi1.txt'], costUsd: 0.01 };
        },
      beforeRalph: (_item, attempt) => {
        if (attempt === 1) {
          // Diverge the cycle branch so attempt 1's merge-back conflicts.
          writeFileSync(join(f.cycleWorktreePath, 'shared.txt'), 'cycle change\n');
          sh(f.cycleWorktreePath, ['add', '.']);
          sh(f.cycleWorktreePath, ['commit', '-q', '-m', 'cycle: diverge']);
        }
      },
      afterRalph: (_item, attempt, worktreePath) => {
        // Each attempt ends on a passing gate — the passing write must have
        // DELETED the feedback file, conflict note included.
        assert.equal(
          snapshotFeedback(worktreePath),
          null,
          `attempt ${attempt}: a passing gate must delete the feedback file (conflict note included)`,
        );
      },
    });

    await runConcurrentDispatch({
      items: topologicalOrder(items),
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap: 1,
      dispatch,
    });

    assertOutcomesSettled(outcomes, items);
    assert.equal(outcomes.get('WI-1')?.status, 'complete');
    assert.equal(
      f.readEvents().filter((e) => e.message === 'dev-loop.merge-conflict-requeue').length,
      1,
      'exactly one requeue — attempt 2 merges clean',
    );

    // Attempt 1 turn 1 (no prior conflict): the iter-0 pre-check failed and
    // wrote PLAIN gate feedback — nothing to preserve.
    const a1t1 = seen.find((s) => s.attempt === 1 && s.iteration === 1);
    assert.ok(a1t1?.feedback, 'attempt 1 turn 1 must see the iter-0 gate failure');
    assert.ok(a1t1.feedback.startsWith(GATE_FAILURE_FEEDBACK_HEADING), 'a first attempt gets a plain gate-failure body');
    assert.ok(a1t1.feedback.includes('(forge, iteration 0)'));
    assert.ok(!a1t1.feedback.includes(MERGE_CONFLICT_FEEDBACK_HEADING));

    // THE CRITICAL ASSERTION: attempt 2 (requeued), the agent's ACTUAL first
    // turn (runner iteration 1) — the iter-0 pre-check already ran the real
    // gate and failed, and the conflict note must have SURVIVED it, with the
    // gate detail appended beneath.
    const a2t1 = seen.find((s) => s.attempt === 2 && s.iteration === 1);
    assert.ok(a2t1?.feedback, "the requeued attempt's first agent turn must find the feedback file");
    assert.ok(
      a2t1.feedback.startsWith(`${MERGE_CONFLICT_FEEDBACK_HEADING} (attempt 1)`),
      'the conflict note must survive the iter-0 gate pre-check and stay FIRST',
    );
    assert.match(a2t1.feedback, /shared\.txt/, 'the conflicting file must still be named');
    assert.ok(
      a2t1.feedback.includes(`${GATE_FAILURE_FEEDBACK_HEADING} (forge, iteration 0)`),
      'the iter-0 gate detail must be appended beneath the conflict note',
    );

    // Iteration ≥ 1 contract: the second turn's read sees the iteration-1
    // gate failure having REPLACED the file entirely (the agent has had its
    // mandated first read; freshest live truth wins).
    const a2t2 = seen.find((s) => s.attempt === 2 && s.iteration === 2);
    assert.ok(a2t2?.feedback, 'attempt 2 turn 2 must see the iteration-1 gate failure');
    assert.ok(a2t2.feedback.startsWith(GATE_FAILURE_FEEDBACK_HEADING));
    assert.ok(a2t2.feedback.includes('(forge, iteration 1)'));
    assert.ok(!a2t2.feedback.includes(MERGE_CONFLICT_FEEDBACK_HEADING), 'an iteration ≥ 1 failure replaces the conflict note entirely');

    assert.equal(seen.length, 3, 'attempt 1 = one turn; attempt 2 = two turns');
  } finally {
    f.cleanup();
  }
});
