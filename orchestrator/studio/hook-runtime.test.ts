/**
 * Acceptance tests for orchestrator/studio/hook-runtime.ts (R3-03-F3) — DOES
 * NOT EXIST YET. This file is RED at branch base:
 * `Cannot find module './hook-runtime.ts'` on import. Do not stub the module
 * into existence; red is the deliverable of this round.
 *
 * Contract this file pins (docs/roadmaps/R3-library-componentry.md
 * §R3-03-F3):
 *
 *   Each hook's permission manifest {env, read, network} is DENY-BY-DEFAULT.
 *   At execution, the harness invokes the hook with a STRIPPED environment
 *   containing ONLY the manifest-granted vars, composing
 *   `orchestrator/spawn-env.ts`'s allowlist seam (R5-02 G8) rather than
 *   hand-rolling a second env filter — same seam, same mechanism. The F2
 *   scan's declared-vs-referenced mismatch is logged as a structured JSONL
 *   event. The manifest renders in the approval gate (data-level here; UI is
 *   a later round).
 *
 *   CREDENTIAL EXCLUSION (2026-08-04 peer-review finding, load-bearing — see
 *   D-M below): `orchestrator/spawn-env.ts`'s `AGENT_ENV_ALLOWLIST` is
 *   calibrated for forge's OWN trusted agent children, which legitimately
 *   need `ANTHROPIC_API_KEY` to call the API. A hook script is UNTRUSTED
 *   third-party code and must get a strictly SMALLER base — `env: []` in a
 *   hook's manifest must mean "sees nothing", including `ANTHROPIC_API_KEY`,
 *   not "sees everything forge's own agents see". This file's ATs pin that
 *   narrower base explicitly; see D-M for the confirmed-then-fixed defect.
 *
 * ---------------------------------------------------------------------------
 * *** HONEST LIMIT, STATED UP FRONT — DO NOT READ THE ACs BELOW AS CLAIMING
 * *** RUNTIME INTERCEPTION. This module does NOT observe or intercept a
 * *** hook's actual env reads at runtime. Safety comes from PREVENTION
 * *** (stripping the child env down to exactly the manifest-granted set
 * *** before the process ever starts) — proven below with a real spawned
 * *** child process. The "declared-vs-referenced mismatch" check is a
 * *** STATIC, pre-spawn text scan for `$VAR`/`${VAR}` references in the
 * *** script body against the manifest — it flags an operator who
 * *** under-declared their manifest (their hook will likely see the var
 * *** missing and may misbehave), it does NOT and cannot detect what the
 * *** running process actually reads. These are two different, independently
 * *** true properties; neither substitutes for the other.
 * ---------------------------------------------------------------------------
 *
 * Style: node:test + node:assert/strict, real temp forge roots + REAL
 * spawned child processes (bash scripts via the module under test — no
 * mocking of child_process), mirroring the git-fixture pattern in
 * band-agent-run.test.ts/pr.test.ts (execFileSync) and spawn-env.test.ts's
 * pure-function assertions.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE THAT WERE NOT SPECIFIED:
 *
 *  D-J. Module surface: `buildHookChildEnv(parentEnv, permissions):
 *       NodeJS.ProcessEnv` (pure — composes spawn-env.ts's `buildChildEnv`,
 *       passing the manifest-granted, present-in-parent vars as its
 *       `overrides` argument); `detectUndeclaredEnvRefs(scriptBody,
 *       permissions): string[]` (pure, static); `runHookScript(input):
 *       HookRunResult` (spawns bash on the real script, real stdio capture,
 *       refuses to spawn at all when `isHookRunnable` is false);
 *       `buildHookApprovalGateView(forgeRoot, id): {permissions, scan}`
 *       (data-level, no UI).
 *  D-K. `runHookScript` takes an explicit `parentEnv?: NodeJS.ProcessEnv`
 *       (default `process.env`) so tests never mutate the real process env —
 *       mirrors `buildChildEnv`'s own pure `(parentEnv, overrides)` shape.
 *  D-L. The env-mismatch event reuses the EXISTING closed `EventType` union
 *       from orchestrator/logging.ts (`event_type: 'error'`) with the
 *       hook-specific semantics carried in `metadata.kind:
 *       'hook-permission-mismatch'` — logging.ts's `EventType` union is
 *       NOT touched (my role must not change any production file); a new
 *       enum member was deliberately NOT invented for this.
 *  D-M. `buildHookChildEnv` composes spawn-env.ts's `overrides` parameter,
 *       which is capped at `MAX_ENV_OVERRIDE_KEYS` (8) — a hook declaring
 *       more than 8 env vars will throw via that existing cap, not a new one
 *       invented here. This is a real, inherited constraint, asserted below.
 *
 *       REVISED 2026-08-04 (peer-review finding, CONFIRMED by direct code
 *       read + a live repro before writing any test): the FIRST draft of
 *       this file asserted `buildHookChildEnv` composes `buildChildEnv`
 *       over the FULL `AGENT_ENV_ALLOWLIST` — which includes
 *       `ANTHROPIC_API_KEY`. That is wrong: it means a hook manifest
 *       declaring `env: []` (asking for NOTHING) still received the
 *       operator's real `ANTHROPIC_API_KEY` in its child env, because
 *       `buildChildEnv`'s base allowlist is unconditional and
 *       manifest-independent. Confirmed live:
 *       `buildHookChildEnv({PATH:'/usr/bin', ANTHROPIC_API_KEY:'sk-REAL'},
 *       {env:[],read:[],network:false})` returned `ANTHROPIC_API_KEY:
 *       'sk-REAL'` in the child. That is the exact exfiltration class F3
 *       exists to prevent — a hook script IS untrusted third-party code,
 *       unlike forge's own trusted agent children `AGENT_ENV_ALLOWLIST` is
 *       calibrated for.
 *
 *       THE ORIGINAL ASSERTIONS ("composes buildChildEnv exactly" /
 *       "inherits AGENT_ENV_ALLOWLIST") WERE THE R3-01 TRAP: a passing test
 *       that pins a live defect as "correct behaviour", which would have
 *       weaponised this file's own gate against fixing it. They are REPLACED
 *       below, not merely patched — see the "deny-by-default: real child
 *       process env" and "buildHookChildEnv composes orchestrator/spawn-
 *       env.ts" describe blocks.
 *
 *       Fix pinned here (implementer's target, mine to specify only as
 *       observable behaviour, not internal shape — same "drive it from the
 *       outside" principle as the studio-lint real-entry-point redirect):
 *       `orchestrator/spawn-env.ts` gains `HOOK_ENV_BASE_ALLOWLIST`, the
 *       minimal process-hygiene subset of `AGENT_ENV_ALLOWLIST` (PATH, HOME,
 *       SHELL, TERM, LANG, LC_*, TMPDIR/TMP/TEMP, USER, LOGNAME) —
 *       explicitly EXCLUDING every credential-bearing name
 *       (`ANTHROPIC_API_KEY` today). It must be DERIVED from
 *       `AGENT_ENV_ALLOWLIST` by subtraction, not independently retyped —
 *       so a future credential added to `AGENT_ENV_ALLOWLIST` cannot
 *       silently widen the hook base by omission. `buildHookChildEnv` must
 *       compose `buildChildEnv` over that NARROWER base (still reusing
 *       `buildChildEnv`, never hand-rolling a second filter) plus the
 *       manifest-granted overrides. `detectUndeclaredEnvRefs`
 *       (hook-runtime.ts) has the SAME bug one level up — it currently
 *       excludes `AGENT_ENV_ALLOWLIST` names (again including
 *       `ANTHROPIC_API_KEY`) from the mismatch report as "always present",
 *       which is now false; it must exclude `HOOK_ENV_BASE_ALLOWLIST`
 *       instead, or a script referencing `$ANTHROPIC_API_KEY` without
 *       declaring it is silently reported as fine while the child actually
 *       gets an empty value. Also pinned below.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { AGENT_ENV_ALLOWLIST, HOOK_ENV_BASE_ALLOWLIST, MAX_ENV_OVERRIDE_KEYS, buildChildEnv } from '../spawn-env.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import { overrideHookBlock } from './hook-scan.ts';
import type { HookPermissionManifest } from './hook-library.ts';

import {
  buildHookChildEnv,
  detectUndeclaredEnvRefs,
  runHookScript,
  buildHookApprovalGateView,
  type HookRunResult,
} from './hook-runtime.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-'));
  createdDirs.push(dir);
  return dir;
}

function makeLogsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-logs-'));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function writeHookPackage(root: string, id: string, scriptBody: string, permissions: HookPermissionManifest): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), scriptBody, 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({ id, name: id, description: `Test hook ${id}.`, on: 'PreToolUse', script: 'scripts/run.sh', permissions }),
    'utf8',
  );
}

function readJsonlEntries(logFilePath: string): EventLogEntry[] {
  return readFileSync(logFilePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EventLogEntry);
}

const NO_ENV: HookPermissionManifest = { env: [], read: [], network: false };

// ---------------------------------------------------------------------------
// Deny-by-default — a REAL spawned child cannot see an undeclared variable.
// ---------------------------------------------------------------------------

describe('deny-by-default: real child process env', () => {
  const ECHO_SCRIPT = `#!/usr/bin/env bash
echo "CANARY=\${FORGE_HOOK_TEST_CANARY:-ABSENT}"
echo "GRANTED=\${MY_GRANTED_VAR:-ABSENT}"
`;

  // -------------------------------------------------------------------
  // HEADLINE SECURITY AT (2026-08-04 peer-review finding — see D-M in the
  // file header for the confirmed-then-fixed defect). This is the single
  // most important assertion in this file: a hook that declares NOTHING
  // must not see the operator's real Anthropic API credential, full stop.
  // Deliberately placed first and named unmissably.
  // -------------------------------------------------------------------
  const CREDENTIAL_ECHO_SCRIPT = `#!/usr/bin/env bash
echo "APIKEY=\${ANTHROPIC_API_KEY:-ABSENT}"
`;

  it('SECURITY: a hook with env: [] (asks for nothing) does NOT receive the operator\'s real ANTHROPIC_API_KEY — real spawned child', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'credential-exfil-probe-hook', CREDENTIAL_ECHO_SCRIPT, { env: [], read: [], network: false });
    const logger = createLogger('credential-exfil-probe-cycle', makeLogsDir());

    const parentEnv: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: 'sk-REAL-OPERATOR-SECRET-DO-NOT-LEAK' };

    const result = runHookScript({ forgeRoot: root, id: 'credential-exfil-probe-hook', logger, initiativeId: 'INIT-test', parentEnv });

    assert.match(
      result.stdout,
      /APIKEY=ABSENT/,
      'a hook declaring env: [] must not see ANTHROPIC_API_KEY even though it is in AGENT_ENV_ALLOWLIST for forge\'s own trusted agents',
    );
    assert.doesNotMatch(result.stdout, /sk-REAL-OPERATOR-SECRET-DO-NOT-LEAK/, 'the real secret value must never appear in hook output');
  });

  it('a hook that DECLARES ANTHROPIC_API_KEY in permissions.env DOES receive it — the manifest is the only route in', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'credential-granted-hook', CREDENTIAL_ECHO_SCRIPT, { env: ['ANTHROPIC_API_KEY'], read: [], network: false });
    const logger = createLogger('credential-granted-cycle', makeLogsDir());

    const parentEnv: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: 'sk-deliberately-granted' };

    const result = runHookScript({ forgeRoot: root, id: 'credential-granted-hook', logger, initiativeId: 'INIT-test', parentEnv });

    assert.match(result.stdout, /APIKEY=sk-deliberately-granted/, 'an operator can still deliberately grant a credential via the manifest');
  });

  it('a distinctive parent-set var NOT in the manifest is absent from the real child', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'canary-hook', ECHO_SCRIPT, { env: ['MY_GRANTED_VAR'], read: [], network: false });
    const logger = createLogger('hook-runtime-test-cycle', makeLogsDir());

    const parentEnv: NodeJS.ProcessEnv = {
      ...process.env,
      FORGE_HOOK_TEST_CANARY: 'leak-if-visible',
      MY_GRANTED_VAR: 'granted-value',
    };

    const result: HookRunResult = runHookScript({
      forgeRoot: root,
      id: 'canary-hook',
      logger,
      initiativeId: 'INIT-test',
      parentEnv,
    });

    assert.match(result.stdout, /CANARY=ABSENT/, 'an undeclared env var must be invisible to the real spawned child');
  });

  it('a declared var IS present in the real child', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'canary-hook-2', ECHO_SCRIPT, { env: ['MY_GRANTED_VAR'], read: [], network: false });
    const logger = createLogger('hook-runtime-test-cycle-2', makeLogsDir());

    const parentEnv: NodeJS.ProcessEnv = { ...process.env, MY_GRANTED_VAR: 'granted-value' };

    const result = runHookScript({ forgeRoot: root, id: 'canary-hook-2', logger, initiativeId: 'INIT-test', parentEnv });

    assert.match(result.stdout, /GRANTED=granted-value/, 'a manifest-declared var must reach the real spawned child');
  });
});

// ---------------------------------------------------------------------------
// Composes spawn-env.ts — assert behaviour consistent with that module,
// never internals.
// ---------------------------------------------------------------------------

/** Filters `env` down to the given allowlist — test-local helper used ONLY to
 *  build the reference composition below; never imported from production. */
