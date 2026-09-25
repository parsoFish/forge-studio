/**
 * End-to-end `runOne` coverage for the stale-remote-branch guard (bead
 * forge-8vfn.8.1.8) — the fail-fast refusal (half a) and the on-failure
 * remote-branch cleanup (half b), both against a REAL local bare repo used
 * as `origin` (no GitHub, no `gh`, no network).
 *
 * Every test injects a tracking `PhaseWiring` whose members record which
 * port got touched and then throw immediately — cheap, deterministic, and
 * crisp: `calls.length === 0` after `runOne` returns is direct proof that
 * NOTHING in the flow (no station, no agent) ever ran, which is exactly what
 * the fail-fast refusal must guarantee. `calls.length > 0` after a resume run
 * is direct proof the run was NOT refused (it reached real flow machinery).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { runOne } from '../../scheduler-run-one.ts';
import { getPaths, type QueuePaths } from '../../queue.ts';
import { add as worktreeAdd } from '../../worktree.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import type { SchedulerConfig } from '../../scheduler.ts';
import type { NotifyConfig } from '../../notify.ts';
import { FORGE_ROOT } from '@forge/kernel';

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

/** Push `branch` straight to origin and drop the local ref — mirroring an
 *  abandoned prior attempt's own push (the exact defect shape). */
function pushAbandonedBranch(repo: string, branch: string): string {
  sh(repo, ['branch', branch, 'main']);
  sh(repo, ['push', '-q', 'origin', branch]);
  const sha = sh(repo, ['rev-parse', branch]).trim();
  sh(repo, ['branch', '-D', branch]);
  return sha;
}

