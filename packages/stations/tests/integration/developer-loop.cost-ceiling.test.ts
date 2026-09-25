/**
 * M7-A / AC4 — two work items dispatched CONCURRENTLY must not jointly
 * overshoot the cycle's cost ceiling by more than one iteration EACH. The
 * check has to read the cycle-level spend (the SAME `CostTracker` instance
 * `flow-runner.ts` wires for the whole node), not only a work item's own
 * `state.costUsdSoFar` — otherwise two work items that are each individually
 * "under budget" can jointly blow through a shared ceiling neither of them
 * can see.
 *
 * `runDeveloperLoop` itself can't be called directly in a test (it always
 * spawns a real Claude SDK query internally) — per the precedent already
 * established by `developer-loop.wi-concurrent-dispatch.test.ts` and
 * `developer-loop.wi-worktree-fanin.test.ts`, this file drives the SAME real
 * building blocks (`runRalph`, `resolveWiCostBudgetUsd`,
 * `makeCostCeilingCheck`, `isCostCeilingHalt`, `settleWiOutcome`,
 * `prerequisiteBlockage`) at the same call shape `developer-loop.ts` uses,
 * against a REAL `CostTracker` (`@forge/flows`) — the exact
 * class `flow-runner.ts` wires into `CycleInput.remainingCostBudgetUsd` in
 * production — rather than a second copy of the cost rule.
 *
 * Also proves the resumable-outcome convention (AC3): a cost-ceiling-halted
 * work item settles 'pending' + `environment: true`, so a DEPENDENT is
 * blocked (`prerequisiteBlockage` → 'environment-failure'), never cascaded
 * to a hard 'failed'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EventLogEntry, EventLogger } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import type { WorkItem } from '@forge/flows';
import { CostTracker } from '@forge/flows/testing';
import { runRalphLoop as runRalph, type LoopResult } from '@forge/agents';
import {
  resolveWiCostBudgetUsd,
  makeCostCeilingCheck,
  isCostCeilingHalt,
} from '../../phases/dev-cost-bound.ts';
import { prerequisiteBlockage, settleWiOutcome, type WiOutcome } from '../../phases/developer-loop.ts';

const CEILING_USD = 0.05;
const PER_ITERATION_COST_USD = 0.02;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function setupRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');
  writeFileSync(join(dir, '.gitignore'), 'PROMPT.md\nAGENT.md\nfix_plan.md\nWI-*.md\n');
  writeFileSync(join(dir, 'README.md'), '# baseline\n');
  git('add', '.');
  git('commit', '-q', '-m', 'baseline');
  return dir;
}

/** A bare logger that only stamps ids — used as `CostTracker`'s OWN logger
 * (its warn/stop emits must not feed back into itself). */
function makeRawLogger(): EventLogger {
  let n = 0;
  const logger = {
    cycleId: 'cycle-ac4',
    logFilePath: '/dev/null',
    emit(partial: Omit<EventLogEntry, 'event_id' | 'cycle_id' | 'started_at'> & { event_id?: string; started_at?: string }) {
      return {
        event_id: partial.event_id ?? `e${++n}`,
        cycle_id: 'cycle-ac4',
        started_at: partial.started_at ?? new Date().toISOString(),
        ...partial,
      } as EventLogEntry;
    },
  };
  return logger as unknown as EventLogger;
}

/** The SAME wrapping shape as `flow-runner.ts`'s `wrapLoggerForCost` — every
 * emitted entry also feeds `tracker.noteEvent`. This is what the dev node's
 * `onIteration` callback actually emits through in production. */
function wrapLoggerForCost(base: EventLogger, tracker: CostTracker): EventLogger {
  return {
    ...base,
    emit(partial) {
      const entry = base.emit(partial);
      tracker.noteEvent(entry);
      return entry;
    },
  };
}

function wi(id: string, dependsOn: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-ac4',
    status: 'pending',
    depends_on: dependsOn,
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['fixture.txt'],
    quality_gate_cmd: ['true'],
    estimated_iterations: 20,
    body: '',
  };
}

/** Mirrors developer-loop.ts's own call shape for a single WI's Ralph run:
 * `initiativeBudget.usd` + `costCeilingCheck` both come from `dev-cost-bound.ts`,
 * reading the SAME `CycleInput.remainingCostBudgetUsd` accessor. */
