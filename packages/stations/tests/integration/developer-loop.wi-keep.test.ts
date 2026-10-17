/**
 * forge-mfv5.1.56 (D-06) — gitweave I4 round 2: WI-17, the round's only fix
 * WI, failed at its iteration budget; the dev loop deleted its branch and 15
 * commits (`dev-loop.discarded`), and the round went on to demo, review and a
 * verdict on unchanged code ($23.09, nothing kept).
 *
 * Row 1: a WI that ends unmerged keeps its branch and every committed
 * iteration (`dev-loop.kept`, spec `kept_branch`); `dev-loop.discarded` names
 * only the uncommitted residue. Driven with the REAL runRalph at a failing
 * gate (3 committed iterations), the real per-WI worktree, and the same close
 * calls `runDeveloperLoop` makes.
 * Row 2: a fix round whose fix WIs did not all complete halts by name before
 * integrate (`sendback.loop-halted`, thrown), with the checks it reached.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { add, createWiWorktree, parseWorkItem, writeWorkItem, writeWorkItemStatus, type WorkItem } from '@forge/flows';
import { runRalphLoop as runRalph, type AgentInvocation } from '@forge/agents';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import { SCRATCH_PATHS } from '@forge/projects';
import { closeWiWorktree, fixRoundHaltReason, haltFixRound, recordWiOutcome } from '../../phases/dev-loop-keep.ts';
import type { WiOutcome } from '../../phases/developer-loop.ts';

const INIT = 'INIT-2026-10-17-wi-keep';
const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

function wi(id: string, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: id, initiative_id: INIT, status: 'pending', depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }], files_in_scope: ['fixture.txt'],
    quality_gate_cmd: ['true'], estimated_iterations: 3, body: '', ...extra,
  };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'forge-wi-keep-'));
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
  return { root, repo, worktreesRoot, cycle: cycle.path, logger, events };
}

/** One new file per iteration; the runner's autocommit net commits each. */
function iteratingAgent(): AgentInvocation {
  return async ({ worktreePath, iteration }) => {
    writeFileSync(join(worktreePath, `iter-${iteration}.txt`), `iteration ${iteration}\n`);
    return { filesChanged: [`iter-${iteration}.txt`], costUsd: 0.01 };
  };
}

async function failAtBudget(f: ReturnType<typeof setup>, id: string) {
  const item = wi(id, { files_in_scope: ['iter-1.txt', 'iter-2.txt', 'iter-3.txt'] });
  writeWorkItem(item, f.cycle);
  const base = sh(f.cycle, ['rev-parse', 'HEAD']);
  const wt = createWiWorktree({ projectRepoPath: f.repo, worktreesRoot: f.worktreesRoot, initiativeId: INIT, workItemId: id, startPointRef: base, cycleWorktreePath: f.cycle });
  const result = await runRalph({
    workItemSpecPath: resolve(wt.path, '.forge', 'work-items', `${id}.md`), worktreePath: wt.path,
    initiativeBudget: { iterations: 3, usd: Number.POSITIVE_INFINITY }, brainQueryResults: '', cycleId: f.logger.cycleId,
    initiativeId: INIT, qualityGate: () => false, failOnHollowIter0Gate: false, filesInScope: item.files_in_scope,
  }, iteratingAgent());
  const specPath = resolve(f.cycle, '.forge', 'work-items', `${id}.md`);
  writeWorkItemStatus(specPath, 'failed');
  return { wt, base, result, specPath };
}

const ctx = (f: ReturnType<typeof setup>) => ({ logger: f.logger, initiativeId: INIT, parentEventId: 'EV_start', skill: 'developer-ralph' });

