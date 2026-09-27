/**
 * M7 row 150 addendum (bead `forge-8vfn.8.1.39`, ruling 1794) — resume after
 * a clean-boundary halt (operator-stop OR cost-ceiling) must continue from
 * the LAST FINISHED WI, not skip straight to `integrate`.
 *
 * `POST /api/runs/:id/resume` calls `runRequeue(id, { resumeFromIntegrate:
 * true })` unconditionally (`RunControls.tsx`'s "Resume" button, and the
 * CLI's `--resume-from=integrate` flag). Before this addendum that ALWAYS
 * stamped `resume_from: integrate`, which the dev-loop node reads as "every
 * WI is already done, dispatch none of them" (`developer-loop.ts`:
 * `toRun = resumeFromIntegrate ? [] : ordered`). A stop mid-dev-loop with
 * some WIs never dispatched would therefore have Resume silently skip them.
 *
 * These three tests exercise `runRequeue` itself — the exact call
 * `POST /api/runs/:id/resume` makes — against a REAL git branch (one
 * committed WI, mirroring `requeue-resume.test.ts`'s own fixture style) and
 * a REAL `_logs/<cycleId>/events.jsonl` carrying the classification
 * `emitFailureClassification` (cycle.ts) actually stamps for each halt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from '../../forge-requeue.ts';
import { serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { OperatorStopError } from '../../operator-stop.ts';

const INIT = 'INIT-2026-09-27-clean-boundary-halt';
const CYCLE = '2026-09-27T00-00-00_INIT-2026-09-27-clean-boundary-halt';
const BRANCH = `forge/${INIT}`;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).toString();
}

/**
 * A forge root laid out exactly like a real one: `_queue/*`, `_worktrees/`,
 * `projects/` all present, so `assertManifestPathFields`'s SEC-02 containment
 * check (both `project_repo_path` and `worktree_path` must resolve UNDER one
 * of these) holds — the same requirement `forge-requeue.test.ts`'s own
 * `setupForgeRoot` exists to satisfy.
 */
function setupForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clean-halt-root-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(root, '_queue', d), { recursive: true });
  }
  mkdirSync(join(root, '_worktrees'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

/** A project repo, CONTAINED under `<root>/projects/testproj`, whose
 *  `forge/<init>` branch carries ONE committed WI (WI-1 "done"; WI-2 never
 *  dispatched, no commit for it). */
function initProjectRepo(root: string): string {
  const dir = join(root, 'projects', 'testproj');
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@forge.local']);
  git(dir, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  git(dir, ['branch', BRANCH]);
  git(dir, ['checkout', '-q', BRANCH]);
  writeFileSync(join(dir, 'wi-1-work.txt'), 'WI-1 committed work\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'feat: WI-1 work']);
  git(dir, ['checkout', '-q', 'main']);
  return dir;
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

/** The preserved worktree, CONTAINED under `<root>/_worktrees/<init>`
 *  (the identity-bound path `manifest-path-guard.ts` accepts) — checked out
 *  on BRANCH, with `.forge/work-items/` status files for both WIs (whatever
 *  `items` says their status is). */
function makeWorktree(root: string, repo: string, items: WorkItem[]): string {
  const dir = join(root, '_worktrees', INIT);
  git(repo, ['worktree', 'add', '-q', dir, BRANCH]);
  const wiDir = join(dir, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });
  for (const item of items) {
    writeFileSync(join(wiDir, `${item.work_item_id}.md`), serializeWorkItem(item));
  }
  return dir;
}

function forgeEvent(message: string, metadata: Record<string, unknown> | undefined, ts: string) {
  return JSON.stringify({
    event_id: `e-${message}-${ts}`,
    initiative_id: INIT,
    started_at: ts,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message,
    ...(metadata ? { metadata } : {}),
  });
}

/** Write `_logs/<CYCLE>/events.jsonl` under an already-set-up `root`, carrying
 *  the `failure_classification` event `emitFailureClassification` (cycle.ts)
 *  would have stamped for the given halt — `cleanBoundaryHalt` is the
 *  STRUCTURED field `readPriorFailureSignal` reads (round 3); `reason` is
 *  free-text kept realistic but never parsed by production code. */
function writeClassification(
  root: string,
  reason: string,
  environment: boolean,
  cleanBoundaryHalt: boolean,
): void {
  const logDir = join(root, '_logs', CYCLE);
  mkdirSync(logDir, { recursive: true });
  const lines = [
    forgeEvent('cycle.start', undefined, '2026-09-27T00:00:00.000Z'),
    forgeEvent(
      'failure_classification',
      {
        failure_mode: 'terminal',
        failure_kind: 'terminal',
        recoverable: false,
        environment,
        cleanBoundaryHalt,
        reason,
      },
      '2026-09-27T00:01:00.000Z',
    ),
  ];
  writeFileSync(join(logDir, 'events.jsonl'), lines.join('\n') + '\n');
}

function manifestFor(projectRepoPath: string, worktreePath: string): string {
  return `---
initiative_id: ${INIT}
project: testproj
project_repo_path: ${projectRepoPath}
created_at: '2026-09-27T00:00:00.000Z'
iteration_budget: 5
cost_budget_usd: 1.0
class: code
worktree_path: ${worktreePath}
cycle_id: ${CYCLE}
retry_count: 0
---

body
`;
}

test(
  'row 150 (ruling 1794): an OPERATOR-STOP halt with 1/2 WIs complete resumes the ' +
    'incomplete WI — no resume_from:integrate, worktree+branch preserved',
  () => {
  const root = setupForgeRoot();
  try {
    const repo = initProjectRepo(root);
    const worktree = makeWorktree(root, repo, [wi('WI-1', 'complete'), wi('WI-2', 'pending')]);
    writeClassification(root, new OperatorStopError().message, false, true);
    writeFileSync(join(root, '_queue', 'failed', `${INIT}.md`), manifestFor(repo, worktree));

    const r = runRequeue(INIT, { forgeRoot: root, resumeFromIntegrate: true });

    assert.equal(r.resumeDecision.resume, true, 'a clean-boundary halt with salvageable work must resume');
    if (r.resumeDecision.resume) {
      assert.equal(
        r.resumeDecision.resume_from,
        null,
        'WIs are NOT all complete — must NOT jump to integrate (that would skip WI-2)',
      );
    }
    assert.equal(r.worktreeRemoved, false, 'the worktree must be preserved, not wiped');
    assert.equal(r.branchDeleted, false, 'the branch must be preserved, not deleted');
    assert.equal(existsSync(worktree), true, 'the worktree directory itself must still be on disk');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'row 150 (ruling 1794): a COST-CEILING halt with 1/2 WIs complete resumes the ' +
    'incomplete WI — no resume_from:integrate, worktree+branch preserved',
  () => {
  const root = setupForgeRoot();
  try {
    const repo = initProjectRepo(root);
    const worktree = makeWorktree(root, repo, [wi('WI-1', 'complete'), wi('WI-2', 'pending')]);
    const costCeilingReason =
      'cost ceiling reached — cost-ceiling: flow spent $10.00 which meets or exceeds the $5.00 ceiling.';
    writeClassification(root, costCeilingReason, false, true);
    writeFileSync(join(root, '_queue', 'failed', `${INIT}.md`), manifestFor(repo, worktree));

    const r = runRequeue(INIT, { forgeRoot: root, resumeFromIntegrate: true });

    assert.equal(r.resumeDecision.resume, true, 'a clean-boundary halt with salvageable work must resume');
    if (r.resumeDecision.resume) {
      assert.equal(
        r.resumeDecision.resume_from,
        null,
        'WIs are NOT all complete — must NOT jump to integrate (that would skip WI-2)',
      );
    }
    assert.equal(r.worktreeRemoved, false, 'the worktree must be preserved, not wiped');
    assert.equal(r.branchDeleted, false, 'the branch must be preserved, not deleted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'row 150 (ruling 1794): a clean-boundary halt with ALL WIs complete still resumes from ' +
    'integrate',
  () => {
  const root = setupForgeRoot();
  try {
    const repo = initProjectRepo(root);
    const worktree = makeWorktree(root, repo, [wi('WI-1', 'complete')]);
    writeClassification(root, new OperatorStopError().message, false, true);
    writeFileSync(join(root, '_queue', 'failed', `${INIT}.md`), manifestFor(repo, worktree));

    const r = runRequeue(INIT, { forgeRoot: root, resumeFromIntegrate: true });

    assert.equal(r.resumeDecision.resume, true);
    if (r.resumeDecision.resume) {
      assert.equal(r.resumeDecision.resume_from, 'integrate', 'all WIs complete — integrate is correct here');
    }
    assert.equal(r.worktreeRemoved, false);
    assert.equal(r.branchDeleted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'row 150 (ruling 1794) CONTROL: an ORDINARY crash still gets the unconditional operator ' +
    'override — resume_from:integrate regardless of WI completion',
  () => {
  const root = setupForgeRoot();
  try {
    const repo = initProjectRepo(root);
    // Only WI-1 is committed, but WI-2 is declared "pending" — an ordinary
    // crash (not a clean-boundary halt) keeps TODAY'S behaviour: the
    // operator's own --resume-from=integrate override is honoured
    // unconditionally.
    const worktree = makeWorktree(root, repo, [wi('WI-1', 'complete'), wi('WI-2', 'pending')]);
    writeClassification(root, 'agent threw a non-rate-limit error', false, false);
    writeFileSync(join(root, '_queue', 'failed', `${INIT}.md`), manifestFor(repo, worktree));

    const r = runRequeue(INIT, { forgeRoot: root, resumeFromIntegrate: true });

    assert.equal(r.resumeDecision.resume, true);
    if (r.resumeDecision.resume) {
      assert.equal(
        r.resumeDecision.resume_from,
        'integrate',
        'unchanged pre-1794 behaviour for a non-clean-boundary failure',
      );
      assert.equal(r.resumeDecision.reason, 'operator-requested --resume-from=integrate');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
