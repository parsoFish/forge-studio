/**
 * Tests for `gh-identity.ts` — bead `forge-8vfn.6.11.35`, T1 rulings 341/344.
 *
 * THE INCIDENT (M5-B session 9, S2 run 6): forge's one outward-facing action,
 * `mintRemote`, ran `gh` with NO token pin, so it acted as whatever account
 * happened to be active on the host. The active account was an Enterprise
 * Managed User, and the $0 probe caught the message:
 *
 *   GraphQL: Unauthorized: As an Enterprise Managed User, you cannot access
 *   this content (createRepository)
 *
 * `gh auth status` PASSED throughout — that account IS logged in — and that is
 * the only question the old gate asked, so the failure landed on the create
 * instead of on the check meant to catch it. Every human and agent `gh` command
 * in this campaign is pinned per command (rulings 284/286); this one code path
 * was not.
 *
 * The exec seam is injected in every case below: these tests never read a real
 * keyring and never reach the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ghTokenFor, assertGhOwner, ghRunnerFor } from './gh-identity.ts';

const SECRET = 'gho_the_token_that_must_never_be_logged';

/** A fake `gh` that records every call, so a test can assert on argv AND env. */
function fakeGh(answers: Record<string, string>) {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv; cwd?: string }> = [];
  const exec = (args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    calls.push({ args, env: opts.env, cwd: opts.cwd });
    const key = args.join(' ');
    const answer = answers[key];
    if (answer === undefined) throw new Error(`fake gh: no answer for "${key}"`);
    return answer;
  };
  return { exec, calls };
}

test('6.11.35: assertGhOwner PASSES when the pinned token names the configured owner', () => {
  const { exec, calls } = fakeGh({
    'auth token --user parsoFish': `${SECRET}\n`,
    'api user --jq .login': 'parsoFish\n',
  });
  assertGhOwner('parsoFish', exec);

  // The identity question is asked WITH the pinned token, not with whatever is
  // active — that is the whole point.
  assert.equal(calls[1].env?.['GH_TOKEN'], SECRET, 'the identity probe runs under the pinned token');
});

test('6.11.35: assertGhOwner THROWS naming BOTH accounts when the token names someone else — the incident', () => {
  const { exec } = fakeGh({
    'auth token --user parsoFish': `${SECRET}\n`,
    'api user --jq .login': 'david-parsonson_isuctm\n',
  });
  assert.throws(
    () => assertGhOwner('parsoFish', exec),
    (err: unknown) => {
      const m = err instanceof Error ? err.message : '';
      return m.includes('parsoFish') && m.includes('david-parsonson_isuctm');
    },
    'a mismatch must name the owner it was asked for AND the login it actually got — one without the other is a riddle',
  );
});

test('6.11.35: a missing token for that owner FAILS LOUDLY, and says which owner', () => {
  const { exec } = fakeGh({}); // even `auth token` has no answer
  assert.throws(
    () => ghTokenFor('parsoFish', exec),
    (err: unknown) => err instanceof Error && err.message.includes('parsoFish'),
  );
});

test('6.11.35: an EMPTY token is a missing token — never a silent pin to nothing', () => {
  const { exec } = fakeGh({ 'auth token --user parsoFish': '\n' });
  assert.throws(() => ghTokenFor('parsoFish', exec), /parsoFish/);
});

test('6.11.35: the token NEVER appears in a thrown message', () => {
  const cases: Record<string, string>[] = [
    { 'auth token --user parsoFish': `${SECRET}\n`, 'api user --jq .login': 'someone-else\n' },
    { 'auth token --user parsoFish': `${SECRET}\n` }, // the identity probe itself throws
  ];
  for (const answers of cases) {
    const { exec } = fakeGh(answers);
    try {
      assertGhOwner('parsoFish', exec);
      assert.fail('expected a throw');
    } catch (err) {
      assert.ok(!String((err as Error).message).includes(SECRET), 'a secret in an error message is a secret in a log');
    }
  }
});

test('6.11.35: ghRunnerFor pins the token into the CHILD env only — never the argv, never this process', () => {
  const before = process.env['GH_TOKEN'];
  const { exec, calls } = fakeGh({
    'auth token --user parsoFish': `${SECRET}\n`,
    'repo create parsoFish/story-s2 --private': 'https://github.com/parsoFish/story-s2\n',
  });

  const run = ghRunnerFor('parsoFish', exec);
  const out = run(['repo', 'create', 'parsoFish/story-s2', '--private'], '/w/projects/story-s2');

  assert.equal(out.trim(), 'https://github.com/parsoFish/story-s2');
  const create = calls[1];
  assert.equal(create.env?.['GH_TOKEN'], SECRET, 'the child gets the pinned token');
  assert.equal(create.cwd, '/w/projects/story-s2', 'and the cwd it was given');
  assert.ok(!create.args.join(' ').includes(SECRET), 'a token in argv is a token in `ps`');
  assert.equal(process.env['GH_TOKEN'], before, 'and this process is left exactly as it was found');
});

test('6.11.35: the token is read ONCE per runner, not once per call', () => {
  const { exec, calls } = fakeGh({
    'auth token --user parsoFish': `${SECRET}\n`,
    'repo view a': 'a\n',
    'repo view b': 'b\n',
  });
  const run = ghRunnerFor('parsoFish', exec);
  run(['repo', 'view', 'a']);
  run(['repo', 'view', 'b']);
  assert.equal(calls.filter((c) => c.args[0] === 'auth').length, 1, 'one keyring read, reused — not one per outward call');
});
