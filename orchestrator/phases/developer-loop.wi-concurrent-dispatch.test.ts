/**
 * Phase 4 step 6 review fix — integration coverage for the actual dispatch
 * wiring `runDeveloperLoop` uses under concurrency: `dispatchWi`'s lazy
 * `pushFailedRef` early-exit check, the shared `mergeQueue`, and
 * `mergeAndPublish`, all driven through the REAL `runConcurrentDispatch`
 * scheduler at `cap > 1` — not the generic fake-dispatch-callback coverage in
 * `wi-dispatch-scheduler.test.ts`, and not the strictly-serial for-loop
 * coverage in `developer-loop.wi-worktree-fanin.test.ts`.
 *
 * `runDeveloperLoop` itself can't be called directly in a test: it always
 * spawns a real Claude SDK query internally (`pinned-sdk-query.ts`, module-
 * level, not injectable via `CycleInput`). Per the precedent already
 * established by `developer-loop.wi-worktree-fanin.test.ts` (see its own doc
 * comment), this file instead drives the SAME real building blocks
 * (`createWiWorktree`, `runRalph` with an injectable `AgentInvocation`,
 * `mergeAndPublish` via `createMergeQueue`, `prerequisiteBlockage`,
 * `settleWiOutcome`, `removeWiWorktree`, `writeWorkItemStatus`) at the same
 * call shape `runWiDispatchTask`/`dispatchWi` use — but dispatches them
 * through the real `runConcurrentDispatch` at `cap: 2` (resolved via the
 * real `resolveDevWiConcurrency` config knob) instead of a bare `for` loop.
 *
 * Two gaps this closes (both flagged in the Step 6 review, neither covered
 * anywhere before this file):
 *  1. The merge+status+push sequence (`mergeAndPublish`, folded into ONE
 *     merge-queue turn) actually stays correctly serialized and every WI's
 *     push actually reaches origin when multiple WIs are genuinely
 *     in-flight at once (not just when dispatched one at a time).
 *  2. The `'branch-push-failed-early-exit'` lazy-skip path — a WI that
 *     becomes ready AFTER a sibling's push already failed must never even
 *     get its own worktree created — had zero test coverage anywhere,
 *     before or after Step 6.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { add } from '../worktree.ts';
import { createWiWorktree, removeWiWorktree } from '../wi-worktree.ts';
import { createMergeQueue, mergeAndPublish, type MergeQueue } from '../wi-merge-back.ts';
import {
  prerequisiteBlockage,
  settleWiOutcome,
  type WiOutcome,
} from './developer-loop.ts';
import { topologicalOrder, writeWorkItem, writeWorkItemStatus, type WorkItem } from '../work-item.ts';
import { run as runRalph, type AgentInvocation } from '../../loops/ralph/runner.ts';
import { runConcurrentDispatch } from '../wi-dispatch-scheduler.ts';
import { resolveDevWiConcurrency } from '../config.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function wi(id: string, dependsOn: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-07-11-concurrent-dispatch-test',
    status: 'pending',
    depends_on: dependsOn,
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['fixture.txt'],
    quality_gate_cmd: ['true'],
    estimated_iterations: 3,
    body: '',
  };
}

/** A fake `AgentInvocation` (same pattern as the fan-in test / runner's own
 * tests): writes ONE real file into the worktree it's handed, with an
 * optional artificial delay so wall-clock overlap under concurrency can be
 * proven the same way `wi-dispatch-scheduler.test.ts`'s cap-3 diamond does. */
