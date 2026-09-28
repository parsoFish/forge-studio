/**
 * Row 167 (bead forge-8vfn.8.1.61, T1 ruling 1916) — a resume that RE-ENTERS
 * the develop flow (`resumeFrom: 'integrate'` ADR 019, `'pr-open'` row 122,
 * `'develop'` ADR 040 fix loop) must rebase the preserved worktree onto
 * current main ONCE, at re-entry, before the first node runs.
 *
 * Before this row's fix the rebase lived inside `execPm`
 * (packages/stations/phases/executor-table.ts), a node that never appears on
 * the shipped `forge-develop` flow — PM lives only in `forge-architect`, whose
 * one resume point is `'plan'`. So none of these three resume points ever
 * rebased: a cycle re-entered the develop flow on the main the HALTED attempt
 * was based on, and a conflict with whatever merged in the meantime surfaced
 * only later, in the PR's own CI or at the merge slot.
 *
 * RED at base: `runFlow` (../../flow-runner.ts) never calls `rebaseForResume`
 * at re-entry — every assertion below that the worktree branch picked up
 * main's new commit (or was refused as a classified failure) fails, because
 * the flow runner executes the fixture's one node straight off the stale
 * branch.
 *
 * `rebaseForResume` arrives on `runFlow` as an injected `FlowRunArgs` field
 * (never a direct import — a mock-injecting caller, e.g.
 * `apps/forge/tests/unit/flow-runner.test.ts`, must see the runner call ITS
 * mock), so every call below passes the real one explicitly, through the
 * same seam production (`cycle.ts`) binds it through.
 *
 * Real temp git repos, no mocked git — the same fixture shape as
 * `resume-rebase.test.ts` (the raw `rebasePreservedBranchOntoMain` unit tests)
 * and `stations/tests/regression/pr-open-resume-skips-bands.test.ts` (the
 * per-node resume-skip integration tests).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { PhaseExecutor } from '@forge/kernel';
import { classifyCycleFailure } from '@forge/agents';
import type { FlowDefinition } from '@forge/contracts';

import { runFlow } from '../../flow-runner.ts';
import type { NodeExecContext } from '../../flow-node-context.ts';
import type { CycleInput } from '../../cycle-context.ts';
import { parseManifest, serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import { rebaseForResume } from '../../cycle-helpers.ts';

function gitRepo(): { dir: string; git: (args: string[]) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-reentry-rebase-repo-'));
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' }).toString();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', 'init/x']);
  writeFileSync(join(dir, 'b.txt'), 'wi work\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'wi']);
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function fixtureFlow(): FlowDefinition {
  return {
    id: 'test-reentry-flow',
    name: 'Test Re-entry Flow',
    version: 1,
    goal: 'a single-node fixture flow — the fixture never runs a real phase',
    project: null,
    kb: null,
    costCeilingUsd: 0,
    origin: 'seed',
    accepts: ['code'],
    nodes: [{ id: 'only-node' }],
    edges: [],
    triggers: [],
    path: '',
  };
}

function fixtureManifest(resumeFrom: InitiativeManifest['resume_from']): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-09-28-reentry-rebase',
    class: 'code',
    acceptance_criteria: [],
    project: 'fixture-project',
    project_repo_path: '/tmp/fixture-project',
    created_at: '2026-09-28T00:00:00Z',
    iteration_budget: 5,
    cost_budget_usd: 1,
    phase: 'pending',
    origin: 'architect',
    body: '# fixture',
    ...(resumeFrom ? { resume_from: resumeFrom } : {}),
  };
}

function neverCall(name: string): () => never {
  return () => { throw new Error(`UNEXPECTED CALL: ${name} must not run — the re-entry rebase owns this seam`); };
}

function readEvents(logFilePath: string): EventLogEntry[] {
  return readFileSync(logFilePath, 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
}

for (const resumeFrom of ['integrate', 'pr-open', 'develop'] as const) {
  test(`runFlow: resumeFrom:'${resumeFrom}' rebases the worktree onto main at re-entry, before the first node runs`, async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'forge-reentry-rebase-run-'));
    const repo = gitRepo();
    try {
      // Main moved after the halt: a new commit on main touching an unrelated file.
      repo.git(['checkout', '-q', 'main']);
      writeFileSync(join(repo.dir, 'c.txt'), 'other cycle merged while this one stalled\n');
      repo.git(['add', '-A']);
      repo.git(['commit', '-q', '-m', 'other cycle merged']);
      repo.git(['checkout', '-q', 'init/x']);

      assert.throws(
        () => repo.git(['merge-base', '--is-ancestor', 'main', 'HEAD']),
        'precondition: main is NOT yet an ancestor of the initiative branch',
      );

      const manifestPath = join(tmp, 'manifest.md');
      writeFileSync(manifestPath, serializeManifest(fixtureManifest(resumeFrom)));
      const logger = createLogger('cyc-reentry-rebase', join(tmp, '_logs'));
      const executedNodes: string[] = [];
      const executor: PhaseExecutor<NodeExecContext> = {
        run: async (nodeId) => {
          executedNodes.push(nodeId);
          // Proves the ORDER, not just that both things happened: the node
          // only sees a worktree where main is already an ancestor.
          assert.doesNotThrow(
            () => repo.git(['merge-base', '--is-ancestor', 'main', 'HEAD']),
            'the rebase must have already happened by the time the first node runs',
          );
          return 'ready-for-review';
        },
      };
      const input: CycleInput = {
        initiativeId: 'INIT-2026-09-28-reentry-rebase',
        manifestPath,
        projectRepoPath: repo.dir,
        worktreePath: repo.dir,
        cycleId: 'cyc-reentry-rebase',
        resumeFrom,
      };

      await runFlow({
        flow: fixtureFlow(),
        input,
        logger,
        executor,
        projectGate: { runPreflight: neverCall('runPreflight') },
        runClosure: neverCall('runClosure'),
        rebaseForResume,
      });

      assert.doesNotThrow(
        () => repo.git(['merge-base', '--is-ancestor', 'main', 'HEAD']),
        `runFlow must rebase the worktree onto main for resumeFrom:'${resumeFrom}'`,
      );
      assert.deepEqual(executedNodes, ['only-node'], 'the single node still runs after a clean rebase');
    } finally {
      repo.cleanup();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('runFlow CONTROL: a fresh (non-resume) run does not rebase — the worktree stays on the OLD main', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-reentry-rebase-control-'));
  const repo = gitRepo();
  try {
    repo.git(['checkout', '-q', 'main']);
    writeFileSync(join(repo.dir, 'c.txt'), 'other cycle merged while this one stalled\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-q', '-m', 'other cycle merged']);
    repo.git(['checkout', '-q', 'init/x']);

    const manifestPath = join(tmp, 'manifest.md');
    writeFileSync(manifestPath, serializeManifest(fixtureManifest(undefined)));
    const logger = createLogger('cyc-reentry-rebase-control', join(tmp, '_logs'));
    const executedNodes: string[] = [];
    const executor: PhaseExecutor<NodeExecContext> = {
      run: async (nodeId) => { executedNodes.push(nodeId); return 'ready-for-review'; },
    };
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-28-reentry-rebase',
      manifestPath,
      projectRepoPath: repo.dir,
      worktreePath: repo.dir,
      cycleId: 'cyc-reentry-rebase-control',
      // resumeFrom deliberately omitted — a fresh, non-resume run.
    };

    await runFlow({
      flow: fixtureFlow(),
      input,
      logger,
      executor,
      projectGate: { runPreflight: neverCall('runPreflight') },
      runClosure: neverCall('runClosure'),
      rebaseForResume,
    });

    assert.throws(
      () => repo.git(['merge-base', '--is-ancestor', 'main', 'HEAD']),
      'a fresh (non-resume) run must NOT rebase — main must still not be an ancestor',
    );
    assert.deepEqual(executedNodes, ['only-node']);
  } finally {
    repo.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runFlow: a CONFLICTING main fails the re-entry rebase as a classified TERMINAL failure — no node executes, resume_from stays on the manifest', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-reentry-rebase-conflict-'));
  const repo = gitRepo();
  try {
    // The initiative branch's own first commit edited a.txt...
    writeFileSync(join(repo.dir, 'a.txt'), 'branch change\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-q', '-m', 'wi edits a.txt']);
    // ...and so did main, while the cycle stalled.
    repo.git(['checkout', '-q', 'main']);
    writeFileSync(join(repo.dir, 'a.txt'), 'main change\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-q', '-m', 'main edits a.txt']);
    repo.git(['checkout', '-q', 'init/x']);

    const manifestPath = join(tmp, 'manifest.md');
    writeFileSync(manifestPath, serializeManifest(fixtureManifest('integrate')));
    const logsRoot = join(tmp, '_logs');
    const logger = createLogger('cyc-reentry-rebase-conflict', logsRoot);
    const executedNodes: string[] = [];
    const executor: PhaseExecutor<NodeExecContext> = {
      run: async (nodeId) => { executedNodes.push(nodeId); return 'ready-for-review'; },
    };
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-28-reentry-rebase',
      manifestPath,
      projectRepoPath: repo.dir,
      worktreePath: repo.dir,
      cycleId: 'cyc-reentry-rebase-conflict',
      resumeFrom: 'integrate',
    };

    await assert.rejects(
      () => runFlow({
        flow: fixtureFlow(),
        input,
        logger,
        executor,
        projectGate: { runPreflight: neverCall('runPreflight') },
        runClosure: neverCall('runClosure'),
        rebaseForResume,
      }),
      /resume-needs-rebase/,
    );

    assert.deepEqual(executedNodes, [], 'no node may execute when the re-entry rebase fails');

    const events = readEvents(logger.logFilePath);
    const cls = classifyCycleFailure(events);
    assert.equal(cls.kind, 'terminal', 'a conflicting rebase is a TERMINAL classified failure, never auto-retried');
    assert.match(cls.reason, /conflict/i, 'the classifier must name the conflict, not a generic/unclassified reason');

    const manifestAfter = parseManifest(readFileSync(manifestPath, 'utf8'));
    assert.equal(
      manifestAfter.resume_from,
      'integrate',
      "the manifest's own resume_from must be untouched by the failed rebase — a later requeue resumes at the same point",
    );
  } finally {
    repo.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});
