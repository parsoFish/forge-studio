/**
 * `openPullRequest` — bead `forge-8vfn.8.1.24` / T1 ruling 1609.
 *
 * THE DEFECT (verified from a live run). At the PR-open step a DNS outage made
 * `gh api user --jq .login` fail with "error connecting to api.github.com".
 * `openPullRequest`'s outer catch wrote that stderr to `process.stderr` ONLY,
 * then returned a bare `null` — the cause never reached the event log, and
 * every early-return path (`return null`) was equally opaque.
 *
 * These tests assert the fixed contract: `openPullRequest` NEVER returns a
 * bare null — it returns `{ url }` or `{ error }`, and `{ error }` carries the
 * real git/gh diagnostic text.
 *
 * Origin is a GitHub-shaped URL (so `githubOwnerRepoForWorktree` resolves an
 * owner and the pinned `gh` seam engages exactly as production does) with its
 * PUSH transport rewritten via `git config url.<bare>.pushInsteadOf
 * <github-url>` to a local bare repo — deliberately `pushInsteadOf`, not the
 * plain `insteadOf` `stale-remote-branch-guard.gh-no-pr-is-none.test.ts` uses
 * for its SHA-injected scenario: a plain `insteadOf` also rewrites what `git
 * remote get-url origin` reports (proven while writing this file — the fetch
 * form is rewritten too), which would make `githubOwnerRepoForWorktree` see
 * the local bare path instead of the github.com URL and refuse to pin `gh` at
 * all. `pushInsteadOf` rewrites ONLY the push transport, so `git push` never
 * touches the network while `git remote get-url origin` (what `gh-pinned.ts`
 * reads) still reports the real github.com URL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __resetGhRunnerCache } from '../../gh-pinned.ts';
import { openPullRequest } from '../../pr.ts';

const OWNER = 'parsoFish';
const GITHUB_URL = `https://github.com/${OWNER}/forge-test.git`;
const INIT = 'INIT-dns-test';
const BRANCH = `forge/${INIT}`;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/**
 * A real repo whose `origin` presents as `https://github.com/...` (so owner
 * resolution + the `gh` pin engage) but whose transport is rewritten to a
 * local bare repo (so `git push` never dials out). One commit on `main`,
 * checked out on `forge/<INIT>` with an extra commit, plus a tracked demo
 * bundle so `assertTrackedDemoExists` passes and execution reaches the
 * push/gh steps under test.
 */
function setup(): { root: string; proj: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-openpr-'));
  const proj = join(root, 'proj');
  mkdirSync(proj, { recursive: true });
  sh(proj, ['init', '-q', '-b', 'main']);
  sh(proj, ['config', 'user.email', 't@forge']);
  sh(proj, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(proj, 'README.md'), 'base\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'base']);

  const bareOrigin = join(root, 'origin.git');
  sh(proj, ['init', '-q', '--bare', bareOrigin]);
  sh(proj, ['remote', 'add', 'origin', GITHUB_URL]);
  sh(proj, ['config', `url.${bareOrigin}.pushInsteadOf`, GITHUB_URL]);
  sh(proj, ['push', '-q', 'origin', 'main']);

  sh(proj, ['checkout', '-q', '-b', BRANCH]);
  mkdirSync(join(proj, 'demo', INIT), { recursive: true });
  writeFileSync(join(proj, 'demo', INIT, 'demo.json'), JSON.stringify({ title: 't' }));
  writeFileSync(join(proj, 'feature.txt'), 'work\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'feat: work']);

  return { root, proj };
}

/** A `gh` PATH-shim that answers the identity handshake `assertGhOwner` makes
 *  (`gh auth token --user <owner>` then `gh api user --jq .login`), failing
 *  the SECOND step with gh's own verbatim connect-failure text — the exact
 *  shape a DNS/network outage produces (mirrors
 *  stale-remote-branch-guard.gh-no-pr-is-none.test.ts's real-gh shim). */
function withDnsOutageGhShim(root: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'gh');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'auth' && a[1] === 'token') { console.log('gho_test_token'); process.exit(0); }
if (a[0] === 'api' && a[1] === 'user') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
process.stderr.write('unsupported: ' + a.join(' ') + '\\n');
process.exit(1);
`,
  );
  chmodSync(shim, 0o755);
  return binDir;
}

/** A fully-answering `gh` shim: identity handshake, no existing PR, and a
 *  successful `pr create`. Models the healthy path so the discriminated
 *  result's success arm is also exercised (not just the failure arm). */
function withHealthyGhShim(root: string, prUrl: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'gh');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'auth' && a[1] === 'token') { console.log('gho_test_token'); process.exit(0); }
if (a[0] === 'api' && a[1] === 'user') { console.log(${JSON.stringify(OWNER)}); process.exit(0); }
if (a[0] === 'repo' && a[1] === 'view') { console.log('false'); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'view') { process.stderr.write('no pull requests found\\n'); process.exit(1); }
if (a[0] === 'pr' && a[1] === 'create') { console.log(${JSON.stringify(prUrl)}); process.exit(0); }
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

test('openPullRequest: a DNS outage at `gh api user` returns { error } naming the real cause — never a bare null', () => {
  const { root, proj } = setup();
  try {
    __resetGhRunnerCache();
    const binDir = withDnsOutageGhShim(root);
    const result = withPath(binDir, () =>
      openPullRequest(proj, join(proj, '.forge', 'pr-description.md'), 'forge: test'),
    );
    assert.ok('error' in result, `expected { error }, got ${JSON.stringify(result)}`);
    assert.match((result as { error: string }).error, /error connecting to api\.github\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('openPullRequest: the healthy path returns { url } (discriminated success arm)', () => {
  const { root, proj } = setup();
  try {
    __resetGhRunnerCache();
    const prUrl = `https://github.com/${OWNER}/forge-test/pull/1`;
    const binDir = withHealthyGhShim(root, prUrl);
    const result = withPath(binDir, () =>
      openPullRequest(proj, join(proj, '.forge', 'pr-description.md'), 'forge: test'),
    );
    assert.deepEqual(result, { url: prUrl });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('openPullRequest: HEAD detached (no branch) returns a named { error }, not null', () => {
  const { root, proj } = setup();
  try {
    sh(proj, ['checkout', '-q', '--detach']);
    const result = openPullRequest(proj, join(proj, '.forge', 'pr-description.md'), 'forge: test');
    assert.ok('error' in result, `expected { error }, got ${JSON.stringify(result)}`);
    assert.match((result as { error: string }).error, /no branch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
