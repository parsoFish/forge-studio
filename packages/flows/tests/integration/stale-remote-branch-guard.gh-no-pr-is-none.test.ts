/**
 * Bead `forge-8vfn.8.1.12` — `defaultOpenPrLookup` (`stale-remote-branch-guard.ts`)
 * mapped ANY `gh pr view` failure to UNKNOWN, including the one failure shape
 * that is a DETERMINATE answer: `gh` exits 1 with stderr `no pull requests
 * found for branch "<branch>"` when there is simply no PR. #947's tests only
 * ever injected `deps.openPr` directly, so this real `gh` failure shape was
 * never exercised end to end — the exact gap the campaign rule (a guard's
 * test must exercise the real tool's failure shapes) exists to catch.
 *
 * These tests run the REAL default open-PR lookup — no `deps.openPr`
 * injection — via a stub `gh` executable placed first on `PATH` (same
 * PATH-shim pattern as `pr.test.ts`'s `withGhShim`), so the actual
 * `execFileSync('gh', …)` code path in `gh-pinned.ts` is exercised, including
 * the identity pin (`gh auth token` + `gh api user`) every real call goes
 * through first.
 *
 * `probeRemoteBranch`'s SHA half is INJECTED here (`deps.remoteBranchSha`) —
 * it is not this defect's concern (it is covered end to end, against a REAL
 * local bare origin, in `scheduler-run-one.stale-remote-branch.test.ts`'s new
 * (b-real-gh) case) and injecting it means `origin` needs no real transport
 * at all: `git remote get-url origin` is a pure local config read, so a
 * plain, never-dialled `https://github.com/…` URL is enough for
 * `githubOwnerRepoForWorktree` to resolve a real owner and reach the real
 * `gh pr view` call below. No network, no real GitHub, ever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __resetGhRunnerCache } from '../../gh-pinned.ts';
import { probeRemoteBranch, type RemoteBranchShaLookup } from '../../stale-remote-branch-guard.ts';

const GITHUB_URL = 'https://github.com/parsoFish/forge-test.git';
const OWNER = 'parsoFish';
const FAKE_SHA = 'a'.repeat(40);
const BRANCH = 'forge/INIT-gh-shape';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A minimal repo whose `origin` is a github.com-shaped URL that is NEVER
 *  dialled: `probeRemoteBranch`'s SHA half is injected below, and
 *  `githubOwnerRepoForWorktree` only ever runs `git remote get-url origin` —
 *  a local config read, no network. */
function setup(): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-stale-branch-gh-shape-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['remote', 'add', 'origin', GITHUB_URL]);
  return { root, repo };
}

const presentLookup: RemoteBranchShaLookup = () => ({ status: 'present', sha: FAKE_SHA });

/** A stub `gh` on `PATH`: answers the identity handshake every real call goes
 *  through (`gh auth token --user <owner>`, `gh api user --jq .login`) and
 *  then the `pr view` scenario under test — the exact `gh` failure/success
 *  shapes named in the defect, verbatim. */
function withGhShim(root: string, prViewBody: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'gh');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'auth' && a[1] === 'token') { console.log('gho_test_token'); process.exit(0); }
if (a[0] === 'api' && a[1] === 'user') { console.log(${JSON.stringify(OWNER)}); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'view') {
${prViewBody}
}
process.stderr.write('unsupported: ' + a.join(' ') + '\\n');
process.exit(1);
`,
  );
  chmodSync(shim, 0o755);
  return binDir;
}

function withPath<T>(binDir: string, fn: () => T): T {
  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

// ---------------------------------------------------------------------------
// (1) gh's exact "no pull requests found" shape → a DETERMINATE none, never
// unknown.
// ---------------------------------------------------------------------------

test('defaultOpenPrLookup via real gh: "no pull requests found for branch" (exit 1) → NONE, not unknown', () => {
  const { root, repo } = setup();
  try {
    __resetGhRunnerCache();
    const binDir = withGhShim(
      root,
      `process.stderr.write('no pull requests found for branch "${BRANCH}"\\n'); process.exit(1);`,
    );
    const probe = withPath(binDir, () => probeRemoteBranch(repo, BRANCH, { remoteBranchSha: presentLookup }));
    assert.deepEqual(probe, { status: 'present', sha: FAKE_SHA, openPr: 'none' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (2) a successful run printing OPEN → open.
// ---------------------------------------------------------------------------

test('defaultOpenPrLookup via real gh: state OPEN (exit 0) → open', () => {
  const { root, repo } = setup();
  try {
    __resetGhRunnerCache();
    const binDir = withGhShim(root, `console.log('OPEN'); process.exit(0);`);
    const probe = withPath(binDir, () => probeRemoteBranch(repo, BRANCH, { remoteBranchSha: presentLookup }));
    assert.deepEqual(probe, { status: 'present', sha: FAKE_SHA, openPr: 'open' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (3) any other real state (MERGED/CLOSED) → none, unchanged from #947.
// ---------------------------------------------------------------------------

test('defaultOpenPrLookup via real gh: state MERGED (exit 0) → none (kept mapping)', () => {
  const { root, repo } = setup();
  try {
    __resetGhRunnerCache();
    const binDir = withGhShim(root, `console.log('MERGED'); process.exit(0);`);
    const probe = withPath(binDir, () => probeRemoteBranch(repo, BRANCH, { remoteBranchSha: presentLookup }));
    assert.deepEqual(probe, { status: 'present', sha: FAKE_SHA, openPr: 'none' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (4) a network failure must still read unknown — never none.
// ---------------------------------------------------------------------------

test('defaultOpenPrLookup via real gh: "error connecting to api.github.com" (exit 1) → unknown, never none', () => {
  const { root, repo } = setup();
  try {
    __resetGhRunnerCache();
    const binDir = withGhShim(
      root,
      `process.stderr.write('error connecting to api.github.com\\n'); process.exit(1);`,
    );
    const probe = withPath(binDir, () => probeRemoteBranch(repo, BRANCH, { remoteBranchSha: presentLookup }));
    assert.equal(probe.status, 'unknown');
    assert.equal((probe as { lookup: string }).lookup, 'openPr');
    assert.match((probe as { reason: string }).reason, /error connecting to api\.github\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (5) an auth failure must still read unknown — never none.
// ---------------------------------------------------------------------------

test('defaultOpenPrLookup via real gh: "HTTP 401: Bad credentials" (exit 1) → unknown, never none', () => {
  const { root, repo } = setup();
  try {
    __resetGhRunnerCache();
    const binDir = withGhShim(
      root,
      `process.stderr.write('HTTP 401: Bad credentials\\n'); process.exit(1);`,
    );
    const probe = withPath(binDir, () => probeRemoteBranch(repo, BRANCH, { remoteBranchSha: presentLookup }));
    assert.equal(probe.status, 'unknown');
    assert.equal((probe as { lookup: string }).lookup, 'openPr');
    assert.match((probe as { reason: string }).reason, /HTTP 401: Bad credentials/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
