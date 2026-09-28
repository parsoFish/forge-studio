/**
 * End-to-end coverage for row 133 (bead forge-8vfn.8.1.57):
 * `linkProjectDeps`'s missing-source case used to be a pure `continue` — no
 * event, no warning — so a ground with no `node_modules` sailed through
 * worktree creation and the cycle failed later, confusingly, at the gate. A
 * real control run hit exactly this.
 *
 * Lane D's row 131 (merged #978) already closed the DANGEROUS half of this:
 * `claim-validator.ts`'s `validateClaimable` runs `runPreflight(...,
 * { requireRunnableGate: true })` UNCONDITIONALLY, and that preflight's DEPS
 * clause (`commandNeedsNodeModules`, `packages/projects/preflight-deps.ts`)
 * already refuses the claim, non-terminal, whenever the declared gate NEEDS
 * node_modules and the ground has none — BEFORE `linkProjectDeps` ever runs.
 * `claim-validator.test.ts` covers that predicate and its own wiring
 * directly; test (a) below is a thin confirming regression at the exact
 * `validateClaimable` seam `runOne` itself calls, proving the two modules
 * compose the way the row's investigation found — no second refusal path
 * is added here.
 *
 * What was still missing — and what (b) is red-first for — is the BENIGN
 * case: a gate that does NOT need node_modules reaches `linkProjectDeps`
 * with a ground that has none. That used to vanish. It is now a `log`-level
 * `deps.link-skipped` event, reusing the same `emitOrchestratorEvent` helper
 * as the neighbouring `deps.link-problem` (never a second detector/path).
 *
 * (c) is the pre-existing linked-as-today path, unchanged, as a regression
 * guard against these two new branches breaking it.
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
import type { PhaseWiring } from '../../phase-wiring.ts';
import type { SchedulerConfig } from '../../scheduler.ts';
import type { NotifyConfig } from '../../notify.ts';
import {
  clearAllPendingRefusalLogs,
  validateClaimable,
  type ClaimValidationResult,
} from '../../claim-validator.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real project repo with a real local bare `origin` — mirrors the stale-remote-branch fixture. */
function setupProject(): { root: string; repo: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-runone-deps-'));
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
  const dirs = [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed];
  for (const p of dirs) {
    mkdirSync(p, { recursive: true });
  }
  return paths;
}

