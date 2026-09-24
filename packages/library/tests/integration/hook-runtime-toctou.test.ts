/**
 * forge-8vfn.8.3.2 (second half) — TOCTOU between the approval gate's own
 * revalidation and `prepareHookRun`'s exec-path derivation.
 *
 * WHY A SEPARATE FILE from hook-runtime.test.ts, not a describe block added
 * there: that file already carries a grandfathered file-size exemption
 * (`scripts/baselines/file-size.json`, 981 lines) from before the 800-line
 * cap was enforced by lint — "an exemption is a ceiling, not a licence"
 * (check-file-size.mjs) — so new coverage for a NEW code path belongs in its
 * own file rather than growing that ceiling. Mirrors
 * hook-runtime-async.test.ts's own precedent for the same module. Fixture
 * helpers below are self-contained (not imported from hook-runtime.test.ts,
 * which does not export them).
 *
 * `resolveHookScriptPath` (hook-library.ts) realpaths the hook dir and
 * REJECTS a script that resolves (after following symlinks) outside it —
 * but `loadHookDefinition` calls it only for the THROW side effect and
 * discards the validated real path it returns. `prepareHookRun` used to
 * re-derive the exec path itself as a bare `join(hookDir(id, forgeRoot),
 * def.script)` — a lexical re-join, never re-validated — and read/spawn
 * through THAT. A script approved as an ordinary regular file can be
 * swapped for a symlink pointing OUTSIDE the hook dir in the window between
 * the gate's own revalidation and this second, unvalidated re-join, and the
 * old code follows it straight through for both the pre-spawn read and the
 * real `bash` execution.
 *
 * DETERMINISM — no real race required. A throwaway instrumented probe
 * (every `realpathSync` call stack-traced across one `runHookScript`
 * invocation, run before this test was written) confirmed the approved
 * script's real path is realpathSync()'d EXACTLY THREE times before the
 * vulnerable join+read: (1) the gate's own `snapshotHookPackage ->
 * loadHookDefinition -> resolveHookScriptPath`, (2) `snapshotHookPackage`'s
 * OWN `readHookPackage` walk (`guardedFile`'s per-segment identity check),
 * and (3) `prepareHookRun`'s post-gate `loadHookDefinition(id, forgeRoot)`
 * call — the LAST validation before the old code's unvalidated re-join. The
 * swap is installed to fire on exactly that third occurrence. Mechanism
 * mirrors `interactive-finalizers-toctou.test.ts`'s `installLstatTrigger`: a
 * bare `require('node:fs').realpathSync = patched` is silently inert
 * against this file's own already-materialized static `import { ... } from
 * 'node:fs'` — `syncBuiltinESMExports()` is what reaches back into that
 * facade.
 *
 * Style: node:test + node:assert/strict, real temp forge roots + REAL
 * spawned child processes (no mocking of child_process), matching
 * hook-runtime.test.ts's own convention.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, unlinkSync, lstatSync, realpathSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { createLogger } from '@forge/kernel';
import { approveHook } from '../../studio/hook-approval-ledger.ts';
import type { HookPermissionManifest } from '../../studio/hook-library.ts';

import { runHookScript, type HookRunResult } from '../../studio/hook-runtime.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — mirrors hook-runtime.test.ts's own (not shared: that
// file does not export them; see the file header for why this lives apart).
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-'));
  createdDirs.push(dir);
  return dir;
}

function makeLogsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-logs-'));
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

/** Patches `node:fs`'s `realpathSync` so the Nth call whose `path` argument
 *  is EXACTLY `triggerPath` invokes `onTrigger()` AFTER computing (and
 *  still returning) that call's real, pre-swap answer — so the triggering
 *  validation call itself is unaffected, exactly as a real racing writer
 *  would leave an already-in-flight syscall's result untouched. Every other
 *  call, and every occurrence past the Nth, passes straight through.
 *  Returns an uninstall function; callers MUST call it (in a `finally`). */
