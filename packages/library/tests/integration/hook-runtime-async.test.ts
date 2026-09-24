/**
 * Acceptance tests for `runHookScriptAsync` (forge-9a3) — the ASYNC spawn
 * tail hook-runtime.ts gained so `hook-dispatch.ts` stops blocking forge
 * serve's event loop while a hook runs.
 *
 * WHY A SEPARATE FILE from hook-runtime.test.ts, not a describe block added
 * there: that file already carries a grandfathered file-size exemption
 * (`scripts/baselines/file-size.json`, 981 lines) from before the 800-line
 * cap was enforced by lint — "an exemption is a ceiling, not a licence"
 * (check-file-size.mjs), so new coverage for a NEW code path belongs in its
 * own file rather than growing that ceiling. Fixture helpers below are
 * deliberately self-contained (not imported from hook-runtime.test.ts, which
 * does not export them) — the same per-file-fixtures convention
 * hook-dispatch.test.ts already uses for adjacent hook-runtime coverage.
 *
 * THE DEFECT THIS SUITE KILLS: `runHookScript` (the only production spawn
 * tail before this) used `spawnSync` with a 30s cap, and `hook-dispatch.ts`
 * called it unmodified — so a `PostToolUse` hook, firing on every tool call,
 * blocked the scheduler and the Studio bridge for the hook's whole duration.
 * The fix extracts the approval gate + env fence + pre-spawn logging into ONE
 * shared `prepareHookRun` step (hook-runtime.ts) and gives it a second, async
 * tail. These tests mirror the SYNC tail's own non-tautological
 * refusal/env/timeout pins (hook-runtime.test.ts), run against
 * `runHookScriptAsync` specifically, to prove the async tail did not get a
 * second, weaker copy of either guard — "ONE gate, one env builder, two
 * tails. No second copy of either guard" (forge-9a3).
 *
 * Style: node:test + node:assert/strict, real temp forge roots + REAL
 * spawned child processes (no mocking of child_process), matching
 * hook-runtime.test.ts's own convention.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { createLogger } from '@forge/kernel';
import { approveHook, overrideHookBlock } from '../../studio/hook-approval-ledger.ts';
import type { HookPermissionManifest } from '../../studio/hook-library.ts';

import { runHookScriptAsync, HookRunError } from '../../studio/hook-runtime.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — mirrors hook-runtime.test.ts's own (not shared: that file
// does not export them, and duplicating a small, stable fixture shape is
// cheaper than a cross-test-file import boundary for four helpers).
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-async-'));
  createdDirs.push(dir);
  return dir;
}

function makeLogsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-async-logs-'));
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

const NO_ENV: HookPermissionManifest = { env: [], read: [], network: false };

/** Polls `process.kill(pid, 0)` (a liveness probe — sends no real signal)
 *  until it throws ESRCH (the pid is gone) or `timeoutMs` elapses, in which
 *  case it throws so the caller's assertion fails with a real reason rather
 *  than silently timing out the whole test. */
