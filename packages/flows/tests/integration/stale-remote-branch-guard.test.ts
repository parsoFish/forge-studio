/**
 * Unit coverage for `stale-remote-branch-guard.ts` (bead forge-8vfn.8.1.8).
 *
 * `probeRemoteBranch`'s SHA lookup runs real `git ls-remote` against a real
 * local bare repo used as `origin` — no fixture ever needs a GitHub remote.
 * The PR-lookup half is injected (`deps.openPr`) so these tests never shell
 * out to `gh` — see the module's own docstring for why that split is safe:
 * a local bare-repo origin already answers "no PR concept" (`null` owner)
 * without any injection at all; the injection point exists so a test can
 * ALSO exercise the "there IS an open PR" branch without a real GitHub repo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  probeRemoteBranch,
  shouldRefuseFreshAttempt,
  emitStaleRemoteBranchRefused,
  cleanupPushedBranchOnFailure,
} from '../../stale-remote-branch-guard.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real project repo with a real local bare repo wired up as `origin`. */
function setup(): { root: string; repo: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.email', 't@forge']);
  sh(repo, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'base']);

  const origin = join(root, 'origin.git');
  sh(root, ['init', '-q', '--bare', origin]);
  sh(origin, ['config', 'gc.autoDetach', 'false']);
  sh(repo, ['remote', 'add', 'origin', origin]);
  sh(repo, ['push', '-q', 'origin', 'main']);

  return { root, repo, origin };
}

/** Push `branch` (forked off `main`) straight to `origin`, mirroring an
 *  abandoned attempt's own push — WITHOUT leaving a local branch behind, the
 *  exact shape the defect describes ("nothing ever deletes it"). */
function pushAbandonedBranch(repo: string, branch: string): string {
  sh(repo, ['branch', branch, 'main']);
  sh(repo, ['push', '-q', 'origin', branch]);
  const sha = sh(repo, ['rev-parse', branch]).trim();
  sh(repo, ['branch', '-D', branch]);
  return sha;
}

// ---------------------------------------------------------------------------
// probeRemoteBranch / shouldRefuseFreshAttempt
// ---------------------------------------------------------------------------