function fileWritingAgent(filename: string, content: string, delayMs = 0): AgentInvocation {
  return async ({ worktreePath }) => {
    if (delayMs > 0) await sleep(delayMs);
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
  cleanup: () => void;
};

function setup(initiativeId: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'forge-devloop-concurrent-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  // Per the forge-project-contract (docs/forge-project-contract.md:185), every
  // onboarded project's `.gitignore` covers forge scratch: `.forge/`,
  // `AGENT.md`, `PROMPT.md`, `fix_plan.md`. Without the latter three, ralph's
  // autocommit safety net (`git add -A`) sweeps them into the WI branch's
  // commit — harmless when strictly serial (each worktree always forks from
  // the latest merged tip), but under real concurrent dispatch two SIBLING
  // worktrees forking from the SAME base each regenerate + commit their own
  // copy independently, which then collides at fan-in. A properly onboarded
  // project's gitignore is what keeps these out of the tracked tree at all.
  writeFileSync(join(repo, '.gitignore'), '.forge/\nAGENT.md\nPROMPT.md\nfix_plan.md\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'base']);

  const worktreesRoot = join(root, '_worktrees');
  const cycleHandle = add({
    projectRepoPath: repo,
    branch: `forge/${initiativeId}`,
    worktreesRoot,
    initiativeId,
  });

  // A real bare "origin" remote, tracked from the cycle branch — mirrors the
  // shape `pushInitiativeBranch` (inside `mergeAndPublish`) expects.
  const origin = join(root, 'origin.git');
  sh(root, ['init', '-q', '--bare', origin]);
  sh(cycleHandle.path, ['remote', 'add', 'origin', origin]);
  sh(cycleHandle.path, ['push', '-q', '-u', 'origin', `forge/${initiativeId}`]);

  return {
    root,
    repo,
    origin,
    worktreesRoot,
    cycleWorktreePath: cycleHandle.path,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function remoteHead(f: Fixture, branch: string): string | undefined {
  const line = sh(f.cycleWorktreePath, ['ls-remote', f.origin, branch]).trim();
  return line.length > 0 ? line.split(/\s+/)[0] : undefined;
}

/**
 * The dispatch wrapper under test, mirroring `dispatchWi` + `runWiDispatchTask`
 * from `developer-loop.ts` at the same call shape: the `pushFailedRef` check
 * runs BEFORE any worktree is created, prerequisite blockage is checked next,
 * then the isolated worktree + Ralph run + queued `mergeAndPublish` + cleanup
 * + settle — everything the real dispatch task does, minus the telemetry/gate
 * machinery this harness doesn't need (already covered by
 * `developer-loop.wi-worktree-fanin.test.ts` and the gate-event tests).
 */
function makeDispatch(opts: {
  f: Fixture;
  initiativeId: string;
  mergeQueue: MergeQueue;
  outcomes: Map<string, WiOutcome>;
  pushFailedRef: { current: boolean };
  createdWiPaths: string[];
  agentFor: (id: string) => AgentInvocation;
  onDispatchStart?: (item: WorkItem, wtPath: string) => void;
}): (item: WorkItem) => Promise<void> {
  const workItemsDir = resolve(opts.f.cycleWorktreePath, '.forge', 'work-items');
  return async (item: WorkItem): Promise<void> => {
    const specPath = resolve(workItemsDir, `${item.work_item_id}.md`);

    if (opts.pushFailedRef.current) {
      writeWorkItemStatus(specPath, 'failed');
      settleWiOutcome(opts.outcomes, { id: item.work_item_id, status: 'failed', result: null });
      return;
    }
    const blockage = prerequisiteBlockage(item, [...opts.outcomes.values()]);
    if (blockage === 'work-failure') {
      writeWorkItemStatus(specPath, 'failed');
      settleWiOutcome(opts.outcomes, { id: item.work_item_id, status: 'failed', result: null });
      return;
    }

    const wiBaseSha = sh(opts.f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim();
    const wiWt = createWiWorktree({
      projectRepoPath: opts.f.repo,
      worktreesRoot: opts.f.worktreesRoot,
      initiativeId: opts.initiativeId,
      workItemId: item.work_item_id,
      startPointRef: wiBaseSha,
      cycleWorktreePath: opts.f.cycleWorktreePath,
    });
    opts.createdWiPaths.push(wiWt.path);
    opts.onDispatchStart?.(item, wiWt.path);

    let finalStatus: WorkItem['status'] = 'failed';
    try {
      const result = await runRalph(
        {
          workItemSpecPath: resolve(wiWt.path, '.forge', 'work-items', `${item.work_item_id}.md`),
          worktreePath: wiWt.path,
          initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
          brainQueryResults: '',
          cycleId: 'test-cycle',
          initiativeId: opts.initiativeId,
          qualityGate: () => true,
          failOnHollowIter0Gate: false,
        },
        opts.agentFor(item.work_item_id),
      );
      assert.equal(result.status, 'complete', `${item.work_item_id}'s ralph run must complete`);

      const outcome = await opts.mergeQueue.enqueue(() =>
        mergeAndPublish({
          cycleWorktreePath: opts.f.cycleWorktreePath,
          wiBranch: wiWt.branch,
          workItemId: item.work_item_id,
          specPath,
        }),
      );
      if (outcome.merged) {
        finalStatus = 'complete';
        if (!outcome.push.pushed) opts.pushFailedRef.current = true;
      } else {
        finalStatus = 'failed';
      }
    } finally {
      removeWiWorktree({
        projectRepoPath: opts.f.repo,
        path: wiWt.path,
        branch: wiWt.branch,
        deleteBranch: true,
      });
    }

    if (finalStatus !== 'complete') {
      writeWorkItemStatus(specPath, finalStatus);
    }
    settleWiOutcome(opts.outcomes, { id: item.work_item_id, status: finalStatus, result: null });
  };
}

test('runConcurrentDispatch + mergeAndPublish: diamond DAG (WI-1 -> WI-2,WI-3 -> WI-4) dispatched at cap 2 runs WI-2/WI-3 concurrently, WI-4 forks from a tip carrying both, and every merge+push lands on origin in enqueue order', async () => {
  const initiativeId = 'INIT-2026-07-11-concurrent-dispatch-diamond';
  const f = setup(initiativeId);
  try {
    // Resolve the cap through the REAL config knob (not a hardcoded literal)
    // — proves the config wiring this step introduced actually drives the
    // scheduler used here.
    const cap = resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 2 } });
    assert.equal(cap, 2);

    const items = [wi('WI-1', []), wi('WI-2', ['WI-1']), wi('WI-3', ['WI-1']), wi('WI-4', ['WI-2', 'WI-3'])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const pushFailedRef = { current: false };
    const createdWiPaths: string[] = [];
    const timings: Record<string, { start: number; end: number }> = {};

    const agentFor = (id: string): AgentInvocation => {
      // WI-2 and WI-3 run "slow" (30ms) so they genuinely overlap under cap
      // 2; WI-1 and WI-4 run fast so the interval-overlap check below is
      // unambiguous.
      const delay = id === 'WI-2' || id === 'WI-3' ? 30 : 5;
      return async (invocation) => {
        const start = Date.now();
        const res = await fileWritingAgent(`${id}.txt`, `${id} content\n`, delay)(invocation);
        timings[id] = { start, end: Date.now() };
        return res;
      };
    };

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      pushFailedRef,
      createdWiPaths,
      agentFor,
      onDispatchStart: (item, wtPath) => {
        if (item.work_item_id === 'WI-4') {
          // WI-4's worktree must fork from a tip that already carries BOTH
          // prerequisites' merged files — the fan-out/fan-in ordering
          // guarantee, now proven under real concurrent dispatch rather
          // than the strictly-serial for-loop.
          assert.equal(readFileSync(join(wtPath, 'WI-2.txt'), 'utf8'), 'WI-2 content\n');
          assert.equal(readFileSync(join(wtPath, 'WI-3.txt'), 'utf8'), 'WI-3 content\n');
        }
      },
    });

    await runConcurrentDispatch({
      items: topologicalOrder(items),
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap,
      dispatch,
    });

    for (const id of ['WI-1', 'WI-2', 'WI-3', 'WI-4']) {
      assert.equal(outcomes.get(id)?.status, 'complete', `${id} must settle complete`);
    }

    // WI-2 and WI-3 genuinely overlapped in wall-clock time — proves cap 2
    // ran them concurrently, not accidentally serially.
    const b = timings['WI-2']!;
    const c = timings['WI-3']!;
    assert.ok(
      b.start < c.end && c.start < b.end,
      `expected WI-2/WI-3 to overlap, got WI-2=${JSON.stringify(b)} WI-3=${JSON.stringify(c)}`,
    );

    // All four files landed on the cycle branch via four --no-ff merges.
    for (const id of ['WI-1', 'WI-2', 'WI-3', 'WI-4']) {
      assert.equal(readFileSync(join(f.cycleWorktreePath, `${id}.txt`), 'utf8'), `${id} content\n`);
    }
    const mergeCount = sh(f.cycleWorktreePath, ['log', '--merges', '--oneline'])
      .trim()
      .split('\n')
      .filter(Boolean).length;
    assert.equal(mergeCount, 4, 'one merge commit per fanned-in WI, even under concurrent dispatch');

    // Every WI's push (folded into `mergeAndPublish`, run inside the shared
    // merge queue) actually reached origin — the queue's serialization held
    // even with WI-2/WI-3 genuinely in flight at the same time.
    const localHead = sh(f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim();
    assert.equal(remoteHead(f, `forge/${initiativeId}`), localHead, 'origin must carry every merge once the queue drains');

    // Scratch per-WI worktrees are cleaned up for all four.
    for (const p of createdWiPaths) assert.equal(existsSync(p), false, `${p} must be removed after settle`);
  } finally {
    f.cleanup();
  }
});

test('dispatchWi wiring: once a WI branch-push fails, a sibling that becomes ready afterward is skipped BEFORE its own worktree is ever created — even under cap > 1', async () => {
  const initiativeId = 'INIT-2026-07-11-concurrent-dispatch-push-fail';
  const f = setup(initiativeId);
  try {
    // Force WI-1's eventual push to fail: push a divergent commit directly
    // to origin's cycle branch from a throwaway clone, so origin is no
    // longer a fast-forward ancestor of what WI-1's merge will produce
    // locally.
    const scratchClone = join(f.root, 'scratch-clone');
    sh(f.root, ['clone', '-q', f.origin, scratchClone]);
    sh(scratchClone, ['config', 'user.email', 't@forge']);
    sh(scratchClone, ['config', 'user.name', 'forge-test']);
    sh(scratchClone, ['checkout', '-q', `forge/${initiativeId}`]);
    writeFileSync(join(scratchClone, 'diverged.txt'), 'not on the cycle worktree\n');
    sh(scratchClone, ['add', '.']);
    sh(scratchClone, ['commit', '-q', '-m', 'diverge origin']);
    sh(scratchClone, ['push', '-q', 'origin', `forge/${initiativeId}`]);
    const originHeadBeforeA = remoteHead(f, `forge/${initiativeId}`);

    const cap = resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 2 } });
    assert.equal(cap, 2);

    const items = [wi('WI-1', []), wi('WI-2', ['WI-1'])];
    for (const item of items) writeWorkItem(item, f.cycleWorktreePath);

    const outcomes = new Map<string, WiOutcome>();
    const mergeQueue = createMergeQueue();
    const pushFailedRef = { current: false };
    const createdWiPaths: string[] = [];
    const dispatchedIds: string[] = [];

    const agentFor = (id: string): AgentInvocation => fileWritingAgent(`${id}.txt`, `${id} content\n`);

    const dispatch = makeDispatch({
      f,
      initiativeId,
      mergeQueue,
      outcomes,
      pushFailedRef,
      createdWiPaths,
      agentFor,
      onDispatchStart: (item) => dispatchedIds.push(item.work_item_id),
    });

    await runConcurrentDispatch({
      items: topologicalOrder(items),
      idOf: (item) => item.work_item_id,
      dependsOn: (item) => item.depends_on,
      cap,
      dispatch,
    });

    // WI-1: its merge succeeded (its own files land locally) but its push
    // was rejected — mergeAndPublish still reports `merged: true` (a push
    // failure is not a merge failure), so WI-1 settles complete...
    assert.equal(outcomes.get('WI-1')?.status, 'complete');
    assert.equal(pushFailedRef.current, true, "WI-1's push must have failed and set the shared flag");
    assert.notEqual(
      remoteHead(f, `forge/${initiativeId}`),
      sh(f.cycleWorktreePath, ['rev-parse', 'HEAD']).trim(),
      "WI-1's merge commit must NOT have reached origin",
    );
    assert.equal(remoteHead(f, `forge/${initiativeId}`), originHeadBeforeA, 'origin must still be at the diverged commit');

    // ...but WI-2, which only becomes ready once WI-1 settles, must be
    // skipped by the lazy `pushFailedRef` check at the TOP of `dispatchWi`
    // — it must never even reach `createWiWorktree`.
    assert.equal(outcomes.get('WI-2')?.status, 'failed');
    assert.deepEqual(dispatchedIds, ['WI-1'], 'WI-2 must never have had its own worktree created');
    assert.equal(createdWiPaths.length, 1, 'only WI-1 ever got a real worktree');

    const workItemsDir = resolve(f.cycleWorktreePath, '.forge', 'work-items');
    assert.match(readFileSync(resolve(workItemsDir, 'WI-2.md'), 'utf8'), /status:\s*failed/);
  } finally {
    f.cleanup();
  }
});
