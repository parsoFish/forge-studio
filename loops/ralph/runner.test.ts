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
      // re-review #3: the sibling committed THIS WI's declared output, so it is
      // genuinely already-delivered (not a bare "branch has a commit").
      requiredPaths: ['sibling_work.go'],
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

// re-review #3: `already-complete` must require THIS WI's OWN declared outputs,
// not a bare "the branch has a commit" — otherwise a sibling's commit silently
// completes a WI that did no work (hollow pass).
test('re-review #3: gate passes + branch has commits but this WI\'s creates are NOT all present ⇒ NOT already-complete', async () => {
  const dir = setupRepoWithBranchCommit(); // sibling committed sibling_work.go
  let agentRuns = 0;
  try {
    const workItemPath = join(dir, 'WI-3.md');
    writeFileSync(workItemPath, '# WI-3: declares an output the sibling did NOT make\n');
    mkdirSync(join(dir, 'loops', 'ralph'), { recursive: true });
    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-rr3',
      initiativeId: 'INIT-rr3',
      qualityGate: () => true,
      requiredPaths: ['this_wi_output.go'], // NOT present on the branch
      failOnHollowIter0Gate: true,
    };
    const result = await run(input, async () => { agentRuns++; return { filesChanged: [], costUsd: 0 }; });
    assert.notEqual(result.stop_reason, 'already-complete', 'must NOT free-ride on the sibling commit');
    assert.ok(agentRuns >= 1, 'the agent must run its own iteration to attempt this WI\'s AC');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-review #3: a WI with empty creates[] does NOT take the already-complete shortcut', async () => {
  const dir = setupRepoWithBranchCommit();
  let agentRuns = 0;
  try {
    const workItemPath = join(dir, 'WI-noc.md');
    writeFileSync(workItemPath, '# WI: no creates declared\n');
    mkdirSync(join(dir, 'loops', 'ralph'), { recursive: true });
    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-noc',
      initiativeId: 'INIT-noc',
      qualityGate: () => true,
      requiredPaths: [], // empty creates ⇒ must run its own iteration
      failOnHollowIter0Gate: true,
    };
    const result = await run(input, async () => { agentRuns++; return { filesChanged: [], costUsd: 0 }; });
    assert.notEqual(result.stop_reason, 'already-complete', 'empty-creates WI must run its own iteration');
    assert.ok(agentRuns >= 1);
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

// re-review #1: a gate that could not RUN (broken command) stops the loop EARLY
// with `gate-errored` instead of iterating the budget against an unrunnable gate.
test('re-review #1: gate fails + gateErrored() ⇒ gate-errored, status failed, 0 iterations', async () => {
  const dir = setupEmptyBranchRepo();
  let agentRuns = 0;
  try {
    const workItemPath = join(dir, 'WI-broken-gate.md');
    writeFileSync(workItemPath, '# WI: broken gate\n\nThe gate command cannot run.\n');
    mkdirSync(join(dir, 'loops', 'ralph'), { recursive: true });

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-broken-gate',
      initiativeId: 'INIT-bg',
      qualityGate: () => false,          // gate "fails" ...
      gateErrored: () => true,           // ... because it could not RUN
      failOnHollowIter0Gate: true,
    };

    const result = await run(input, async () => { agentRuns++; return { filesChanged: [], costUsd: 0 }; });

    assert.equal(result.stop_reason, 'gate-errored', `expected gate-errored, got ${result.stop_reason}`);
    assert.equal(result.status, 'failed');
    assert.equal(result.iterations, 0, 'must short-circuit before any agent iteration');
    assert.equal(agentRuns, 0, 'the agent must not be invoked against a broken gate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// G4 (plan item 2.2): the caller's fix-loop failure ceiling (the unifier's
// consecutive same-sub-check composed-gate failure cap) stops the loop EARLY
// with `loop-cap-exhausted` instead of burning the remaining iteration budget
// re-invoking the agent against a gate it has repeatedly failed to clear.
test('G4: gate keeps failing + loopCapExhausted() flips true ⇒ loop-cap-exhausted, no further agent runs', async () => {
  const dir = setupEmptyBranchRepo();
  let agentRuns = 0;
  let gateFails = 0;
  try {
    const workItemPath = join(dir, 'WI-loop-cap.md');
    writeFileSync(workItemPath, '# WI: fix-loop cap\n\nThe gate fails the same way every evaluation.\n');
    mkdirSync(join(dir, 'loops', 'ralph'), { recursive: true });

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 10, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-loop-cap',
      initiativeId: 'INIT-lc',
      qualityGate: () => { gateFails++; return false; },
      // The unifier's tracker flips this after N consecutive same-check
      // failures; here: after the 2nd failing evaluation.
      loopCapExhausted: () => gateFails >= 2,
      failOnHollowIter0Gate: false, // mirrors the unifier caller
    };

    const result = await run(input, async () => { agentRuns++; return { filesChanged: [], costUsd: 0 }; });

    assert.equal(result.stop_reason, 'loop-cap-exhausted', `expected loop-cap-exhausted, got ${result.stop_reason}`);
    assert.equal(result.status, 'failed');
    // Trace: iter0 (gate not run at iter 0) → agent#1 → gate fail#1 (cap not
    // hit) → agent#2 → gate fail#2 (cap hit) → STOP before agent#3. The agent
    // never runs again once the predicate is true.
    assert.equal(agentRuns, 2, 'the agent must NOT be re-invoked once the cap is exhausted');
    assert.ok(result.iterations < 10, 'must stop well before the iteration budget');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// G2 rescope (plan item 2.6): hollow-gate detection is a deterministic
// tool-use + diff-presence check — a WI whose gate passes after N agent
// iterations with ZERO branch diff vs base did no durable work; the pass is
// hollow. Replaces the deleted NO_WORK_INDICATORS string heuristics.
// -------------------------------------------------------------------------

/**
 * Like setupEmptyBranchRepo, but with the loop-scratch files gitignored the
 * way the C2 contract requires of every conformant project — so the
 * autocommit safety net never sweeps PROMPT.md/AGENT.md/fix_plan.md into a
 * commit that would mask a zero-work branch.
 */
function setupIgnoredScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-runner-g2-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');
  writeFileSync(join(dir, 'README.md'), '# baseline\n');
  writeFileSync(join(dir, '.gitignore'), 'PROMPT.md\nAGENT.md\nfix_plan.md\nWI-*.md\n');
  git('add', '.');
  git('commit', '-m', 'baseline');
  git('checkout', '-b', 'forge/wi-g2');
  return dir;
}

test('G2: gate passes after ≥1 agent iteration with ZERO branch diff ⇒ hollow-no-work, status failed', async () => {
  const dir = setupIgnoredScratchRepo();
  const swept: number[] = [];
  try {
    const workItemPath = join(dir, 'WI-g2.md');
    writeFileSync(workItemPath, '# WI-g2: agent does nothing durable\n');
    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-g2-hollow',
      initiativeId: 'INIT-g2h',
      // Gate not evaluated at iter-0 (failOnHollowIter0Gate false — mirrors
      // callers whose gate can legitimately pass early); passes at iteration 1.
      qualityGate: () => true,
      failOnHollowIter0Gate: false,
      onAutoCommit: (iteration) => { swept.push(iteration); },
    };
    // The agent runs but produces no worktree change at all.
    const result = await run(input, async () => ({ filesChanged: [], costUsd: 0 }));

    assert.equal(result.stop_reason, 'hollow-no-work', `expected hollow-no-work, got ${result.stop_reason}`);
    assert.equal(result.status, 'failed');
    assert.equal(result.iterations, 1, 'the hollow pass is detected on the first post-iteration gate check');
    assert.equal(result.toolUseTotal, 0, 'zero tool use recorded as evidence');
    assert.deepEqual(swept, [], 'nothing to sweep — scratch files are gitignored');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G2: gate passes after an iteration that produced real committed work ⇒ quality-gates-pass, complete', async () => {
  const dir = setupIgnoredScratchRepo();
  try {
    const workItemPath = join(dir, 'WI-g2-real.md');
    writeFileSync(workItemPath, '# WI-g2-real: agent writes a real file\n');
    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 5, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-g2-real',
      initiativeId: 'INIT-g2r',
      qualityGate: () => true,
      failOnHollowIter0Gate: false,
    };
    const result = await run(input, async () => {
      // Real durable work: a non-ignored file lands in the worktree (the
      // autocommit net commits it before the gate check).
      writeFileSync(join(dir, 'real_work.go'), 'package x\n');
      return { filesChanged: ['real_work.go'], costUsd: 0, toolsUsed: [{ name: 'Write', inputSummary: 'real_work.go' }] };
    });

    assert.equal(result.stop_reason, 'quality-gates-pass', `expected quality-gates-pass, got ${result.stop_reason}`);
    assert.equal(result.status, 'complete');
    assert.equal(result.toolUseTotal, 1, 'tool use tallied across iterations');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// G1 rescope (plan item 2.6): the autocommit safety net STAYS, but when it
// fires the agent's commit-discipline failure must be VISIBLE — the runner
// reports it through onAutoCommit so the caller emits a distinct
// `ralph.uncommitted-work-swept` event instead of silently absorbing it.
// -------------------------------------------------------------------------

test('G1: the autocommit net sweeping uncommitted agent work invokes onAutoCommit with the iteration', async () => {
  const dir = setupIgnoredScratchRepo();
  const swept: number[] = [];
  try {
    const workItemPath = join(dir, 'WI-g1.md');
    writeFileSync(workItemPath, '# WI-g1: agent forgets to commit\n');
    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 2, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-g1',
      initiativeId: 'INIT-g1',
      qualityGate: () => true,
      failOnHollowIter0Gate: false,
      onAutoCommit: (iteration) => { swept.push(iteration); },
    };
    const result = await run(input, async () => {
      writeFileSync(join(dir, 'forgotten.go'), 'package x\n');
      return { filesChanged: ['forgotten.go'], costUsd: 0 };
    });

    assert.deepEqual(swept, [1], 'the sweep must be reported with its iteration');
    // The net still works: the swept work counts as durable branch work.
    assert.equal(result.status, 'complete');
    const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir }).toString('utf8');
    assert.match(log, /forge-autocommit:/, 'the swept commit keeps its distinguishing prefix');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
