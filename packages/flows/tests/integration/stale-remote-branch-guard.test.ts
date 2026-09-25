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
 * TRI-STATE (row 93 fail-closed): every scenario below asserts a `status`,
 * never a boolean/null shorthand — the whole point of this reopen is that
 * "couldn't tell" and "confirmed absent" must never collapse into the same
 * value again.
 *
 * The refusal event, the delete, and the cleanup event this probe feeds are
 * all owned by `scheduler-run-one.ts` now (bead forge-8vfn.8.1.8 consolidation
 * pass) — covered end-to-end by `scheduler-run-one.stale-remote-branch.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('probeRemoteBranch: branch absent on origin → status absent, never refused', () => {
  const { root, repo } = setup();
  try {
    const probe = probeRemoteBranch(repo, 'forge/INIT-absent');
    assert.deepEqual(probe, { status: 'absent' });
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
    // No injected PR lookup — the real default runs, sees a non-GitHub
    // (local path) origin — a genuine, LOCAL, no-network fact — and answers
    // `none` without shelling out to `gh` at all.
    assert.deepEqual(probe, { status: 'present', sha, openPr: 'none' });
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
      openPr: () => ({ status: 'open' }), // Inject the PR-lookup so the test needs no `gh`.
    });
    assert.equal(probe.status, 'present');
    assert.equal((probe as { openPr: string }).openPr, 'open');
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
      openPr: () => { called = true; return { status: 'open' }; },
    });
    assert.deepEqual(probe, { status: 'absent' });
    assert.equal(called, false, 'nothing to have a PR against — the lookup must not run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (f, unit half): the open-PR lookup itself failing (gh unreachable, not
// authenticated, rate-limited …) must read as UNKNOWN, never as "no PR" — the
// exact defect this reopen closes for the PR half of the probe.
// ---------------------------------------------------------------------------

test('probeRemoteBranch: branch present + an injected open-PR lookup FAILS → status unknown, lookup openPr, never refused as confirmed-stale', () => {
  const { root, repo } = setup();
  try {
    const sha = pushAbandonedBranch(repo, 'forge/INIT-gh-down');
    const probe = probeRemoteBranch(repo, 'forge/INIT-gh-down', {
      openPr: () => ({ status: 'unknown', reason: 'gh: HTTP 502 (api.github.com)' }),
    });
    assert.deepEqual(probe, { status: 'unknown', lookup: 'openPr', reason: 'gh: HTTP 502 (api.github.com)' });
    // Never the confirmed-stale decision — the caller must route this through
    // its own separate, retryable `probe-failed` refusal instead.
    assert.equal(shouldRefuseFreshAttempt(probe), false);
    void sha;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d, unit half) + row 93 fail-closed: a real git exec failure (DNS outage,
// unreadable remote, no origin at all) is UNKNOWN, never ABSENT. Simulated
// locally by revoking read access to the bare origin — no network involved,
// same exec-failure shape as a DNS outage from `probeRemoteBranch`'s POV.
// ---------------------------------------------------------------------------

test('probeRemoteBranch: origin unreadable (git exec failure) → status unknown, lookup remoteBranchSha, never absent', () => {
  const { root, repo, origin } = setup();
  try {
    chmodSync(origin, 0o000);
    const probe = probeRemoteBranch(repo, 'forge/INIT-unreadable');
    assert.equal(probe.status, 'unknown');
    assert.equal((probe as { lookup: string }).lookup, 'remoteBranchSha');
    assert.ok((probe as { reason: string }).reason.length > 0, 'the exec failure text is carried, never swallowed');
    assert.equal(shouldRefuseFreshAttempt(probe), false);
  } finally {
    chmodSync(origin, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test('probeRemoteBranch: no `origin` remote at all → status unknown (an exec failure, not a determined absence)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-stale-branch-guard-noorigin-'));
  const repo = join(root, 'repo');
  try {
    mkdirSync(repo, { recursive: true });
    sh(repo, ['init', '-q', '-b', 'main']);
    const probe = probeRemoteBranch(repo, 'forge/INIT-whatever');
    assert.equal(probe.status, 'unknown');
    assert.equal((probe as { lookup: string }).lookup, 'remoteBranchSha');
    assert.equal(shouldRefuseFreshAttempt(probe), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
