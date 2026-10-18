/**
 * forge-mfv5.1.60 (D-06) — gitweave I4 round 3 (R73): the operator POSTed the
 * stop flag and SIGKILLed WI-18's dev agent. The dev loop classed the death a
 * transient crash (`dev-loop.agent-crash-retry {attempt 1, crash_reason sigkill}`),
 * re-spawned, and the retry's iteration 0 re-ran the WI's full gate (pytest +
 * live checks) until serve was killed too — no `dev-loop.kept`, nothing recorded.
 *
 * An agent that dies while the initiative's operator-stop flag is set was
 * stopped, not crashed: the WI stops at once (no retry, no further gate run),
 * settles resumable, and its committed iterations are kept. Driven with the
 * REAL runRalph and the real per-WI worktree, through the same
 * `runWithCrashRetry` + `recordWiOutcome` calls `runDeveloperLoop` makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { add, createWiWorktree, parseWorkItem, writeWorkItem, writeWorkItemStatus, type WorkItem } from '@forge/flows';
import { runRalphLoop as runRalph, type AgentInvocation, type LoopResult } from '@forge/agents';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import { SCRATCH_PATHS } from '@forge/projects';
import { recordWiOutcome, runWithCrashRetry } from '../../phases/dev-loop-keep.ts';

const INIT = 'INIT-2026-10-18-stop-kept';
const SIGKILL = 'Claude Code process terminated by signal SIGKILL'; // the I4 runner_error message, verbatim
const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'forge-stop-kept-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  writeFileSync(join(repo, '.gitignore'), SCRATCH_PATHS.join('\n') + '\n');
  sh(repo, ['add', 'README.md', '.gitignore']);
  sh(repo, ['commit', '-q', '-m', 'base']);
  const worktreesRoot = join(root, '_worktrees');
  const cycle = add({ projectRepoPath: repo, branch: `forge/${INIT}`, worktreesRoot, initiativeId: INIT });
  const logger = createLogger(INIT, join(root, '_logs'));
  const events = (): EventLogEntry[] => readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
  const item: WorkItem = {
    work_item_id: 'WI-18', initiative_id: INIT, status: 'pending', depends_on: [], acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['it-1.txt', 'it-2.txt', 'it-3.txt'], quality_gate_cmd: ['true'], estimated_iterations: 5, body: '',
  };
  writeWorkItem(item, cycle.path);
  const base = sh(cycle.path, ['rev-parse', 'HEAD']);
  const wt = createWiWorktree({ projectRepoPath: repo, worktreesRoot, initiativeId: INIT, workItemId: 'WI-18', startPointRef: base, cycleWorktreePath: cycle.path });
  return { root, repo, cycle: cycle.path, logger, events, item, base, wt, specPath: resolve(cycle.path, '.forge', 'work-items', 'WI-18.md') };
}

/** Commits three iterations, then the operator's kill lands on the fourth turn — every later turn dies the same way. */
function killedAgent(onKill: () => void): AgentInvocation {
  return async ({ worktreePath, iteration }) => {
    if (iteration > 3) { onKill(); throw new Error(SIGKILL); }
    writeFileSync(join(worktreePath, `it-${iteration}.txt`), `iteration ${iteration}\n`);
    return { filesChanged: [`it-${iteration}.txt`], costUsd: 0.01 };
  };
}

async function drive(f: ReturnType<typeof setup>, stopFlag: boolean) {
  let gateRuns = 0;
  let gateRunsAtFirstKill = -1;
  let result: LoopResult | null = null;
  const outcome = await runWithCrashRetry({
    logger: f.logger, initiativeId: INIT, parentEventId: 'EV_start', skill: 'developer-ralph', workItemId: 'WI-18', specPath: f.specPath,
    maxRetries: 2, backoffMs: 0, sleep: async () => {},
    operatorStopRequested: () => stopFlag,
    attempt: async () => {
      result = await runRalph({
        workItemSpecPath: resolve(f.wt.path, '.forge', 'work-items', 'WI-18.md'), worktreePath: f.wt.path,
        initiativeBudget: { iterations: 5, usd: Number.POSITIVE_INFINITY }, brainQueryResults: '', cycleId: f.logger.cycleId,
        initiativeId: INIT, qualityGate: () => { gateRuns++; return false; }, failOnHollowIter0Gate: false, filesInScope: f.item.files_in_scope,
      }, killedAgent(() => { if (gateRunsAtFirstKill < 0) gateRunsAtFirstKill = gateRuns; }));
    },
  });
  return { outcome, gateRuns, gateRunsAtFirstKill, result };
}

test('row 2: an agent killed under an active operator stop takes the kept path at once — no crash retry, no further gate run, WI pending + kept_branch, dev-loop.kept', async () => {
  const f = setup();
  try {
    const { outcome, gateRuns, gateRunsAtFirstKill } = await drive(f, true);

    assert.equal(outcome.stoppedByOperator, true);
    assert.deepEqual(outcome.runnerError, { kind: 'agent_threw', message: SIGKILL });
    assert.equal(f.events().some((e) => e.message === 'dev-loop.agent-crash-retry'), false, 'never classed a transient crash');
    assert.ok(gateRunsAtFirstKill > 0);
    assert.equal(gateRuns, gateRunsAtFirstKill, 'not one gate run after the kill — no retry, so no iteration-0 gate re-run');
    const stopped = f.events().filter((e) => e.message === 'dev-loop.agent-stopped');
    assert.equal(stopped.length, 1);
    assert.deepEqual(stopped[0]!.metadata, { work_item_id: 'WI-18', attempt: 1, reason: 'operator-stop', runner_error: { kind: 'agent_threw', message: SIGKILL } });

    // The developer loop's settle for a stopped WI: resumable (pending), then the keep record.
    writeWorkItemStatus(f.specPath, 'pending');
    recordWiOutcome({ logger: f.logger, initiativeId: INIT, parentEventId: 'EV_start', skill: 'developer-ralph', workItemId: 'WI-18', specPath: f.specPath, wiWorktree: f.wt, wiBaseSha: f.base, finalStatus: 'pending' });
    const spec = parseWorkItem(readFileSync(f.specPath, 'utf8'));
    assert.deepEqual([spec.status, spec.kept_branch], ['pending', f.wt.branch]);
    const kept = f.events().filter((e) => e.message === 'dev-loop.kept');
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.metadata?.commits, 3);
    assert.equal(kept[0]!.metadata?.outcome, 'pending');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('row 2 control: the same kill with NO stop flag is a crash and retries as today', async () => {
  const f = setup();
  try {
    const { outcome, gateRuns, gateRunsAtFirstKill } = await drive(f, false);

    assert.equal(outcome.stoppedByOperator, false);
    const retry = f.events().filter((e) => e.message === 'dev-loop.agent-crash-retry');
    assert.deepEqual(retry.map((e) => [e.metadata?.attempt, e.metadata?.max_retries, e.metadata?.crash_class]), [[1, 2, 'transient'], [2, 2, 'transient']], 'a sigkill signature is transient: retried to the cap (the I4 event)');
    assert.ok(gateRuns > gateRunsAtFirstKill, `each retry re-runs the gate (${gateRunsAtFirstKill} → ${gateRuns} runs)`);
    assert.equal(f.events().some((e) => e.message === 'dev-loop.agent-stopped'), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
