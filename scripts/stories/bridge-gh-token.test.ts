/**
 * Operator ruling 590(i), T1 ruling 632 — the story bridge gets the ONE
 * credential the community refresh needs, and nothing else gets it.
 *
 * WHY THIS EXISTS. S8 beat 4 presses `refresh-community-registry` and asserts
 * `data-refresh-state: "refreshed"`. It has been red for every run of that
 * story, always the same way — `got "refused"` — because `bootOwnBridge`
 * spawned `forge studio` with no `env:` at all, so the bridge inherited a
 * runner environment that carries no `GH_TOKEN`, and
 * `community-refresh-run.ts` refuses rather than degrading to an anonymous
 * best effort. The beat was measuring the runner's environment, not the
 * product.
 *
 * THE GRANT IS BOUNDED, AND THE BOUND IS MEASURABLE. Exactly two lines in the
 * product read `process.env[GH_TOKEN_ENV]` (`community-refresh-run.ts:328` and
 * `:399`), and both feed `fetchAllowedApiUrl` — the one guarded seam, whose
 * origin allowlist is api.github.com / registry.modelcontextprotocol.io /
 * registry.npmjs.org, with `redirect: 'manual'` and a timeout. So what the
 * bridge may newly do outward is READ those three origins.
 *
 * It does NOT newly enable an outward WRITE. `pr.ts`'s merge path runs through
 * `ghForWorktree` → `gh-identity.ts`, which mints its own token from the
 * keyring and passes it in a child env; it never reads `process.env.GH_TOKEN`,
 * so it could already do that before this change and is unaffected by it.
 *
 * THE FOUR PROPERTIES, one test each (632):
 *   (a) the BRIDGE child's env carries the token — proven through a real
 *       `spawn` using the real options object, not by reading the source;
 *   (b) a spawned AGENT's env does NOT — `AGENT_ENV_ALLOWLIST` is the seam,
 *       and `buildChildEnv` is asserted to strip it even when the parent has it;
 *   (c) the token appears in no argv, no log line and no thrown message;
 *   (d) with no token available the bridge STILL boots, and the refusal stays
 *       honest — S8's ground precondition survives, it is just no longer the
 *       default.
 *
 * RUN: node --experimental-strip-types --test scripts/stories/bridge-gh-token.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { bridgeSpawnOptions, bridgeGhToken, STORY_BRIDGE_GH_USER } from './bridge.mjs';
import { buildChildEnv, AGENT_ENV_ALLOWLIST } from '../../packages/kernel/spawn-env.ts';

const SECRET = 'gho_TESTTOKEN_never_real_0123456789';

test('(a) the BRIDGE child env carries GH_TOKEN — proven by a real spawn with the real options', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => SECRET });

  // The real options object, handed to a real child. A test that only read
  // `opts.env` would pass for an options bag `bootOwnBridge` never passes on.
  const printed = execFileSync(
    process.execPath,
    ['-e', 'process.stdout.write(String(process.env.GH_TOKEN ?? "<absent>"))'],
    { env: opts.env as NodeJS.ProcessEnv, encoding: 'utf8' },
  );

  assert.equal(printed, SECRET, 'the bridge process is the one process that is meant to have it');
});

test('(a2) the rest of the environment survives — PATH reaches the child, or the bridge cannot boot at all', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => SECRET });
  assert.equal((opts.env as NodeJS.ProcessEnv)['PATH'], process.env['PATH']);
  assert.equal(opts.detached, true, 'unchanged: the boot timeout kills the whole process group');
});

test('(b) a spawned AGENT never sees it — the allowlist has no GH_TOKEN and buildChildEnv strips it', () => {
  assert.equal(
    AGENT_ENV_ALLOWLIST.includes('GH_TOKEN'),
    false,
    'GH_TOKEN on the agent allowlist would hand every spawned agent a GitHub credential',
  );

  // The parent now HAS the token — which is the whole point of this change, and
  // therefore the exact condition under which the agent seam has to hold.
  const child = buildChildEnv({ PATH: '/usr/bin', HOME: '/home/x', GH_TOKEN: SECRET });

  assert.equal(child['GH_TOKEN'], undefined, 'the agent seam must strip it even when the parent carries it');
  assert.equal(child['PATH'], '/usr/bin', 'and must still carry what an agent genuinely needs');
});

test('(c) the token is in the ENV and nowhere else — not argv, not the command, not a log line', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => SECRET });

  const argvText = JSON.stringify({ command: opts.command, args: opts.args });
  assert.equal(argvText.includes(SECRET), false, 'argv is world-readable in /proc — a token there is a leak');

  // Everything this module would ever print about the boot, in one string.
  assert.equal(opts.note.includes(SECRET), false, 'the boot note is logged; it must never carry the value');
  assert.match(opts.note, /GH_TOKEN/, 'it should still SAY whether the bridge got one — silence is not honesty');
});

test('(c2) a failing token read throws nothing and leaks nothing — it reports absence', () => {
  const boom = () => {
    throw new Error(`gh: bad credentials for ${SECRET}`);
  };
  // `gh` can echo credential state into its own error text, so the reader must
  // not let that error escape — not into a log, not into a thrown message.
  const token = bridgeGhToken({ exec: boom });
  assert.equal(token, null, 'an unreadable credential is ABSENT, never a partial or a throw');
});

test('(d) with no token available the bridge still boots, and the refusal stays honest', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => null });

  assert.equal('GH_TOKEN' in (opts.env as NodeJS.ProcessEnv), false, 'absent, never an empty string — "" is a credential that fails at GitHub rather than at the door');
  assert.match(opts.note, /no GH_TOKEN/i, 'the run must say the refresh will refuse, so a red beat 4 is read correctly');
});

test('the identity is the one #611 pinned, and it is named rather than implied', () => {
  assert.equal(STORY_BRIDGE_GH_USER, 'parsoFish');
});
