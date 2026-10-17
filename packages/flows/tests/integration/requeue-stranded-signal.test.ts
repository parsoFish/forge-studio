/**
 * forge-mfv5.1.54 (P1, D-06) — a Requeue after a boot STRANDED classification
 * resumes; it never infers a fresh re-run off a log that carries no
 * `failure_classification` row.
 *
 * Measured shape (capstone I4, 2026-10-17 05:09:27Z): a stop flag POSTed, then
 * serve SIGKILLed mid WI-13; the .47 boot classifier parked the manifest in
 * failed/ with `recovery.stranded-classified {stale-heartbeat, stop_flag:true}`
 * and wrote no `failure_classification`, so `readPriorFailureSignalFromLog`
 * returned the all-false signal and `inferRequeueResume` answered "fresh re-run"
 * — a Requeue would `branch -D` + `push --delete` WI-1..12. `I4_STRANDED_ROW`
 * below is that event copied verbatim from the I4 cycle log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inferRequeueResume, readPriorFailureSignalFromLog, strandedFailureClassification } from '../../requeue-resume.ts';
import { serializeWorkItem, type WorkItem } from '../../work-item.ts';

const I4 = 'INIT-2026-10-17-i4-modules-overlays';
const CYCLE = `2026-10-17T02-17-04_${I4}`;
const I4_STRANDED_ROW = '{"event_id":"EV_mvbxsx38_9yg2j6jw","cycle_id":"2026-10-17T02-17-04_INIT-2026-10-17-i4-modules-overlays","started_at":"2026-10-17T05:09:27.044Z","initiative_id":"INIT-2026-10-17-i4-modules-overlays","phase":"orchestrator","skill":"scheduler","event_type":"error","input_refs":["/home/parso/forge/_queue/failed/INIT-2026-10-17-i4-modules-overlays.md"],"output_refs":[],"message":"recovery.stranded-classified","metadata":{"reason":"stale-heartbeat","stop_flag":true,"heartbeat_age_ms":3021543.233154297,"resume_from":null,"last_event":{"message":"usage_delta","phase":"developer-loop","at":"2026-10-17T04:19:08.620Z"},"queue_state":"failed","needs":"operator"}}';

const row = (message: string, metadata: Record<string, unknown>): string =>
  JSON.stringify({ initiative_id: I4, phase: 'orchestrator', skill: 'cycle', event_type: 'log', message, metadata });
const TERMINAL = row('failure_classification', { failure_kind: 'terminal', recoverable: false, environment: false, cleanBoundaryHalt: false, reason: 'gate red' });
const stranded = (reason: string, stopFlag: boolean): string => row('recovery.stranded-classified', { reason, stop_flag: stopFlag, queue_state: 'failed', needs: 'operator' });

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' });
}

/** A forge root holding I4's shape: a 16-WI preserved worktree (12 complete) and a branch with committed WI work. */
function i4Root(logLines: string[]): { root: string; wt: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-requeue-stranded-'));
  const repo = join(root, 'projects', 'gitweave');
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'base']);
  git(repo, ['branch', `forge/${I4}`]);
  git(repo, ['checkout', '-q', `forge/${I4}`]);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'Merge WI-12']);
  git(repo, ['checkout', '-q', 'main']);
  const wt = join(root, '_worktrees', I4);
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  for (let i = 1; i <= 16; i++) {
    const wi: WorkItem = {
      work_item_id: `WI-${i}`, initiative_id: I4, status: i <= 12 ? 'complete' : 'pending', depends_on: [],
      acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }], files_in_scope: ['src/x.py'], estimated_iterations: 2, body: 'b',
    };
    writeFileSync(join(wt, '.forge', 'work-items', `WI-${i}.md`), serializeWorkItem(wi));
  }
  mkdirSync(join(root, '_logs', CYCLE), { recursive: true });
  writeFileSync(join(root, '_logs', CYCLE, 'events.jsonl'), logLines.join('\n') + '\n');
  return { root, wt, repo };
}

const logOf = (root: string): string => join(root, '_logs', CYCLE, 'events.jsonl');

test('I4: the verbatim stranded row (stop_flag) reads as a clean-boundary halt, and the Requeue inference RESUMES with the worktree kept', () => {
  const f = i4Root([TERMINAL, I4_STRANDED_ROW]);
  try {
    assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: false, cleanBoundaryHalt: true });
    const d = inferRequeueResume({ forgeRoot: f.root, cycleId: CYCLE, initiativeId: I4, worktreePath: f.wt, projectRepoPath: f.repo });
    assert.equal(d.resume, true, `must resume, got: ${d.reason}`);
    if (d.resume) assert.equal(d.resume_from, null, '12/16 complete → preserve in place, dev-loop re-runs');
    assert.match(d.reason, /clean-boundary halt with 12\/16 WIs complete/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a stranded run killed WITHOUT a stop flag (stale-heartbeat / missing-worktree) is environment-class — resumable', () => {
  for (const reason of ['stale-heartbeat', 'missing-worktree']) {
    const f = i4Root([stranded(reason, false)]);
    try {
      assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: true, cleanBoundaryHalt: false }, reason);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('control: a genuine code failure (terminal classification, no strand) still infers a fresh re-run', () => {
  const f = i4Root([TERMINAL]);
  try {
    assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: false, cleanBoundaryHalt: false });
    const d = inferRequeueResume({ forgeRoot: f.root, cycleId: CYCLE, initiativeId: I4, worktreePath: f.wt, projectRepoPath: f.repo });
    assert.equal(d.resume, false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the LATEST signal wins: a terminal classification written after a strand (a later attempt) is read, not the strand', () => {
  const f = i4Root([I4_STRANDED_ROW, TERMINAL]);
  try {
    assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: false, cleanBoundaryHalt: false });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('an unrecognised stranded reason yields NO resume signal (§6.15: never a safe-looking default)', () => {
  const f = i4Root([stranded('something-new', false)]);
  try {
    assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: false, cleanBoundaryHalt: false });
    assert.equal(strandedFailureClassification({ reason: 'something-new', stopFlag: false }), null);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('one contract: the classification a strand maps to is the reader\'s own failure_classification shape, never auto-retryable', () => {
  const c = strandedFailureClassification({ reason: 'stale-heartbeat', stopFlag: true });
  assert.ok(c);
  assert.equal(c.environment, false);
  assert.equal(c.cleanBoundaryHalt, true);
  assert.equal(c.recoverable, false, 'a boot never re-dispatches (D-06) — the operator Requeues');
  assert.equal(c.failure_kind, 'terminal');
  assert.match(String(c.reason), /stale-heartbeat/);
  const f = i4Root([row('failure_classification', c)]);
  try {
    assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: false, cleanBoundaryHalt: true });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a strand of a run that was itself a narrow pr-open re-entry keeps resume_from pr-open — the post-develop band is not re-run', () => {
  const f = i4Root([row('failure_classification', { environment: true, resume_from: 'pr-open' }), row('recovery.stranded-classified', { reason: 'stale-heartbeat', stop_flag: false, resume_from: 'pr-open' })]);
  try {
    assert.deepEqual(readPriorFailureSignalFromLog(logOf(f.root)), { environment: true, cleanBoundaryHalt: false, resumeFrom: 'pr-open' });
    assert.equal(strandedFailureClassification({ reason: 'stale-heartbeat', stopFlag: false, resumeFrom: 'develop' })?.resume_from, undefined, 'only the narrow markers pass through');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
