/**
 * Wave 2 conformance item — "gate-failure re-injection" (REFINEMENT-PLAN.md
 * §7). Proves, end-to-end against a REAL per-WI worktree (Phase 4 fan-out)
 * and the REAL `runRalph` loop, that when a WI's quality gate fails at
 * iteration 0 the exact failure detail lands where the NEXT ralph iteration's
 * agent invocation actually reads it — and that once the gate passes, no
 * stale failure text survives for a later iteration (or the unifier) to
 * misread as live signal (brain/cycles/themes/2026-07-04-stale-last-gate-
 * failure-poisons-unifier.md).
 *
 * Exercises the PRODUCTION `writeGateFeedback` (exported for this test) +
 * `makeQualityGateFromCmd` + `createWiWorktree` + `runRalph`, wired exactly
 * as `orchestrator/phases/developer-loop.ts`'s per-WI dispatch body wires
 * them — the only substitution is a fake `AgentInvocation` standing in for
 * the Claude Agent SDK call (the same seam `loops/ralph/runner.test.ts` and
 * `developer-loop.wi-worktree-fanin.test.ts` use), so the test never spawns
 * a real agent while still proving the orchestrator's own wiring is correct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWiWorktree, removeWiWorktree } from '../wi-worktree.ts';
import { writeGateFeedback } from './developer-loop.ts';
import { makeQualityGateFromCmd, type GateRunInfo } from '../../loops/ralph/stop-conditions.ts';
import { run as runRalph, type AgentInvocation } from '../../loops/ralph/runner.ts';

const DISTINCTIVE_FAILURE = 'DISTINCTIVE_GATE_FAIL_7f3ac2: fixed.marker missing — fix required';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/**
 * A stateful gate command: fails with the distinctive marker text until
 * `fixed.marker` exists in the worktree, then passes. Mirrors a real
 * `quality_gate_cmd` that fails first (iter-0, before any agent work) and
 * passes once the agent's fix lands.
 */
const GATE_CMD = [
  'sh',
  '-c',
  `test -f fixed.marker && echo GATE_OK || { echo "${DISTINCTIVE_FAILURE}" >&2; exit 1; }`,
];

type Fixture = {
  repo: string;
  worktreesRoot: string;
  cleanup: () => void;
};

