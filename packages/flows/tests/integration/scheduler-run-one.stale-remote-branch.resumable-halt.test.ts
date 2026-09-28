/**
 * row 163 (bead forge-8vfn.8.1.50, S10 run 42, T1 ruling 1899) — the stale-
 * remote-branch cleanup (scheduler-run-one.ts's `finally` block) must NOT
 * delete a branch this attempt pushed when the attempt's own failure is a
 * RESUMABLE halt (operator-stop, a cost ceiling, or anything else `forge
 * requeue` would resume). The remote branch is the only backup of the pushed
 * WI work once the worktree is lost — S10 run 42 survived a mid-flight
 * operator stop only because the resumed attempt re-pushed WI-1; deleting the
 * branch of a run that is about to be resumed throws that work away for
 * nothing (the exact regression: a `stale-remote-branch.cleaned-up` fired for
 * the run's OWN branch four seconds after its own operator-stop).
 *
 * Fixtures + injection style mirror scheduler-run-one.stale-remote-branch.test.ts
 * (a real local bare `origin`, no GitHub/`gh`, no network; a tracking/throwing
 * `PhaseWiring`). The three tests here prove the scheduler now keys the
 * decision on RESUMABILITY — via `decideRequeueResume`, the SAME predicate
 * `forge requeue` applies — rather than deleting on every `cycleFailed`:
 *
 *   (a) operator-stop mid-flight (WI-1 pushed, WI-2 never dispatched)  → kept
 *   (b) a cost-ceiling halt (same shape)                               → kept
 *   (c) a genuinely non-resumable failure, even with the SAME committed
 *       WI-1 work + work-item specs on the branch                     → deleted, as today
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { runOne } from '../../scheduler-run-one.ts';
import { getPaths, type QueuePaths } from '../../queue.ts';
import { serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { OperatorStopError } from '../../operator-stop.ts';
import { CostCeilingError } from '../../flow-budgets.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import type { SchedulerConfig } from '../../scheduler.ts';
import type { NotifyConfig } from '../../notify.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real project repo with a real local bare repo wired up as `origin` — the
 *  ONLY remote every test here ever talks to (matches the sibling suite). */
function setupProject(): { root: string; repo: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-runone-resumable-halt-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'base']);

  const origin = join(root, 'origin.git');
  sh(root, ['init', '-q', '--bare', origin]);
  sh(origin, ['config', 'gc.autoDetach', 'false']);
  sh(repo, ['remote', 'add', 'origin', origin]);
  sh(repo, ['push', '-q', 'origin', 'main']);

  return { root, repo, origin };
}

function remoteHeadSha(repo: string, branch: string): string | null {
  const out = sh(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim();
  return out ? out.split(/\s+/, 1)[0] : null;
}

function setupQueue(queueRoot: string): QueuePaths {
  const paths = getPaths(queueRoot);
  const dirs = [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed];
  for (const p of dirs) {
    mkdirSync(p, { recursive: true });
  }
  return paths;
}

function writeManifest(paths: QueuePaths, initiativeId: string, projectRepoPath: string): string {
  const content = `---
initiative_id: ${initiativeId}
project: stale-branch-guard-fixture
project_repo_path: ${projectRepoPath}
created_at: 2026-09-28T00:00:00Z
iteration_budget: 5
cost_budget_usd: 5
class: code
phase: in-flight
flow_id: forge-develop
---

# ${initiativeId}
`;
  const p = join(paths.inFlight, `${initiativeId}.md`);
  writeFileSync(p, content);
  return p;
}

function makeCfg(
  queueRoot: string,
  worktreesRoot: string,
  logsRoot: string,
): Required<Omit<SchedulerConfig, 'notify'>> & { notify: NotifyConfig; logsRoot: string } {
  return {
    queueRoot,
    worktreesRoot,
    maxConcurrentInitiatives: 2,
    heartbeatIntervalMs: 60_000,
    staleHeartbeatMs: 5 * 60_000,
    pollIntervalMs: 5_000,
    recoverIntervalMs: 5 * 60_000,
    notify: { desktop: false, webhook_url: null },
    logsRoot,
  };
}

function wi(id: string, status: WorkItem['status']): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'placeholder',
    status,
    depends_on: [],
    acceptance_criteria: [{ given: 'a fixture', when: 'the WI runs', then: 'the thing exists' }],
    files_in_scope: ['src/x.ts'],
    estimated_iterations: 2,
    body: 'Fixture WI body.',
  };
}