function pickAllowed(env: NodeJS.ProcessEnv, allowlist: readonly string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of allowlist) if (env[name] !== undefined) out[name] = env[name];
  return out;
}

describe('buildHookChildEnv composes orchestrator/spawn-env.ts (over the NARROWER hook base — see D-M)', () => {
  it('matches composing buildChildEnv over HOOK_ENV_BASE_ALLOWLIST (not the full AGENT_ENV_ALLOWLIST) plus the manifest-granted overrides', () => {
    const parentEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/operator',
      ANTHROPIC_API_KEY: 'sk-should-not-leak-here', // present in AGENT_ENV_ALLOWLIST, must NOT be in the hook base
      ANTHROPIC_BASE_URL: 'https://evil.example.com', // the canonical spawn-env leak example
      MY_GRANTED_VAR: 'granted-value',
      SOME_OTHER_AMBIENT_VAR: 'should-never-appear',
    };
    const permissions: HookPermissionManifest = { env: ['MY_GRANTED_VAR'], read: [], network: false };

    const viaHookRuntime = buildHookChildEnv(parentEnv, permissions);
    const viaDirectComposition = buildChildEnv(pickAllowed(parentEnv, HOOK_ENV_BASE_ALLOWLIST), pickAllowed(parentEnv, permissions.env));

    assert.deepEqual(
      viaHookRuntime,
      viaDirectComposition,
      'hook-runtime must delegate to buildChildEnv over the narrowed hook base, not reimplement the filter and not use the full agent allowlist',
    );
    assert.equal(viaHookRuntime.ANTHROPIC_API_KEY, undefined, 'sanity: the reference composition itself must not carry the credential either');
  });

  it('HOOK_ENV_BASE_ALLOWLIST process-hygiene vars (PATH/HOME) pass through WITHOUT being declared in the manifest', () => {
    const parentEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/operator' };
    const child = buildHookChildEnv(parentEnv, NO_ENV);
    for (const name of HOOK_ENV_BASE_ALLOWLIST) {
      if (parentEnv[name] !== undefined) assert.equal(child[name], parentEnv[name]);
    }
  });

  it('HOOK_ENV_BASE_ALLOWLIST does not contain ANTHROPIC_API_KEY (structural — the field this whole finding is about)', () => {
    assert.equal((HOOK_ENV_BASE_ALLOWLIST as readonly string[]).includes('ANTHROPIC_API_KEY'), false);
  });

  // -------------------------------------------------------------------
  // Subtraction-derivation AT (peer-review requirement): HOOK_ENV_BASE_ALLOWLIST
  // must be a proper subset of AGENT_ENV_ALLOWLIST, derived by SUBTRACTING
  // credential-bearing names — never an independently retyped list. This is
  // what keeps the two from silently drifting apart: if a future credential
  // is added to AGENT_ENV_ALLOWLIST without also being excluded here, this
  // AT's "strictly smaller, still a subset" shape stays true regardless (it
  // cannot catch a NEW credential nobody excluded), but it DOES lock the
  // relationship so the hook base can never independently grow a name the
  // agent list doesn't already have, and it fails loud the moment someone
  // tries to hand-add a name to HOOK_ENV_BASE_ALLOWLIST that isn't already
  // agent-allowlisted (a copy-paste-typo class of drift).
  // -------------------------------------------------------------------
  it('HOOK_ENV_BASE_ALLOWLIST is a proper subset of AGENT_ENV_ALLOWLIST (derived by subtraction, not retyped)', () => {
    const agentSet = new Set<string>(AGENT_ENV_ALLOWLIST);
    for (const name of HOOK_ENV_BASE_ALLOWLIST) {
      assert.ok(agentSet.has(name), `HOOK_ENV_BASE_ALLOWLIST entry "${name}" must also be present in AGENT_ENV_ALLOWLIST — it is a subset, not a parallel list`);
    }
    assert.ok(
      HOOK_ENV_BASE_ALLOWLIST.length < AGENT_ENV_ALLOWLIST.length,
      'the hook base must be STRICTLY smaller than the agent allowlist — at least one credential-bearing name must be excluded',
    );
  });

  it('an ambient leak var (ANTHROPIC_BASE_URL) is stripped exactly as buildChildEnv strips it, manifest or not', () => {
    const parentEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://evil.example.com' };
    const child = buildHookChildEnv(parentEnv, NO_ENV);
    assert.equal(child.ANTHROPIC_BASE_URL, undefined);
  });

  it('declaring more than MAX_ENV_OVERRIDE_KEYS env vars throws via the INHERITED spawn-env cap, not a new one', () => {
    const parentEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const tooManyEnvNames: string[] = [];
    for (let i = 0; i <= MAX_ENV_OVERRIDE_KEYS; i++) {
      const name = `HOOK_VAR_${i}`;
      parentEnv[name] = String(i);
      tooManyEnvNames.push(name);
    }
    const permissions: HookPermissionManifest = { env: tooManyEnvNames, read: [], network: false };
    assert.throws(() => buildHookChildEnv(parentEnv, permissions), /overrides/i);
  });
});

