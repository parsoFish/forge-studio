/**
 * Bead `forge-8vfn.8.1.12` — the same `runOne` (b) shape as
 * `scheduler-run-one.stale-remote-branch.test.ts` (a fresh attempt that
 * pushes `forge/<INIT>` itself, then fails), but driven by the REAL default
 * `openPr` lookup — no `deps.openPr` injection anywhere in this file,
 * `probeRemoteBranch` always runs with defaults — hitting a REAL stub `gh`
 * on `PATH` that answers gh's own exact "no pull requests found" shape.
 *
 * Pre-fix, `defaultOpenPrLookup` (`stale-remote-branch-guard.ts`) mapped that
 * failure to UNKNOWN — indistinguishable from a network outage or a bad
 * credential — so cleanup emitted `stale-remote-branch.cleanup-failed` and
 * left the pushed branch on origin forever. This is the live S10 run 28
 * shape verbatim: `Command failed: gh pr view forge/INIT-… --json state -q
 * .state\nno pull requests found for branch "forge/INIT-…"\n`.
 *
 * Split into its own file (rather than added to
 * `scheduler-run-one.stale-remote-branch.test.ts`) to stay under the
 * 800-line file cap — every fixture below is a deliberate duplicate of that
 * file's own helpers, the established pattern across this package's test
 * suite (see `pr.test.ts` vs this package's other integration tests, each
 * with its own `sh()`/setup rather than a shared import).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { runOne } from '../../scheduler-run-one.ts';
import { __resetGhRunnerCache } from '../../gh-pinned.ts';
import { getPaths, type QueuePaths } from '../../queue.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import type { SchedulerConfig } from '../../scheduler.ts';
import type { NotifyConfig } from '../../notify.ts';

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real project repo with a real local bare repo wired up as `origin` —
 *  identical fixture shape to `scheduler-run-one.stale-remote-branch.test.ts`. */
function setupProject(): { root: string; repo: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-runone-stale-branch-ghshape-'));
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

function remoteHeadSha(repo: string, branch: string): string | null {
  const out = sh(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim();
  return out ? out.split(/\s+/, 1)[0] : null;
}

function setupQueue(queueRoot: string): QueuePaths {
  const paths = getPaths(queueRoot);
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
    mkdirSync(p, { recursive: true });
  }
  return paths;
}

function writeManifest(paths: QueuePaths, initiativeId: string, projectRepoPath: string): string {
  const content = `---
initiative_id: ${initiativeId}
project: stale-branch-guard-gh-shape-fixture
project_repo_path: ${projectRepoPath}
created_at: 2026-09-26T00:00:00Z
iteration_budget: 5
cost_budget_usd: 5
class: code
phase: in-flight
flow_id: forge-develop
---

# ${initiativeId}
`;
  const p = join(paths.inFlight, `${initiativeId}.md`);
  writeFileSync(p, content);
  return p;
}

function makeCfg(
  queueRoot: string,
  worktreesRoot: string,
  logsRoot: string,
): Required<Omit<SchedulerConfig, 'notify'>> & { notify: NotifyConfig; logsRoot: string } {
  return {
    queueRoot,
    worktreesRoot,
    maxConcurrentInitiatives: 2,
    heartbeatIntervalMs: 60_000,
    staleHeartbeatMs: 5 * 60_000,
    pollIntervalMs: 5_000,
    recoverIntervalMs: 5 * 60_000,
    notify: { desktop: false, webhook_url: null },
    logsRoot,
  };
}

/** A `PhaseWiring` whose 'dev' node performs a REAL push to origin (mirroring
 *  the dev-loop's own per-WI publish) and then fails the cycle. */
function makePushThenFailWiring(worktreePath: string, branch: string): PhaseWiring {
  return {
    executor: {
      run: async (nodeId: string) => {
        if (nodeId === 'dev') {
          execFileSync('git', ['push', '--set-upstream', 'origin', branch], {
            cwd: worktreePath,
            stdio: 'pipe',
          });
        }
        throw new Error(`test-stub-fails-after-push:${nodeId}`);
      },
    },
    projectGate: { runPreflight: () => { throw new Error('unreachable'); } } as unknown as PhaseWiring['projectGate'],
    runClosure: async () => { throw new Error('unreachable'); },
    runReflector: async () => { throw new Error('unreachable'); },
  };
}

function withSkipContractCheck<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.FORGE_SKIP_CONTRACT_CHECK;
  process.env.FORGE_SKIP_CONTRACT_CHECK = '1';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.FORGE_SKIP_CONTRACT_CHECK;
    else process.env.FORGE_SKIP_CONTRACT_CHECK = prev;
  });
}