async function waitForProcessDeath(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw err;
    }
    if (Date.now() >= deadline) throw new Error(`pid ${pid} is still alive ${timeoutMs}ms after the tail settled`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// ---------------------------------------------------------------------------
// The approval gate — mirrors hook-runtime.test.ts's "BLOCKER 1" pin, run
// against the async tail.
// ---------------------------------------------------------------------------

describe('runHookScriptAsync: mirrors runHookScript — ONE gate, ONE env fence, two tails (forge-9a3)', () => {
  it('an UNAPPROVED hook is refused via the async tail too — WITHOUT spawning (real child, observable absence)', async () => {
    const root = makeForgeRoot();
    const markerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-async-unapproved-'));
    createdDirs.push(markerDir);
    const markerPath = join(markerDir, 'must-not-exist.marker');

    writeHookPackage(root, 'async-unapproved-hook', `#!/usr/bin/env bash\necho ran > ${JSON.stringify(markerPath)}\n`, NO_ENV);
    // deliberately NOT approved
    const logger = createLogger('async-unapproved-cycle', makeLogsDir());

    await assert.rejects(
      () => runHookScriptAsync({ forgeRoot: root, id: 'async-unapproved-hook', logger, initiativeId: 'INIT-test' }),
      (e: unknown) => {
        assert.ok(e instanceof HookRunError, `expected a HookRunError, got ${Object.prototype.toString.call(e)}`);
        assert.equal((e as HookRunError).reason, 'not-runnable');
        return true;
      },
    );
    assert.equal(
      existsSync(markerPath),
      false,
      'the async tail must never actually spawn an unapproved hook — the marker file (proof of a real spawn) must not appear',
    );
  });

  it('SECURITY: the async tail strips the child env down to the allowlist too — a secret-shaped parent var not in the manifest is absent from the child', async () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'async-env-fence-hook', `#!/usr/bin/env bash\necho "SECRET=\${FORGE_9A3_TEST_SECRET_TOKEN:-ABSENT}"\n`, NO_ENV);
    // overrideHookBlock, not approveHook: the script body references a
    // TOKEN/SECRET-shaped name, which hook-scan.ts flags as a critical
    // env-read finding and blocks on its own — mirrors hook-runtime.test.ts's
    // existing CREDENTIAL_ECHO_SCRIPT fixtures. The property under test
    // (env stripping) is unaffected; approval routing is not this test's
    // subject.
    overrideHookBlock({ forgeRoot: root, id: 'async-env-fence-hook', reason: 'test fixture: exercising the async tail env fence, not the approval gate' });
    const logger = createLogger('async-env-fence-cycle', makeLogsDir());

    const parentEnv: NodeJS.ProcessEnv = { ...process.env, FORGE_9A3_TEST_SECRET_TOKEN: 'sk-should-never-leak-async' };

    const result = await runHookScriptAsync({ forgeRoot: root, id: 'async-env-fence-hook', logger, initiativeId: 'INIT-test', parentEnv });

    assert.match(
      result.stdout,
      /SECRET=ABSENT/,
      'an undeclared, secret-shaped env var must be invisible to the async child — only manifest-granted/base-allowlisted keys pass through',
    );
    assert.doesNotMatch(result.stdout, /sk-should-never-leak-async/, 'the planted secret value must never appear in async hook output');
  });

  it('timeout parity: a hanging script is killed at the (injectable) budget, with the SAME outcome shape as the sync tail', async () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'async-hanging-hook', '#!/usr/bin/env bash\nsleep 30\n', NO_ENV);
    approveHook({ forgeRoot: root, id: 'async-hanging-hook' });
    const logger = createLogger('async-hanging-cycle', makeLogsDir());

    await assert.rejects(
      () => runHookScriptAsync({ forgeRoot: root, id: 'async-hanging-hook', logger, initiativeId: 'INIT-test', timeoutMs: 200 }),
      (e: unknown) => {
        assert.ok(e instanceof HookRunError, `expected a HookRunError, got ${Object.prototype.toString.call(e)}`);
        assert.equal((e as HookRunError).reason, 'timeout', 'a hung script is NOT a spawn failure and NOT an approval refusal — same reason the sync tail uses');
        assert.match((e as HookRunError).message, /timed out|exceeded/i, 'the message must name the real problem, not "failed to spawn"');
        assert.match((e as HookRunError).message, /200/, 'and it must name the budget that was exceeded, exactly like the sync tail');
        return true;
      },
    );
  });

  it('a timed-out hook does not leak a grandchild — the whole process GROUP dies, not only the bash child (forge-9a3)', async () => {
    const root = makeForgeRoot();
    const pidDir = mkdtempSync(join(tmpdir(), 'hook-runtime-async-orphan-'));
    createdDirs.push(pidDir);
    const pidFilePath = join(pidDir, 'grandchild.pid');

    // The grandchild backgrounds itself (`&`) BEFORE `wait` blocks bash —
    // by the time the timeout fires, its PID is already on disk. `wait`
    // keeps bash alive (and its stdio pipes open) until killed, matching a
    // real hook that spawns work and waits on it.
    writeHookPackage(
      root,
      'async-orphan-hook',
      `#!/usr/bin/env bash\nsleep 30 &\necho $! > ${JSON.stringify(pidFilePath)}\nwait\n`,
      NO_ENV,
    );
    approveHook({ forgeRoot: root, id: 'async-orphan-hook' });
    const logger = createLogger('async-orphan-cycle', makeLogsDir());

    let grandchildPid: number | undefined;
    try {
      await assert.rejects(
        () => runHookScriptAsync({ forgeRoot: root, id: 'async-orphan-hook', logger, initiativeId: 'INIT-test', timeoutMs: 200 }),
        (e: unknown) => {
          assert.ok(e instanceof HookRunError, `expected a HookRunError, got ${Object.prototype.toString.call(e)}`);
          assert.equal((e as HookRunError).reason, 'timeout');
          return true;
        },
      );

      assert.ok(existsSync(pidFilePath), 'the script must have written the grandchild PID before the tail settled');
      grandchildPid = parseInt(readFileSync(pidFilePath, 'utf8').trim(), 10);
      assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, `expected a real PID in ${pidFilePath}, got ${grandchildPid}`);

      await waitForProcessDeath(grandchildPid, 1000);
    } finally {
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, 'SIGKILL');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
        }
      }
    }
  });

  it('a hook that finishes inside its budget resolves normally via the async tail — the timeout path must not fire for an ordinary run', async () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'async-fast-hook', '#!/usr/bin/env bash\necho ok\nexit 0\n', NO_ENV);
    approveHook({ forgeRoot: root, id: 'async-fast-hook' });
    const logger = createLogger('async-fast-cycle', makeLogsDir());
    const result = await runHookScriptAsync({ forgeRoot: root, id: 'async-fast-hook', logger, initiativeId: 'INIT-test', timeoutMs: 10_000 });
    assert.equal(result.exitCode, 0);
  });
});
