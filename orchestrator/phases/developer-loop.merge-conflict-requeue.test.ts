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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { add } from '../worktree.ts';
import { createWiWorktree, removeWiWorktree, wiWorktreePath } from '../wi-worktree.ts';
import { createMergeQueue, mergeAndPublish, type MergeQueue } from '../wi-merge-back.ts';
import {
  assertOutcomesSettled,
  gitNetDelta,
  prerequisiteBlockage,
  settleWiOutcome,
  wiDeliveryEvent,
  type WiOutcome,
} from './developer-loop.ts';
import { topologicalOrder, writeWorkItem, writeWorkItemStatus, type WorkItem } from '../work-item.ts';
import { run as runRalph, type AgentInvocation } from '../../loops/ralph/runner.ts';
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
  agentFor: (item: WorkItem, attempt: number) => AgentInvocation;
  beforeRalph?: (item: WorkItem, attempt: number, worktreePath: string) => void;
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

    let finalStatus: WorkItem['status'] = 'failed';
    let mergeConflict = false;
    let requeue = false;
    try {
      opts.beforeRalph?.(item, attempt, wiWt.path);

      const result = await runRalph(
        {
          workItemSpecPath: resolve(wiWt.path, '.forge', 'work-items', `${item.work_item_id}.md`),
          worktreePath: wiWt.path,
          initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
          brainQueryResults: '',
          cycleId: opts.f.logger.cycleId,
          initiativeId: opts.initiativeId,
          qualityGate: () => true,
          failOnHollowIter0Gate: false,
        },
        opts.agentFor(item, attempt),
      );
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
        }),
      );

      if (mergeOutcome.merged) {
        finalStatus = 'complete';
      } else {
        mergeConflict = true;
        if (attempt <= MAX_RETRIES) {
          opts.mergeConflictAttempts.set(item.work_item_id, attempt);
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
    const wi1AttemptCalls: number[] = [];

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      mergeConflictAttempts,
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
      beforeRalph: (item, attempt) => {
        if (item.work_item_id === 'WI-1' && attempt === 1) {
          // Simulate the cycle branch moving independently while WI-1's
          // first attempt is in flight — the only way a merge conflict
          // arises at all.
          writeFileSync(join(f.cycleWorktreePath, 'shared.txt'), 'cycle change\n');
          sh(f.cycleWorktreePath, ['add', '.']);
          sh(f.cycleWorktreePath, ['commit', '-q', '-m', 'cycle: diverge']);
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
    const wi1AttemptCalls: number[] = [];
    let wi2Dispatched = false;

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      mergeConflictAttempts,
      agentFor: (item, attempt) => {
        if (item.work_item_id === 'WI-1') {
          wi1AttemptCalls.push(attempt);
          return fileWritingAgent('shared.txt', `wi-1 change ${attempt}\n`);
        }
        wi2Dispatched = true;
        return fileWritingAgent('wi2.txt', 'wi-2 content\n');
      },
      beforeRalph: (item, attempt) => {
        if (item.work_item_id === 'WI-1') {
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
