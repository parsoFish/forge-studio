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
 *
 * The refusal event, the delete, and the cleanup event this probe feeds are
 * all owned by `scheduler-run-one.ts` now (bead forge-8vfn.8.1.8 consolidation
 * pass) — covered end-to-end by `scheduler-run-one.stale-remote-branch.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { probeRemoteBranch, shouldRefuseFreshAttempt } from '../../stale-remote-branch-guard.ts';

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
