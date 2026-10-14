/**
 * Bead forge-mfv5.1.37 (R39) — the DOOR: `runOne` claims a Kickoff-started
 * develop manifest (no `resume_from`), reuses the architect's preserved
 * worktree (the hand-off), and the branch is rebased onto origin's main
 * BEFORE the first node runs — the dependency that merged while the
 * initiative waited at its Kickoff gate is in the base the dev loop sees.
 *
 * Real local bare `origin`, no network, no `gh`. The tracking wiring throws
 * at the first node, so no station ever does real work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { runOne } from '../../scheduler-run-one.ts';
import { getPaths, type QueuePaths } from '../../queue.ts';
import { add as worktreeAdd } from '../../worktree.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import type { SchedulerConfig } from '../../scheduler.ts';
import type { NotifyConfig } from '../../notify.ts';

const sh = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

function commit(cwd: string, file: string, body: string, msg: string): string {
  writeFileSync(join(cwd, file), body);
  sh(cwd, ['add', '--', file]);
  sh(cwd, ['-c', 'user.email=t@forge', '-c', 'user.name=forge-test', 'commit', '-q', '-m', msg]);
  return sh(cwd, ['rev-parse', 'HEAD']);
}

function setupProject(): { root: string; repo: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-runone-start-rebase-'));
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  // The rebase replays commits, so the repo needs a committer identity of its own (CI runners have no global one).
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  commit(repo, 'README.md', 'base\n', 'base');
  sh(root, ['init', '-q', '--bare', '-b', 'main', origin]);
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

function writeManifest(paths: QueuePaths, initiativeId: string, projectRepoPath: string): string {
  const p = join(paths.inFlight, `${initiativeId}.md`);
  writeFileSync(p, `---
initiative_id: ${initiativeId}
project: start-rebase-fixture
project_repo_path: ${projectRepoPath}
created_at: 2026-10-14T00:00:00Z
iteration_budget: 5
cost_budget_usd: 5
class: code
phase: in-flight
flow_id: forge-develop
---

# ${initiativeId}
`);
  return p;
}

function makeCfg(queueRoot: string, worktreesRoot: string, logsRoot: string): Required<Omit<SchedulerConfig, 'notify'>> & { notify: NotifyConfig; logsRoot: string } {
  return {
    queueRoot, worktreesRoot, maxConcurrentInitiatives: 2, heartbeatIntervalMs: 60_000,
    staleHeartbeatMs: 5 * 60_000, pollIntervalMs: 5_000, recoverIntervalMs: 5 * 60_000,
    notify: { desktop: false, webhook_url: null }, logsRoot,
  };
}

type Seen = { node: string; baseHasDependency: boolean; workItemKept: boolean };

/** Records what the FIRST node saw, then fails the cycle — no station does real work. */
function observingWiring(worktreePath: string, dependencySha: string, seen: Seen[]): PhaseWiring {
  const fail = (): never => { throw new Error('unreachable'); };
  return {
    executor: {
      run: async (nodeId: string) => {
        let baseHasDependency = true;
        try { sh(worktreePath, ['merge-base', '--is-ancestor', dependencySha, 'HEAD']); } catch { baseHasDependency = false; }
        seen.push({ node: nodeId, baseHasDependency, workItemKept: existsSync(join(worktreePath, '.forge', 'work-items', 'WI-1.md')) });
        throw new Error(`test-stub-stops-at:${nodeId}`);
      },
    },
    projectGate: { runPreflight: fail } as unknown as PhaseWiring['projectGate'],
    runClosure: async () => fail(),
    runReflector: async () => fail(),
  };
}

test('runOne: a Kickoff Start onto the preserved hand-off branch rebases it onto origin main before the first node', async () => {
  const prev = process.env.FORGE_SKIP_CONTRACT_CHECK;
  process.env.FORGE_SKIP_CONTRACT_CHECK = '1';
  const { root, repo, origin } = setupProject();
  const initiativeId = `INIT-mfv5137-${randomUUID()}`;
  try {
    const queueRoot = join(root, '_queue');
    const worktreesRoot = join(root, '_worktrees');
    const paths = setupQueue(queueRoot);
    const branch = `forge/${initiativeId}`;

    // The architect's hand-off: preserved worktree, PM work items, one built commit.
    const wt = worktreeAdd({ projectRepoPath: repo, branch, worktreesRoot, initiativeId });
    mkdirSync(join(wt.path, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(wt.path, '.forge', 'work-items', 'WI-1.md'), '# WI-1\n');
    commit(wt.path, 'feature.txt', 'wi work\n', 'wi(WI-1): merge');

    // The dependency merges on origin while the initiative waits at Kickoff; local main stays stale.
    const other = join(root, 'other');
    sh(root, ['clone', '-q', origin, other]);
    const dependencySha = commit(other, 'dependency.txt', 'merged\n', 'Merge dependency initiative');
    sh(other, ['push', '-q', 'origin', 'main']);

    const seen: Seen[] = [];
    const manifestPath = writeManifest(paths, initiativeId, repo);
    await runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot, join(root, '_logs')), undefined, observingWiring(wt.path, dependencySha, seen));

    assert.ok(seen.length > 0, 'the run reached the flow (not refused)');
    assert.equal(seen[0].baseHasDependency, true, `the first node (${seen[0].node}) must start on a base containing the dependency's merge`);
    assert.equal(seen[0].workItemKept, true, 'the PM work items survive the rebase');

    // The scheduler's own events and the cycle's events land in different dirs under logsRoot.
    const events = readdirSync(join(root, '_logs'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('events.jsonl'))
      .flatMap((f) => readFileSync(join(root, '_logs', f), 'utf8').trim().split('\n').filter(Boolean))
      .map((l) => JSON.parse(l) as { message?: string; metadata?: Record<string, unknown> });
    const rebase = events.filter((e) => e.message?.startsWith('cycle.resume-'));
    assert.equal(rebase.length, 1, `one entry rebase: ${JSON.stringify(rebase)}`);
    assert.equal(rebase[0].message, 'cycle.resume-rebased');
    assert.equal(rebase[0].metadata?.entry, 'start');
    assert.equal(rebase[0].metadata?.onto_sha, dependencySha);
  } finally {
    if (prev === undefined) delete process.env.FORGE_SKIP_CONTRACT_CHECK;
    else process.env.FORGE_SKIP_CONTRACT_CHECK = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
