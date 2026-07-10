/**
 * Tests for cli/forge-requeue.ts — F2.I3.
 *
 * Validates: manifest moves to pending/, verdicts deleted, worktree
 * removed, retry_count handled per flag, previous_failure_modes appended.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from './forge-requeue.ts';

function setupForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-requeue-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(root, '_queue', d), { recursive: true });
  }
  return root;
}

const MANIFEST = (overrides: { worktreePath?: string } = {}): string => `---
initiative_id: INIT-2026-05-24-rq-test
project: testproj
project_repo_path: /tmp/nonexistent-repo
created_at: '2026-05-24T00:00:00.000Z'
iteration_budget: 5
cost_budget_usd: 1.0
worktree_path: ${overrides.worktreePath ?? '/tmp/nonexistent-worktree'}
retry_count: 2
previous_failure_modes:
  - pm-hidden-coupling
---

body
`;

test('runRequeue: moves manifest from failed/ → pending/ + appends marker', () => {
  const root = setupForgeRoot();
  try {
    const file = 'INIT-2026-05-24-rq-test.md';
    writeFileSync(join(root, '_queue', 'failed', file), MANIFEST());

    const r = runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root });
    assert.equal(r.initiativeId, 'INIT-2026-05-24-rq-test');
    assert.equal(r.fromQueueDir, 'failed');
    assert.equal(r.toQueueDir, 'pending');
    // Manifest moved.
    assert.equal(existsSync(join(root, '_queue', 'failed', file)), false);
    assert.equal(existsSync(join(root, '_queue', 'pending', file)), true);
    // retry_count preserved by default.
    assert.equal(r.retryCountBefore, 2);
    assert.equal(r.retryCountAfter, 2);
    // previous_failure_modes appended with marker.
    assert.ok(r.previousFailureModesAfter.some((m) => m.startsWith('requeued-from-failed-')));
    // pre-existing pm-hidden-coupling still present.
    assert.ok(r.previousFailureModesAfter.includes('pm-hidden-coupling'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue: --reset-retries zeros retry_count', () => {
  const root = setupForgeRoot();
  try {
    writeFileSync(join(root, '_queue', 'failed', 'INIT-2026-05-24-rq-test.md'), MANIFEST());
    const r = runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root, resetRetries: true });
    assert.equal(r.retryCountAfter, 0);
    // serializeManifest omits retry_count when 0 (manifest.ts:181) —
    // the reset is reflected by the field being absent / non-positive.
    const moved = readFileSync(join(root, '_queue', 'pending', 'INIT-2026-05-24-rq-test.md'), 'utf8');
    assert.doesNotMatch(moved, /^retry_count:\s*[1-9]/m, 'retry_count must not show a non-zero value');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue: removes stranded verdict files in every queue dir', () => {
  const root = setupForgeRoot();
  try {
    const file = 'INIT-2026-05-24-rq-test.md';
    writeFileSync(join(root, '_queue', 'ready-for-review', file), MANIFEST());
    writeFileSync(join(root, '_queue', 'ready-for-review', 'INIT-2026-05-24-rq-test.verdict-response.md'), '---\nverdict: approve\n---');
    writeFileSync(join(root, '_queue', 'in-flight', 'INIT-2026-05-24-rq-test.verdict-prompt.md'), 'stale prompt');

    const r = runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root });
    assert.equal(r.verdictsRemoved.length, 2);
    assert.equal(existsSync(join(root, '_queue', 'ready-for-review', 'INIT-2026-05-24-rq-test.verdict-response.md')), false);
    assert.equal(existsSync(join(root, '_queue', 'in-flight', 'INIT-2026-05-24-rq-test.verdict-prompt.md')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue: removes orphan worktree dir if present', () => {
  const root = setupForgeRoot();
  try {
    const file = 'INIT-2026-05-24-rq-test.md';
    writeFileSync(join(root, '_queue', 'failed', file), MANIFEST({ worktreePath: join(root, '_worktrees', 'INIT-2026-05-24-rq-test') }));
    mkdirSync(join(root, '_worktrees', 'INIT-2026-05-24-rq-test'), { recursive: true });
    writeFileSync(join(root, '_worktrees', 'INIT-2026-05-24-rq-test', 'leftover.txt'), 'from a prior cycle');

    const r = runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root });
    assert.equal(r.worktreeRemoved, true);
    assert.equal(existsSync(join(root, '_worktrees', 'INIT-2026-05-24-rq-test')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue --resume-from=unifier: stamps resume_from AND preserves the worktree', () => {
  const root = setupForgeRoot();
  try {
    const file = 'INIT-2026-05-24-rq-test.md';
    const wt = join(root, '_worktrees', 'INIT-2026-05-24-rq-test');
    writeFileSync(join(root, '_queue', 'failed', file), MANIFEST({ worktreePath: wt }));
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, 'wi-work.txt'), 'salvageable per-WI commits live here');

    const r = runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root, resumeFromUnifier: true });

    // ADR 019: worktree is the salvaged work — it must NOT be removed.
    assert.equal(r.worktreeRemoved, false);
    assert.equal(existsSync(wt), true, 'worktree must be preserved on resume-from-unifier');
    // resume_from stamped into the moved manifest.
    const moved = readFileSync(join(root, '_queue', 'pending', file), 'utf8');
    assert.match(moved, /^resume_from:\s*unifier\s*$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue --resume-from=unifier: preserves worktree + branch, stamps resume_from: unifier, clears legacy pr-feedback (ADR 026)', () => {
  const root = setupForgeRoot();
  try {
    const file = 'INIT-2026-05-24-rq-test.md';
    const wt = join(root, '_worktrees', 'INIT-2026-05-24-rq-test');
    writeFileSync(join(root, '_queue', 'failed', file), MANIFEST({ worktreePath: wt }));
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, 'wi-work.txt'), 'salvageable per-WI commits live here');
    // A legacy pr-feedback.md (ADR 026 retired the thread) must now be cleared.
    const feedback = join(root, '_queue', 'failed', 'INIT-2026-05-24-rq-test.pr-feedback.md');
    writeFileSync(feedback, '# Send-back feedback\n\nlegacy file\n');

    const r = runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root, resumeFromUnifier: true });

    // (a) worktree is the salvaged work — it must NOT be removed.
    assert.equal(r.worktreeRemoved, false);
    assert.equal(existsSync(wt), true, 'worktree must be preserved on resume-from-unifier');
    // (b) the forge/<id> branch must NOT be deleted (no project repo here, so
    //     branchDeleted is false regardless — assert the preservation contract).
    assert.equal(r.branchDeleted, false, 'branch must be preserved on resume-from-unifier');
    // (c) the retired pr-feedback.md is cleared — it is no longer read.
    assert.equal(existsSync(feedback), false, 'legacy pr-feedback.md must be cleared');
    // (d) resume_from: unifier stamped into the moved manifest.
    const moved = readFileSync(join(root, '_queue', 'pending', file), 'utf8');
    assert.match(moved, /^resume_from:\s*unifier\s*$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue: throws when manifest is not in any queue dir', () => {
  const root = setupForgeRoot();
  try {
    assert.throws(
      () => runRequeue('INIT-2026-05-24-rq-test', { forgeRoot: root }),
      /no manifest INIT-2026-05-24-rq-test\.md found/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue: throws when initiative ID does not resolve', () => {
  const root = setupForgeRoot();
  try {
    assert.throws(
      () => runRequeue('not-a-real-id', { forgeRoot: root }),
      /no initiative resolves/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ADR 026 retired the `<id>.pr-feedback.md` send-back thread (review feedback is
// now appended UWIs in the worktree). Any requeue — resume or not — clears a
// legacy feedback file, since nothing reads it anymore.
test('runRequeue: a full (non-resume) requeue CLEARS a stamped resume_from (ADR 026)', () => {
  const root = setupForgeRoot();
  try {
    const id = 'INIT-2026-05-24-rq-test';
    // A manifest a send-back stamped with resume_from: unifier.
    const withResume = MANIFEST().replace(/^---$/m, '---\nresume_from: unifier');
    writeFileSync(join(root, '_queue', 'failed', `${id}.md`), withResume);

    runRequeue(id, { forgeRoot: root }); // full re-run, no --resume-from
    const moved = readFileSync(join(root, '_queue', 'pending', `${id}.md`), 'utf8');
    assert.doesNotMatch(moved, /resume_from/, 'a full requeue must clear the resume marker for a true full re-run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue: non-resume requeue REMOVES stale <id>.pr-feedback.md', () => {
  const root = setupForgeRoot();
  try {
    const id = 'INIT-2026-05-24-rq-test';
    writeFileSync(join(root, '_queue', 'failed', `${id}.md`), MANIFEST());
    const feedback = join(root, '_queue', 'failed', `${id}.pr-feedback.md`);
    writeFileSync(feedback, 'stale feedback\n');

    const r = runRequeue(id, { forgeRoot: root });
    assert.equal(existsSync(feedback), false, 'stale pr-feedback.md must be cleared on a non-resume requeue');
    assert.ok(r.verdictsRemoved.includes(feedback));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// N7 (plan 2.9): requeue infers resume position from worktree/branch state.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { serializeWorkItem, type WorkItem } from '../orchestrator/work-item.ts';

const N7_INIT = 'INIT-2026-05-24-rq-test';

function n7Git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Real project repo with main + a forge/<init> branch carrying one commit. */
function n7ProjectRepo(root: string, withBranchCommit: boolean): string {
  const repo = join(root, 'project-repo');
  mkdirSync(repo, { recursive: true });
  n7Git(repo, ['init', '-q', '-b', 'main']);
  n7Git(repo, ['config', 'user.email', 'test@forge.local']);
  n7Git(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), '# fixture\n');
  n7Git(repo, ['add', '.']);
  n7Git(repo, ['commit', '-q', '-m', 'init']);
  n7Git(repo, ['branch', `forge/${N7_INIT}`]);
  if (withBranchCommit) {
    n7Git(repo, ['checkout', '-q', `forge/${N7_INIT}`]);
    writeFileSync(join(repo, 'wi-work.txt'), 'committed WI work\n');
    n7Git(repo, ['add', '.']);
    n7Git(repo, ['commit', '-q', '-m', 'feat: WI-1 work']);
    n7Git(repo, ['checkout', '-q', 'main']);
  }
  return repo;
}