test('row 1: a WI that fails at its iteration budget keeps its branch and all 3 committed iterations — failed + kept_branch, dev-loop.kept, no discarded', async () => {
  const f = setup();
  try {
    const { wt, base, result, specPath } = await failAtBudget(f, 'WI-17');
    assert.equal(result.status, 'failed');
    assert.equal(result.stop_reason, 'iteration-budget');
    const tip = sh(wt.path, ['rev-parse', 'HEAD']);
    assert.equal(Number(sh(f.repo, ['rev-list', '--count', `${base}..${wt.branch}`])), 3, 'precondition: 3 committed iterations');

    recordWiOutcome({ ...ctx(f), workItemId: 'WI-17', specPath, wiWorktree: wt, wiBaseSha: base, finalStatus: 'failed' });
    closeWiWorktree({ projectRepoPath: f.repo, wiWorktree: wt, cycleWorktreePath: f.cycle, requeue: false });

    assert.equal(existsSync(wt.path), false, 'the scratch worktree directory still goes');
    assert.equal(sh(f.repo, ['rev-parse', wt.branch]), tip, 'the branch is kept at its tip');
    assert.equal(sh(f.repo, ['rev-list', '--count', `${base}..${wt.branch}`]), '3', 'every committed iteration survives');
    const spec = parseWorkItem(readFileSync(specPath, 'utf8'));
    assert.equal(spec.status, 'failed');
    assert.equal(spec.kept_branch, wt.branch, 'the WI names the branch it resumes from');
    const kept = f.events().filter((e) => e.message === 'dev-loop.kept');
    assert.equal(kept.length, 1);
    assert.deepEqual({ ...kept[0]!.metadata, insertions: undefined, files_changed: undefined },
      { work_item_id: 'WI-17', branch: wt.branch, tip, commits: 3, deletions: 0, outcome: 'failed', resumable: true, insertions: undefined, files_changed: undefined });
    assert.equal(f.events().some((e) => e.message === 'dev-loop.discarded'), false, 'nothing uncommitted, nothing discarded');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('row 1: uncommitted residue is the ONLY thing dev-loop.discarded names', async () => {
  const f = setup();
  try {
    const { wt, base, specPath } = await failAtBudget(f, 'WI-17');
    writeFileSync(join(wt.path, 'half-done.txt'), 'never committed\n');
    recordWiOutcome({ ...ctx(f), workItemId: 'WI-17', specPath, wiWorktree: wt, wiBaseSha: base, finalStatus: 'failed' });
    const discarded = f.events().filter((e) => e.message === 'dev-loop.discarded');
    assert.equal(discarded.length, 1);
    assert.deepEqual(discarded[0]!.metadata?.uncommitted_files, ['half-done.txt']);
    assert.equal(discarded[0]!.metadata?.commits, 0, 'committed work is never reported as discarded');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('row 1 control: a complete (merged) WI is delivered and its branch deleted; a merge-conflict requeue still re-cuts', async () => {
  const f = setup();
  try {
    const { wt, base, specPath } = await failAtBudget(f, 'WI-1');
    sh(f.cycle, ['merge', '-q', '--no-ff', '-m', 'merge WI-1', wt.branch]);
    writeWorkItemStatus(specPath, 'complete');
    recordWiOutcome({ ...ctx(f), workItemId: 'WI-1', specPath, wiWorktree: wt, wiBaseSha: base, finalStatus: 'complete' });
    closeWiWorktree({ projectRepoPath: f.repo, wiWorktree: wt, cycleWorktreePath: f.cycle, requeue: false });
    assert.equal(f.events().filter((e) => e.message === 'dev-loop.delivered').length, 1);
    assert.throws(() => sh(f.repo, ['rev-parse', '--verify', wt.branch]), 'a merged branch is deleted');

    const second = await failAtBudget(f, 'WI-2');
    closeWiWorktree({ projectRepoPath: f.repo, wiWorktree: second.wt, cycleWorktreePath: f.cycle, requeue: true });
    assert.throws(() => sh(f.repo, ['rev-parse', '--verify', second.wt.branch]), 'a requeued attempt re-cuts from the new base');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

function gateEvent(f: ReturnType<typeof setup>, id: string, iteration: number, label: string, passed: boolean): void {
  appendFileSync(f.logger.logFilePath, `${JSON.stringify({ phase: 'developer-loop', message: passed ? 'gate.pass' : 'gate.fail', started_at: new Date().toISOString(), metadata: { work_item_id: id, gate_passed: passed, iteration, acceptance_criterion: label, check_expect: 'pass' } })}\n`);
}
const checked = (id: string, labels: string[]) => wi(id, { origin: 'review-fix', acceptance_criteria: labels.map((l) => ({ given: l, when: 'w', then: 't', check: { argv: ['true'], expect: 'pass' as const } })) });
const outcome = (id: string, status: WorkItem['status'], stop = 'iteration-budget', environment = false): WiOutcome =>
  ({ id, status, result: { stop_reason: stop } as never, ...(environment ? { environment: true } : {}) });

test('row 2: the halt reason names each failed fix WI with the checks its LAST iteration reached', () => {
  const f = setup();
  try {
    gateEvent(f, 'WI-17', 3, 'SB1', true); gateEvent(f, 'WI-17', 3, 'SB2', false);
    gateEvent(f, 'WI-17', 4, 'SB1', true); gateEvent(f, 'WI-17', 4, 'SB2', true); gateEvent(f, 'WI-17', 4, 'SB3', false);
    const items = [wi('WI-1', { status: 'complete' }), checked('WI-17', ['SB1', 'SB2', 'SB3', 'SB4'])];
    const reason = fixRoundHaltReason({ items, roundFixIds: ['WI-17'], outcomes: new Map([['WI-17', outcome('WI-17', 'failed')]]), logFilePath: f.logger.logFilePath })?.reason;
    assert.equal(reason, 'fix work item(s) failed at the iteration budget: WI-17 (2/4 checks passing)');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('row 2: one failed + one complete fix WI still halts; all complete, a non-fix WI failing, or an environment failure does not', () => {
  const f = setup();
  try {
    f.logger.emit({ initiative_id: INIT, phase: 'developer-loop', skill: 'developer-ralph', event_type: 'start', input_refs: [], output_refs: [] }); // the cycle log exists; no gate ran
    const items = [checked('WI-17', ['A']), checked('WI-18', ['B']), wi('WI-1')];
    const run = (o: WiOutcome[], ids = ['WI-17', 'WI-18']) => fixRoundHaltReason({ items, roundFixIds: ids, outcomes: new Map(o.map((x) => [x.id, x])), logFilePath: f.logger.logFilePath })?.reason ?? null;
    assert.equal(run([outcome('WI-17', 'failed'), outcome('WI-18', 'complete')]), 'fix work item(s) failed at the iteration budget: WI-17 (0/1 checks passing)');
    assert.equal(run([outcome('WI-17', 'complete'), outcome('WI-18', 'complete')]), null, 'all complete → integrate as today');
    assert.equal(run([outcome('WI-17', 'complete'), outcome('WI-18', 'complete'), outcome('WI-1', 'failed')]), null, 'only the round\'s own fix WIs count');
    assert.equal(run([outcome('WI-17', 'failed', 'crashed', true), outcome('WI-18', 'complete')]), null, 'an environment failure stays the classifier\'s (auto-retry)');
    assert.equal(run([outcome('WI-17', 'failed', 'crashed'), outcome('WI-18', 'complete')]), 'fix work item(s) failed: WI-17 (crashed; 0/1 checks passing)');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('row 2: haltFixRound records sendback.loop-halted (the #1218 surface) and throws by name', () => {
  const f = setup();
  try {
    const manifestPath = join(f.root, 'm.md');
    writeFileSync(manifestPath, `---\ninitiative_id: ${INIT}\nproject: p\ncreated_at: '2026-10-17T00:00:00Z'\niteration_budget: 5\ncost_budget_usd: 5\nclass: code\nreview_rounds: 2\n---\n`);
    const reason = 'fix work item(s) failed at the iteration budget: WI-17 (2/4 checks passing)';
    assert.throws(
      () => haltFixRound({ ...ctx(f), manifestPath, worktreePath: f.cycle, failedIds: ['WI-17'], reason }),
      (err: Error) => err.message === `developer-loop: ${reason} — the round halts before integrate; Requeue resumes each from its kept branch`,
    );
    const halt = f.events().filter((e) => e.message === 'sendback.loop-halted');
    assert.equal(halt.length, 1);
    assert.equal(halt[0]!.event_type, 'error');
    assert.deepEqual({ ...halt[0]!.metadata, head_sha: undefined }, { round: 2, classification: 'fix-work-items-failed', reason, pending_work_items: ['WI-17'], head_sha: undefined });
    assert.equal(halt[0]!.metadata?.head_sha, sh(f.cycle, ['rev-parse', 'HEAD']));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
