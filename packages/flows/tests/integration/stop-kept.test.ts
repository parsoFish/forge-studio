/**
 * forge-mfv5.1.60 (D-06) — gitweave I4 round 3 (R73): WI-18 was hard-stopped
 * mid-loop (stop flag POSTed, the dev agent SIGKILLed, serve SIGKILLed). No
 * `dev-loop.kept` was ever written, so WI-18.md stayed `status: pending` with
 * no `kept_branch` while its branch carried 3 commits (a9d3ee6). Boot
 * classified the run stranded; a Requeue would then reach
 * `createWiWorktree({ resumeKept: wi.kept_branch !== undefined })` with
 * `false`, PARK the branch under `forge/parked/…` and re-cut WI-18 fresh.
 *
 * The Requeue of a stranded run now stamps each owed WI whose branch carries
 * commits outside the cycle branch as kept, so it resumes at its tip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, renameSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWiWorktree, wiBranchName } from '../../wi-worktree.ts';
import { parseWorkItem } from '../../work-item.ts';
import { runRequeue } from '../../forge-requeue.ts';
import { FIX_BRANCH, FIX_CYCLE, FIX_INIT, plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';

const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

// The R73 boot classification, shape copied from the I4 cycle log (stop flag set, stale heartbeat).
const STRANDED_ROW = JSON.stringify({ cycle_id: FIX_CYCLE, started_at: '2026-10-18T03:20:09.000Z', initiative_id: FIX_INIT, phase: 'orchestrator', skill: 'scheduler', event_type: 'error', message: 'recovery.stranded-classified',
  metadata: { reason: 'stale-heartbeat', stop_flag: true, heartbeat_age_ms: 2_094_880, resume_from: 'develop', last_event: { message: 'gate.pass', phase: 'developer-loop', at: '2026-10-18T02:51:02.562Z' }, queue_state: 'failed', needs: 'operator' } });
// …and the failure_classification boot writes right after it (scheduler-sweeps.ts announceRecovery).
const STRANDED_CLASS_ROW = JSON.stringify({ cycle_id: FIX_CYCLE, started_at: '2026-10-18T03:20:09.000Z', initiative_id: FIX_INIT, phase: 'orchestrator', skill: 'cycle', event_type: 'log', message: 'failure_classification',
  metadata: { cycle_id: FIX_CYCLE, failure_mode: 'terminal', failure_kind: 'terminal', recoverable: false, environment: false, cleanBoundaryHalt: true, reason: 'stranded run classified at boot (stale-heartbeat, operator stop flag set) — Requeue resumes from the preserved worktree', evidence_event_ids: [] } });

/** WI-6 (the round's fix WI) stopped mid-loop: pending, no kept_branch, its branch `commits` commits over the cycle tip; manifest stranded into failed/. */
function strandedStop(commits: number, logLines: string[] = [STRANDED_ROW, STRANDED_CLASS_ROW]) {
  const root = mkdtempSync(join(tmpdir(), 'forge-stop-kept-'));
  const fx = plantStrandedFixRound(root, { withGit: true, fixOrigin: 'review-fix' });
  const branch = wiBranchName({ initiativeId: FIX_INIT, workItemId: 'WI-6' });
  git(fx.repo, ['branch', branch, FIX_BRANCH]);
  const wt = join(root, '_worktrees', 'wi', FIX_INIT, 'WI-6');
  git(fx.repo, ['worktree', 'add', '-q', wt, branch]); // the WI worktree survives the kill intact
  for (let i = 1; i <= commits; i++) {
    execFileSync('sh', ['-c', `echo it-${i} > it-${i}.txt`], { cwd: wt });
    git(wt, ['add', `it-${i}.txt`]);
    git(wt, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `wip: iteration ${i}`]);
  }
  const tip = git(fx.repo, ['rev-parse', branch]);
  for (const l of logLines) appendFileSync(join(fx.logDir, 'events.jsonl'), `${l}\n`);
  renameSync(fx.manifestPath, join(root, '_queue', 'failed', `${FIX_INIT}.md`));
  const specPath = join(fx.worktree, '.forge', 'work-items', 'WI-6.md');
  const events = () => readFileSync(join(fx.logDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { message: string; metadata?: Record<string, unknown> });
  return { root, fx, branch, tip, specPath, events };
}

