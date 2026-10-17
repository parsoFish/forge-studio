/**
 * forge-mfv5.1.56 (D-06) — a work item's committed work is never discarded by
 * the per-WI branch lifecycle. Gitweave I4 round 2: WI-17 failed at its
 * 15-iteration budget, and its 15 commits were deleted with its branch; the
 * round then reviewed the unchanged code. Three deletion paths existed —
 * the dev loop's per-WI `finally`, `createWiWorktree`'s collision self-heal,
 * and `pruneStaleWiWorktrees` — this file holds the two in `wi-worktree.ts`
 * plus the Requeue that resumes a halted round from the kept branch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWiWorktree, pruneStaleWiWorktrees, removeWiWorktree, unmergedCommitCount, wiBranchName } from '../../wi-worktree.ts';
import { parseWorkItem, serializeWorkItem } from '../../work-item.ts';
import { runRequeue } from '../../forge-requeue.ts';
import { parseManifest } from '../../manifest.ts';
import { FIX_BRANCH, FIX_INIT, plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';
import { drainPendingFixWorkItems } from '../../drain-fix-loop.ts';
import { aggregateRun } from '../../run-model.ts';
import { findDelivered, findLatestWiVerdict } from '../../run-model-derive-cost.ts';
import type { EventLogEntry } from '@forge/kernel';
import { UNREACHED_PHASE_WIRING } from '../test-fixtures/phase-wiring.ts';

const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

function repoWithCycle(initiativeId: string): { dir: string; repo: string; worktreesRoot: string; cycle: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-keep-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'init']);
  git(repo, ['branch', `forge/${initiativeId}`]);
  const cycle = join(dir, 'cycle-wt');
  mkdirSync(join(cycle, '.forge', 'work-items'), { recursive: true });
  writeFileSync(join(cycle, '.forge', 'work-items', 'WI-1.md'), 'spec\n');
  return { dir, repo, worktreesRoot: join(dir, '_wt'), cycle };
}

/** A WI branch carrying `n` commits of its own — the shape a budget-failed WI leaves behind. */
function commitIterations(path: string, n: number): string {
  for (let i = 1; i <= n; i++) {
    writeFileSync(join(path, `iter-${i}.txt`), `iteration ${i}\n`);
    git(path, ['add', `iter-${i}.txt`]);
    git(path, ['commit', '-q', '-m', `wip: iteration ${i}`]);
  }
  return git(path, ['rev-parse', 'HEAD']);
}