/** A `PhaseWiring` whose 'dev' node mirrors a REAL dev-loop's own per-WI
 *  publish: it writes `.forge/work-items/` specs for a completed WI-1 and a
 *  never-dispatched WI-2, commits + pushes WI-1's work to `branch` on origin,
 *  then throws `buildError()` — the exact shape S10 run 42's own log showed
 *  (WI-1 pushed, WI-2/WI-3 `ralph.skipped`, then the halt). */
function makeWiProgressThenThrowWiring(
  worktreePath: string,
  branch: string,
  buildError: () => Error,
): PhaseWiring {
  return {
    executor: {
      run: async (nodeId: string) => {
        if (nodeId === 'dev') {
          const wiDir = join(worktreePath, '.forge', 'work-items');
          mkdirSync(wiDir, { recursive: true });
          writeFileSync(join(wiDir, 'WI-1.md'), serializeWorkItem(wi('WI-1', 'complete')));
          writeFileSync(join(wiDir, 'WI-2.md'), serializeWorkItem(wi('WI-2', 'pending')));
          writeFileSync(join(worktreePath, 'wi-1-work.txt'), 'WI-1 committed work\n');
          execFileSync('git', ['add', '.'], { cwd: worktreePath, stdio: 'pipe' });
          const commitArgs = [
            '-c', 'user.email=t@forge',
            '-c', 'user.name=forge-test',
            'commit', '-q', '-m', 'feat: WI-1 work',
          ];
          execFileSync('git', commitArgs, { cwd: worktreePath, stdio: 'pipe' });
          const pushArgs = ['push', '--set-upstream', 'origin', branch];
          execFileSync('git', pushArgs, { cwd: worktreePath, stdio: 'pipe' });
        }
        throw buildError();
      },
    },
    projectGate: {
      runPreflight: () => { throw new Error('unreachable'); },
    } as unknown as PhaseWiring['projectGate'],
    runClosure: async () => { throw new Error('unreachable'); },
    runReflector: async () => { throw new Error('unreachable'); },
  };
}

function withSkipContractCheck<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.FORGE_SKIP_CONTRACT_CHECK;
  process.env.FORGE_SKIP_CONTRACT_CHECK = '1';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.FORGE_SKIP_CONTRACT_CHECK;
    else process.env.FORGE_SKIP_CONTRACT_CHECK = prev;
  });
}

// ---------------------------------------------------------------------------
// (a) operator-stop mid-flight → the branch this attempt pushed survives.
// ---------------------------------------------------------------------------