const resumeAt = (s: ReturnType<typeof strandedStop>) => {
  const wi = parseWorkItem(readFileSync(s.specPath, 'utf8'));
  // The very expression developer-loop.ts passes (`resumeKept: wi.kept_branch !== undefined`).
  return createWiWorktree({ projectRepoPath: s.fx.repo, worktreesRoot: join(s.root, '_worktrees'), initiativeId: FIX_INIT, workItemId: 'WI-6', startPointRef: git(s.fx.repo, ['rev-parse', FIX_BRANCH]), cycleWorktreePath: s.fx.worktree, resumeKept: wi.kept_branch !== undefined });
};

test('row 1: Requeue of a stranded stop stamps the stopped WI kept (pending + kept_branch, named event) and the dev loop resumes it at its tip — never parked', () => {
  const s = strandedStop(3);
  try {
    const r = runRequeue(FIX_INIT, { forgeRoot: s.root });
    assert.deepEqual([r.resumeDecision.resume, r.resumeDecision.resume && r.resumeDecision.resume_from], [true, 'develop'], r.resumeDecision.reason);

    const wi = parseWorkItem(readFileSync(s.specPath, 'utf8'));
    assert.equal(wi.kept_branch, s.branch, 'the stopped WI names the branch it resumes from');
    assert.equal(wi.status, 'pending', 'still owed work: the round counts it, the drain never parks it as failed');
    const kept = s.events().filter((e) => e.message === 'wi.kept-at-classification');
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0]!.metadata, { initiative_id: FIX_INIT, work_item_id: 'WI-6', branch: s.branch, tip: s.tip, commits: 3 });

    const h = resumeAt(s);
    assert.equal(h.resumedFrom, s.tip, 'resumed at a9d3ee6-equivalent');
    assert.equal(h.parkedAs, null, 'never parked');
    assert.equal(git(s.fx.repo, ['branch', '--list', `forge/parked/${FIX_INIT}/*`]), '', 'no forge/parked ref');
    assert.ok(existsSync(join(h.path, 'it-3.txt')), 'the committed iterations are in the resumed worktree');
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('row 1: a stopped WI whose branch has no commits beyond its start point is not stamped — it is re-cut as today', () => {
  const s = strandedStop(0);
  try {
    runRequeue(FIX_INIT, { forgeRoot: s.root });
    assert.equal(parseWorkItem(readFileSync(s.specPath, 'utf8')).kept_branch, undefined);
    assert.equal(s.events().some((e) => e.message === 'wi.kept-at-classification'), false);
    const h = resumeAt(s);
    assert.deepEqual([h.resumedFrom, h.parkedAs], [null, null], 're-cut fresh');
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('row 1 control: a Requeue whose prior failure was not a strand (a recorded round halt) stamps nothing — that path keeps its own #1230 shape', () => {
  const halt = JSON.stringify({ phase: 'review-loop', skill: 'developer-ralph', event_type: 'error', message: 'sendback.loop-halted', started_at: '2026-10-10T06:00:00.000Z', metadata: { round: 1, classification: 'fix-work-items-failed', reason: 'x', pending_work_items: ['WI-1'] } });
  const s = strandedStop(3, [halt]);
  try {
    runRequeue(FIX_INIT, { forgeRoot: s.root });
    assert.equal(parseWorkItem(readFileSync(s.specPath, 'utf8')).kept_branch, undefined);
    assert.equal(s.events().some((e) => e.message === 'wi.kept-at-classification'), false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('row 1: a stopped WI branch whose commit count cannot be read refuses the Requeue by name — the manifest stays in failed/', () => {
  const s = strandedStop(3);
  try {
    git(s.fx.repo, ['worktree', 'remove', '--force', join(s.root, '_worktrees', 'wi', FIX_INIT, 'WI-6')]);
    // The ref exists but names no object git can read: `git rev-list` cannot answer.
    writeFileSync(join(s.fx.repo, '.git', 'refs', 'heads', ...s.branch.split('/')), `${'1'.repeat(40)}\n`);
    assert.throws(() => runRequeue(FIX_INIT, { forgeRoot: s.root }), /requeue: cannot tell whether forge\/wi\/INIT-2026-10-10-stranded-fix-round\/WI-6 carries commits outside forge\/INIT-2026-10-10-stranded-fix-round — refusing to resume or re-cut it \(D-06\)/);
    assert.ok(existsSync(join(s.root, '_queue', 'failed', `${FIX_INIT}.md`)));
    assert.equal(parseWorkItem(readFileSync(s.specPath, 'utf8')).kept_branch, undefined);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
