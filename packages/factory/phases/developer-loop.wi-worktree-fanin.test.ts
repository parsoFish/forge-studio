/**
 * Phase 4 step 5 — per-WI worktrees + merge-back fan-in, exercised end-to-end
 * (real git repos, real `runRalph`, real `createWiWorktree` /
 * `mergeWiIntoCycle`). Referenced by `wi-merge-back.test.ts`'s own doc
 * comment.
 *
 * No SDK: `runRalph`'s `agent` parameter is a plain injectable function
 * (`loops/ralph/runner.ts`'s own tests stub it the same way — a fake agent
 * that writes real files into `params.worktreePath` and returns
 * `{filesChanged, costUsd}`; the runner's autocommit net turns that into a
 * real commit). This file drives the SAME building blocks
 * `runDeveloperLoop`'s per-WI body uses (`createWiWorktree`, `runRalph`,
 * `mergeWiIntoCycle` via `createMergeQueue`, `prerequisiteBlockage`,
 * `settleWiOutcome`, `removeWiWorktree`, `writeWorkItemStatus`,
 * `gitNetDelta`, `topologicalOrder`) directly, at the same call shape —
 * proving the fan-out/fan-in mechanics without needing a live Claude SDK
 * call. Three scenarios: a happy-path two-WI chain (fan-out forks from the
 * post-merge tip), a merge conflict at fan-in (terminal for the WI,
 * non-cascading for dependents), and a plain ralph failure (never even
 * attempts a merge, but still reports honest diff stats before cleanup).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { add } from '../worktree.ts';
import { createWiWorktree, removeWiWorktree, wiWorktreePath } from '../wi-worktree.ts';
import { createMergeQueue, mergeWiIntoCycle } from '../wi-merge-back.ts';
import { gitNetDelta, prerequisiteBlockage, settleWiOutcome, type WiOutcome } from './developer-loop.ts';
import { topologicalOrder, writeWorkItem, writeWorkItemStatus, type WorkItem } from '../work-item.ts';
import { run as runRalph, type AgentInvocation } from '../../loops/ralph/runner.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function wi(id: string, dependsOn: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-11-fanin-test',
    status: 'pending',
    depends_on: dependsOn,
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['fixture.txt'],
    // Never actually run (the fake agent stands in for Ralph) — only needed
    // to satisfy validateWorkItem's non-hollow-gate shape check.
    quality_gate_cmd: ['true'],
    estimated_iterations: 3,
    body: '',
  };
}

/** A fake `AgentInvocation` (mirrors `loops/ralph/runner.test.ts`'s pattern):
 * writes ONE real file into the worktree it's handed and reports it. */
function fileWritingAgent(filename: string, content: string): AgentInvocation {
  return async ({ worktreePath }) => {
    writeFileSync(join(worktreePath, filename), content);
    return { filesChanged: [filename], costUsd: 0.01 };
  };
}

type Fixture = {
  root: string;
  repo: string;
  worktreesRoot: string;
  cycleWorktreePath: string;
  logger: ReturnType<typeof createLogger>;
  readEvents: () => EventLogEntry[];
  cleanup: () => void;
};

/**
 * A real project repo + a real cycle worktree checked out on the cycle
 * branch, exactly as `runDeveloperLoop` finds it: `input.worktreePath` is a
 * sibling of the per-WI worktrees under the same `worktreesRoot`, created via
 * `orchestrator/worktree.ts`'s `add()` — the same helper `scheduler.ts` uses
 * for the cycle worktree itself.
 */
