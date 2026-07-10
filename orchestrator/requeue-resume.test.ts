/**
 * N7 (plan 2.9) — requeue infers resume position from worktree/branch state.
 *
 * A failed initiative whose failure was ENVIRONMENT-classified (rate-limit
 * death mid-WI, gate timeout, lint-lock contention — G3/N9) and whose
 * worktree + branch still carry committed work must NOT be wiped back to a
 * fresh-from-main re-run. The requeue resumes from the preserved state
 * instead, mirroring the ADR-019 resume machinery:
 *   - all WIs complete  → `resume_from: unifier` (existing marker; only the
 *                          unifier + downstream re-run)
 *   - some WIs pending  → preserve the worktree with NO marker; the
 *                          scheduler's preserved-work-items reuse path picks
 *                          it up and the dev-loop re-runs in place (complete
 *                          WIs take the iter-0 shortcut, pending ones build)
 *   - anything else     → fresh full re-run (wipe), exactly as before.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  branchHasCommittedWork,
  decideRequeueResume,
  inferRequeueResume,
  readPriorFailureEnvironment,
  summarizeWorkItemStatuses,
} from './requeue-resume.ts';
import { serializeWorkItem, type WorkItem } from './work-item.ts';

const INIT = 'INIT-2026-07-11-n7-fixture';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).toString();
}

/** Bare-bones project repo: main with one commit. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'n7-repo-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@forge.local']);
  git(dir, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

/** Create `branch` off main, optionally with one committed WI file on it. */
function addBranch(repo: string, branch: string, withCommit: boolean): void {
  git(repo, ['branch', branch]);
  if (withCommit) {
    git(repo, ['checkout', '-q', branch]);
    writeFileSync(join(repo, 'wi-work.txt'), 'committed WI work\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'feat: WI-1 work']);
    git(repo, ['checkout', '-q', 'main']);
  }
}

function wi(id: string, status: WorkItem['status']): WorkItem {
  return {
    work_item_id: id,
    initiative_id: INIT,
    status,
    depends_on: [],
    acceptance_criteria: [{ given: 'a fixture', when: 'the WI runs', then: 'the thing exists' }],
    files_in_scope: ['src/x.ts'],
    estimated_iterations: 2,
    body: 'Fixture WI body.',
  };
}

/** A preserved worktree dir with .forge/work-items/ status files. */
function makeWorktree(items: WorkItem[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'n7-wt-'));
  const wiDir = join(dir, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });
  for (const item of items) {
    writeFileSync(join(wiDir, `${item.work_item_id}.md`), serializeWorkItem(item));
  }
  return dir;
}

/** A forge root with `_logs/<cycleId>/events.jsonl` carrying a classification. */
function makeForgeRoot(cycleId: string, classification: Record<string, unknown> | null): string {
  const root = mkdtempSync(join(tmpdir(), 'n7-root-'));
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  const lines: string[] = [
    JSON.stringify({ event_id: 'e1', initiative_id: INIT, started_at: '2026-07-11T00:00:00.000Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', input_refs: [], output_refs: [], message: 'cycle.start' }),
  ];
  if (classification) {
    lines.push(
      JSON.stringify({ event_id: 'e2', initiative_id: INIT, started_at: '2026-07-11T00:01:00.000Z', phase: 'orchestrator', skill: 'cycle', event_type: 'log', input_refs: [], output_refs: [], message: 'failure_classification', metadata: classification }),
    );
  }
  writeFileSync(join(logDir, 'events.jsonl'), lines.join('\n') + '\n');
  return root;
}

// ---------------------------------------------------------------------------
// decideRequeueResume — the pure decision
// ---------------------------------------------------------------------------

test('decideRequeueResume: environment failure + preserved work + all WIs complete → resume from unifier', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    worktreePresent: true,
    branchHasWork: true,
    workItems: { total: 3, complete: 3 },
  });
  assert.equal(d.resume, true);
  if (d.resume) assert.equal(d.resume_from, 'unifier');
});

test('decideRequeueResume: environment failure + preserved work + WIs incomplete → resume with NO marker (dev-loop re-runs in place)', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    worktreePresent: true,
    branchHasWork: true,
    workItems: { total: 3, complete: 1 },
  });
  assert.equal(d.resume, true);
  if (d.resume) assert.equal(d.resume_from, null);
});

test('decideRequeueResume: non-environment failure → no resume (fresh re-run)', () => {
  const d = decideRequeueResume({
    environmentFailure: false,
    worktreePresent: true,
    branchHasWork: true,
    workItems: { total: 3, complete: 3 },
  });
  assert.equal(d.resume, false);
});

test('decideRequeueResume: no preserved worktree → no resume', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    worktreePresent: false,
    branchHasWork: true,
    workItems: { total: 2, complete: 2 },
  });
  assert.equal(d.resume, false);
});

test('decideRequeueResume: branch has no committed work → no resume (nothing to salvage)', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    worktreePresent: true,
    branchHasWork: false,
    workItems: { total: 2, complete: 0 },
  });
  assert.equal(d.resume, false);
});