function remoteHeadSha(repo: string, branch: string): string | null {
  const out = sh(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim();
  return out ? out.split(/\s+/, 1)[0] : null;
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
): Required<Omit<SchedulerConfig, 'notify'>> & { notify: NotifyConfig } {
  return {
    queueRoot,
    worktreesRoot,
    maxConcurrentInitiatives: 2,
    heartbeatIntervalMs: 60_000,
    staleHeartbeatMs: 5 * 60_000,
    pollIntervalMs: 5_000,
    recoverIntervalMs: 5 * 60_000,
    notify: { desktop: false, webhook_url: null },
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

/** A `PhaseWiring` whose 'dev' node performs a REAL push to origin (mirroring
 *  the dev-loop's own per-WI publish) and then fails the cycle — so cleanup
 *  has a real, freshly-pushed branch to react to. */
function makePushThenFailWiring(worktreePath: string, branch: string): PhaseWiring {
  return {
    executor: {
      run: async (nodeId: string) => {
        if (nodeId === 'dev') {
          execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
            cwd: worktreePath,
            stdio: 'pipe',
          });
        }
        throw new Error(`test-stub-fails-after-push:${nodeId}`);
      },
    },
    projectGate: { runPreflight: () => { throw new Error('unreachable'); } } as unknown as PhaseWiring['projectGate'],
    runClosure: async () => { throw new Error('unreachable'); },
    runReflector: async () => { throw new Error('unreachable'); },
  };
}

/** `_logs/` entries for `initiativeId` land either at `_logs/<initiativeId>/`
 *  (the guard's own direct-append event) or `_logs/<timestamp>_<initiativeId>/`
 *  (a real `runCycle` — cycle.ts's `newCycleId`). Both are swept here so a
 *  test that reaches `runCycle` leaves no litter in the real repo tree. */
function cleanupRealLogs(initiativeId: string): void {
  const logsRoot = join(FORGE_ROOT, '_logs');
  if (!existsSync(logsRoot)) return;
  for (const entry of readdirSync(logsRoot)) {
    if (entry === initiativeId || entry.endsWith(`_${initiativeId}`)) {
      rmSync(join(logsRoot, entry), { recursive: true, force: true });
    }
  }
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
// (a) fresh attempt + stale remote branch, no open PR → refused before spend
// ---------------------------------------------------------------------------

test('runOne (a): fresh attempt onto a stale forge/<INIT> branch already on origin, no open PR → refused before any station runs', async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn818a-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const sha = pushAbandonedBranch(repo, branch);
      const manifestPath = writeManifest(paths, initiativeId, repo);
      const { wiring, calls } = makeTrackingWiring();

      await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot), undefined, wiring);

      assert.equal(calls.length, 0, `no station/agent may run before the refusal; saw: ${calls.join(', ')}`);
      assert.ok(existsSync(join(paths.failed, `${initiativeId}.md`)), 'manifest must land in failed/');
      assert.ok(!existsSync(join(paths.inFlight, `${initiativeId}.md`)), 'manifest must leave in-flight/');
      assert.ok(!existsSync(join(worktreesRoot, initiativeId)), 'no local worktree may be created for a refused attempt');

      const logPath = join(FORGE_ROOT, '_logs', initiativeId, 'events.jsonl');
      assert.ok(existsSync(logPath), 'a named refusal event must be logged');
      const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const refusal = events.find((e) => e.message === 'stale-remote-branch.refused');
      assert.ok(refusal, `expected a stale-remote-branch.refused event, got: ${JSON.stringify(events)}`);
      assert.equal(refusal.metadata.branch, branch);
      assert.equal(refusal.metadata.sha, sha);

      // NEVER force-pushed, never deleted — the stale branch is untouched,
      // exactly as an operator would need to find it to resolve by hand.
      assert.equal(remoteHeadSha(repo, branch), sha);
    } finally {
      cleanupRealLogs(initiativeId);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (a') resume path → never refused, even with a stale branch sitting on
// origin — the guard is skipped entirely for a 'reuse' strategy.
// ---------------------------------------------------------------------------

test("runOne (a'): resuming a preserved worktree (resume_from) is never refused, even though a stale forge/<INIT> already sits on origin", async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn818ap-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;

      // The adverse condition the refusal would normally trip on — present
      // here on purpose, to prove the resume path ignores it entirely.
      pushAbandonedBranch(repo, branch);

      // A preserved worktree from an earlier entry of THIS SAME attempt
      // (ADR 019) — decideWorktreeStrategy must read this as 'reuse'.
      worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot, initiativeId });

      const manifestPath = writeManifest(paths, initiativeId, repo, { resumeFrom: 'develop' });
      const { wiring, calls } = makeTrackingWiring();

      await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot), undefined, wiring);

      assert.ok(calls.length > 0, 'the resume run must reach real flow machinery, not be refused');
      // Refuted, not refused: the manifest fails via the GENERIC cycle-error
      // path (the stub throws), never via the stale-remote-branch refusal.
      const logPath = join(FORGE_ROOT, '_logs', initiativeId, 'events.jsonl');
      const refusalLogged = existsSync(logPath)
        ? readFileSync(logPath, 'utf8').includes('stale-remote-branch.refused')
        : false;
      assert.equal(refusalLogged, false, 'a resume run must never emit the stale-remote-branch refusal event');
    } finally {
      cleanupRealLogs(initiativeId);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (b) a cycle that pushes THIS ATTEMPT then fails → the branch it pushed is
// deleted from origin afterward.
// ---------------------------------------------------------------------------

test('runOne (b): a fresh attempt that pushes forge/<INIT> itself, then fails → the branch it pushed is deleted from origin', async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn818b-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const manifestPath = writeManifest(paths, initiativeId, repo);

      const expectedWtPath = join(worktreesRoot, initiativeId);
      const wiring = makePushThenFailWiring(expectedWtPath, branch);

      assert.equal(remoteHeadSha(repo, branch), null, 'precondition: nothing pushed yet');

      await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot), undefined, wiring);

      assert.ok(existsSync(join(paths.failed, `${initiativeId}.md`)), 'manifest must land in failed/');
      assert.equal(
        remoteHeadSha(repo, branch),
        null,
        'the branch THIS attempt pushed must be deleted from origin once the cycle fails',
      );

      const logPath = join(FORGE_ROOT, '_logs', initiativeId, 'events.jsonl');
      const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(
        events.some((e) => e.message === 'stale-remote-branch.cleaned-up' && e.metadata.branch === branch),
        `expected a stale-remote-branch.cleaned-up event, got: ${JSON.stringify(events)}`,
      );
    } finally {
      cleanupRealLogs(initiativeId);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (b') a pre-existing branch this attempt did NOT push is never deleted —
// exercised via the resume path, which never even tracks a branch as "this
// attempt's own fresh push" in the first place.
// ---------------------------------------------------------------------------

test("runOne (b'): resuming a preserved worktree onto a PRE-EXISTING forge/<INIT> — a failure never deletes it (this attempt never pushed it)", async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn818bp-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const sha = pushAbandonedBranch(repo, branch); // pre-existing — NOT pushed by this attempt

      worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot, initiativeId });
      const manifestPath = writeManifest(paths, initiativeId, repo, { resumeFrom: 'develop' });

      // Fails immediately, WITHOUT pushing anything — proves the pre-existing
      // branch survives a failed attempt that never touched it.
      const { wiring } = makeTrackingWiring();

      await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot), undefined, wiring);

      assert.equal(remoteHeadSha(repo, branch), sha, 'a branch this attempt did not push must never be deleted');

      const logPath = join(FORGE_ROOT, '_logs', initiativeId, 'events.jsonl');
      const cleanedUp = existsSync(logPath)
        ? readFileSync(logPath, 'utf8').includes('stale-remote-branch.cleaned-up')
        : false;
      assert.equal(cleanedUp, false, 'no cleanup event may fire for a branch this attempt never pushed');
    } finally {
      cleanupRealLogs(initiativeId);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (c) architect→develop hand-off (row 93(b)): a 'reuse' attempt can be the
// FIRST to push forge/<INIT> — ownership must be recorded on 'reuse' too, not
// only on 'add', or a failed hand-off leaves its own push on origin forever.
// ---------------------------------------------------------------------------

test("runOne (c): hand-off 'reuse' attempt pushes forge/<INIT> itself (absent on origin beforehand), then fails → the branch it pushed is deleted", async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn818c-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;

      // The architect→develop hand-off: a preserved worktree WITH work-items,
      // no resume_from marker — decideWorktreeStrategy must read this as
      // 'reuse' via handoffWorkItemsPresent, exactly like S10's live case.
      const wt = worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot, initiativeId });
      mkdirSync(join(wt.path, '.forge', 'work-items'), { recursive: true });
      writeFileSync(join(wt.path, '.forge', 'work-items', 'WI-1.md'), '# WI-1\n');

      const manifestPath = writeManifest(paths, initiativeId, repo);
      const wiring = makePushThenFailWiring(wt.path, branch);

      assert.equal(remoteHeadSha(repo, branch), null, 'precondition: nothing on origin yet');

      await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot), undefined, wiring);

      assert.ok(existsSync(join(paths.failed, `${initiativeId}.md`)), 'manifest must land in failed/');
      assert.equal(
        remoteHeadSha(repo, branch),
        null,
        'the branch THIS hand-off attempt pushed must be deleted from origin once it fails',
      );

      const logPath = join(FORGE_ROOT, '_logs', initiativeId, 'events.jsonl');
      const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(
        events.some((e) => e.message === 'stale-remote-branch.cleaned-up' && e.metadata.branch === branch),
        `expected a stale-remote-branch.cleaned-up event, got: ${JSON.stringify(events)}`,
      );
    } finally {
      cleanupRealLogs(initiativeId);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// (c') the same hand-off 'reuse' path, but forge/<INIT> already existed on
// origin BEFORE this attempt — never refused (reuse), and never deleted (this
// attempt did not create it, even though it pushes more commits onto it).
// ---------------------------------------------------------------------------

test("runOne (c'): hand-off 'reuse' attempt onto a PRE-EXISTING forge/<INIT> → never refused, never deleted on failure", async () => {
  await withSkipContractCheck(async () => {
    const { root, repo } = setupProject();
    const initiativeId = `INIT-8vfn818cp-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const sha = pushAbandonedBranch(repo, branch); // pre-existing — NOT this attempt's push

      const wt = worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot, initiativeId });
      mkdirSync(join(wt.path, '.forge', 'work-items'), { recursive: true });
      writeFileSync(join(wt.path, '.forge', 'work-items', 'WI-1.md'), '# WI-1\n');

      const manifestPath = writeManifest(paths, initiativeId, repo);
      const wiring = makePushThenFailWiring(wt.path, branch);

      await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot), undefined, wiring);

      assert.equal(remoteHeadSha(repo, branch), sha, 'a branch this attempt did not create must never be deleted');

      const logPath = join(FORGE_ROOT, '_logs', initiativeId, 'events.jsonl');
      const logged = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      assert.ok(!logged.includes('stale-remote-branch.cleaned-up'), 'no cleanup event for a branch this attempt did not create');
      assert.ok(!logged.includes('stale-remote-branch.refused'), 'a reuse attempt must never be refused, even onto an existing branch');
    } finally {
      cleanupRealLogs(initiativeId);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