function installRealpathSwapOnNthMatch(triggerPath: string, n: number, onTrigger: () => void): () => void {
  const require = createRequire(import.meta.url);
  const fsCjs = require('node:fs') as unknown as { realpathSync: unknown };
  const original = fsCjs.realpathSync as (...args: unknown[]) => unknown;
  let seen = 0;
  let fired = false;
  const patched = (...args: unknown[]): unknown => {
    const result = original(...args);
    if (!fired && args[0] === triggerPath) {
      seen += 1;
      if (seen === n) {
        fired = true;
        onTrigger();
      }
    }
    return result;
  };
  fsCjs.realpathSync = patched;
  syncBuiltinESMExports();
  return function uninstall(): void {
    fsCjs.realpathSync = original;
    syncBuiltinESMExports();
  };
}

describe('TOCTOU (forge-8vfn.8.3.2): script swapped for an outside symlink between the approval gate and the exec read', () => {
  it("a real spawned child must NEVER run the swapped-in outside script — the gate's own revalidation must not be bypassable by a later unvalidated re-join", () => {
    const root = makeForgeRoot();
    const id = 'toctou-swap-hook';
    writeHookPackage(root, id, '#!/usr/bin/env bash\necho INSIDE-OK\n', NO_ENV);
    approveHook({ forgeRoot: root, id });

    const outsideDir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-outside-'));
    createdDirs.push(outsideDir);
    const markerPath = join(outsideDir, 'pwned.marker');
    const outsideScript = join(outsideDir, 'outside.sh');
    writeFileSync(outsideScript, `#!/usr/bin/env bash\necho OUTSIDE-ESCAPED\necho PWNED > "${markerPath}"\n`, 'utf8');

    const hookDirReal = realpathSync(join(root, 'studio', 'hooks', id));
    const scriptRealBefore = join(hookDirReal, 'scripts', 'run.sh');
    assert.ok(
      existsSync(scriptRealBefore) && !lstatSync(scriptRealBefore).isSymbolicLink(),
      'arrange: the approved script starts as a real, non-symlinked file',
    );

    let swapPerformed = false;
    const uninstall = installRealpathSwapOnNthMatch(scriptRealBefore, 3, () => {
      unlinkSync(scriptRealBefore);
      symlinkSync(outsideScript, scriptRealBefore);
      swapPerformed = true;
    });

    const logger = createLogger('toctou-cycle', makeLogsDir());
    let threw = false;
    let caughtMessage = '';
    let result: HookRunResult | undefined;
    try {
      try {
        result = runHookScript({ forgeRoot: root, id, logger, initiativeId: 'INIT-test' });
      } catch (e) {
        threw = true;
        caughtMessage = (e as Error).message;
      }
    } finally {
      uninstall();
    }

    // Prove the swap actually fired against the live filesystem — never
    // trust a verdict behind a trigger that might have silently misfired.
    assert.ok(
      swapPerformed,
      'arrange: the realpathSync trigger (3rd matching call) must have fired and swapped the script for an outside symlink — if false the whole test is vacuous',
    );
    assert.ok(lstatSync(scriptRealBefore).isSymbolicLink(), 'arrange: the script path must genuinely be a symlink after the swap');
    assert.equal(
      realpathSync(scriptRealBefore),
      realpathSync(outsideScript),
      'arrange: the planted symlink must genuinely resolve to the outside script',
    );

    // ---- THE SECURITY ASSERTIONS — these fail RED against the unfixed code ----
    assert.equal(
      existsSync(markerPath),
      false,
      'the outside script must NEVER actually execute — a real spawned bash process ran it and wrote the marker file',
    );
    if (result) {
      assert.doesNotMatch(result.stdout ?? '', /OUTSIDE-ESCAPED/, "the outside script's own output must never appear — it must never be spawned");
    }
    assert.equal(
      threw,
      true,
      'runHookScript must refuse (throw) once the script path its own gate just revalidated is swapped before the exec read, rather than re-deriving ' +
        `and reading/spawning an unvalidated lexical re-join. Observed: ${result ? `returned normally, stdout=${JSON.stringify(result.stdout)}` : `threw "${caughtMessage}"`}.`,
    );
  });
});