function n7WorkItem(id: string, status: WorkItem['status']): string {
  return serializeWorkItem({
    work_item_id: id,
    initiative_id: N7_INIT,
    status,
    depends_on: [],
    acceptance_criteria: [{ given: 'a fixture', when: 'the WI runs', then: 'the thing exists' }],
    files_in_scope: ['src/x.ts'],
    estimated_iterations: 2,
    body: 'Fixture WI body.',
  });
}

/** Preserved worktree with .forge/work-items status files. */
function n7Worktree(root: string, statuses: Array<WorkItem['status']>): string {
  const wt = join(root, '_worktrees', N7_INIT);
  const wiDir = join(wt, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });
  statuses.forEach((s, i) => {
    writeFileSync(join(wiDir, `WI-${i + 1}.md`), n7WorkItem(`WI-${i + 1}`, s));
  });
  return wt;
}

/** Cycle log with a failure_classification event. */
function n7CycleLog(root: string, cycleId: string, environment: boolean): void {
  const dir = join(root, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const entry = {
    event_id: 'e1',
    initiative_id: N7_INIT,
    started_at: '2026-07-11T00:00:00.000Z',
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message: 'failure_classification',
    metadata: environment
      ? { failure_mode: 'transient', recoverable: true, environment: true, reason: 'rate-limited (environment failure)' }
      : { failure_mode: 'terminal', recoverable: false, environment: false, reason: 'unifier did not pass' },
  };
  writeFileSync(join(dir, 'events.jsonl'), JSON.stringify(entry) + '\n');
}

function n7Manifest(worktreePath: string, projectRepoPath: string, cycleId: string): string {
  return `---
initiative_id: ${N7_INIT}
project: testproj
project_repo_path: ${projectRepoPath}
created_at: '2026-05-24T00:00:00.000Z'
iteration_budget: 5
cost_budget_usd: 1.0
worktree_path: ${worktreePath}
cycle_id: ${cycleId}
---

body
`;
}

test('runRequeue N7: environment failure + preserved branch work + incomplete WIs → preserves worktree/branch, NO resume_from marker', () => {
  const root = setupForgeRoot();
  try {
    const repo = n7ProjectRepo(root, true);
    const wt = n7Worktree(root, ['complete', 'pending']);
    n7CycleLog(root, 'cyc-n7-env', true);
    writeFileSync(join(root, '_queue', 'failed', `${N7_INIT}.md`), n7Manifest(wt, repo, 'cyc-n7-env'));

    const r = runRequeue(N7_INIT, { forgeRoot: root });

    assert.equal(r.resumeDecision.resume, true);
    if (r.resumeDecision.resume) assert.equal(r.resumeDecision.resume_from, null);
    assert.equal(r.worktreeRemoved, false);
    assert.equal(r.branchDeleted, false);
    assert.equal(existsSync(wt), true, 'preserved worktree must survive the requeue');
    // Branch still exists (committed WI work salvaged).
    execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `forge/${N7_INIT}`], { stdio: 'pipe' });
    // No unifier marker — the dev-loop re-runs in place via the preserved work-items.
    const moved = readFileSync(join(root, '_queue', 'pending', `${N7_INIT}.md`), 'utf8');
    assert.doesNotMatch(moved, /^resume_from:/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue N7: environment failure with ALL WIs complete → stamps resume_from: unifier', () => {
  const root = setupForgeRoot();
  try {
    const repo = n7ProjectRepo(root, true);
    const wt = n7Worktree(root, ['complete', 'complete']);
    n7CycleLog(root, 'cyc-n7-env2', true);
    writeFileSync(join(root, '_queue', 'failed', `${N7_INIT}.md`), n7Manifest(wt, repo, 'cyc-n7-env2'));

    const r = runRequeue(N7_INIT, { forgeRoot: root });

    assert.equal(r.resumeDecision.resume, true);
    if (r.resumeDecision.resume) assert.equal(r.resumeDecision.resume_from, 'unifier');
    assert.equal(r.worktreeRemoved, false);
    assert.equal(existsSync(wt), true);
    const moved = readFileSync(join(root, '_queue', 'pending', `${N7_INIT}.md`), 'utf8');
    assert.match(moved, /^resume_from:\s*unifier\s*$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue N7: terminal (non-environment) failure → wipes worktree + branch exactly as before', () => {
  const root = setupForgeRoot();
  try {
    const repo = n7ProjectRepo(root, true);
    const wt = n7Worktree(root, ['complete', 'pending']);
    n7CycleLog(root, 'cyc-n7-term', false);
    writeFileSync(join(root, '_queue', 'failed', `${N7_INIT}.md`), n7Manifest(wt, repo, 'cyc-n7-term'));

    const r = runRequeue(N7_INIT, { forgeRoot: root });

    assert.equal(r.resumeDecision.resume, false);
    assert.equal(r.worktreeRemoved, true);
    assert.equal(existsSync(wt), false, 'terminal failure requeue must wipe the worktree');
    assert.equal(r.branchDeleted, true);
    assert.throws(() =>
      execFileSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `forge/${N7_INIT}`], { stdio: 'pipe' }),
    );
    const moved = readFileSync(join(root, '_queue', 'pending', `${N7_INIT}.md`), 'utf8');
    assert.doesNotMatch(moved, /^resume_from:/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRequeue N7: no cycle log (legacy manifest without cycle_id) → fresh re-run, unchanged behaviour', () => {
  const root = setupForgeRoot();
  try {
    const repo = n7ProjectRepo(root, true);
    const wt = n7Worktree(root, ['pending']);
    // No cycle log; manifest carries a cycle_id pointing nowhere.
    writeFileSync(join(root, '_queue', 'failed', `${N7_INIT}.md`), n7Manifest(wt, repo, 'cyc-missing'));

    const r = runRequeue(N7_INIT, { forgeRoot: root });
    assert.equal(r.resumeDecision.resume, false);
    assert.equal(r.worktreeRemoved, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
