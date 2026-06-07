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
