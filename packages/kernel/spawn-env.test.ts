/**
 * Tests for orchestrator/spawn-env.ts — the R5-02 F1 allowlist that replaces
 * the old denylist scrub (`pinnedAgentEnv`, removed). See spawn-env.ts's own
 * header for the design rationale and pinned-sdk-query.ts for the seam that
 * consumes `buildChildEnv`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { delimiter } from 'node:path';
import { AGENT_ENV_ALLOWLIST, MAX_ENV_OVERRIDE_KEYS, HOOK_ENV_BASE_ALLOWLIST, HOOK_ENV_CREDENTIAL_EXCLUSIONS, buildChildEnv, forgeBinOnPath } from './spawn-env.ts';

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

test('AGENT_ENV_ALLOWLIST: does NOT include GH_TOKEN — the GitHub PAT never reaches a spawned agent child (W8-B5)', () => {
  // W8-B5 built forge's first outbound third-party API call (the deterministic
  // community-registry refresh, orchestrator/studio/community-refresh-api.ts).
  // The naive move when a feature needs a credential is to add it here; that
  // would be a SECURITY REGRESSION, not a fix. This allowlist governs SDK-
  // spawned agent CHILDREN, and forge's design is that only the ORCHESTRATOR
  // PROCESS holds GH_TOKEN — spawned agents are instructed never to call `gh`
  // themselves and the refresh runs in-process, outside this seam entirely.
  // Adding it would hand the operator's GitHub PAT to every agent forge spawns,
  // which is the exact leak class R5-02 closed after it recurred three times.
  //
  // Pinned as NON-membership, deliberately: the module docstring already says
  // "GH_TOKEN is also deliberately excluded", and a comment is not a gate.
  assert.ok(
    !AGENT_ENV_ALLOWLIST.includes('GH_TOKEN'),
    'GH_TOKEN must never be inheritable by a spawned agent — the orchestrator process reads it directly',
  );
  assert.ok(
    AGENT_ENV_ALLOWLIST.every((name) => !/^(GH|GITHUB)_/.test(name)),
    'no GitHub credential var of any spelling may enter the agent-child allowlist',
  );
});

test('buildChildEnv: a parent env carrying a real GH_TOKEN produces a child that cannot see it', () => {
  const parentWithPat: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/operator',
    GH_TOKEN: 'ghp_operator_personal_access_token',
    GITHUB_TOKEN: 'ghp_second_spelling',
  };
  const child = buildChildEnv(parentWithPat);
  assert.equal(child.GH_TOKEN, undefined, 'the PAT leaked into a spawned agent child');
  assert.equal(child.GITHUB_TOKEN, undefined);
  assert.ok(!JSON.stringify(child).includes('ghp_'), 'no credential-shaped value may reach the child env');
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

// ---------------------------------------------------------------------------
// M4-library PR 2 — the module MOVED from `packages/agents/spawn-env.ts` to
// `packages/kernel/spawn-env.ts` (T1 ruling, park #1 Q3): library's
// `hook-runtime.ts` and `connection-probe.ts` need `HOOK_ENV_BASE_ALLOWLIST`
// and `buildChildEnv`, and library (rank 2) may not import agents (rank 3).
// `HOOK_ENV_BASE_ALLOWLIST` is a `.filter()` over `AGENT_ENV_ALLOWLIST`, so
// the whole seam travelled together rather than being copied.
//
// The three assertions below exist ONLY because of that move. Every test
// above is a property test — each would still pass if the move had silently
// added a name to the allowlist, because none of them pins the SET. These
// pin the set, so a name added or dropped in transit fails loudly.
// ---------------------------------------------------------------------------

test('MOVE PIN: AGENT_ENV_ALLOWLIST membership is byte-identical to its pre-move value', () => {
  assert.deepEqual(
    [...AGENT_ENV_ALLOWLIST],
    ['PATH', 'HOME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LANGUAGE', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'ANTHROPIC_API_KEY'],
    'the allowlist changed in the move from packages/agents/ to packages/kernel/',
  );
});

test('MOVE PIN: the HOOK base is the AGENT list MINUS the credential exclusions, and stays narrower', () => {
  assert.deepEqual([...HOOK_ENV_CREDENTIAL_EXCLUSIONS], ['ANTHROPIC_API_KEY']);
  assert.ok(!HOOK_ENV_BASE_ALLOWLIST.includes('ANTHROPIC_API_KEY'), 'an untrusted hook child must never inherit the API key');
  assert.deepEqual(
    [...HOOK_ENV_BASE_ALLOWLIST],
    AGENT_ENV_ALLOWLIST.filter((n) => !HOOK_ENV_CREDENTIAL_EXCLUSIONS.has(n)),
    'the hook base must stay a strict filter of the agent list, not a hand-maintained second copy',
  );
  assert.ok(HOOK_ENV_BASE_ALLOWLIST.length < AGENT_ENV_ALLOWLIST.length);
});

test('MOVE PIN: buildChildEnv layers overrides UNCONDITIONALLY — the credential refusal is the caller\'s, and that premise moved intact', () => {
  // Executed, not read. `buildChildEnv` filters `parentEnv` against
  // AGENT_ENV_ALLOWLIST and then layers `overrides` on top with no allowlist
  // check at all — by design, because overrides are the caller's own
  // composition. That is precisely why `HOOK_ENV_CREDENTIAL_EXCLUSIONS` is
  // exported from this module rather than applied inside it: the UNTRUSTED
  // caller (`hook-runtime.ts`'s `buildHookChildEnv`, which stays in library)
  // must filter its own overrides first, and W8-B6 FIX-1 exists because it
  // once did not. A move that quietly started filtering overrides here would
  // look like a hardening and would in fact hide the seam this test names.
  const parent = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;
  const child = buildChildEnv(parent, { ANTHROPIC_API_KEY: 'sk-caller-supplied' });
  assert.equal(
    child.ANTHROPIC_API_KEY,
    'sk-caller-supplied',
    'overrides must still win unconditionally — if this now filters, the hook-side refusal has moved and hook-runtime.ts must be re-reviewed',
  );
  // And the constant the untrusted caller is required to filter against is
  // reachable from this module, which is the whole reason it lives here.
  assert.ok(HOOK_ENV_CREDENTIAL_EXCLUSIONS.has('ANTHROPIC_API_KEY'));
});

// ---------------------------------------------------------------------------
// forgeBinOnPath — bead forge-8vfn.6.11.26. The run's own forge wins the
// lookup for every child, without touching the allowlist.
// ---------------------------------------------------------------------------

test('forgeBinOnPath: the forge root\'s own bin LEADS the returned PATH', () => {
  const out = forgeBinOnPath('/trees/alpha', '/usr/bin:/bin');
  assert.equal(out.split(delimiter)[0], '/trees/alpha/bin');
});

test('forgeBinOnPath: every other entry is preserved, in order — the operator\'s PATH is not rewritten', () => {
  const out = forgeBinOnPath('/trees/alpha', '/usr/local/bin:/usr/bin:/bin');
  assert.deepEqual(out.split(delimiter), ['/trees/alpha/bin', '/usr/local/bin', '/usr/bin', '/bin']);
});

test('forgeBinOnPath: idempotent — a forge child of a forge process does not stack duplicate entries', () => {
  const once = forgeBinOnPath('/trees/alpha', '/usr/bin');
  assert.equal(forgeBinOnPath('/trees/alpha', once), once);
});

test('forgeBinOnPath: a DIFFERENT tree\'s bin is displaced, never merely joined — two checkouts on one host is the whole defect', () => {
  const beta = forgeBinOnPath('/trees/beta', '/usr/bin');
  const alpha = forgeBinOnPath('/trees/alpha', beta);
  assert.equal(alpha.split(delimiter)[0], '/trees/alpha/bin');
  assert.ok(alpha.split(delimiter).includes('/trees/beta/bin'), 'the other tree stays reachable by absolute path — it just stops winning the bare-name lookup');
});

test('forgeBinOnPath: an absent or empty PATH yields the bin alone, never a stray empty entry (an empty PATH element means CWD)', () => {
  assert.equal(forgeBinOnPath('/trees/alpha', undefined), '/trees/alpha/bin');
  assert.equal(forgeBinOnPath('/trees/alpha', ''), '/trees/alpha/bin');
  assert.equal(forgeBinOnPath('/trees/alpha', '/usr/bin::/bin'), ['/trees/alpha/bin', '/usr/bin', '/bin'].join(delimiter));
});