test('unmergedCommitCount: commits on the branch outside every named ref; UNKNOWN when no named ref exists', () => {
  const w = repoWithCycle('INIT-count');
  try {
    const wt = createWiWorktree({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-count', workItemId: 'WI-1', startPointRef: git(w.repo, ['rev-parse', 'main']), cycleWorktreePath: w.cycle });
    assert.equal(unmergedCommitCount(w.repo, wt.branch, ['forge/INIT-count', 'main']), 0);
    commitIterations(wt.path, 3);
    assert.equal(unmergedCommitCount(w.repo, wt.branch, ['forge/INIT-count', 'main']), 3);
    assert.equal(unmergedCommitCount(w.repo, wt.branch, ['refs/heads/no-such-ref']), 'UNKNOWN');
    assert.equal(unmergedCommitCount(w.repo, 'forge/wi/INIT-count/WI-9', ['main']), 'UNKNOWN', 'a missing branch is not "0 unmerged"');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('prune: an UNMERGED per-WI branch (3 committed iterations) survives the sweep — its worktree is pruned, the branch and every commit are kept and named', () => {
  const w = repoWithCycle('INIT-keep');
  const logsRoot = join(w.dir, '_logs');
  try {
    const wt = createWiWorktree({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-keep', workItemId: 'WI-1', startPointRef: git(w.repo, ['rev-parse', 'main']), cycleWorktreePath: w.cycle });
    const tip = commitIterations(wt.path, 3);

    const r = pruneStaleWiWorktrees({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-keep', logsRoot });

    assert.deepEqual(r.prunedPaths, [wt.path], 'the scratch worktree is still pruned');
    assert.deepEqual(r.prunedBranches, [], 'the unmerged branch is not deleted');
    assert.deepEqual(r.keptBranches, [wt.branch]);
    assert.equal(git(w.repo, ['rev-parse', wt.branch]), tip, 'the branch still points at its tip');
    assert.equal(git(w.repo, ['rev-list', '--count', `main..${wt.branch}`]), '3');
    const ev = readFileSync(join(logsRoot, 'INIT-keep', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { message: string; metadata: Record<string, unknown> });
    assert.equal(ev[0]!.message, 'wi-worktrees.pruned');
    assert.deepEqual(ev[0]!.metadata.kept_branches, [wt.branch]);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('prune: a per-WI branch already merged into the initiative branch is deleted (orphan sweep path)', () => {
  const w = repoWithCycle('INIT-merged');
  try {
    const wt = createWiWorktree({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-merged', workItemId: 'WI-1', startPointRef: git(w.repo, ['rev-parse', 'main']), cycleWorktreePath: w.cycle });
    const tip = commitIterations(wt.path, 2);
    removeWiWorktree({ projectRepoPath: w.repo, path: wt.path, branch: wt.branch });
    git(w.repo, ['branch', '-f', 'forge/INIT-merged', tip]);

    const r = pruneStaleWiWorktrees({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-merged', logsRoot: join(w.dir, '_logs') });

    assert.deepEqual(r.prunedBranches, [wt.branch]);
    assert.deepEqual(r.keptBranches, []);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('createWiWorktree: an existing UNMERGED WI branch is resumed at its kept tip — never deleted and re-cut from the start point', () => {
  const w = repoWithCycle('INIT-resume');
  try {
    const base = git(w.repo, ['rev-parse', 'main']);
    const first = createWiWorktree({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-resume', workItemId: 'WI-1', startPointRef: base, cycleWorktreePath: w.cycle });
    const tip = commitIterations(first.path, 3);
    removeWiWorktree({ projectRepoPath: w.repo, path: first.path, branch: first.branch });
    writeFileSync(join(w.cycle, '.forge', 'work-items', 'WI-1.md'), 'spec v2\n');

    const second = createWiWorktree({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-resume', workItemId: 'WI-1', startPointRef: base, cycleWorktreePath: w.cycle });

    assert.equal(second.resumedFrom, tip, 'the handle names the kept tip it resumed from');
    assert.equal(git(second.path, ['rev-parse', 'HEAD']), tip);
    assert.ok(existsSync(join(second.path, 'iter-3.txt')), 'every committed iteration is in the resumed worktree');
    assert.equal(readFileSync(join(second.path, '.forge', 'work-items', 'WI-1.md'), 'utf8'), 'spec v2\n');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('createWiWorktree: a fresh WI reports no resume', () => {
  const w = repoWithCycle('INIT-fresh');
  try {
    const h = createWiWorktree({ projectRepoPath: w.repo, worktreesRoot: w.worktreesRoot, initiativeId: 'INIT-fresh', workItemId: 'WI-1', startPointRef: git(w.repo, ['rev-parse', 'main']), cycleWorktreePath: w.cycle });
    assert.equal(h.resumedFrom, null);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('WorkItem: kept_branch round-trips through parse/serialize and survives a status write', () => {
  const src = ['---', 'work_item_id: WI-17', 'initiative_id: INIT-2026-10-17-x', 'status: failed', 'depends_on: []',
    'acceptance_criteria:', '  - given: g', '    when: w', '    then: t', 'files_in_scope:', '  - a.txt',
    'estimated_iterations: 3', 'origin: review-fix', 'kept_branch: forge/wi/INIT-2026-10-17-x/WI-17', '---', '', '# WI-17', ''].join('\n');
  const w = parseWorkItem(src);
  assert.equal(w.kept_branch, 'forge/wi/INIT-2026-10-17-x/WI-17');
  assert.match(serializeWorkItem({ ...w, status: 'pending' }), /kept_branch: forge\/wi\/INIT-2026-10-17-x\/WI-17/);
  assert.doesNotMatch(serializeWorkItem({ ...w, kept_branch: undefined }), /kept_branch/, 'omit-on-undefined');
});

test('Requeue of a round halted on a budget-failed fix WI resumes develop from the kept branch: WI back to pending, kept branch and its commits untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'wi-keep-requeue-'));
  try {
    const fx = plantStrandedFixRound(root, { withGit: true, fixOrigin: 'review-fix' });
    const kept = wiBranchName({ initiativeId: FIX_INIT, workItemId: 'WI-6' });
    git(fx.repo, ['branch', kept, FIX_BRANCH]);
    const keptWt = join(root, 'kept-wt');
    git(fx.repo, ['worktree', 'add', '-q', keptWt, kept]);
    const tip = commitIterations(keptWt, 3);
    git(fx.repo, ['worktree', 'remove', '--force', keptWt]);
    const specPath = join(fx.worktree, '.forge', 'work-items', 'WI-6.md');
    writeFileSync(specPath, serializeWorkItem({ ...parseWorkItem(readFileSync(specPath, 'utf8')), status: 'failed', kept_branch: kept }));
    appendFileSync(join(fx.logDir, 'events.jsonl'), `${JSON.stringify({ phase: 'review-loop', skill: 'developer-ralph', event_type: 'error', message: 'sendback.loop-halted', started_at: '2026-10-10T06:00:00.000Z', metadata: { round: 1, classification: 'fix-work-items-failed', reason: 'fix work item(s) failed at the iteration budget: WI-6 (1/1 checks passing)', pending_work_items: ['WI-6'] } })}\n`);
    renameSync(fx.manifestPath, join(root, '_queue', 'failed', `${FIX_INIT}.md`));

    const r = runRequeue(FIX_INIT, { forgeRoot: root });

    assert.deepEqual([r.resumeDecision.resume, r.resumeDecision.resume && r.resumeDecision.resume_from], [true, 'develop'], r.resumeDecision.reason);
    assert.equal(r.branchDeleted, false);
    assert.equal(parseManifest(readFileSync(join(root, '_queue', 'pending', `${FIX_INIT}.md`), 'utf8')).resume_from, 'develop');
    const wi6 = parseWorkItem(readFileSync(specPath, 'utf8'));
    assert.equal(wi6.status, 'pending', 'the failed fix WI is re-armed for the resumed round');
    assert.equal(wi6.kept_branch, kept, 'and still names the branch it resumes from');
    assert.equal(git(fx.repo, ['rev-parse', kept]), tip, 'the kept branch is untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: a round the dev loop halted on a failed fix WI lands in failed/ by name — round_halt on the manifest, one halt event, never ready-for-review or "completed"', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wi-keep-drain-'));
  try {
    const fx = plantStrandedFixRound(root, { withGit: true, fixOrigin: 'review-fix' });
    const reason = 'fix work item(s) failed at the iteration budget: WI-6 (10/20 checks passing)';
    const log = join(fx.logDir, 'events.jsonl');
    const ev = (message: string, metadata: Record<string, unknown> = {}) => `${JSON.stringify({ phase: 'developer-loop', skill: 'developer-ralph', event_type: 'log', message, started_at: new Date().toISOString(), metadata })}\n`;
    const results = await drainPendingFixWorkItems({
      queueRoot: join(root, '_queue'), logsRoot: join(root, '_logs'), phaseWiring: UNREACHED_PHASE_WIRING, confirmMerge: () => false,
      // Stands in for runCycle: the dev loop records its halt and the develop node throws (stations' own test drives that door).
      runDrainCycle: async () => {
        appendFileSync(log, ev('cycle.start'));
        const spec = join(fx.worktree, '.forge', 'work-items', 'WI-6.md');
        writeFileSync(spec, serializeWorkItem({ ...parseWorkItem(readFileSync(spec, 'utf8')), status: 'failed', kept_branch: wiBranchName({ initiativeId: FIX_INIT, workItemId: 'WI-6' }) }));
        appendFileSync(log, ev('sendback.loop-halted', { round: 1, classification: 'fix-work-items-failed', reason, pending_work_items: ['WI-6'] }));
        return { status: 'failed' };
      },
    });
    const r = results.find((x) => x.initiativeId === FIX_INIT);
    assert.equal(r?.status, 'halted', JSON.stringify(r));
    assert.equal(r?.detail, reason);
    assert.equal(existsSync(join(root, '_queue', 'ready-for-review', `${FIX_INIT}.md`)), false);
    const failed = readFileSync(join(root, '_queue', 'failed', `${FIX_INIT}.md`), 'utf8');
    assert.match(failed, /^round_halt: fix-work-items-failed$/m);
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { message: string });
    assert.equal(lines.filter((e) => e.message === 'sendback.loop-halted').length, 1, 'the drain never duplicates the recorded halt');
    assert.equal(lines.some((e) => e.message === 'sendback.loop-completed'), false);
    const run = aggregateRun({ root, queueState: 'failed', manifestPath: join(root, '_queue', 'failed', `${FIX_INIT}.md`), nowMs: Date.now() });
    assert.deepEqual(run.roundHalt, { round: 1, classification: 'fix-work-items-failed', reason });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run model: dev-loop.kept is the WI\'s latest verdict — never read as delivered', () => {
  const at = new Date().toISOString();
  const evs = [
    { message: 'dev-loop.delivered', metadata: { work_item_id: 'WI-17', files_changed: 2, insertions: 5, commits: 1, outcome: 'complete' } },
    { message: 'dev-loop.discarded', metadata: { work_item_id: 'WI-17', uncommitted_files: ['x.txt'], files_changed: 1, insertions: 0, commits: 0, outcome: 'failed' } },
    { message: 'dev-loop.kept', metadata: { work_item_id: 'WI-17', branch: 'forge/wi/I/WI-17', files_changed: 22, insertions: 567, deletions: 46, commits: 15, outcome: 'failed', resumable: true } },
  ].map((e) => ({ ...e, started_at: at })) as unknown as EventLogEntry[];
  assert.deepEqual(findLatestWiVerdict(evs, 'WI-17'), { message: 'dev-loop.kept', outcome: 'failed', files: 22, insertions: 567, commits: 15 });
  assert.equal(findDelivered(evs, 'WI-17'), undefined);
});