async function dispatchWi(opts: {
  id: string;
  cycleInput: CycleInput;
  logger: EventLogger;
  delayMs: number;
}): Promise<LoopResult> {
  const dir = setupRepo(`forge-devloop-ac4-${opts.id}-`);
  try {
    const workItemPath = join(dir, `${opts.id}.md`);
    writeFileSync(workItemPath, `# ${opts.id}: concurrent cost-ceiling halt\n`);
    return await runRalph(
      {
        workItemSpecPath: workItemPath,
        worktreePath: dir,
        // 20 budgeted iterations — generous enough that ONLY the cost
        // ceiling, never the iteration cap, can be what stops this WI.
        initiativeBudget: { iterations: 20, usd: resolveWiCostBudgetUsd(opts.cycleInput) },
        brainQueryResults: '',
        cycleId: 'cycle-ac4',
        initiativeId: 'INIT-ac4',
        qualityGate: () => false,
        failOnHollowIter0Gate: false,
        costCeilingCheck: makeCostCeilingCheck(opts.cycleInput),
        onIteration: (iteration, info) => {
          opts.logger.emit({
            initiative_id: 'INIT-ac4',
            phase: 'developer-loop',
            skill: 'developer-ralph',
            event_type: 'iteration',
            iteration,
            input_refs: [],
            output_refs: info.filesChanged,
            cost_usd: info.costUsd,
            metadata: { work_item_id: opts.id },
          });
        },
      },
      async () => {
        await sleep(opts.delayMs);
        return { filesChanged: [], costUsd: PER_ITERATION_COST_USD };
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('M7-A AC4: two concurrently-dispatched work items sharing a cycle ceiling each halt at cost-budget, and jointly overshoot by at most one iteration EACH', async () => {
  const tracker = new CostTracker({
    ceilingUsd: CEILING_USD,
    ceilingSource: 'env',
    initiativeId: 'INIT-ac4',
    logger: makeRawLogger(),
  });
  const logger = wrapLoggerForCost(makeRawLogger(), tracker);
  const cycleInput: CycleInput = {
    initiativeId: 'INIT-ac4',
    manifestPath: '/tmp/manifest.md',
    projectRepoPath: '/tmp/repo',
    worktreePath: '/tmp/wt',
    // The SAME live accessor flow-runner.ts wires from its CostTracker.
    remainingCostBudgetUsd: () => tracker.remainingUsd,
  };

  const [r1, r2] = await Promise.all([
    dispatchWi({ id: 'WI-1', cycleInput, logger, delayMs: 5 }),
    dispatchWi({ id: 'WI-2', cycleInput, logger, delayMs: 5 }),
  ]);

  // AC1/AC3, under concurrency: both halted at the cost ceiling, named with
  // the existing stop_reason vocabulary — not a work failure, not silent.
  assert.equal(r1.stop_reason, 'cost-budget', `WI-1 expected cost-budget, got ${r1.stop_reason}`);
  assert.equal(r2.stop_reason, 'cost-budget', `WI-2 expected cost-budget, got ${r2.stop_reason}`);

  // Neither ran anywhere near its 20-iteration budget — the CYCLE ceiling
  // stopped them, not the per-WI iteration cap.
  assert.ok(r1.iterations < 20, `WI-1 ran ${r1.iterations} iterations — the ceiling must have stopped it well short of budget`);
  assert.ok(r2.iterations < 20, `WI-2 ran ${r2.iterations} iterations — the ceiling must have stopped it well short of budget`);

  // AC4's actual claim: reading the CYCLE-level spend bounds the JOINT
  // overshoot to at most one iteration PER work item — not per cycle. Had
  // the check instead read each WI's own `state.costUsdSoFar` against a
  // fixed share (the old shape), nothing would have stopped either WI until
  // it separately spent its own $0.10 (ceiling’s full "share"), and the
  // pair could together reach ~$0.40 (20 iterations × $0.02 × 2) before
  // either noticed — the exact defect measured in production ($12 declared,
  // $84 spent).
  const bound = CEILING_USD + 2 * PER_ITERATION_COST_USD;
  assert.ok(
    tracker.totalSpentUsd <= bound + 1e-9,
    `joint spend $${tracker.totalSpentUsd.toFixed(4)} must not exceed ceiling ($${CEILING_USD}) + one iteration EACH ($${bound.toFixed(2)})`,
  );
  assert.ok(tracker.totalSpentUsd > CEILING_USD, 'sanity: the ceiling was actually crossed, not merely approached');

  // AC3 resumable convention: a cost-ceiling halt settles 'pending' with
  // `environment: true` — the SAME shape developer-loop.ts's WI-boundary
  // cost skip already uses — never a hard 'failed'.
  const outcomes = new Map<string, WiOutcome>();
  for (const [id, result] of [['WI-1', r1], ['WI-2', r2]] as const) {
    assert.ok(isCostCeilingHalt(result), `${id} must be recognised as a cost-ceiling halt`);
    const finalStatus = result.status === 'complete' ? 'complete' : (isCostCeilingHalt(result) ? 'pending' : 'failed');
    assert.equal(finalStatus, 'pending', `${id} must settle 'pending' (resumable), not 'failed'`);
    settleWiOutcome(outcomes, { id, status: finalStatus, result, environment: true });
  }

  // A DEPENDENT of a ceiling-halted prerequisite is blocked, not cascaded to
  // a hard failure — exercised through the real `prerequisiteBlockage`.
  const dependent = wi('WI-3', ['WI-1']);
  const blockage = prerequisiteBlockage(dependent, [...outcomes.values()]);
  assert.equal(blockage, 'environment-failure', 'a dependent of a cost-ceiling-halted WI must be blocked, not failed');
});
