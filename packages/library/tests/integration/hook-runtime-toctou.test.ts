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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, unlinkSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
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

/** Patches `node:fs`'s `readFileSync` so the Nth call whose `path` argument
 *  is EXACTLY `triggerPath` invokes `onTrigger()` AFTER returning that call's
 *  real, pre-swap content — so the triggering read itself is unaffected,
 *  exactly as a real racing writer would leave an already-in-flight read's
 *  result untouched. Content-half twin of `installRealpathSwapOnNthMatch`
 *  above (same bead, same mechanism, different fs sink). Returns an
 *  uninstall function; callers MUST call it (in a `finally`). */
function installReadFileSyncSwapOnNthMatch(triggerPath: string, n: number, onTrigger: () => void): () => void {
  const require = createRequire(import.meta.url);
  const fsCjs = require('node:fs') as unknown as { readFileSync: unknown };
  const original = fsCjs.readFileSync as (...args: unknown[]) => unknown;
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
  fsCjs.readFileSync = patched;
  syncBuiltinESMExports();
  return function uninstall(): void {
    fsCjs.readFileSync = original;
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

// ---------------------------------------------------------------------------
// forge-8vfn.8.3.2 (content half) — the approval fingerprint
// (`hookRunState` -> `snapshotHookPackage` -> `readHookPackage`),
// `prepareHookRun`'s own `readFileSync(scriptPath)`, and (before this fix)
// the exec itself were THREE separate opens of the SAME path, SAME inode —
// no symlink involved. An overwrite landing between the gate's read (which
// approves) and the exec read (which — before this fix — fed the real
// `bash` spawn) changes what runs without changing what was approved.
// ---------------------------------------------------------------------------

describe('TOCTOU (forge-8vfn.8.3.2, content half): script content overwritten in place, same path/inode, between the gate read and the exec read', () => {
  it('a real spawned child must NEVER execute bytes that differ from the fingerprint the approval gate just accepted', () => {
    const root = makeForgeRoot();
    const id = 'content-swap-hook';
    const benignBody = '#!/usr/bin/env bash\necho BENIGN\n';
    writeHookPackage(root, id, benignBody, NO_ENV);
    approveHook({ forgeRoot: root, id });

    const scriptRealPath = realpathSync(join(root, 'studio', 'hooks', id, 'scripts', 'run.sh'));
    assert.ok(
      existsSync(scriptRealPath) && !lstatSync(scriptRealPath).isSymbolicLink(),
      'arrange: the approved script starts as a real, non-symlinked file',
    );

    const markerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-content-marker-'));
    createdDirs.push(markerDir);
    const markerPath = join(markerDir, 'pwned.marker');
    const maliciousBody = `#!/usr/bin/env bash\necho PWNED\necho PWNED > "${markerPath}"\n`;

    // Trigger on the 1st readFileSync of THIS exact path — that is the
    // gate's own read (hookRunState -> snapshotHookPackage -> readHookPackage),
    // which must see and approve the ORIGINAL benign bytes. Overwriting
    // in place, same path, right after that read returns, means the 2nd
    // matching read — prepareHookRun's own, the one this fix hashes and
    // executes — sees the MALICIOUS bytes instead.
    let swapPerformed = false;
    const uninstall = installReadFileSyncSwapOnNthMatch(scriptRealPath, 1, () => {
      writeFileSync(scriptRealPath, maliciousBody, 'utf8'); // same path, same inode — an in-place overwrite, never a symlink
      swapPerformed = true;
    });

    const logger = createLogger('toctou-content-cycle', makeLogsDir());
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
      "arrange: the readFileSync trigger (1st matching call — the gate's own read) must have fired and overwritten the script in place — if false the whole test is vacuous",
    );
    assert.equal(
      readFileSync(scriptRealPath, 'utf8'),
      maliciousBody,
      'arrange: the file on disk now genuinely holds the malicious bytes, same path, same inode',
    );

    // ---- THE SECURITY ASSERTIONS — these fail RED against the unfixed code ----
    assert.equal(
      existsSync(markerPath),
      false,
      'the overwritten bytes must NEVER actually execute — a real spawned bash process ran them and wrote the marker file',
    );
    if (result) {
      assert.doesNotMatch(result.stdout ?? '', /PWNED/, "the malicious script's own output must never appear — it must never be spawned");
    }
    assert.equal(
      threw,
      true,
      "runHookScript must refuse (throw) once the script's content differs from the ledger's approved fingerprint, rather than executing whatever a later, unverified read of the same path happens to find. " +
        `Observed: ${result ? `returned normally, stdout=${JSON.stringify(result.stdout)}` : `threw "${caughtMessage}"`}.`,
    );
    if (threw) {
      assert.match(
        caughtMessage,
        /fingerprint mismatch/,
        'the refusal must name WHY — a fingerprint mismatch — not an unrelated failure that happens to also throw',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// forge-8vfn.8.3.2 (content half, decisive window) — the overwrite lands
// AFTER `prepareHookRun`'s own verified read, i.e. in the window that used to
// be a THIRD open: each tail's own `spawn(Sync)('bash', [scriptPath])`. There
// is nothing left to refuse against here — the bytes were verified before the
// overwrite happened — so the required outcome is the OTHER honest one the
// brief names: the APPROVED bytes still run, because exec now uses a private,
// read-only COPY of those bytes (written right after verification — see
// `writePrivateScriptCopy`) and never reopens `scriptPath` again. This is
// also the test that kills the regression-shaped mutation "execute the path
// again instead of the bytes": that mutation would have `bash` open
// `scriptPath` itself at spawn time, pick up THIS overwrite, and run the
// malicious content instead.
// ---------------------------------------------------------------------------

describe('TOCTOU (forge-8vfn.8.3.2, content half): script overwritten AFTER the verified read — the approved bytes must still be what runs', () => {
  it('a real spawned child runs the bytes prepareHookRun verified, never a later on-disk overwrite of the same path/inode', () => {
    const root = makeForgeRoot();
    const id = 'content-swap-post-read-hook';

    const benignMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-benign-marker-'));
    createdDirs.push(benignMarkerDir);
    const benignMarkerPath = join(benignMarkerDir, 'benign.marker');
    const benignBody = `#!/usr/bin/env bash\necho BENIGN > "${benignMarkerPath}"\n`;
    writeHookPackage(root, id, benignBody, NO_ENV);
    approveHook({ forgeRoot: root, id });

    const scriptRealPath = realpathSync(join(root, 'studio', 'hooks', id, 'scripts', 'run.sh'));

    const pwnedMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-pwned-marker-'));
    createdDirs.push(pwnedMarkerDir);
    const pwnedMarkerPath = join(pwnedMarkerDir, 'pwned.marker');
    const maliciousBody = `#!/usr/bin/env bash\necho PWNED\necho PWNED > "${pwnedMarkerPath}"\n`;

    // Trigger on the 2nd readFileSync match of this path — `prepareHookRun`'s
    // OWN read (the gate's internal read, inside `hookRunState`, is the 1st).
    // That 2nd read is the one this fix hashes, verifies, and copies to a
    // private file for exec — overwrite the ORIGINAL file on disk right
    // after it returns.
    let swapPerformed = false;
    const uninstall = installReadFileSyncSwapOnNthMatch(scriptRealPath, 2, () => {
      writeFileSync(scriptRealPath, maliciousBody, 'utf8'); // same path, same inode
      swapPerformed = true;
    });

    const logger = createLogger('toctou-content-post-read-cycle', makeLogsDir());
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

    assert.ok(
      swapPerformed,
      "arrange: the readFileSync trigger (2nd matching call — prepareHookRun's own verified read) must have fired and overwritten the script in place — if false the whole test is vacuous",
    );
    assert.equal(
      readFileSync(scriptRealPath, 'utf8'),
      maliciousBody,
      'arrange: the file on disk now genuinely holds the malicious bytes, written after the verified read',
    );

    // ---- THE SECURITY ASSERTIONS — these fail RED against a "re-open the path at exec" implementation ----
    assert.equal(
      existsSync(pwnedMarkerPath),
      false,
      'the post-read on-disk overwrite must NEVER execute — a spawn that re-opens scriptPath at exec time would pick it straight up',
    );
    if (result) {
      assert.doesNotMatch(result.stdout ?? '', /PWNED/, "the overwritten script's own output must never appear — it must never be spawned");
    }
    assert.equal(
      threw,
      false,
      'there is nothing left to refuse against in this window — the bytes were already verified before the overwrite — so the approved bytes must ' +
        `still run rather than the call refusing outright. Observed: threw "${caughtMessage}"`,
    );
    assert.equal(
      existsSync(benignMarkerPath),
      true,
      'the ORIGINAL, approved bytes — copied to a private file at the verified read — must actually execute: proof that exec runs the private copy and never reopens the original path a third time',
    );
  });
});

// ---------------------------------------------------------------------------
// forge-8vfn.8.3.2 (content half, T2 review 2026-09-25) — the FIRST cut of
// this fix fed the verified script to `bash -s` on stdin, closing the TOCTOU
// but opening a correctness regression: `bash -s` reads its own commands
// INCREMENTALLY from that same stdin stream as it executes them, so a hook
// command that itself reads stdin (`read`, `cat`/`jq` with no file arg,
// `while read …`) does not get an empty pipe — it consumes the SCRIPT'S OWN
// remaining source lines as if they were input data, silently deleting
// whatever command followed. Confirmed empirically (not assumed) before this
// pin was written: `bash -xs` tracing a two-`echo`-plus-`read` script showed
// the line immediately after `read` never reached the trace at all — `read`
// ate it. Stdin must stay exactly what it was on main: an empty, unread pipe
// unless a caller supplies real `input` (nothing does today).
// ---------------------------------------------------------------------------

describe("a hook's own stdin must stay untouched by the exec mechanism (forge-8vfn.8.3.2, content half)", () => {
  it('a `read` inside a hook gets an empty line, never the next line of the hook\'s own script source', () => {
    const root = makeForgeRoot();
    const id = 'stdin-untouched-hook';

    const markerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-toctou-stdin-marker-'));
    createdDirs.push(markerDir);
    const markerPath = join(markerDir, 'read.marker');
    // The decisive shape: a `read` immediately followed by another command.
    // Under the FIRST cut's `bash -s`, `read` consumes THIS NEXT LINE — the
    // `echo` — as its own input, and the echo never runs at all.
    const scriptBody = `#!/usr/bin/env bash\nread -r line || true\necho "got:$line" > "${markerPath}"\n`;
    writeHookPackage(root, id, scriptBody, NO_ENV);
    approveHook({ forgeRoot: root, id });

    const logger = createLogger('stdin-untouched-cycle', makeLogsDir());
    // No stdin `input` supplied — `runHookScript`'s real, current contract:
    // nothing feeds the child's stdin. If the exec mechanism itself were
    // feeding the script text on stdin (the regression), `read` would find
    // SOMETHING there regardless of what this test does or does not supply.
    const result = runHookScript({ forgeRoot: root, id, logger, initiativeId: 'INIT-test' });

    assert.equal(result.exitCode, 0, 'sanity: the hook must actually run to completion');
    assert.ok(
      existsSync(markerPath),
      "the marker file must exist at all — under the bash -s regression, `read` swallows the `echo` line as its own input and the echo NEVER RUNS, so the file is never created",
    );
    assert.equal(
      readFileSync(markerPath, 'utf8'),
      'got:\n',
      'the `read` must see an empty, already-EOF stdin (no caller supplied input) — a non-empty or missing marker means the exec mechanism is feeding the script through the same stream the script itself reads from',
    );
  });
});
