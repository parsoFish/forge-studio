/**
 * Smoke test for the Ralph runner skeleton. Proves the wiring works:
 * - templates stamp into a worktree
 * - stop conditions fire (iteration budget) when nothing changes
 * - the runner returns a structured result
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type LoopInput } from './runner.ts';

test('Ralph runner: stamps templates and exits on iteration budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ralph-'));
  try {
    const workItemPath = join(dir, 'WI-1.md');
    writeFileSync(workItemPath, '# WI-1: smoke test\n\nDoes nothing.\n');

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 2, usd: 1 },
      brainQueryResults: '_(no brain context — smoke test)_',
      cycleId: 'cycle-test',
      initiativeId: 'INIT-test',
    };

    const result = await run(input);

    // Templates should have been stamped.
    assert.ok(existsSync(join(dir, 'PROMPT.md')), 'PROMPT.md created');
    assert.ok(existsSync(join(dir, 'AGENT.md')), 'AGENT.md created');
    assert.ok(existsSync(join(dir, 'fix_plan.md')), 'fix_plan.md created');

    // The stub agent makes no progress, so we exit on iteration-budget.
    // (Tier 2 thinning 2026-05-26 removed wedged-detection — iteration
    // budget is now the sole no-progress backstop.)
    assert.equal(result.status, 'failed', `status was ${result.status}`);
    assert.ok(result.iterations >= 1, 'at least one iteration ran');
    assert.equal(result.cost_usd, 0, 'stub agent costs nothing');
    assert.ok(result.duration_ms >= 0, 'duration tracked');

    // Verify PROMPT.md substitution worked.
    const prompt = readFileSync(join(dir, 'PROMPT.md'), 'utf8');
    assert.ok(prompt.includes('WI-1'), 'WI id substituted');
    assert.ok(prompt.includes('INIT-test'), 'initiative id substituted');
    // F-W5-6 (cwd-hallucination): the absolute worktree path must be stated in
    // the prompt so the agent uses relative paths instead of guessing
    // /workspaces//repo/ container prefixes.
    assert.ok(prompt.includes(dir), 'worktree path stated in prompt');
    assert.ok(!prompt.includes('{{WORKTREE_PATH}}'), 'WORKTREE_PATH placeholder substituted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// Wave B (2026-06-04): 3-way iter-0 gate decision
// -------------------------------------------------------------------------

/**
 * Set up a git repo with a main baseline + a feature branch that already
 * has a commit, simulating "a sibling WI delivered this WI's work".
 */
function setupRepoWithBranchCommit(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-runner-git-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');
  writeFileSync(join(dir, 'README.md'), '# baseline\n');
  git('add', 'README.md');
  git('commit', '-m', 'baseline');
  git('checkout', '-b', 'forge/wi-sibling');
  // Simulate a sibling WI's commit: writes a file on this branch.
  writeFileSync(join(dir, 'sibling_work.go'), 'package x\n');
  git('add', 'sibling_work.go');
  git('commit', '-m', 'sibling WI delivered this file');
  return dir;
}

/**
 * Set up a git repo with a main baseline + a feature branch with NO commits
 * (hollow gate: gate passes before any work).
 */
function setupEmptyBranchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-runner-empty-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');
  writeFileSync(join(dir, 'README.md'), '# baseline\n');
  git('add', 'README.md');
  git('commit', '-m', 'baseline');
  git('checkout', '-b', 'forge/wi-empty');
  // Branch is at the same commit as main — no new work.
  return dir;
}

test('Wave B: gate passes + branch has prior commits → already-complete, status complete (NOT failed)', async () => {
  const dir = setupRepoWithBranchCommit();
  try {
    const workItemPath = join(dir, 'WI-2.md');
    writeFileSync(workItemPath, '# WI-2: already delivered by sibling\n\nDoes nothing.\n');

    mkdirSync(join(dir, 'loops', 'ralph'), { recursive: true });

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-wb-test',
      initiativeId: 'INIT-wb',
      // Gate always passes — simulates WI-2's test already passing because
      // WI-1 wrote the required file.
      qualityGate: () => true,
      failOnHollowIter0Gate: true,
    };

    const result = await run(input);

    assert.equal(result.stop_reason, 'already-complete', `expected already-complete, got ${result.stop_reason}`);
    assert.equal(result.status, 'complete', `expected complete, got ${result.status}`);
    assert.equal(result.iterations, 0, 'no agent iterations should have run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Wave B: gate passes + empty branch (no prior commits) → gate-too-loose, status failed', async () => {
  const dir = setupEmptyBranchRepo();
  try {
    const workItemPath = join(dir, 'WI-hollow.md');
    writeFileSync(workItemPath, '# WI-hollow: hollow gate\n\nGate trivially passes.\n');

    mkdirSync(join(dir, 'loops', 'ralph'), { recursive: true });

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-wb-hollow',
      initiativeId: 'INIT-wbh',
      // Gate always passes — but the branch has no commits vs main.
      qualityGate: () => true,
      failOnHollowIter0Gate: true,
    };

    const result = await run(input);

    assert.equal(result.stop_reason, 'gate-too-loose', `expected gate-too-loose, got ${result.stop_reason}`);
    assert.equal(result.status, 'failed', `expected failed, got ${result.status}`);
    assert.equal(result.iterations, 0, 'no agent iterations should have run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
