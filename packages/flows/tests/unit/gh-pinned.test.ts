/**
 * Bead `forge-8vfn.7.6.15` / operator ruling 597(a) — every outward `gh` call
 * acts as a NAMED identity, or does not happen.
 *
 * THE HOLE THESE CLOSE. `mergePullRequest` ran `gh pr merge --merge` with `cwd`
 * and no `env`, so `gh` resolved its own credential — `GH_TOKEN`/`GITHUB_TOKEN`
 * if set, otherwise **the active account in `~/.config/gh/hosts.yml`**. Nothing
 * set either, so the bridge merged as whatever account happened to be active on
 * the host. That is the 2026-07-16 incident's mechanism, and the fix for this
 * exact class already existed one package down (`kernel/gh-identity.ts`, bead
 * `6.11.35`) with repo creation as its only caller.
 *
 * NO NETWORK AND NO KEYRING IN ANY TEST. Every case injects both the `git` read
 * and the `gh` exec, so nothing here reads a real token or reaches GitHub.
 *
 * The four door tests are the ones ruling 597(a) asked for by name, and each is
 * written to fail LOUDLY on the pre-fix behaviour rather than quietly pass:
 * three of them assert on what was NOT run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { githubOwnerForWorktree, ghForWorktree, __resetGhRunnerCache } from '../../gh-pinned.ts';

const WT = '/home/parso/forge-m6-d';
const TOKEN = 'gho_TOTALLY_SECRET_VALUE_do_not_leak';

/** A stub pair: the `git remote get-url` answer, and a recorder for `gh`. */
function stubs(remoteUrl: string, opts: { login?: string; tokenFor?: Record<string, string> } = {}) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  const tokenFor = opts.tokenFor ?? { parsoFish: TOKEN };
  const gh = (args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv }): string => {
    calls.push({ args, env: o.env });
    if (args[0] === 'auth' && args[1] === 'token') {
      const user = args[args.indexOf('--user') + 1];
      const t = tokenFor[user];
      if (t === undefined) throw new Error(`no token for ${user}`);
      return `${t}\n`;
    }
    if (args[0] === 'api' && args[1] === 'user') return `${opts.login ?? 'parsoFish'}\n`;
    return 'OK\n';
  };
  const git = (_args: string[]): string => remoteUrl;
  return { calls, gh, git };
}

test('githubOwnerForWorktree reads the owner off an https remote', () => {
  const { git } = stubs('https://github.com/parsoFish/forge-studio.git\n');
  assert.equal(githubOwnerForWorktree(WT, 'origin', git), 'parsoFish');
});

test('githubOwnerForWorktree reads the owner off an ssh remote', () => {
  const { git } = stubs('git@github.com:parsoFish/forge-studio.git\n');
  assert.equal(githubOwnerForWorktree(WT, 'origin', git), 'parsoFish');
});

test('githubOwnerForWorktree returns null for a remote that is NOT GitHub — an owner is not guessed from another host', () => {
  const { git } = stubs('git@gitlab.com:someone/thing.git\n');
  assert.equal(githubOwnerForWorktree(WT, 'origin', git), null);
});

test('githubOwnerForWorktree returns null when there is no remote at all', () => {
  const git = (): string => { throw new Error("fatal: No such remote 'origin'"); };
  assert.equal(githubOwnerForWorktree(WT, 'origin', git), null);
});

// ---------------------------------------------------------------------------
// The four door tests ruling 597(a) names
// ---------------------------------------------------------------------------

test('DOOR 1: an identity that cannot act as the named owner is REFUSED, and nothing outward is attempted', () => {
  __resetGhRunnerCache();
  // The host is logged in — as somebody else. This is the 6.11.35 shape: an
  // Enterprise Managed User whose `gh auth status` passes the whole time.
  const { calls, gh, git } = stubs('https://github.com/parsoFish/forge-studio.git\n', {
    login: 'david-parsonson_isuctm',
    tokenFor: { parsoFish: TOKEN },
  });

  assert.throws(
    () => ghForWorktree(WT, { remote: 'origin', git, gh })(['pr', 'merge', '--merge']),
    (err: Error) => {
      assert.match(err.message, /parsoFish/, 'the refusal must name the owner forge is configured to act as');
      assert.match(err.message, /david-parsonson_isuctm/, 'and the login the token actually carries');
      return true;
    },
  );

  const outward = calls.filter((c) => c.args[0] === 'pr' || c.args[0] === 'run' || c.args[0] === 'workflow');
  assert.deepEqual(outward, [], 'NOTHING outward may be attempted once the identity check fails');
});