/** A stub `gh` on `PATH`: answers the identity handshake every real
 *  `ghForWorktree` call goes through (`gh auth token --user <owner>`,
 *  `gh api user --jq .login`) and then the `pr view` scenario under test —
 *  gh's own exact failure/success shapes, verbatim (same shape as
 *  `pr.test.ts`'s `withGhShim`). */
function withGhShim(root: string, prViewBody: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'gh');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === 'auth' && a[1] === 'token') { console.log('gho_test_token'); process.exit(0); }
if (a[0] === 'api' && a[1] === 'user') { console.log('parsoFish'); process.exit(0); }
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

/**
 * Repoint `origin` at a github.com-shaped SSH URL while a `core.sshCommand`
 * wrapper transparently redirects every real SSH dial back to the SAME local
 * bare repo `setupProject` already built — no network, no real GitHub, but
 * `githubOwnerRepoForWorktree` (a pure `git remote get-url` read) genuinely
 * resolves a real owner, so the guard's real `gh pr view` call is reached
 * instead of short-circuiting on "not a GitHub remote".
 *
 * Least invasive alternative to `url.<local>.insteadOf`: verified against
 * git 2.43, `git remote get-url` itself EXPANDS `insteadOf` rewrites, which
 * would make the derived owner disappear along with the local-path swap —
 * `core.sshCommand` only intercepts the actual network dial, so `get-url`
 * still reports the configured GitHub URL untouched.
 */
function pointOriginAtGithubViaFakeSsh(root: string, repo: string, originPath: string): void {
  const fakeSsh = join(root, 'fakessh.sh');
  writeFileSync(
    fakeSsh,
    `#!/bin/sh
# args: <user@host> <remote-command-string> — the "simple" ssh variant git
# assumes for an unrecognised GIT_SSH_COMMAND. Ignore the host entirely and
# run the requested git service against the real local bare repo.
shift
cmd="$1"
case "$cmd" in
  git-upload-pack*) exec git-upload-pack '${originPath}' ;;
  git-receive-pack*) exec git-receive-pack '${originPath}' ;;
  *) echo "fakessh: unsupported command: $cmd" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(fakeSsh, 0o755);
  sh(repo, ['config', 'core.sshCommand', fakeSsh]);
  sh(repo, ['remote', 'set-url', 'origin', 'ssh://git@github.com/parsoFish/forge-test.git']);
}

/** `fn` is `async` here (it wraps `runOne`) — the PATH swap MUST stay in
 *  place until the returned promise settles, not just until `fn()` returns a
 *  pending promise, or the stub `gh` this exists to install is gone from
 *  PATH before `runOne`'s own internals ever get to shell out to it. */
async function withPath<T>(binDir: string, fn: () => Promise<T> | T): Promise<T> {
  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

test('runOne (b-real-gh): a fresh attempt pushes forge/<INIT>, then fails, and a REAL gh reports "no pull requests found" → the branch is still deleted (a determinate NONE, not unknown)', async () => {
  await withSkipContractCheck(async () => {
    const { root, repo, origin } = setupProject();
    const initiativeId = `INIT-8vfn8112-${randomUUID()}`;
    try {
      const queueRoot = join(root, '_queue');
      const worktreesRoot = join(root, '_worktrees');
      const paths = setupQueue(queueRoot);
      const branch = `forge/${initiativeId}`;
      const manifestPath = writeManifest(paths, initiativeId, repo);

      pointOriginAtGithubViaFakeSsh(root, repo, origin);
      __resetGhRunnerCache();
      const binDir = withGhShim(
        root,
        `process.stderr.write('no pull requests found for branch "${branch}"\\n'); process.exit(1);`,
      );

      const expectedWtPath = join(worktreesRoot, initiativeId);
      const wiring = makePushThenFailWiring(expectedWtPath, branch);

      assert.equal(remoteHeadSha(repo, branch), null, 'precondition: nothing pushed yet');

      await withPath(binDir, () =>
        runOne(manifestPath, `${initiativeId}.md`, makeCfg(queueRoot, worktreesRoot, join(root, '_logs')), undefined, wiring),
      );

      assert.ok(existsSync(join(paths.failed, `${initiativeId}.md`)), 'manifest must land in failed/');
      assert.equal(
        remoteHeadSha(repo, branch),
        null,
        'the branch THIS attempt pushed must be deleted from origin — gh\'s "no pull requests found" is a determinate NONE',
      );

      const logPath = join(root, '_logs', initiativeId, 'events.jsonl');
      const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(
        events.some((e) => e.message === 'stale-remote-branch.cleaned-up' && e.metadata.branch === branch),
        `expected a stale-remote-branch.cleaned-up event, got: ${JSON.stringify(events)}`,
      );
      assert.ok(
        !events.some((e) => e.message === 'stale-remote-branch.cleanup-failed'),
        `a determinate "no PR" must never be read as unknown; got: ${JSON.stringify(events)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
