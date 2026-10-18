/**
 * N7 (plan 2.9) — requeue infers resume position from worktree/branch state.
 *
 * A failed initiative whose failure was ENVIRONMENT-classified (rate-limit
 * death mid-WI, gate timeout, lint-lock contention — G3/N9) and whose
 * worktree + branch still carry committed work must NOT be wiped back to a
 * fresh-from-main re-run. The requeue resumes from the preserved state
 * instead, mirroring the D-06 resume machinery:
 *   - all WIs complete  → `resume_from: integrate` (R4-10-F6 marker; the post-develop
 *                          band re-runs at the integrate node, no WI rebuilt)
 *   - some WIs pending  → preserve the worktree with NO marker; the
 *                          scheduler's preserved-work-items reuse path picks
 *                          it up and the dev-loop re-runs in place (complete
 *                          WIs take the iter-0 shortcut, pending ones build)
 *   - anything else     → fresh full re-run (wipe), exactly as before.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  branchHasCommittedWork,
  decideRequeueResume,
  derivedFailureClassification,
  inferRequeueResume,
  readPriorFailureSignal,
  summarizeWorkItemStatuses,
} from '../../requeue-resume.ts';
import { serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { classifyCycleFailure } from '@forge/agents';
import { rebasesAtEntry } from '../../flow-runner.ts';
import { parseManifest, serializeManifest } from '../../manifest.ts';
import { failureCauseEvents, failureClassificationRecord, type FailureCause } from '../test-fixtures/failure-cause-events.ts';

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

/**
 * A forge root with `_logs/<cycleId>/events.jsonl`: the failure's CAUSE events, then the `failure_classification`
 * record as some version of cycle.ts wrote it (forge-mfv5.1.62: the record is never the input — the cause is).
 */