test('DOOR 2: the named owner\'s token is put in the CHILD ENV, never in argv', () => {
  __resetGhRunnerCache();
  const { calls, gh, git } = stubs('https://github.com/parsoFish/forge-studio.git\n');

  ghForWorktree(WT, { remote: 'origin', git, gh })(['pr', 'merge', '--merge'], WT);

  const merge = calls.find((c) => c.args[0] === 'pr' && c.args[1] === 'merge');
  assert.ok(merge, 'the merge must actually run once the identity is confirmed');
  assert.equal(merge.env?.['GH_TOKEN'], TOKEN, 'the pinned token must reach the child env');
  assert.equal(
    merge.args.some((a) => a.includes(TOKEN)),
    false,
    'the token must never be in argv — `ps` shows argv to every user on the host',
  );
});

test('DOOR 3: the token never appears in a thrown message', () => {
  __resetGhRunnerCache();
  const { gh, git } = stubs('https://github.com/parsoFish/forge-studio.git\n', {
    login: 'someone-else',
    tokenFor: { parsoFish: TOKEN },
  });

  try {
    ghForWorktree(WT, { remote: 'origin', git, gh })(['pr', 'merge', '--merge']);
    assert.fail('expected a refusal');
  } catch (err) {
    assert.ok(!String((err as Error).message).includes(TOKEN), 'a secret in an error message is a secret in a log');
    assert.ok(!String((err as Error).stack ?? '').includes(TOKEN));
  }
});

test('DOOR 4: a remote that is not GitHub refuses BY NAME rather than guessing an owner', () => {
  __resetGhRunnerCache();
  const { calls, gh, git } = stubs('git@gitlab.com:someone/thing.git\n');

  assert.throws(
    () => ghForWorktree(WT, { remote: 'origin', git, gh })(['pr', 'view']),
    /not a GitHub remote|no GitHub owner/i,
  );
  assert.deepEqual(calls, [], 'not even the keyring should be touched for a remote forge cannot act on');
});

test('the runner is built ONCE per worktree — the keyring and the identity check are not re-run per call', () => {
  __resetGhRunnerCache();
  const { calls, gh, git } = stubs('https://github.com/parsoFish/forge-studio.git\n');

  const run = ghForWorktree(WT, { remote: 'origin', git, gh });
  run(['pr', 'view']);
  run(['pr', 'view']);
  run(['run', 'list']);

  assert.equal(calls.filter((c) => c.args[0] === 'auth').length, 1, 'the keyring is read once per runner (gh-identity.ts\'s own rule)');
  assert.equal(calls.filter((c) => c.args[0] === 'api').length, 1, 'the identity is confirmed once, not per poll — pr-ci-watch polls');
});

test('githubOwnerForWorktree falls back to the ONLY remote when there is no `origin` — forge\'s own checkout names its remote `parsoFish`', () => {
  const asked: string[][] = [];
  const git = (args: string[]): string => {
    asked.push(args);
    const verb = args.slice(2).join(' ');
    if (verb === 'remote get-url origin') throw new Error("error: No such remote 'origin'");
    if (verb === 'remote') return 'parsoFish\n';
    if (verb === 'remote get-url parsoFish') return 'https://github.com/parsoFish/forge-studio.git\n';
    throw new Error(`unexpected: ${verb}`);
  };

  assert.equal(githubOwnerForWorktree(WT, 'origin', git), 'parsoFish');
});

test('githubOwnerForWorktree does NOT pick when there are SEVERAL remotes — one remote is unambiguous, two is a guess', () => {
  const git = (args: string[]): string => {
    const verb = args.slice(2).join(' ');
    if (verb === 'remote get-url origin') throw new Error("error: No such remote 'origin'");
    if (verb === 'remote') return 'upstream\nfork\n';
    throw new Error(`unexpected: ${verb}`);
  };

  assert.equal(githubOwnerForWorktree(WT, 'origin', git), null);
});