test('decideRequeueResume: no readable work-item specs → no resume (dev node needs them)', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    worktreePresent: true,
    branchHasWork: true,
    workItems: null,
  });
  assert.equal(d.resume, false);
});

// ---------------------------------------------------------------------------
// branchHasCommittedWork — fixture git repos
// ---------------------------------------------------------------------------

test('branchHasCommittedWork: branch with a commit beyond main → true', () => {
  const repo = initRepo();
  addBranch(repo, `forge/${INIT}`, true);
  assert.equal(branchHasCommittedWork(repo, `forge/${INIT}`), true);
});

test('branchHasCommittedWork: branch at main (no WI commits) → false', () => {
  const repo = initRepo();
  addBranch(repo, `forge/${INIT}`, false);
  assert.equal(branchHasCommittedWork(repo, `forge/${INIT}`), false);
});

test('branchHasCommittedWork: missing branch → false', () => {
  const repo = initRepo();
  assert.equal(branchHasCommittedWork(repo, `forge/${INIT}`), false);
});

test('branchHasCommittedWork: not a git repo → false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'n7-notrepo-'));
  assert.equal(branchHasCommittedWork(dir, `forge/${INIT}`), false);
});

// ---------------------------------------------------------------------------
// summarizeWorkItemStatuses
// ---------------------------------------------------------------------------

test('summarizeWorkItemStatuses: counts complete vs total from .forge/work-items', () => {
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'pending'), wi('WI-3', 'complete')]);
  assert.deepEqual(summarizeWorkItemStatuses(wt), { total: 3, complete: 2 });
});

test('summarizeWorkItemStatuses: missing work-items dir → null', () => {
  const wt = mkdtempSync(join(tmpdir(), 'n7-emptywt-'));
  assert.equal(summarizeWorkItemStatuses(wt), null);
});

// ---------------------------------------------------------------------------
// readPriorFailureEnvironment — the classification stamped by cycle.ts
// ---------------------------------------------------------------------------

test('readPriorFailureEnvironment: environment:true classification in the cycle log → true', () => {
  const root = makeForgeRoot('cyc-1', { failure_mode: 'transient', recoverable: true, environment: true, reason: 'rate-limited (environment failure)' });
  assert.equal(readPriorFailureEnvironment(root, 'cyc-1'), true);
});

test('readPriorFailureEnvironment: terminal / non-environment classification → false', () => {
  const root = makeForgeRoot('cyc-2', { failure_mode: 'terminal', recoverable: false, reason: 'unifier did not pass' });
  assert.equal(readPriorFailureEnvironment(root, 'cyc-2'), false);
});

test('readPriorFailureEnvironment: no classification event / missing log → false', () => {
  const root = makeForgeRoot('cyc-3', null);
  assert.equal(readPriorFailureEnvironment(root, 'cyc-3'), false);
  assert.equal(readPriorFailureEnvironment(root, 'no-such-cycle'), false);
  assert.equal(readPriorFailureEnvironment(root, undefined), false);
});

// ---------------------------------------------------------------------------
// inferRequeueResume — composition over real fixtures
// ---------------------------------------------------------------------------

test('inferRequeueResume: environment death mid-WI with preserved worktree+branch → resume, no marker', () => {
  const repo = initRepo();
  addBranch(repo, `forge/${INIT}`, true);
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'pending')]);
  const root = makeForgeRoot('cyc-env', { failure_mode: 'transient', recoverable: true, environment: true, reason: 'rate-limited' });

  const d = inferRequeueResume({
    forgeRoot: root,
    cycleId: 'cyc-env',
    initiativeId: INIT,
    worktreePath: wt,
    projectRepoPath: repo,
  });
  assert.equal(d.resume, true);
  if (d.resume) assert.equal(d.resume_from, null);
});

test('inferRequeueResume: environment death after all WIs complete → resume from unifier', () => {
  const repo = initRepo();
  addBranch(repo, `forge/${INIT}`, true);
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'complete')]);
  const root = makeForgeRoot('cyc-env2', { failure_mode: 'transient', recoverable: true, environment: true, reason: 'gate timed out' });

  const d = inferRequeueResume({
    forgeRoot: root,
    cycleId: 'cyc-env2',
    initiativeId: INIT,
    worktreePath: wt,
    projectRepoPath: repo,
  });
  assert.equal(d.resume, true);
  if (d.resume) assert.equal(d.resume_from, 'unifier');
});

test('inferRequeueResume: terminal failure → no resume even with preserved state', () => {
  const repo = initRepo();
  addBranch(repo, `forge/${INIT}`, true);
  const wt = makeWorktree([wi('WI-1', 'complete')]);
  const root = makeForgeRoot('cyc-term', { failure_mode: 'terminal', recoverable: false, reason: 'unifier did not pass' });

  const d = inferRequeueResume({
    forgeRoot: root,
    cycleId: 'cyc-term',
    initiativeId: INIT,
    worktreePath: wt,
    projectRepoPath: repo,
  });
  assert.equal(d.resume, false);
});