function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'forge-gate-feedback-loop-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  // Contract C2: `.forge/` is gitignored on every onboarded project. Without
  // this, ralph's autocommit safety net (`git add -A`) would sweep
  // `.forge/last-gate-failure.md` itself into the WI branch's commit.
  writeFileSync(join(repo, '.gitignore'), '.forge/\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'base']);
  const worktreesRoot = join(root, '_worktrees');
  mkdirSync(worktreesRoot, { recursive: true });
  return {
    repo,
    worktreesRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('dev-loop gate-failure re-injection: iter-1 agent sees iter-0 live failure, then the file clears on pass', async () => {
  const f = setup();
  try {
    const initiativeId = 'INIT-2026-07-12-gate-feedback';
    const workItemId = 'WI-1';

    // Real per-WI worktree, created exactly as the Phase 4 dispatcher does
    // (developer-loop.ts: `createWiWorktree({ ..., startPointRef, cycleWorktreePath })`).
    const handle = createWiWorktree({
      projectRepoPath: f.repo,
      worktreesRoot: f.worktreesRoot,
      initiativeId,
      workItemId,
      startPointRef: 'main',
      cycleWorktreePath: f.repo,
    });

    try {
      const specDir = join(handle.path, '.forge', 'work-items');
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, `${workItemId}.md`);
      writeFileSync(specPath, '# WI-1: fix the gate\n\nWrite fixed.marker.\n');

      const failureFilePath = join(handle.path, '.forge', 'last-gate-failure.md');

      // The EXACT production wiring from developer-loop.ts's per-WI dispatch
      // body: makeQualityGateFromCmd's onRun callback feeds writeGateFeedback,
      // both scoped to the per-WI worktree path.
      const qualityGate = (ctx?: { iteration: number }): boolean =>
        makeQualityGateFromCmd(
          handle.path,
          GATE_CMD,
          (info: GateRunInfo) => writeGateFeedback(handle.path, info),
        )(ctx);

      // Captures what the iteration-1 agent invocation actually found on disk
      // in ITS worktree — the same worktree the SDK adapter sets as `cwd`
      // (loops/ralph/claude-agent.ts: `options.cwd = worktreePath`).
      let seenAtIteration1: string | null = null;
      const agent: AgentInvocation = async ({ worktreePath, iteration }) => {
        assert.equal(
          worktreePath,
          handle.path,
          'the agent invocation must receive the SAME per-WI worktree path the gate wrote the failure into',
        );
        if (iteration === 1) {
          const p = join(worktreePath, '.forge', 'last-gate-failure.md');
          seenAtIteration1 = existsSync(p) ? readFileSync(p, 'utf8') : null;
        }
        // The agent's "fix": produce what the gate is waiting for.
        writeFileSync(join(worktreePath, 'fixed.marker'), 'fixed\n');
        return { filesChanged: ['fixed.marker'], costUsd: 0 };
      };

      const result = await runRalph(
        {
          workItemSpecPath: specPath,
          worktreePath: handle.path,
          initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
          brainQueryResults: '',
          cycleId: 'test-cycle',
          initiativeId,
          qualityGate,
          failOnHollowIter0Gate: true,
        },
        agent,
      );

      // The loop must have actually run the agent once (iter-0's gate fails,
      // iter-1 fixes it, and quality-gates-pass then stops the loop).
      assert.equal(result.stop_reason, 'quality-gates-pass');
      assert.equal(result.status, 'complete');
      assert.equal(result.iterations, 1);

      // The core proof: iteration 1's agent invocation — the ONLY place the
      // "next ralph iteration" can read anything — saw the iter-0 failure,
      // and it carries the distinctive live-gate detail verbatim.
      assert.notEqual(seenAtIteration1, null, 'iteration-1 agent found no .forge/last-gate-failure.md at all');
      assert.match(seenAtIteration1!, new RegExp(DISTINCTIVE_FAILURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(seenAtIteration1!, /iteration 0/, 'failure file should be tagged with the iteration it came from');

      // The second half of the loop: once the gate passes, the failure file
      // must be gone — a later iteration (or the unifier, per the 2026-07-04
      // stale-last-gate-failure-poisons-unifier theme) must not read a fossil.
      assert.equal(
        existsSync(failureFilePath),
        false,
        '.forge/last-gate-failure.md must be cleared once the gate passes — a stale copy would poison the next reader',
      );
    } finally {
      removeWiWorktree({
        projectRepoPath: f.repo,
        path: handle.path,
        branch: handle.branch,
        deleteBranch: true,
      });
    }
  } finally {
    f.cleanup();
  }
});

test('dev-loop gate-failure re-injection: a gate that never fails writes no feedback file at all', async () => {
  const f = setup();
  try {
    const initiativeId = 'INIT-2026-07-12-gate-feedback-clean';
    const workItemId = 'WI-2';

    const handle = createWiWorktree({
      projectRepoPath: f.repo,
      worktreesRoot: f.worktreesRoot,
      initiativeId,
      workItemId,
      startPointRef: 'main',
      cycleWorktreePath: f.repo,
    });

    try {
      const specDir = join(handle.path, '.forge', 'work-items');
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, `${workItemId}.md`);
      writeFileSync(specPath, '# WI-2: trivial\n');

      // iter-0 fails (hollow: file not there yet) exactly once, matching the
      // real dev-loop's iter-0-must-fail contract, then passes — but this
      // time assert the happy path never leaves ANY trace once it clears.
      const qualityGate = (ctx?: { iteration: number }): boolean =>
        makeQualityGateFromCmd(
          handle.path,
          GATE_CMD,
          (info: GateRunInfo) => writeGateFeedback(handle.path, info),
        )(ctx);

      const agent: AgentInvocation = async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, 'fixed.marker'), 'fixed\n');
        return { filesChanged: ['fixed.marker'], costUsd: 0 };
      };

      await runRalph(
        {
          workItemSpecPath: specPath,
          worktreePath: handle.path,
          initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY },
          brainQueryResults: '',
          cycleId: 'test-cycle',
          initiativeId,
          qualityGate,
          failOnHollowIter0Gate: true,
        },
        agent,
      );

      assert.equal(
        existsSync(join(handle.path, '.forge', 'last-gate-failure.md')),
        false,
        'no stale last-gate-failure.md should remain once the WI completes cleanly',
      );
    } finally {
      removeWiWorktree({
        projectRepoPath: f.repo,
        path: handle.path,
        branch: handle.branch,
        deleteBranch: true,
      });
    }
  } finally {
    f.cleanup();
  }
});