function writeManifest(paths: QueuePaths, initiativeId: string, projectRepoPath: string): string {
  const content = `---
initiative_id: ${initiativeId}
project: deps-link-fixture
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

/** Records which port got touched, then throws — proves whether the flow was reached at all. */
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

function readEvents(logsRoot: string, initiativeId: string): Array<Record<string, unknown>> {
  const logPath = join(logsRoot, initiativeId, 'events.jsonl');
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// (a) a node-preloading gate + no node_modules → refused at CLAIM, non-
// terminal, before any station runs — confirming D's row-131 DEPS clause
// already covers this exact case through the SAME `validateClaimable` seam
// `runOne` calls (test-controlled `forgeRoot`/project dir, matching
// claim-validator.test.ts's own fixture style, so nothing writes into this
// checkout's real brain/projects/).
// ---------------------------------------------------------------------------

test(
  'validateClaimable (row 133 confirming): node-preloading gate + no node_modules → refused, non-terminal',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-deps-claim-'));
    try {
      clearAllPendingRefusalLogs();
      const forgeRoot = root;
      const flowDir = join(forgeRoot, 'studio', 'flows', 'test-cycle');
      mkdirSync(flowDir, { recursive: true });
      const flowPath = join(flowDir, 'flow.yaml');
      writeFileSync(
        flowPath,
        `id: test-cycle
name: Test Cycle
version: 1
goal: Take an approved initiative to a merged PR.
project: null
kb: cycles
costCeilingUsd: 25
origin: seed
accepts: [code]
nodes:
  - { id: architect, gate: plan }
  - { id: pm, agent: project-manager }
  - { id: review, gate: verdict }
edges:
  - { from: architect, to: pm, artifact: plan }
  - { from: pm, to: review, artifact: work-items }
triggers: []
`,
      );

      const projectDir = join(root, 'projects', 'gitpulse-like');
      mkdirSync(projectDir, { recursive: true });
      // The exact live shape from preflight-deps.ts's own docstring: `node`
      // preloading a bare specifier resolves it from node_modules.
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ name: 'gitpulse-like', scripts: { test: 'node --import tsx --test' } }),
      );
      writeFileSync(join(projectDir, '.gitignore'), '.forge/\n');
      writeFileSync(join(projectDir, 'roadmap.md'), '# Roadmap\n');
      const centralBrain = join(root, 'brain', 'projects', 'gitpulse-like');
      mkdirSync(centralBrain, { recursive: true });
      writeFileSync(join(centralBrain, 'profile.md'), '# Profile\n');
      // Deliberately no node_modules/ anywhere in projectDir.

      const result = validateClaimable('INIT-deps-claim-a', projectDir, forgeRoot, 'code', flowPath);

      assert.equal(result.ok, false, 'a node-preloading gate with no node_modules must refuse the claim');
      const refused = result as Extract<ClaimValidationResult, { ok: false }>;
      const pendingMsg = 'DEPS is operator-fixable (npm ci) — non-terminal, stays pending';
      assert.equal(refused.terminal, false, pendingMsg);
      assert.match(refused.reason, /not contract-ready/);
      const blocked = refused.blockedClauses ?? '';
      assert.ok(blocked.includes('DEPS'), `expected DEPS among blocked clauses, got: ${blocked}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// (b) red-first for row 133's actual defect: a gate that does NOT need
// node_modules reaches `linkProjectDeps` with none in the ground — claim
// proceeds (never refused), and the no-op is now a named, structured event.
// ---------------------------------------------------------------------------

test(
  'runOne (b): no node_modules needed → claim proceeds, the skip is a structured event',
  async () => {
    await withSkipContractCheck(async () => {
      const { root, repo } = setupProject();
      const initiativeId = `INIT-deps-link-b-${randomUUID()}`;
      try {
        const queueRoot = join(root, '_queue');
        const worktreesRoot = join(root, '_worktrees');
        const logsRoot = join(root, '_logs');
        const paths = setupQueue(queueRoot);
        const manifestPath = writeManifest(paths, initiativeId, repo);
        const { wiring, calls } = makeTrackingWiring();
        const cfg = makeCfg(queueRoot, worktreesRoot, logsRoot);

        // No node_modules/ anywhere in `repo` — the exact silent-skip shape.
        assert.ok(!existsSync(join(repo, 'node_modules')), 'precondition: no node_modules in the ground');

        await runOne(manifestPath, `${initiativeId}.md`, cfg, undefined, wiring);

        const reached = `claim must NOT be refused; the flow must be reached, saw: ${calls.join(', ')}`;
        assert.ok(calls.length > 0, reached);
        const created = 'a worktree IS created — this is not a claim refusal';
        assert.ok(existsSync(join(worktreesRoot, initiativeId)), created);

        const events = readEvents(logsRoot, initiativeId);
        const skip = events.find((e) => e.message === 'deps.link-skipped');
        assert.ok(skip, `expected a deps.link-skipped event, got: ${JSON.stringify(events)}`);
        assert.equal(skip.event_type, 'log', 'a benign no-op is a log event, not an error');
        const metadata = skip.metadata as { skipped: string[]; worktree: string };
        assert.equal(metadata.skipped.length, 1);
        assert.match(metadata.skipped[0], /node_modules/);
        const noProblem = 'a benign skip must never also report a problem';
        assert.ok(!events.some((e) => e.message === 'deps.link-problem'), noProblem);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },
);

// ---------------------------------------------------------------------------
// (c) regression guard: node_modules present in the ground → linked into the
// worktree exactly as before, no skip and no problem event.
// ---------------------------------------------------------------------------

test(
  'runOne (c): node_modules present in the ground → linked as today, no skip/problem event',
  async () => {
    await withSkipContractCheck(async () => {
      const { root, repo } = setupProject();
      const initiativeId = `INIT-deps-link-c-${randomUUID()}`;
      try {
        const queueRoot = join(root, '_queue');
        const worktreesRoot = join(root, '_worktrees');
        const logsRoot = join(root, '_logs');
        const paths = setupQueue(queueRoot);
        const manifestPath = writeManifest(paths, initiativeId, repo);
        const { wiring, calls } = makeTrackingWiring();
        const cfg = makeCfg(queueRoot, worktreesRoot, logsRoot);

        mkdirSync(join(repo, 'node_modules'), { recursive: true });
        writeFileSync(join(repo, 'node_modules', 'marker.txt'), 'dep\n');

        await runOne(manifestPath, `${initiativeId}.md`, cfg, undefined, wiring);

        const reached = `claim must NOT be refused; the flow must be reached, saw: ${calls.join(', ')}`;
        assert.ok(calls.length > 0, reached);
        const linked = join(worktreesRoot, initiativeId, 'node_modules', 'marker.txt');
        assert.ok(existsSync(linked), 'node_modules must be symlinked into the cycle worktree');

        const events = readEvents(logsRoot, initiativeId);
        const noSkip = 'a provisioned ground must never report a skip';
        assert.ok(!events.some((e) => e.message === 'deps.link-skipped'), noSkip);
        const noProblem = 'a provisioned ground must never report a problem';
        assert.ok(!events.some((e) => e.message === 'deps.link-problem'), noProblem);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },
);