function setup(initiativeId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'forge-devloop-fanin-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  // Per the forge-project-contract (C2), every onboarded project's
  // `.gitignore` covers `.forge/` — `.forge/work-items/*.md` is the PM's
  // per-cycle scratch, never meant to be tracked. Without this, ralph's
  // autocommit safety net (`git add -A`, which itself respects .gitignore)
  // would sweep the per-WI worktree's COPY of the spec file into the WI
  // branch's commit, and the merge-back would then collide with the SAME
  // untracked file still sitting in the cycle worktree.
  writeFileSync(join(repo, '.gitignore'), '.forge/\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'base']);

  const worktreesRoot = join(root, '_worktrees');
  const cycleHandle = add({
    projectRepoPath: repo,
    branch: `forge/${initiativeId}`,
    worktreesRoot,
    initiativeId,
  });

  const logsDir = join(root, '_logs');
  const logger = createLogger(initiativeId, logsDir);

  return {
    root,
    repo,
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

test('fan-in: two sequential WIs (second depends on first) — the second worktree contains the first WI\'s files, both merge as --no-ff, both worktrees are cleaned up', async () => {
  const f = setup('INIT-2026-07-11-fanin-test');
  try {
    const items = [wi('WI-1', []), wi('WI-2', ['WI-1'])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const workItemsDir = resolve(f.cycleWorktreePath, '.forge', 'work-items');
    const createdWiPaths: string[] = [];

    for (const item of topologicalOrder(items)) {
      const blockage = prerequisiteBlockage(item, [...outcomes.values()]);
      assert.equal(blockage, 'none', `${item.work_item_id} must not be blocked in the happy path`);

      const wiBaseSha = sh(f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim();
      const wiWt = createWiWorktree({
        projectRepoPath: f.repo,
        worktreesRoot: f.worktreesRoot,
        initiativeId: 'INIT-2026-07-11-fanin-test',
        workItemId: item.work_item_id,
        startPointRef: wiBaseSha,
        cycleWorktreePath: f.cycleWorktreePath,
      });
      createdWiPaths.push(wiWt.path);

      // The load-bearing assertion for WI-2: its freshly-created worktree
      // must already contain WI-1's file — proof the fan-out forked from
      // the cycle branch's tip AFTER WI-1's fan-in merge, not from some
      // stale/earlier point.
      if (item.work_item_id === 'WI-2') {
        assert.equal(
          readFileSync(join(wiWt.path, 'wi1.txt'), 'utf8'),
          'wi-1 content\n',
          "WI-2's worktree must contain WI-1's merged file",
        );
      }

      let finalStatus: WorkItem['status'] = 'failed';
      try {
        const agent =
          item.work_item_id === 'WI-1'
            ? fileWritingAgent('wi1.txt', 'wi-1 content\n')
            : fileWritingAgent('wi2.txt', 'wi-2 content\n');

        const result = await runRalph(
          {
            workItemSpecPath: resolve(wiWt.path, '.forge', 'work-items', `${item.work_item_id}.md`),
            worktreePath: wiWt.path,
            initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
            brainQueryResults: '',
            cycleId: f.logger.cycleId,
            initiativeId: 'INIT-2026-07-11-fanin-test',
            qualityGate: () => true,
            failOnHollowIter0Gate: false,
          },
          agent,
        );
        assert.equal(result.status, 'complete');

        const mergeResult = await mergeQueue.enqueue(() =>
          mergeWiIntoCycle({
            cycleWorktreePath: f.cycleWorktreePath,
            wiBranch: wiWt.branch,
            workItemId: item.work_item_id,
          }),
        );
        assert.equal(mergeResult.merged, true, `${item.work_item_id} must merge cleanly`);
        finalStatus = 'complete';
      } finally {
        removeWiWorktree({
          projectRepoPath: f.repo,
          path: wiWt.path,
          branch: wiWt.branch,
          deleteBranch: true,
        });
      }

      writeWorkItemStatus(resolve(workItemsDir, `${item.work_item_id}.md`), finalStatus);
      settleWiOutcome(outcomes, { id: item.work_item_id, status: finalStatus, result: null });
    }

    // Both files landed on the cycle branch.
    assert.equal(readFileSync(join(f.cycleWorktreePath, 'wi1.txt'), 'utf8'), 'wi-1 content\n');
    assert.equal(readFileSync(join(f.cycleWorktreePath, 'wi2.txt'), 'utf8'), 'wi-2 content\n');

    // Both outcomes settled complete.
    assert.equal(outcomes.get('WI-1')?.status, 'complete');
    assert.equal(outcomes.get('WI-2')?.status, 'complete');

    // Cleanup ran for BOTH per-WI worktrees — scratch only, nothing lingers.
    for (const p of createdWiPaths) assert.equal(existsSync(p), false, `${p} must be removed after settle`);

    // The cycle branch history carries TWO --no-ff merge commits (one per
    // WI) — never a fast-forward that would hide which WI contributed what.
    const mergeCount = sh(f.cycleWorktreePath, ['log', '--merges', '--oneline']).trim().split('\n').filter(Boolean).length;
    assert.equal(mergeCount, 2, 'one merge commit per fanned-in WI');
  } finally {
    f.cleanup();
  }
});

test('fan-in: a merge conflict is terminal for the WI (failure_kind merge-conflict), its dependent stays pending (not failed), the cycle worktree is left clean, and both worktrees are cleaned up', async () => {
  const f = setup('INIT-2026-07-11-fanin-conflict');
  try {
    // A file already tracked on the cycle branch so both the cycle branch
    // itself and WI-1's branch can independently change it, forcing a real
    // content conflict at merge-back time — the same shape
    // `wi-merge-back.test.ts`'s own conflict test uses, wired through the
    // fan-in loop this time.
    writeFileSync(join(f.cycleWorktreePath, 'shared.txt'), 'base\n');
    sh(f.cycleWorktreePath, ['add', '.']);
    sh(f.cycleWorktreePath, ['commit', '-q', '-m', 'seed shared.txt']);

    const items = [wi('WI-1', []), wi('WI-2', ['WI-1'])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const workItemsDir = resolve(f.cycleWorktreePath, '.forge', 'work-items');
    const createdWiPaths: string[] = [];

    for (const item of topologicalOrder(items)) {
      const blockage = prerequisiteBlockage(item, [...outcomes.values()]);

      if (blockage !== 'none') {
        // Blocked (environment-class, per Phase 4 step 5): settle PENDING,
        // never dispatch a worktree for it at all.
        settleWiOutcome(outcomes, { id: item.work_item_id, status: 'pending', result: null, environment: true });
        continue;
      }

      const wiBaseSha = sh(f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim();
      const wiWt = createWiWorktree({
        projectRepoPath: f.repo,
        worktreesRoot: f.worktreesRoot,
        initiativeId: 'INIT-2026-07-11-fanin-conflict',
        workItemId: item.work_item_id,
        startPointRef: wiBaseSha,
        cycleWorktreePath: f.cycleWorktreePath,
      });
      createdWiPaths.push(wiWt.path);

      // Simulate the cycle branch moving independently WHILE WI-1's Ralph
      // loop is in flight — the only way a genuinely SERIAL loop (this
      // step; concurrent dispatch is a later step) can still hit a merge
      // conflict: something else touches the cycle branch between fork and
      // merge-back.
      writeFileSync(join(f.cycleWorktreePath, 'shared.txt'), 'cycle change\n');
      sh(f.cycleWorktreePath, ['add', '.']);
      sh(f.cycleWorktreePath, ['commit', '-q', '-m', 'cycle: diverge']);

      let finalStatus: WorkItem['status'] = 'failed';
      let mergeConflict = false;
      try {
        const result = await runRalph(
          {
            workItemSpecPath: resolve(wiWt.path, '.forge', 'work-items', `${item.work_item_id}.md`),
            worktreePath: wiWt.path,
            initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
            brainQueryResults: '',
            cycleId: f.logger.cycleId,
            initiativeId: 'INIT-2026-07-11-fanin-conflict',
            qualityGate: () => true,
            failOnHollowIter0Gate: false,
          },
          fileWritingAgent('shared.txt', 'wi-1 change\n'),
        );
        assert.equal(result.status, 'complete', "WI-1's own Ralph loop succeeds — the conflict is only at fan-in");

        const mergeResult = await mergeQueue.enqueue(() =>
          mergeWiIntoCycle({
            cycleWorktreePath: f.cycleWorktreePath,
            wiBranch: wiWt.branch,
            workItemId: item.work_item_id,
          }),
        );
        if (mergeResult.merged) {
          finalStatus = 'complete';
        } else {
          finalStatus = 'failed';
          mergeConflict = true;
        }
      } finally {
        removeWiWorktree({
          projectRepoPath: f.repo,
          path: wiWt.path,
          branch: wiWt.branch,
          deleteBranch: true,
        });
      }

      writeWorkItemStatus(resolve(workItemsDir, `${item.work_item_id}.md`), finalStatus);

      // Mirrors developer-loop.ts's real `ralph.end` emit shape: a merge
      // conflict gets its OWN failure_kind, distinct from a work failure.
      f.logger.emit({
        initiative_id: 'INIT-2026-07-11-fanin-conflict',
        phase: 'developer-loop',
        skill: 'developer-ralph',
        event_type: 'end',
        input_refs: [],
        output_refs: [],
        message: 'ralph.end',
        metadata: {
          work_item_id: item.work_item_id,
          status: finalStatus,
          ...(mergeConflict ? { failure_kind: 'merge-conflict' } : {}),
        },
      });

      settleWiOutcome(outcomes, {
        id: item.work_item_id,
        status: finalStatus,
        result: null,
        ...(mergeConflict ? { environment: true } : {}),
      });
    }

    // WI-1 failed at fan-in with the merge-conflict failure_kind.
    assert.equal(outcomes.get('WI-1')?.status, 'failed');
    assert.equal(outcomes.get('WI-1')?.environment, true);
    const events = f.readEvents();
    const wi1End = events.find((e) => e.message === 'ralph.end' && e.metadata?.work_item_id === 'WI-1');
    assert.equal(wi1End?.metadata?.failure_kind, 'merge-conflict');

    // WI-2 never got dispatched at all — it stays PENDING, not failed
    // (prerequisiteBlockage treats a merge-conflict outcome the same as an
    // environment failure: dependents don't cascade-fail).
    assert.equal(outcomes.get('WI-2')?.status, 'pending');
    assert.equal(existsSync(wiWorktreePath({
      worktreesRoot: f.worktreesRoot,
      initiativeId: 'INIT-2026-07-11-fanin-conflict',
      workItemId: 'WI-2',
    })), false, 'WI-2 must never get a worktree — it was blocked before dispatch');

    // Both per-WI worktrees that WERE created (WI-1's) are cleaned up even
    // on the failure path.
    for (const p of createdWiPaths) assert.equal(existsSync(p), false, `${p} must be removed after settle`);

    // The cycle worktree itself is left CLEAN — `mergeWiIntoCycle` aborted
    // the failed merge, so nothing is mid-conflict for whatever runs next.
    const status = sh(f.cycleWorktreePath, ['status', '--porcelain']).trim();
    assert.equal(status, '', 'cycle worktree must be clean after an aborted merge');
    assert.throws(() => sh(f.cycleWorktreePath, ['rev-parse', '--verify', 'MERGE_HEAD']));

    // The cycle branch kept its OWN divergent commit (the merge never
    // happened) — WI-1's conflicting content never landed.
    assert.equal(readFileSync(join(f.cycleWorktreePath, 'shared.txt'), 'utf8'), 'cycle change\n');
  } finally {
    f.cleanup();
  }
});

test('fan-in: a plain ralph FAILURE (not a merge conflict) never merges and never pushes — diff stats are still captured against the per-WI worktree before cleanup', async () => {
  const f = setup('INIT-2026-07-11-fanin-ralph-fail');
  try {
    const item = wi('WI-1', []);
    writeWorkItem(item, f.cycleWorktreePath);

    const mergeQueue = createMergeQueue();
    let mergeAttempted = false;
    const workItemsDir = resolve(f.cycleWorktreePath, '.forge', 'work-items');

    const cycleHeadBeforeDispatch = sh(f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim();
    const wiBaseSha = cycleHeadBeforeDispatch;
    const wiWt = createWiWorktree({
      projectRepoPath: f.repo,
      worktreesRoot: f.worktreesRoot,
      initiativeId: 'INIT-2026-07-11-fanin-ralph-fail',
      workItemId: item.work_item_id,
      startPointRef: wiBaseSha,
      cycleWorktreePath: f.cycleWorktreePath,
    });

    let finalStatus: WorkItem['status'] = 'failed';
    let wiDelta: ReturnType<typeof gitNetDelta> = { files: 0, insertions: 0, deletions: 0, commits: 0 };
    try {
      // The agent DOES write real, committable work (mirrors a real WI that
      // makes progress but never satisfies its own quality gate) — proving
      // the diff stats below reflect actual work, not just zeros because
      // nothing happened.
      const result = await runRalph(
        {
          workItemSpecPath: resolve(wiWt.path, '.forge', 'work-items', `${item.work_item_id}.md`),
          worktreePath: wiWt.path,
          initiativeBudget: { iterations: 1, usd: Number.POSITIVE_INFINITY },
          brainQueryResults: '',
          cycleId: f.logger.cycleId,
          initiativeId: 'INIT-2026-07-11-fanin-ralph-fail',
          // The gate never passes — the loop exhausts its budget and
          // reports failed, exactly like a WI that never gets there.
          qualityGate: () => false,
          failOnHollowIter0Gate: false,
        },
        fileWritingAgent('wi1.txt', 'wi-1 content\n'),
      );
      // Phase 4 step 5: a ralph FAILURE never even attempts a merge —
      // mirrors developer-loop.ts's `if (ralphStatus === 'complete') { … }`
      // guard around the merge-queue enqueue. (Compare against a `const`
      // rather than inline `result.status` so TS's assertion-narrowing from
      // the `assert.equal` below doesn't collapse this into dead code —
      // this branch mirrors LIVE production logic, evaluated first.)
      const ralphStatus = result.status;
      if (ralphStatus === 'complete') {
        mergeAttempted = true;
        await mergeQueue.enqueue(() =>
          mergeWiIntoCycle({ cycleWorktreePath: f.cycleWorktreePath, wiBranch: wiWt.branch, workItemId: item.work_item_id }),
        );
        finalStatus = 'complete';
      } else {
        finalStatus = 'failed';
      }
      assert.equal(ralphStatus, 'failed', 'a gate that never passes must fail the ralph run');

      // Read BEFORE cleanup, against the per-WI worktree — exactly the
      // ordering `developer-loop.ts` uses (`gitNetDelta` runs before the
      // `finally` that removes the worktree).
      wiDelta = gitNetDelta(wiWt.path, wiBaseSha);
    } finally {
      removeWiWorktree({ projectRepoPath: f.repo, path: wiWt.path, branch: wiWt.branch, deleteBranch: true });
    }

    writeWorkItemStatus(resolve(workItemsDir, `${item.work_item_id}.md`), finalStatus);
    const outcomes = new Map<string, WiOutcome>();
    settleWiOutcome(outcomes, { id: item.work_item_id, status: finalStatus, result: null });
    assert.equal(outcomes.get('WI-1')?.status, 'failed');

    // Nothing merged: no attempt was even made, and the cycle branch never
    // moved past its own dispatch-time tip.
    assert.equal(mergeAttempted, false, 'a ralph failure must never attempt a merge');
    assert.equal(sh(f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim(), cycleHeadBeforeDispatch, 'the cycle branch must not move on a ralph failure');

    // Nothing pushed: the cycle worktree carries no new commit to publish
    // (asserted above), so there is nothing for `pushInitiativeBranch` to
    // find — this is the same guard `developer-loop.ts` uses
    // (`if (finalStatus === 'complete')`) to skip the push entirely.
    assert.equal(finalStatus, 'failed');

    // The dev-loop.discarded path's diff stats ARE populated — the agent's
    // work (plus the runner's own loop-scratch files, autocommitted
    // alongside it) is real, it was just never merged or pushed anywhere.
    assert.ok(wiDelta.files >= 1, 'the discarded WI still carries its own diff stats');
    assert.ok(wiDelta.insertions >= 1);
    assert.ok(wiDelta.commits >= 1);

    // Per-WI worktree cleanup ran even though nothing merged.
    assert.equal(existsSync(wiWt.path), false, 'the per-WI worktree must be removed after a ralph failure too');
  } finally {
    f.cleanup();
  }
});
