/**
 * forge-mfv5.1.47 (P0, D-06) — `runOne`'s RESUME door settles the initiative
 * branch before any worktree step: a missing local branch is recreated from
 * origin/<branch> (never from main — the measured "branch: Created from HEAD"),
 * a local branch ahead of origin is refused by name listing the shas, and a
 * preserved worktree on another branch is refused. A REAL local bare repo is
 * `origin`; the tracking wiring throws on first touch, so `calls.length === 0`
 * proves nothing in the flow ran (no agent, no network beyond the bare repo).
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
import { add as worktreeAdd } from '../../worktree.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import type { SchedulerConfig } from '../../scheduler.ts';
import type { NotifyConfig } from '../../notify.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real project repo with a real local bare repo wired up as `origin` — the
 *  ONLY remote every test here ever talks to. */
function setupProject(): { root: string; repo: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-runone-stale-branch-'));
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

function setupQueue(queueRoot: string): QueuePaths {
  const paths = getPaths(queueRoot);
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
    mkdirSync(p, { recursive: true });
  }
  return paths;
}

function writeManifest(
  paths: QueuePaths,
  initiativeId: string,
  projectRepoPath: string,
  opts: { resumeFrom?: 'develop' | 'integrate' } = {},
): string {
  const content = `---
initiative_id: ${initiativeId}
project: stale-branch-guard-fixture
project_repo_path: ${projectRepoPath}
created_at: 2026-09-26T00:00:00Z
iteration_budget: 5
cost_budget_usd: 5
class: code
phase: in-flight
flow_id: forge-develop
${opts.resumeFrom ? `resume_from: ${opts.resumeFrom}\n` : ''}---

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
    // bead forge-8vfn.8.1.10: this attempt's own tmp root — `runOne` must
    // never write into this checkout's real `_logs/` (logs-residue-guard).
    logsRoot,
  };
}

/** A `PhaseWiring` that records which port got touched, then throws — so a
 *  test can assert EITHER "nothing was touched" (refused before any spend)
 *  or "something was touched" (not refused; the flow genuinely ran). */
function makeTrackingWiring(): { wiring: PhaseWiring; calls: string[] } {
  const calls: string[] = [];
  const wiring: PhaseWiring = {
    executor: {
      run: async (nodeId: string) => {
        calls.push(`executor:${nodeId}`);
        throw new Error(`test-stub-reached-executor:${nodeId}`);
      },
    },
    projectGate: {
      runPreflight: () => {
        calls.push('projectGate.runPreflight');
        throw new Error('test-stub-reached-projectGate');
      },
    } as unknown as PhaseWiring['projectGate'],
    runClosure: async () => {
      calls.push('runClosure');
      throw new Error('test-stub-reached-runClosure');
    },
    runReflector: async () => {
      calls.push('runReflector');
      throw new Error('test-stub-reached-runReflector');
    },
  };
  return { wiring, calls };
}

function withSkipContractCheck<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.FORGE_SKIP_CONTRACT_CHECK;
  process.env.FORGE_SKIP_CONTRACT_CHECK = '1';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.FORGE_SKIP_CONTRACT_CHECK;
    else process.env.FORGE_SKIP_CONTRACT_CHECK = prev;
  });
}


/** The branch pushed to origin with one WI commit; main then moves on, so "from main" ≠ "from origin". */
function pushedBranchBehindMovedMain(repo: string, branch: string): { pushed: string; main: string } {
  sh(repo, ['checkout', '-q', '-b', branch]);
  sh(repo, ['commit', '-q', '--allow-empty', '-m', 'wi(WI-1): merge']);
  const pushed = sh(repo, ['rev-parse', 'HEAD']).trim();
  sh(repo, ['push', '-q', 'origin', branch]);
  sh(repo, ['checkout', '-q', 'main']);
  sh(repo, ['commit', '-q', '--allow-empty', '-m', 'main moved on']);
  const main = sh(repo, ['rev-parse', 'HEAD']).trim();
  sh(repo, ['push', '-q', 'origin', 'main']);
  return { pushed, main };
}

function events(root: string, initiativeId: string): Array<{ message: string; metadata?: Record<string, unknown> }> {
  const p = join(root, '_logs', initiativeId, 'events.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

const quiet = async (fn: () => Promise<void>): Promise<void> => {
  const [l, e, w] = [console.log, console.error, console.warn];
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { await fn(); } finally { console.log = l; console.error = e; console.warn = w; }
};

test('runOne resume: the local branch is MISSING and origin has it → recreated from origin/<branch>, never from main, and the run proceeds', async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-2026-10-16-rb-missing-${randomUUID().slice(0, 8)}`;
    try {
      const paths = setupQueue(join(root, '_queue'));
      const branch = `forge/${initiativeId}`;
      const { pushed, main } = pushedBranchBehindMovedMain(repo, branch);
      sh(repo, ['branch', '-D', branch]); // the measured shape: the local branch is gone
      const manifestPath = writeManifest(paths, initiativeId, repo, { resumeFrom: 'develop' });
      const { wiring, calls } = makeTrackingWiring();

      await quiet(() => runOne(manifestPath, `${initiativeId}.md`, makeCfg(join(root, '_queue'), join(root, '_worktrees'), join(root, '_logs')), undefined, wiring));

      const settled = events(root, initiativeId).find((e) => e.message === 'resume-branch.settled');
      assert.equal(settled?.metadata?.action, 'recreate-from-origin');
      const reflog = sh(repo, ['reflog', 'show', '--format=%H %gs', `refs/heads/${branch}`]).trim().split('\n');
      const created = reflog[reflog.length - 1]!;
      assert.ok(created.startsWith(pushed), `the branch was created at origin's tip ${pushed.slice(0, 8)}, not main ${main.slice(0, 8)}: ${created}`);
      assert.ok(!created.includes('Created from HEAD'), 'never "branch: Created from HEAD"');
      assert.ok(!events(root, initiativeId).some((e) => e.message === 'stale-remote-branch.refused'), 'its own pushed branch is not a stale one');
      assert.ok(calls.length > 0, 'the resume proceeded into the flow on the recovered branch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test('runOne resume: a local branch AHEAD of origin is refused by name listing the unpushed shas — failed/, nothing ran, branch + worktree + scratch untouched', async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-2026-10-16-rb-ahead-${randomUUID().slice(0, 8)}`;
    try {
      const paths = setupQueue(join(root, '_queue'));
      const branch = `forge/${initiativeId}`;
      pushedBranchBehindMovedMain(repo, branch);
      const wt = worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot: join(root, '_worktrees'), initiativeId });
      sh(wt.path, ['commit', '-q', '--allow-empty', '-m', 'unpushed WI work']);
      const unpushed = sh(wt.path, ['rev-parse', 'HEAD']).trim();
      mkdirSync(join(wt.path, '.forge', 'work-items'), { recursive: true });
      writeFileSync(join(wt.path, '.forge', 'work-items', 'WI-1.md'), 'scratch\n');
      const manifestPath = writeManifest(paths, initiativeId, repo, { resumeFrom: 'develop' });
      const { wiring, calls } = makeTrackingWiring();

      await quiet(() => runOne(manifestPath, `${initiativeId}.md`, makeCfg(join(root, '_queue'), join(root, '_worktrees'), join(root, '_logs')), undefined, wiring));

      assert.equal(calls.length, 0, 'refused before any flow machinery');
      assert.ok(existsSync(join(paths.failed, `${initiativeId}.md`)), 'parked in failed/');
      const refused = events(root, initiativeId).find((e) => e.message === 'resume-branch.refused');
      assert.ok(refused, 'a named resume-branch.refused event');
      assert.ok(String(refused!.metadata?.reason).includes(unpushed.slice(0, 12)), 'the unpushed sha is named');
      assert.equal(sh(repo, ['rev-parse', branch]).trim(), unpushed, 'never reset');
      assert.ok(existsSync(join(wt.path, '.forge', 'work-items', 'WI-1.md')), 'the scratch survives');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test('runOne resume: a preserved worktree that is not on the initiative branch is refused by name', async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-2026-10-16-rb-offbranch-${randomUUID().slice(0, 8)}`;
    try {
      const paths = setupQueue(join(root, '_queue'));
      const branch = `forge/${initiativeId}`;
      pushedBranchBehindMovedMain(repo, branch);
      const wt = worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot: join(root, '_worktrees'), initiativeId });
      sh(wt.path, ['checkout', '-q', '-b', 'somewhere-else']);
      const manifestPath = writeManifest(paths, initiativeId, repo, { resumeFrom: 'develop' });
      const { wiring, calls } = makeTrackingWiring();

      await quiet(() => runOne(manifestPath, `${initiativeId}.md`, makeCfg(join(root, '_queue'), join(root, '_worktrees'), join(root, '_logs')), undefined, wiring));

      assert.equal(calls.length, 0);
      assert.ok(existsSync(join(paths.failed, `${initiativeId}.md`)));
      const refused = events(root, initiativeId).find((e) => e.message === 'resume-branch.refused');
      assert.match(String(refused?.metadata?.reason), /is on somewhere-else, not forge\//);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