function makeForgeRoot(cycleId: string, cause: FailureCause | null, record: Record<string, unknown> | null, extra: Array<Record<string, unknown>> = []): string {
  const root = mkdtempSync(join(tmpdir(), 'n7-root-'));
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  const events: Array<Record<string, unknown>> = [
    { event_id: 'e1', initiative_id: INIT, started_at: '2026-07-11T00:00:00.000Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', input_refs: [], output_refs: [], message: 'cycle.start' },
    ...(cause ? failureCauseEvents(cause, INIT) : []),
    ...(record ? [failureClassificationRecord(INIT, record)] : []),
    ...extra,
  ];
  writeFileSync(join(logDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return root;
}

// ---------------------------------------------------------------------------
// decideRequeueResume — the pure decision
// ---------------------------------------------------------------------------

test('decideRequeueResume: environment failure + preserved work + all WIs complete → resume from demo', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    worktreePresent: true,
    branchHasWork: true,
    workItems: { total: 3, complete: 3 },
  });
  assert.equal(d.resume, true);
  if (d.resume) assert.equal(d.resume_from, 'integrate');
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

test(
  'decideRequeueResume: row 157 resumeFromPlan → resume from plan regardless of ' +
    'worktree/branch state',
  () => {
    const d = decideRequeueResume({
      environmentFailure: false,
      resumeFromPlan: true,
      worktreePresent: false,
      branchHasWork: false,
      workItems: null,
    });
    assert.equal(d.resume, true);
    if (d.resume) assert.equal(d.resume_from, 'plan');
  },
);

test(
  'decideRequeueResume: row 122 resumeFromPrOpen → resume from pr-open, no WI-count check needed',
  () => {
    const d = decideRequeueResume({
      environmentFailure: true,
      resumeFromPrOpen: true,
      worktreePresent: true,
      // Deliberately false/null — a `pr-open` resume never consults these;
      // dev, integrate and adversarial-review are guaranteed to have
      // succeeded already (PR-open is the flow's last node), so there is
      // nothing to count WIs for the way the generic 'integrate' branch does.
      branchHasWork: false,
      workItems: null,
    });
    assert.equal(d.resume, true);
    if (d.resume) assert.equal(d.resume_from, 'pr-open');
  },
);

test('decideRequeueResume: row 122 resumeFromPrOpen but the preserved worktree is gone → no resume', () => {
  const d = decideRequeueResume({
    environmentFailure: true,
    resumeFromPrOpen: true,
    worktreePresent: false,
    branchHasWork: false,
    workItems: null,
  });
  assert.equal(d.resume, false);
});

// ---------------------------------------------------------------------------
// branchHasCommittedWork — fixture git repos
// ---------------------------------------------------------------------------

test('branchHasCommittedWork: branch with a commit beyond main → true', () => {
  const repo = initRepo();
  try {
    addBranch(repo, `forge/${INIT}`, true);
    assert.equal(branchHasCommittedWork(repo, `forge/${INIT}`), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('branchHasCommittedWork: branch at main (no WI commits) → false', () => {
  const repo = initRepo();
  try {
    addBranch(repo, `forge/${INIT}`, false);
    assert.equal(branchHasCommittedWork(repo, `forge/${INIT}`), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('branchHasCommittedWork: missing branch → false', () => {
  const repo = initRepo();
  try {
    assert.equal(branchHasCommittedWork(repo, `forge/${INIT}`), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('branchHasCommittedWork: not a git repo → false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'n7-notrepo-'));
  try {
    assert.equal(branchHasCommittedWork(dir, `forge/${INIT}`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// summarizeWorkItemStatuses
// ---------------------------------------------------------------------------

test('summarizeWorkItemStatuses: counts complete vs total from .forge/work-items', () => {
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'pending'), wi('WI-3', 'complete')]);
  try {
    assert.deepEqual(summarizeWorkItemStatuses(wt), { total: 3, complete: 2, superseded: 0 });
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('summarizeWorkItemStatuses: missing work-items dir → null', () => {
  const wt = mkdtempSync(join(tmpdir(), 'n7-emptywt-'));
  try {
    assert.equal(summarizeWorkItemStatuses(wt), null);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// readPriorFailureSignal — the classification stamped by cycle.ts
// ---------------------------------------------------------------------------

test('readPriorFailureSignal: environment:true classification in the cycle log → environment true', () => {
  const root = makeForgeRoot('cyc-1', 'environment', { failure_mode: 'transient', recoverable: true, environment: true, reason: 'rate-limited (environment failure)' });
  try {
    assert.equal(readPriorFailureSignal(root, 'cyc-1').environment, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readPriorFailureSignal: terminal / non-environment classification → environment false', () => {
  const root = makeForgeRoot('cyc-2', 'terminal', { failure_mode: 'terminal', recoverable: false, reason: 'unifier did not pass' });
  try {
    assert.equal(readPriorFailureSignal(root, 'cyc-2').environment, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readPriorFailureSignal: row 157 resume_from:"plan" in the classification → resumeFrom "plan"', () => {
  const root = makeForgeRoot('cyc-plan', 'plan', {
    failure_mode: 'terminal', recoverable: false, environment: false, cleanBoundaryHalt: false,
    resume_from: 'plan', reason: 'PM did not compile an acceptance work item …',
  });
  try {
    assert.equal(readPriorFailureSignal(root, 'cyc-plan').resumeFrom, 'plan');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readPriorFailureSignal: row 122 resume_from:"pr-open" → resumeFrom "pr-open"', () => {
  const root = makeForgeRoot('cyc-pr-open', 'pr-open', {
    failure_mode: 'transient', recoverable: true, environment: true, cleanBoundaryHalt: false,
    resume_from: 'pr-open', reason: 'DNS resolution failed while pushing/fetching …',
  });
  try {
    const signal = readPriorFailureSignal(root, 'cyc-pr-open');
    assert.equal(signal.environment, true);
    assert.equal(signal.resumeFrom, 'pr-open');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readPriorFailureSignal: no classification event / missing log → all-false signal', () => {
  const root = makeForgeRoot('cyc-3', null, null);
  const allFalse = { environment: false, cleanBoundaryHalt: false };
  try {
    assert.deepEqual(readPriorFailureSignal(root, 'cyc-3'), allFalse);
    assert.deepEqual(readPriorFailureSignal(root, 'no-such-cycle'), allFalse);
    assert.deepEqual(readPriorFailureSignal(root, undefined), allFalse);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'readPriorFailureSignal (round 3): cleanBoundaryHalt comes from the classifier over the cause — ' +
    'the record\'s reason prose is not parsed',
  () => {
    const root = makeForgeRoot('cyc-4', 'operator-stop', {
      failure_mode: 'terminal',
      recoverable: false,
      environment: false,
      cleanBoundaryHalt: true,
      reason: 'a reason string that says nothing about cost ceilings or operator stops',
    });
    try {
      const expected = { environment: false, cleanBoundaryHalt: true };
      assert.deepEqual(readPriorFailureSignal(root, 'cyc-4'), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// inferRequeueResume — composition over real fixtures
// ---------------------------------------------------------------------------

test('inferRequeueResume: environment death mid-WI with preserved worktree+branch → resume, no marker', () => {
  const repo = initRepo();
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'pending')]);
  const root = makeForgeRoot('cyc-env', 'environment', { failure_mode: 'transient', recoverable: true, environment: true, reason: 'rate-limited' });
  try {
    addBranch(repo, `forge/${INIT}`, true);

    const d = inferRequeueResume({
      forgeRoot: root,
      cycleId: 'cyc-env',
      initiativeId: INIT,
      worktreePath: wt,
      projectRepoPath: repo,
    });
    assert.equal(d.resume, true);
    if (d.resume) assert.equal(d.resume_from, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('inferRequeueResume: environment death after all WIs complete → resume from demo', () => {
  const repo = initRepo();
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'complete')]);
  const root = makeForgeRoot('cyc-env2', 'environment', { failure_mode: 'transient', recoverable: true, environment: true, reason: 'gate timed out' });
  try {
    addBranch(repo, `forge/${INIT}`, true);

    const d = inferRequeueResume({
      forgeRoot: root,
      cycleId: 'cyc-env2',
      initiativeId: INIT,
      worktreePath: wt,
      projectRepoPath: repo,
    });
    assert.equal(d.resume, true);
    if (d.resume) assert.equal(d.resume_from, 'integrate');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'inferRequeueResume: row 122 — environment failure classified at PR-open → resume from pr-open, ' +
    'not the generic integrate re-entry',
  () => {
    const repo = initRepo();
    const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-2', 'complete')]);
    const root = makeForgeRoot('cyc-pr-open-infer', 'pr-open', {
      failure_mode: 'transient',
      recoverable: true,
      environment: true,
      resume_from: 'pr-open',
      reason: 'DNS resolution failed while pushing/fetching …',
    });
    try {
      addBranch(repo, `forge/${INIT}`, true);

      const d = inferRequeueResume({
        forgeRoot: root,
        cycleId: 'cyc-pr-open-infer',
        initiativeId: INIT,
        worktreePath: wt,
        projectRepoPath: repo,
      });
      assert.equal(d.resume, true);
      // Every WI is complete here too (a PR-open failure implies it), but the
      // classifier's own `resumeFrom:'pr-open'` signal must win over the
      // generic all-WI-complete ⇒ `'integrate'` inference.
      if (d.resume) assert.equal(d.resume_from, 'pr-open');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('inferRequeueResume: terminal failure → no resume even with preserved state', () => {
  const repo = initRepo();
  const wt = makeWorktree([wi('WI-1', 'complete')]);
  const root = makeForgeRoot('cyc-term', 'terminal', { failure_mode: 'terminal', recoverable: false, reason: 'unifier did not pass' });
  try {
    addBranch(repo, `forge/${INIT}`, true);

    const d = inferRequeueResume({
      forgeRoot: root,
      cycleId: 'cyc-term',
      initiativeId: INIT,
      worktreePath: wt,
      projectRepoPath: repo,
    });
    assert.equal(d.resume, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// forge-mfv5.1.61 row 3 — a review failure resumes at the review node
// ---------------------------------------------------------------------------

/** gitweave I4 round 4: terminal, no auto-retry — but every WI complete and the branch green. */
const REVIEW_FAILED = {
  failure_mode: 'terminal', failure_kind: 'terminal', recoverable: false, environment: false, cleanBoundaryHalt: false,
  resume_from: 'review', reason: 'the adversarial-review pipeline failed to produce a findings artifact',
};

test('readPriorFailureSignal: resume_from:"review" in the classification → resumeFrom "review"', () => {
  const root = makeForgeRoot('cyc-review-signal', 'review', REVIEW_FAILED);
  try {
    assert.equal(readPriorFailureSignal(root, 'cyc-review-signal').resumeFrom, 'review');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('inferRequeueResume: review failure + every WI complete + preserved branch → resume_from review (not a fresh re-run)', () => {
  const repo = initRepo();
  const wt = makeWorktree([wi('WI-1', 'complete'), wi('WI-19', 'complete')]);
  const root = makeForgeRoot('cyc-review-infer', 'review', REVIEW_FAILED);
  try {
    addBranch(repo, `forge/${INIT}`, true);
    const d = inferRequeueResume({ forgeRoot: root, cycleId: 'cyc-review-infer', initiativeId: INIT, worktreePath: wt, projectRepoPath: repo });
    assert.equal(d.resume, true, JSON.stringify(d));
    if (d.resume) assert.equal(d.resume_from, 'review');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('decideRequeueResume: review failure but the preserved worktree is gone → fresh re-run, said by name', () => {
  const d = decideRequeueResume({ environmentFailure: false, resumeFromReview: true, worktreePresent: false, branchHasWork: true, workItems: { total: 1, complete: 1 } });
  assert.equal(d.resume, false);
  assert.match(d.reason, /review/);
});

test('decideRequeueResume: review failure with a work item NOT complete → no review resume (the review never judged an unfinished set)', () => {
  const d = decideRequeueResume({ environmentFailure: false, resumeFromReview: true, worktreePresent: true, branchHasWork: true, workItems: { total: 2, complete: 1 } });
  assert.ok(!(d.resume && d.resume_from === 'review'), JSON.stringify(d));
});

test('a manifest stamped resume_from: review round-trips, and the review resume rebases once at entry', () => {
  const base = parseManifest(`---\ninitiative_id: ${INIT}\nproject: fix\ncreated_at: 2026-10-18T00:00:00Z\niteration_budget: 3\ncost_budget_usd: 5\nclass: code\n---\nbody\n`);
  assert.equal(parseManifest(serializeManifest({ ...base, resume_from: 'review' })).resume_from, 'review');
  assert.equal(rebasesAtEntry({ resumeFrom: 'review' }), true);
});

// ---------------------------------------------------------------------------
// forge-mfv5.1.62 row 1 — the classification is derived from the log, never read off the stored record
// ---------------------------------------------------------------------------

/** gitweave I4 log line 7990: the record pre-#1234 code wrote for the review failure — terminal, NO resume_from. */
const I4_PRE_1234_RECORD = {
  cycle_id: 'cyc-i4', failure_mode: 'terminal', failure_kind: 'terminal', recoverable: false, environment: false, cleanBoundaryHalt: false,
  reason: 'the adversarial-review pipeline failed to produce a findings artifact (spawn / scope / budget) — the verdict gate has nothing to render; triage the review-agent failure (see the review.* error events), then re-run',
  evidence_event_ids: ['EV_mvdnqwyj_4zb26hxc'],
};

/** The I4 tail around that record: the review node's budget-exhausted chunk, its failed end, the cycle error, then cycle.end + the drain's round record after it. */
function i4TailEvents(): { before: Array<Record<string, unknown>>; after: Array<Record<string, unknown>> } {
  const base = { initiative_id: INIT, input_refs: [], output_refs: [] };
  const pipelineFailed = 'adversarial review pipeline failed (budget-exhausted: gitweave/apply.py is too large for review: its spawn was terminated by the SDK (error_max_turns). The chunk is a SINGLE file and cannot be split further: gitweave/apply.py. Split the work item, not the budget.) — no findings artifact was produced for the verdict gate. Triage before re-running.';
  return {
    before: [
      { ...base, event_id: 'r1', started_at: '2026-10-18T08:27:37.741Z', phase: 'orchestrator', skill: 'adversarial-review', event_type: 'start' },
      { ...base, event_id: 'r2', started_at: '2026-10-18T10:03:29.754Z', phase: 'orchestrator', skill: 'adversarial-review', event_type: 'error', message: 'review.budget-exhausted', metadata: { agent_slug: 'adversarial-review', result_subtype: 'error_max_turns', attempt: 1, chunk: 'gitweave/apply.py' } },
      { ...base, event_id: 'r3', started_at: '2026-10-18T10:03:29.755Z', phase: 'orchestrator', skill: 'adversarial-review', event_type: 'end', metadata: { node_id: 'adversarial-review', status: 'failed', error: `Error: ${pipelineFailed}` } },
      { ...base, event_id: 'EV_mvdnqwyj_4zb26hxc', started_at: '2026-10-18T10:03:29.755Z', phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: pipelineFailed },
    ],
    after: [
      { ...base, event_id: 'r5', started_at: '2026-10-18T10:03:29.828Z', phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'failed', error: `Error: ${pipelineFailed}` } },
      { ...base, event_id: 'r6', started_at: '2026-10-18T10:03:30.012Z', phase: 'review-loop', skill: 'fix-loop-drain', event_type: 'log', message: 'sendback.loop-completed', metadata: { round: 3, head_sha: '60df6711', cycle_status: 'failed' } },
    ],
  };
}

function makeI4ForgeRoot(cycleId: string): string {
  const root = makeForgeRoot(cycleId, null, null);
  const { before, after } = i4TailEvents();
  const lines = [...before, failureClassificationRecord(INIT, I4_PRE_1234_RECORD, '2026-10-18T10:03:29.821Z'), ...after].map((e) => JSON.stringify(e));
  writeFileSync(join(root, '_logs', cycleId, 'events.jsonl'), lines.join('\n') + '\n', { flag: 'a' });
  return root;
}

test('readPriorFailureSignal: the I4 shape — a pre-#1234 record with NO resume_from — derives resumeFrom "review" with the current classifier', () => {
  const root = makeI4ForgeRoot('cyc-i4');
  try {
    assert.deepEqual(readPriorFailureSignal(root, 'cyc-i4'), { environment: false, cleanBoundaryHalt: false, resumeFrom: 'review' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('inferRequeueResume: the I4 shape (20 WIs, WI-17 superseded by WI-19, record without resume_from) → resume_from review', () => {
  const repo = initRepo();
  const items = Array.from({ length: 20 }, (_, i) => wi(`WI-${i + 1}`, i + 1 === 17 ? 'failed' : 'complete'));
  const wt = makeWorktree(items.map((w) => (/^WI-1[6-9]$/.test(w.work_item_id) ? { ...w, origin: 'review-fix' as const } : w)));
  const root = makeI4ForgeRoot('cyc-i4-infer');
  try {
    addBranch(repo, `forge/${INIT}`, true);
    const d = inferRequeueResume({ forgeRoot: root, cycleId: 'cyc-i4-infer', initiativeId: INIT, worktreePath: wt, projectRepoPath: repo });
    assert.equal(d.resume, true, JSON.stringify(d));
    if (d.resume) assert.equal(d.resume_from, 'review');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('readPriorFailureSignal: a record whose stored fields claim more than its cause is read as its cause (environment:true over a terminal cause → false)', () => {
  const root = makeForgeRoot('cyc-lying-record', 'terminal', { failure_mode: 'transient', recoverable: true, environment: true, cleanBoundaryHalt: true, resume_from: 'pr-open', reason: 'stale' });
  try {
    assert.deepEqual(readPriorFailureSignal(root, 'cyc-lying-record'), { environment: false, cleanBoundaryHalt: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('derivedFailureClassification: a record the current classifier wrote derives identical to itself (every cause)', () => {
  for (const cause of ['environment', 'operator-stop', 'cost-ceiling', 'plan', 'pr-open', 'review', 'terminal'] as const) {
    const events = [{ event_id: 's', initiative_id: INIT, started_at: 't0', phase: 'orchestrator', skill: 'cycle', event_type: 'start', input_refs: [], output_refs: [], message: 'cycle.start' }, ...failureCauseEvents(cause, INIT)];
    const written = classifyCycleFailure(events as never);
    assert.deepEqual(derivedFailureClassification([...events, failureClassificationRecord(INIT, { stale: true })] as never, events.length), written, cause);
  }
});

// ---------------------------------------------------------------------------
// forge-mfv5.1.62 row 2 — a superseded fix WI is resolved, an unsuperseded failed one still blocks
// ---------------------------------------------------------------------------

test('summarizeWorkItemStatuses: 20 WIs, 19 complete, failed fix WI-17 superseded by WI-19 → 19/19 (WI-17 resolved)', () => {
  const items = Array.from({ length: 20 }, (_, i) => wi(`WI-${i + 1}`, i + 1 === 17 ? 'failed' : 'complete'));
  const wt = makeWorktree(items.map((w) => (['WI-17', 'WI-18', 'WI-19'].includes(w.work_item_id) ? { ...w, origin: 'review-fix' as const } : w)));
  try {
    assert.deepEqual(summarizeWorkItemStatuses(wt), { total: 19, complete: 19, superseded: 1 });
    const d = decideRequeueResume({ environmentFailure: false, resumeFromReview: true, worktreePresent: true, branchHasWork: true, workItems: summarizeWorkItemStatuses(wt) });
    assert.equal(d.resume, true, JSON.stringify(d));
    if (d.resume) assert.equal(d.resume_from, 'review');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('summarizeWorkItemStatuses: the same set with WI-17 the NEWEST fix WI (no successor) → 20/19, review resume refused and a fresh re-run as today', () => {
  const items = Array.from({ length: 20 }, (_, i) => wi(`WI-${i + 1}`, i + 1 === 17 ? 'failed' : 'complete'));
  const wt = makeWorktree(items.map((w) => (w.work_item_id === 'WI-17' ? { ...w, origin: 'review-fix' as const } : w)));
  try {
    assert.deepEqual(summarizeWorkItemStatuses(wt), { total: 20, complete: 19, superseded: 0 });
    const d = decideRequeueResume({ environmentFailure: false, resumeFromReview: true, worktreePresent: true, branchHasWork: true, workItems: summarizeWorkItemStatuses(wt) });
    assert.equal(d.resume, false, JSON.stringify(d));
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test('decideRequeueResume: an environment failure with a superseded fix WI resumes at integrate over the unsuperseded set', () => {
  const items = [wi('WI-1', 'complete'), { ...wi('WI-2', 'failed'), origin: 'review-fix' as const }, { ...wi('WI-3', 'complete'), origin: 'review-fix' as const }];
  const wt = makeWorktree(items);
  try {
    const d = decideRequeueResume({ environmentFailure: true, worktreePresent: true, branchHasWork: true, workItems: summarizeWorkItemStatuses(wt) });
    assert.equal(d.resume, true, JSON.stringify(d));
    if (d.resume) assert.equal(d.resume_from, 'integrate');
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});