test('probeRemoteBranch: branch absent on origin → remoteSha null, openPrExists false, never refused', () => {
  const { root, repo } = setup();
  try {
    const probe = probeRemoteBranch(repo, 'forge/INIT-absent');
    assert.equal(probe.remoteSha, null);
    assert.equal(probe.openPrExists, false);
    assert.equal(shouldRefuseFreshAttempt(probe), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('probeRemoteBranch: branch exists on origin, no PR lookup override (local bare origin has no GitHub owner) → refused', () => {
  const { root, repo } = setup();
  try {
    const sha = pushAbandonedBranch(repo, 'forge/INIT-stale');
    const probe = probeRemoteBranch(repo, 'forge/INIT-stale');
    assert.equal(probe.remoteSha, sha);
    // No injected PR lookup — the real default runs, sees a non-GitHub
    // (local path) origin, and answers "no PR concept" without shelling
    // out to `gh` at all.
    assert.equal(probe.openPrExists, false);
    assert.equal(shouldRefuseFreshAttempt(probe), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('probeRemoteBranch: branch exists AND an injected open-PR lookup says OPEN → never refused', () => {
  const { root, repo } = setup();
  try {
    pushAbandonedBranch(repo, 'forge/INIT-open-pr');
    const probe = probeRemoteBranch(repo, 'forge/INIT-open-pr', {
      openPr: () => true, // Inject the PR-lookup so the test needs no `gh`.
    });
    assert.equal(probe.openPrExists, true);
    assert.equal(shouldRefuseFreshAttempt(probe), false, 'an open PR must NEVER be refused, even though the branch exists');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('probeRemoteBranch: an injected open-PR lookup is never even consulted when the branch is absent', () => {
  const { root, repo } = setup();
  try {
    let called = false;
    const probe = probeRemoteBranch(repo, 'forge/INIT-nothing-here', {
      openPr: () => { called = true; return true; },
    });
    assert.equal(probe.remoteSha, null);
    assert.equal(called, false, 'nothing to have a PR against — the lookup must not run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('probeRemoteBranch: no `origin` remote at all → remoteSha null (best-effort, never throws)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-noorigin-'));
  const repo = join(root, 'repo');
  try {
    mkdirSync(repo, { recursive: true });
    sh(repo, ['init', '-q', '-b', 'main']);
    const probe = probeRemoteBranch(repo, 'forge/INIT-whatever');
    assert.equal(probe.remoteSha, null);
    assert.equal(shouldRefuseFreshAttempt(probe), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// emitStaleRemoteBranchRefused — the named event, naming branch + sha
// ---------------------------------------------------------------------------

test('emitStaleRemoteBranchRefused: appends a named JSONL event carrying the branch and its sha', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-forgeroot-'));
  const initiativeId = 'INIT-emit-test';
  try {
    emitStaleRemoteBranchRefused(forgeRoot, initiativeId, 'forge/INIT-emit-test', 'deadbeef1234');
    const logPath = join(forgeRoot, '_logs', initiativeId, 'events.jsonl');
    assert.ok(existsSync(logPath));
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].message, 'stale-remote-branch.refused');
    assert.equal(lines[0].event_type, 'error');
    assert.equal(lines[0].metadata.branch, 'forge/INIT-emit-test');
    assert.equal(lines[0].metadata.sha, 'deadbeef1234');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// cleanupPushedBranchOnFailure
// ---------------------------------------------------------------------------

test('cleanupPushedBranchOnFailure: branch now exists on origin, no open PR → deleted + logged', () => {
  const { root, repo } = setup();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-cleanup-'));
  try {
    const sha = pushAbandonedBranch(repo, 'forge/INIT-cleanup-a');
    cleanupPushedBranchOnFailure({
      projectRepoPath: repo,
      branch: 'forge/INIT-cleanup-a',
      initiativeId: 'INIT-cleanup-a',
      forgeRoot,
    });
    const remaining = sh(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/forge/INIT-cleanup-a']).trim();
    assert.equal(remaining, '', 'the branch must be gone from origin');

    const logPath = join(forgeRoot, '_logs', 'INIT-cleanup-a', 'events.jsonl');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[0].message, 'stale-remote-branch.cleaned-up');
    assert.equal(lines[0].event_type, 'log');
    assert.equal(lines[0].metadata.sha, sha);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('cleanupPushedBranchOnFailure: branch absent on origin → no-op, nothing logged', () => {
  const { root, repo } = setup();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-cleanup-noop-'));
  try {
    cleanupPushedBranchOnFailure({
      projectRepoPath: repo,
      branch: 'forge/INIT-never-pushed',
      initiativeId: 'INIT-never-pushed',
      forgeRoot,
    });
    assert.equal(existsSync(join(forgeRoot, '_logs', 'INIT-never-pushed')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('cleanupPushedBranchOnFailure: an injected open-PR lookup says OPEN → branch is kept, nothing logged', () => {
  const { root, repo } = setup();
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-cleanup-openpr-'));
  try {
    pushAbandonedBranch(repo, 'forge/INIT-cleanup-open-pr');
    cleanupPushedBranchOnFailure({
      projectRepoPath: repo,
      branch: 'forge/INIT-cleanup-open-pr',
      initiativeId: 'INIT-cleanup-open-pr',
      forgeRoot,
      deps: { openPr: () => true },
    });
    const remaining = sh(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/forge/INIT-cleanup-open-pr']).trim();
    assert.notEqual(remaining, '', 'a branch backing an open PR must never be deleted');
    assert.equal(existsSync(join(forgeRoot, '_logs', 'INIT-cleanup-open-pr')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