test(
  'runOne (row 163 a): an operator-stop mid-flight keeps the branch this attempt just pushed',
  async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn81850a-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const manifestPath = writeManifest(paths, initiativeId, repo);
      const expectedWtPath = join(worktreesRoot, initiativeId);
      const wiring = makeWiProgressThenThrowWiring(expectedWtPath, branch, () => new OperatorStopError());

      assert.equal(remoteHeadSha(repo, branch), null, 'precondition: nothing pushed yet');

      const cfg = makeCfg(queueRoot, worktreesRoot, join(root, '_logs'));
      await runOne(manifestPath, `${initiativeId}.md`, cfg, undefined, wiring);

      const failedManifest = join(paths.failed, `${initiativeId}.md`);
      assert.ok(existsSync(failedManifest), 'manifest must land in failed/ (recoverable: false)');
      assert.notEqual(
        remoteHeadSha(repo, branch),
        null,
        'an operator-stop is a RESUMABLE halt — the branch it pushed must survive',
      );

      const logPath = join(root, '_logs', initiativeId, 'events.jsonl');
      const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const cleanedUp = events.some((e) => e.message === 'stale-remote-branch.cleaned-up');
      assert.ok(!cleanedUp, `no cleanup may fire for a resumable halt, got: ${JSON.stringify(events)}`);
      const kept = events.some(
        (e) => e.message === 'stale-remote-branch.kept-resumable' && e.metadata.branch === branch,
      );
      assert.ok(kept, 'expected a stale-remote-branch.kept-resumable event');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (b) a cost-ceiling halt → the same resumable-halt treatment as operator-stop.
// ---------------------------------------------------------------------------

test(
  'runOne (row 163 b): a cost-ceiling halt mid-flight keeps the branch this attempt just pushed',
  async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn81850b-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const manifestPath = writeManifest(paths, initiativeId, repo);
      const expectedWtPath = join(worktreesRoot, initiativeId);
      const wiring = makeWiProgressThenThrowWiring(expectedWtPath, branch, () => new CostCeilingError(5, 5));

      assert.equal(remoteHeadSha(repo, branch), null, 'precondition: nothing pushed yet');

      const cfg = makeCfg(queueRoot, worktreesRoot, join(root, '_logs'));
      await runOne(manifestPath, `${initiativeId}.md`, cfg, undefined, wiring);

      const failedManifest = join(paths.failed, `${initiativeId}.md`);
      assert.ok(existsSync(failedManifest), 'manifest must land in failed/ (recoverable: false)');
      assert.notEqual(
        remoteHeadSha(repo, branch),
        null,
        'a cost-ceiling halt is a RESUMABLE halt — the branch it pushed must survive',
      );

      const logPath = join(root, '_logs', initiativeId, 'events.jsonl');
      const logged = readFileSync(logPath, 'utf8');
      const cleanedUp = logged.includes('stale-remote-branch.cleaned-up');
      assert.ok(!cleanedUp, 'no cleanup may fire for a resumable halt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (c) CONTROL: a genuinely non-resumable failure, with the SAME committed
// WI-1 work + work-item specs, still gets its pushed branch deleted — proves
// the gate is resumability, not merely "did this attempt push committed work".
// ---------------------------------------------------------------------------

test(
  'runOne (row 163 c) CONTROL: a genuinely non-resumable failure still deletes the branch it pushed, ' +
    'even with the same WI progress',
  async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn81850c-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const manifestPath = writeManifest(paths, initiativeId, repo);
      const expectedWtPath = join(worktreesRoot, initiativeId);
      const wiring = makeWiProgressThenThrowWiring(
        expectedWtPath,
        branch,
        () => new Error('unifier did not pass its composed gate — deterministic, not a clean-boundary halt'),
      );

      assert.equal(remoteHeadSha(repo, branch), null, 'precondition: nothing pushed yet');

      const cfg = makeCfg(queueRoot, worktreesRoot, join(root, '_logs'));
      await runOne(manifestPath, `${initiativeId}.md`, cfg, undefined, wiring);

      const failedManifest = join(paths.failed, `${initiativeId}.md`);
      assert.ok(existsSync(failedManifest), 'manifest must land in failed/');
      assert.equal(
        remoteHeadSha(repo, branch),
        null,
        'a genuinely non-resumable failure must still have its pushed branch deleted (unchanged behaviour)',
      );

      const logPath = join(root, '_logs', initiativeId, 'events.jsonl');
      const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const cleanedUp = events.some(
        (e) => e.message === 'stale-remote-branch.cleaned-up' && e.metadata.branch === branch,
      );
      assert.ok(
        cleanedUp,
        `expected a stale-remote-branch.cleaned-up event, got: ${JSON.stringify(events)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
