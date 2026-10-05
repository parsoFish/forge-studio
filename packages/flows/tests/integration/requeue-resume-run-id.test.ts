/**
 * Row 152 (bead forge-8vfn.8.1.54) — a worker on row 150 suspected that the
 * resume/requeue machinery picks the cycle_id for a resumed attempt by
 * SCANNING `_logs/` for the initiative id and taking the newest (or first)
 * match, rather than reading the exact id of the run that was actually
 * stopped. If true, an initiative with MORE THAN ONE prior run (a fresh
 * re-dispatch after a failed run, then a stop/resume of a LATER one) could
 * have its resume adopt the wrong dispatch dir.
 *
 * INVESTIGATION (this row): grepping `preserveRunId` across the repo finds
 * nothing — that symbol does not exist. The actual mechanism is
 * `runRequeue` (forge-requeue.ts) reading `manifest.cycle_id` straight off
 * the ONE physical manifest file for this initiative id (`readFileSync` +
 * `parseManifest` on whichever queue dir `candidates.find` locates it in),
 * then threading that literal value into `inferRequeueResume` /
 * `readPriorFailureSignal` (requeue-resume.ts), which joins
 * `_logs/<cycleId>/events.jsonl` from THAT id — never from a
 * `readdirSync('_logs').filter(d => d.endsWith('_' + initiativeId))` scan.
 * (That scan DOES exist — `run-model.ts` / `run-list-cache.ts`'s
 * `findNewestCycleId` — but it is a read-only UI-aggregation fallback used
 * ONLY when a manifest carries no `cycle_id` at all, e.g. a legacy manifest;
 * it is never consulted by the requeue/resume/dispatch path.) `cycle_id` is
 * minted once (D-20, `manifest.ts`'s `persistManifestCycleId`) and never
 * re-stamped, round-tripping unchanged through every `parseManifest` /
 * `serializeManifest` pass forge-requeue.ts's own move-to-pending step does.
 *
 * This test PINS that finding rather than changing any code (the worker
 * note's suspicion does not hold): it builds TWO `_logs/` dispatch dirs for
 * the SAME initiative — an OLDER one that is the run actually being resumed,
 * and a NEWER decoy a naive "scan `_logs/` for this initiative id and take
 * the newest" lookup would pick instead — and gives them DIFFERENT failure
 * classifications so the two behave observably differently. The stopped
 * (older) run's classification says "clean-boundary halt, resumable"; the
 * newer decoy says "ordinary terminal failure, no salvage". If resume ever
 * started reading the decoy's classification or persisting the decoy's id,
 * this test fails loudly (wrong resume decision, worktree wiped, or the
 * wrong cycle_id written back to the pending manifest).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from '../../forge-requeue.ts';
import { parseManifest } from '../../manifest.ts';
import { serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { OperatorStopError } from '../../operator-stop.ts';

const INIT = 'INIT-2026-09-20-two-prior-runs';
const BRANCH = `forge/${INIT}`;
// Lexicographically (and chronologically) OLDER — this is the run that was
// actually stopped and must be the one resume continues.
const STOPPED_CYCLE = `2026-09-20T08-00-00_${INIT}`;
// Lexicographically NEWER — a decoy dispatch dir for the SAME initiative id
// that a wrong "pick the newest _logs dir for this initiative" lookup would
// grab instead of the stopped run's own id.
const DECOY_CYCLE = `2026-09-25T08-00-00_${INIT}`;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).toString();
}

/** Mirrors forge-requeue-clean-boundary-halt.test.ts's own `setupForgeRoot`. */
function setupForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'two-prior-runs-root-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(root, '_queue', d), { recursive: true });
  }
  mkdirSync(join(root, '_worktrees'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

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

function writeClassification(
  root: string,
  cycleId: string,
  reason: string,
  environment: boolean,
  cleanBoundaryHalt: boolean,
): void {
  const logDir = join(root, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  const lines = [
    forgeEvent('cycle.start', undefined, '2026-09-20T08:00:00.000Z'),
    forgeEvent(
      'failure_classification',
      { failure_mode: 'terminal', failure_kind: 'terminal', recoverable: false, environment, cleanBoundaryHalt, reason },
      '2026-09-20T08:01:00.000Z',
    ),
  ];
  writeFileSync(join(logDir, 'events.jsonl'), lines.join('\n') + '\n');
}

function manifestFor(projectRepoPath: string, worktreePath: string, cycleId: string): string {
  return `---
initiative_id: ${INIT}
project: testproj
project_repo_path: ${projectRepoPath}
created_at: '2026-09-20T08:00:00.000Z'
iteration_budget: 5
cost_budget_usd: 1.0
class: code
worktree_path: ${worktreePath}
cycle_id: ${cycleId}
retry_count: 0
---

body
`;
}

test(
  'row 152 (bead forge-8vfn.8.1.54): with two prior _logs dirs for the same initiative, ' +
    'resume continues the STOPPED run\'s own cycle id, not the newer decoy dispatch dir',
  () => {
    const root = setupForgeRoot();
    try {
      const repo = initProjectRepo(root);
      const worktree = makeWorktree(root, repo, [wi('WI-1', 'complete')]);

      // The decoy: a NEWER dispatch dir for the SAME initiative id, classified
      // as an ordinary non-resumable terminal failure. A lookup keyed on
      // initiativeId (pick the newest `_logs/*_<init>` dir) would read THIS
      // classification instead of the stopped run's own.
      writeClassification(root, DECOY_CYCLE, 'agent threw a non-rate-limit error', false, false);

      // The actual stopped run: OLDER dispatch dir, a clean-boundary halt
      // (operator-stop) with its one WI already complete — resumable, and
      // (being the only WI) resolves to resume_from: integrate.
      writeClassification(root, STOPPED_CYCLE, new OperatorStopError().message, false, true);

      // The manifest currently sitting in failed/ IS the stopped run: its own
      // cycle_id points at STOPPED_CYCLE, never at the decoy.
      writeFileSync(
        join(root, '_queue', 'failed', `${INIT}.md`),
        manifestFor(repo, worktree, STOPPED_CYCLE),
      );

      const r = runRequeue(INIT, { forgeRoot: root });

      assert.equal(
        r.resumeDecision.resume,
        true,
        'must read the STOPPED run\'s own clean-boundary-halt classification, not the decoy\'s ordinary-failure one',
      );
      if (r.resumeDecision.resume) {
        assert.equal(r.resumeDecision.resume_from, 'integrate', 'the one WI is complete — integrate is correct here');
      }
      assert.equal(r.worktreeRemoved, false, 'a wrongly-picked decoy classification would wipe the worktree — it must not');
      assert.equal(r.branchDeleted, false);
      assert.equal(existsSync(worktree), true);

      const pendingPath = join(root, '_queue', 'pending', `${INIT}.md`);
      const pending = parseManifest(readFileSync(pendingPath, 'utf8'));
      assert.equal(
        (pending as { cycle_id?: string }).cycle_id,
        STOPPED_CYCLE,
        'the resumed manifest must keep the stopped run\'s own cycle id, never the newer decoy dispatch dir',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