// ---------------------------------------------------------------------------
// Declared-vs-referenced mismatch — static detection + a structured JSONL
// event (real logger, real file read-back).
// ---------------------------------------------------------------------------

describe('detectUndeclaredEnvRefs: static, pre-spawn scan', () => {
  it('a script referencing $VAR not in permissions.env is reported', () => {
    const script = `#!/usr/bin/env bash\necho "$UNDECLARED_VAR"\n`;
    const refs = detectUndeclaredEnvRefs(script, NO_ENV);
    assert.deepEqual(refs, ['UNDECLARED_VAR']);
  });

  it('a script referencing ${VAR} (braced form) not in permissions.env is reported', () => {
    const script = `#!/usr/bin/env bash\necho "\${UNDECLARED_BRACED_VAR}"\n`;
    const refs = detectUndeclaredEnvRefs(script, NO_ENV);
    assert.deepEqual(refs, ['UNDECLARED_BRACED_VAR']);
  });

  it('a declared var is NOT reported as a mismatch', () => {
    const script = `#!/usr/bin/env bash\necho "$MY_GRANTED_VAR"\n`;
    const refs = detectUndeclaredEnvRefs(script, { env: ['MY_GRANTED_VAR'], read: [], network: false });
    assert.deepEqual(refs, []);
  });

  // 2026-08-04 peer-review finding (see D-M): detectUndeclaredEnvRefs used to
  // exclude every AGENT_ENV_ALLOWLIST name — including ANTHROPIC_API_KEY —
  // as "always present", which was true for forge's own trusted agents but
  // is now FALSE for a hook (which only gets HOOK_ENV_BASE_ALLOWLIST
  // unconditionally). Left unfixed, a script referencing $ANTHROPIC_API_KEY
  // without declaring it would be silently reported as "no mismatch" while
  // the real child actually gets an empty value — a quiet, misleading
  // false-negative that looks like a correct copy of the PATH/HOME exclusion
  // one line above it.
  it('SECURITY: a script referencing $ANTHROPIC_API_KEY WITHOUT declaring it IS reported as a mismatch (it is not "always present" for a hook)', () => {
    const script = `#!/usr/bin/env bash\necho "$ANTHROPIC_API_KEY"\n`;
    const refs = detectUndeclaredEnvRefs(script, NO_ENV);
    assert.deepEqual(refs, ['ANTHROPIC_API_KEY']);
  });

  it('a script referencing $PATH/$HOME (real, unconditional hook-base hygiene vars) is NOT reported as a mismatch', () => {
    const script = `#!/usr/bin/env bash\necho "$PATH $HOME"\n`;
    const refs = detectUndeclaredEnvRefs(script, NO_ENV);
    assert.deepEqual(refs, [], 'PATH/HOME are genuinely always present for a hook (HOOK_ENV_BASE_ALLOWLIST), unlike ANTHROPIC_API_KEY');
  });
});

