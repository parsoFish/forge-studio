/**
 * M7-A — the Ralph runner's dynamic `costCeilingCheck` predicate
 * (`LoopInput.costCeilingCheck`), checked at the SAME point as
 * `gateErrored`/`loopCapExhausted`: after the current iteration's gate
 * result is in, BEFORE the next agent invocation starts.
 *
 * Proves:
 *   AC1 — the loop stops at its NEXT iteration boundary, not mid-iteration
 *         and not only at the end of the WI (no further agent call once the
 *         predicate flips true).
 *   AC2 — the in-flight iteration (already started when the ceiling was
 *         crossed) completes; nothing after it runs, so recorded cost is
 *         bounded by "ceiling + one iteration's cost".
 *   AC3 — the halt is named with the EXISTING `cost-budget` stop_reason
 *         vocabulary (same as `initiativeBudget.usd`'s own static
 *         condition), not a new event kind.
 *   AC6 — a run whose ceiling the check never reports crossed proceeds to
 *         its normal stop condition, completely unaffected.
 *
 * A mutation this file kills: reverting `costCeilingCheck` back to
 * unconsulted (or the predicate ignored) would make the FIRST test run
 * every one of its 10 budgeted iterations and stop on `iteration-budget`
 * instead of `cost-budget` after exactly 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type LoopInput } from '../../ralph/runner.ts';

function setupRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');
  writeFileSync(dir + '/.gitignore', 'PROMPT.md\nAGENT.md\nfix_plan.md\nWI-*.md\n');
  writeFileSync(dir + '/README.md', '# baseline\n');
  git('add', '.');
  git('commit', '-q', '-m', 'baseline');
  return dir;
}

test('M7-A AC1/AC2/AC3: costCeilingCheck flips true mid-loop ⇒ stops at the NEXT iteration boundary with stop_reason cost-budget, exactly one iteration runs', async () => {
  const dir = setupRepo('forge-ralph-cost-ceiling-');
  let agentRuns = 0;
  try {
    const workItemPath = join(dir, 'WI-1.md');
    writeFileSync(workItemPath, '# WI-1: cost-ceiling mid-loop halt\n');
    // Flips true only AFTER the first agent iteration completes — models a
    // SIBLING work item's concurrent spend crossing the shared cycle ceiling
    // while this WI's own iteration was already in flight.
    let ceilingCrossed = false;

    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      // The WI's own static budget is generous — it must NOT be what stops
      // this loop; only the dynamic cross-WI predicate should.
      initiativeBudget: { iterations: 10, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-cc',
      initiativeId: 'INIT-cc',
      qualityGate: () => false, // never completes via the quality gate
      failOnHollowIter0Gate: false,
      costCeilingCheck: () => ceilingCrossed,
    };

    const result = await run(input, async () => {
      agentRuns++;
      ceilingCrossed = true;
      return { filesChanged: [], costUsd: 0.03 };
    });

    assert.equal(result.stop_reason, 'cost-budget', `expected cost-budget, got ${result.stop_reason}`);
    assert.equal(result.status, 'failed', 'a ceiling halt is not a quality pass');
    assert.equal(agentRuns, 1, 'exactly ONE iteration completes; no further agent iteration starts (AC1)');
    assert.equal(result.iterations, 1, 'iteration count matches the single completed turn');
    assert.equal(result.cost_usd, 0.03, 'recorded cost is the ceiling-crossing iteration only — nothing after it (AC2)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-A AC6 regression: costCeilingCheck never reports crossed ⇒ the loop runs to its normal stop condition, unaffected', async () => {
  const dir = setupRepo('forge-ralph-cost-ceiling-ok-');
  let agentRuns = 0;
  try {
    const workItemPath = join(dir, 'WI-2.md');
    writeFileSync(workItemPath, '# WI-2: ceiling comfortably above spend\n');
    const input: LoopInput = {
      workItemSpecPath: workItemPath,
      worktreePath: dir,
      initiativeBudget: { iterations: 3, usd: 10 },
      brainQueryResults: '',
      cycleId: 'cycle-cc-ok',
      initiativeId: 'INIT-cc-ok',
      qualityGate: () => false,
      failOnHollowIter0Gate: false,
      costCeilingCheck: () => false,
    };

    const result = await run(input, async () => {
      agentRuns++;
      return { filesChanged: [], costUsd: 0.01 };
    });

    assert.equal(result.stop_reason, 'iteration-budget', `expected the normal iteration-budget stop, got ${result.stop_reason}`);
    assert.equal(agentRuns, 3, 'every iteration ran — the ceiling check never interfered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
