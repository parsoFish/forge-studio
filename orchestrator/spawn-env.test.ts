/**
 * Tests for orchestrator/spawn-env.ts — the R5-02 F1 allowlist that replaces
 * the old denylist scrub (`pinnedAgentEnv`, removed). See spawn-env.ts's own
 * header for the design rationale and pinned-sdk-query.ts for the seam that
 * consumes `buildChildEnv`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AGENT_ENV_ALLOWLIST, MAX_ENV_OVERRIDE_KEYS, buildChildEnv } from './spawn-env.ts';

test('AGENT_ENV_ALLOWLIST: does not include ANTHROPIC_BASE_URL or any HEADROOM_* var (the recurring G8 leak)', () => {
  assert.ok(!AGENT_ENV_ALLOWLIST.includes('ANTHROPIC_BASE_URL'), 'ANTHROPIC_BASE_URL must never be inheritable');
  assert.ok(
    AGENT_ENV_ALLOWLIST.every((name) => !name.startsWith('HEADROOM_')),
    'no HEADROOM_* var may be in the allowlist',
  );
});

test('AGENT_ENV_ALLOWLIST: includes PATH and HOME (hard SDK-spawn requirements)', () => {
  // Node's child_process.spawn resolves a bare command name (the SDK spawns
  // `node`/`bun`) using the CHILD env's own PATH, not the parent process's —
  // omit PATH here and every agent spawn fails outright, across all 5 launch
  // paths. HOME locates ~/.claude (CLAUDE_CONFIG_DIR ?? homedir()/.claude).
  assert.ok(AGENT_ENV_ALLOWLIST.includes('PATH'));
  assert.ok(AGENT_ENV_ALLOWLIST.includes('HOME'));
});

test('AGENT_ENV_ALLOWLIST: includes ANTHROPIC_API_KEY (the one auth var forge documents as required)', () => {
  assert.ok(AGENT_ENV_ALLOWLIST.includes('ANTHROPIC_API_KEY'));
});

test('buildChildEnv: F1 AC — a polluted parent env (ANTHROPIC_BASE_URL + a canary var) produces a child receiving NEITHER', () => {
  const pollutedParent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/operator',
    ANTHROPIC_API_KEY: 'sk-real-key',
    ANTHROPIC_BASE_URL: 'https://evil.example.com',
    FORGE_TEST_CANARY_XYZ: 'leak-me-if-you-can',
    HEADROOM_PROXY_URL: 'http://127.0.0.1:8787',
    HEADROOM_ENABLED: 'true',
  };

  const child = buildChildEnv(pollutedParent);

  assert.equal(child.ANTHROPIC_BASE_URL, undefined, 'ANTHROPIC_BASE_URL must be stripped at the seam');
  assert.equal(child.FORGE_TEST_CANARY_XYZ, undefined, 'an arbitrary unlisted ambient var must be stripped too');
  assert.equal(child.HEADROOM_PROXY_URL, undefined, 'HEADROOM_* must be stripped');
  assert.equal(child.HEADROOM_ENABLED, undefined, 'HEADROOM_* must be stripped');

  assert.equal(child.PATH, '/usr/bin:/bin', 'allowlisted PATH passes through');
  assert.equal(child.HOME, '/home/operator', 'allowlisted HOME passes through');
  assert.equal(child.ANTHROPIC_API_KEY, 'sk-real-key', 'the one documented auth var passes through');
});

test('buildChildEnv: overrides always win, even for keys outside the allowlist (the git-identity SDK overlay)', () => {
  const parent: NodeJS.ProcessEnv = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://evil.example.com' };
  const child = buildChildEnv(parent, {
    GIT_AUTHOR_NAME: 'forge-ralph',
    GIT_AUTHOR_EMAIL: 'forge-ralph+WI-7@forge.local',
    GIT_COMMITTER_NAME: 'forge-ralph',
    GIT_COMMITTER_EMAIL: 'forge-ralph+WI-7@forge.local',
  });
  assert.equal(child.GIT_AUTHOR_NAME, 'forge-ralph', 'a deliberate override passes through even though GIT_* is not allowlisted');
  assert.equal(child.GIT_AUTHOR_EMAIL, 'forge-ralph+WI-7@forge.local');
  assert.equal(child.PATH, '/usr/bin', 'allowlisted ambient vars still pass through alongside overrides');
  assert.equal(child.ANTHROPIC_BASE_URL, undefined, 'overrides do not reopen the ambient-env strip for unrelated keys');
});

test('buildChildEnv: an override cannot be used to smuggle back a non-allowlisted key from an unrelated source by accident — only keys the caller explicitly names in overrides pass', () => {
  const parent: NodeJS.ProcessEnv = { ANTHROPIC_CUSTOM_HEADERS: 'X-Injected: 1' };
  const child = buildChildEnv(parent, { GIT_AUTHOR_NAME: 'forge-unifier' });
  assert.equal(child.ANTHROPIC_CUSTOM_HEADERS, undefined, 'a var absent from BOTH the allowlist and overrides never reaches the child');
});

test('buildChildEnv: default overrides to {} when omitted — pure allowlist-filtered ambient env', () => {
  const parent: NodeJS.ProcessEnv = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://evil.example.com' };
  const child = buildChildEnv(parent);
  assert.equal(child.PATH, '/usr/bin');
  assert.equal(child.ANTHROPIC_BASE_URL, undefined);
});

test('buildChildEnv: never mutates parentEnv or overrides (immutability)', () => {
  const parent: NodeJS.ProcessEnv = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://evil.example.com' };
  const parentSnapshot = { ...parent };
  const overrides: NodeJS.ProcessEnv = { GIT_AUTHOR_NAME: 'forge-ralph' };
  const overridesSnapshot = { ...overrides };

  buildChildEnv(parent, overrides);

  assert.deepEqual(parent, parentSnapshot, 'parentEnv must be untouched');
  assert.deepEqual(overrides, overridesSnapshot, 'overrides must be untouched');
});

test('buildChildEnv: returns a new object identity, never the parentEnv reference', () => {
  const parent: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
  const child = buildChildEnv(parent);
  assert.notEqual(child, parent);
});

test('buildChildEnv: an undefined-valued key in parentEnv or overrides is treated as absent, not written as literal "undefined"', () => {
  const parent: NodeJS.ProcessEnv = { PATH: undefined };
  const child = buildChildEnv(parent, { GIT_AUTHOR_NAME: undefined });
  assert.equal('PATH' in child, false);
  assert.equal('GIT_AUTHOR_NAME' in child, false);
});

// FIX 5 (R5-02): overrides is meant for a SMALL deliberate delta (the 4-key
// git-identity overlay is the only production caller). A future caller passing
// a large ambient blob as overrides would silently reopen the allowlist —
// every key in it wins unconditionally. A lightweight structural guard caps
// the key count so that misuse fails loudly instead of leaking.
test('MAX_ENV_OVERRIDE_KEYS: leaves clear headroom over the git-identity overlay (4 keys) but well below an ambient blob', () => {
  assert.ok(MAX_ENV_OVERRIDE_KEYS >= 4, 'must allow at least the 4-key git-identity overlay');
  assert.ok(MAX_ENV_OVERRIDE_KEYS < 20, 'must stay well below a full ambient env (dozens/hundreds of keys)');
});

test('buildChildEnv: the 4-key git-identity overlay is within the cap (no false positive)', () => {
  assert.doesNotThrow(() =>
    buildChildEnv({ PATH: '/usr/bin' }, {
      GIT_AUTHOR_NAME: 'forge-ralph',
      GIT_AUTHOR_EMAIL: 'forge-ralph+WI-7@forge.local',
      GIT_COMMITTER_NAME: 'forge-ralph',
      GIT_COMMITTER_EMAIL: 'forge-ralph+WI-7@forge.local',
    }),
  );
});

test('buildChildEnv: rejects an oversized overrides blob (allowlist stays closed by construction, not by discipline)', () => {
  const ambientBlob: NodeJS.ProcessEnv = {};
  for (let i = 0; i <= MAX_ENV_OVERRIDE_KEYS; i++) ambientBlob[`AMBIENT_VAR_${i}`] = String(i);
  assert.throws(
    () => buildChildEnv({ PATH: '/usr/bin' }, ambientBlob),
    /overrides/,
    'passing more override keys than the cap must throw, not silently reopen the allowlist',
  );
});