describe('runHookScript: mismatch emitted as a structured JSONL event', () => {
  it('a real EventLogger records a hook-permission-mismatch entry for an under-declared manifest', () => {
    const root = makeForgeRoot();
    const script = `#!/usr/bin/env bash\necho "\${UNDECLARED_RUNTIME_VAR:-ABSENT}"\n`;
    writeHookPackage(root, 'mismatch-hook', script, NO_ENV);
    const logsDir = makeLogsDir();
    const logger = createLogger('mismatch-test-cycle', logsDir);

    runHookScript({ forgeRoot: root, id: 'mismatch-hook', logger, initiativeId: 'INIT-test' });

    const entries = readJsonlEntries(logger.logFilePath);
    const mismatchEntry = entries.find((e) => e.metadata?.['kind'] === 'hook-permission-mismatch');
    assert.ok(mismatchEntry, 'expected a JSONL entry recording the declared-vs-referenced mismatch');
    assert.equal(mismatchEntry!.metadata?.['hookId'], 'mismatch-hook');
    assert.deepEqual(mismatchEntry!.metadata?.['undeclaredRefs'], ['UNDECLARED_RUNTIME_VAR']);
  });

  it('no mismatch event is emitted when every referenced var is declared', () => {
    const root = makeForgeRoot();
    const script = `#!/usr/bin/env bash\necho "$MY_GRANTED_VAR"\n`;
    writeHookPackage(root, 'clean-manifest-hook', script, { env: ['MY_GRANTED_VAR'], read: [], network: false });
    const logsDir = makeLogsDir();
    const logger = createLogger('clean-manifest-test-cycle', logsDir);

    runHookScript({
      forgeRoot: root,
      id: 'clean-manifest-hook',
      logger,
      initiativeId: 'INIT-test',
      parentEnv: { ...process.env, MY_GRANTED_VAR: 'x' },
    });

    const entries = readJsonlEntries(logger.logFilePath);
    assert.equal(
      entries.some((e) => e.metadata?.['kind'] === 'hook-permission-mismatch'),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Blocked hooks: the block ACTUALLY prevents execution (a real process never
// spawns), not merely a report string. Override is what changes that.
// ---------------------------------------------------------------------------

describe('runHookScript: a blocked, unapproved hook is refused — actual prevention', () => {
  // eval + base64-decode trips the F2 obfuscation category (see
  // hook-scan.test.ts), independent of any network access, so this fixture
  // is blocked without needing network egress at all.
  const OBFUSCATED_SCRIPT = `#!/usr/bin/env bash\neval "$(echo dG91Y2ggIiQxIg== | base64 -d)" "$MARKER_PATH"\n`;

  it('refuses to spawn at all — a marker file the script would create never appears', () => {
    const root = makeForgeRoot();
    const logsDir = makeLogsDir();
    const markerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-marker-'));
    createdDirs.push(markerDir);
    const markerPath = join(markerDir, 'ran.marker');

    writeHookPackage(root, 'blocked-hook', OBFUSCATED_SCRIPT, { env: ['MARKER_PATH'], read: [], network: false });
    const logger = createLogger('blocked-test-cycle', logsDir);

    assert.throws(
      () =>
        runHookScript({
          forgeRoot: root,
          id: 'blocked-hook',
          logger,
          initiativeId: 'INIT-test',
          parentEnv: { ...process.env, MARKER_PATH: markerPath },
        }),
      /blocked|not runnable/i,
    );
    assert.equal(existsSync(markerPath), false, 'the process must never have actually spawned');
  });

  it('after an explicit override, the SAME hook actually executes — the marker file now appears', () => {
    const root = makeForgeRoot();
    const logsDir = makeLogsDir();
    const markerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-marker-2-'));
    createdDirs.push(markerDir);
    const markerPath = join(markerDir, 'ran.marker');

    writeHookPackage(root, 'overridden-hook', OBFUSCATED_SCRIPT, { env: ['MARKER_PATH'], read: [], network: false });
    overrideHookBlock({ forgeRoot: root, id: 'overridden-hook', reason: 'operator manually reviewed and accepted the risk' });
    const logger = createLogger('overridden-test-cycle', logsDir);

    assert.doesNotThrow(() =>
      runHookScript({
        forgeRoot: root,
        id: 'overridden-hook',
        logger,
        initiativeId: 'INIT-test',
        parentEnv: { ...process.env, MARKER_PATH: markerPath },
      }),
    );
    assert.equal(existsSync(markerPath), true, 'an overridden hook must actually run');
  });
});

// ---------------------------------------------------------------------------
// The manifest renders in the approval gate — data-level only (F3 AC; UI is
// a later round, deliberately not tested here).
// ---------------------------------------------------------------------------

describe('buildHookApprovalGateView: data-level only', () => {
  it('combines the permission manifest and the scan report for one hook', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'gate-view-hook', `#!/usr/bin/env bash\necho ok\n`, { env: ['SOME_VAR'], read: [], network: true });

    const view = buildHookApprovalGateView(root, 'gate-view-hook');

    assert.deepEqual(view.permissions, { env: ['SOME_VAR'], read: [], network: true });
    assert.equal(view.scan.verdict, 'clean');
    assert.deepEqual(view.scan.findings, []);
  });
});
