/**
 * forge-8vfn.8.3.6 (M7-C PKG) — the whole-package pin.
 *
 * WHY A SEPARATE FILE from hook-runtime-toctou.test.ts, not a describe block
 * added there: same reasoning that file's own header already gives for not
 * growing hook-runtime.test.ts (which carries a grandfathered file-size
 * exemption) — new coverage for a NEW code path belongs in its own file.
 * Mirrors hook-runtime-async.test.ts's and hook-runtime-toctou.test.ts's own
 * precedent for the same module. Fixture helpers below are self-contained
 * (not imported from either sibling file, which does not export them).
 *
 * WHAT THIS FILE PINS THAT hook-runtime-toctou.test.ts DOES NOT: that file's
 * three content-TOCTOU cases and PIN D (hook-runtime.test.ts) all key off the
 * ENTRY script's own real path. Before this fix, `prepareHookRun` re-verified
 * and copied ONLY the entry script — a SIBLING a hook sources via
 * `. "$(dirname "$0")/lib.sh"` was read LIVE from the mutable original
 * directory for the whole run, because `$0` was deliberately faked back to
 * the real (mutable) path so `dirname "$0"` would find the real sibling. The
 * two doors below are that same TOCTOU shape, generalised to a file the OLD
 * code never re-verified or copied at all.
 *
 * Style: node:test + node:assert/strict, real temp forge roots + REAL spawned
 * child processes (no mocking of child_process), matching the sibling files'
 * own convention.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { createLogger } from '@forge/kernel';
import { approveHook } from '../../studio/hook-approval-ledger.ts';
import type { HookPermissionManifest } from '../../studio/hook-library.ts';

import { runHookScript, type HookRunResult } from '../../studio/hook-runtime.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — self-contained, see file header for why.
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-'));
  createdDirs.push(dir);
  return dir;
}

function makeLogsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-logs-'));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

const NO_ENV: HookPermissionManifest = { env: [], read: [], network: false };

/** Entry `scripts/run.sh` sources `scripts/lib.sh` via `$(dirname "$0")` —
 *  the exact idiom PIN D (hook-runtime.test.ts) and design.md's "Hook exec"
 *  both name. */
function writeHookPackageWithSibling(root: string, id: string, libBody: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\n. "$(dirname "$0")/lib.sh"\nhelper_main\n', 'utf8');
  writeFileSync(join(dir, 'scripts', 'lib.sh'), libBody, 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({ id, name: id, description: `Test hook ${id}.`, on: 'PreToolUse', script: 'scripts/run.sh', permissions: NO_ENV }),
    'utf8',
  );
}

/** Patches `node:fs`'s `readFileSync` so the Nth call whose `path` argument is
 *  EXACTLY `triggerPath` invokes `onTrigger()` AFTER computing (and still
 *  returning) that call's real, pre-swap content — mirrors
 *  hook-runtime-toctou.test.ts's `installReadFileSyncSwapOnNthMatch` exactly
 *  (not imported: that file does not export it). Returns an uninstall
 *  function; callers MUST call it (in a `finally`). */
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

function runApproved(root: string, id: string, name: string): { threw: boolean; message: string; result?: HookRunResult } {
  const logger = createLogger(name, makeLogsDir());
  try {
    return { threw: false, message: '', result: runHookScript({ forgeRoot: root, id, logger, initiativeId: 'INIT-test' }) };
  } catch (e) {
    return { threw: true, message: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Door 1 — sibling swapped between the gate's own read and prepareHookRun's
// own whole-package re-verify: refused, fingerprint mismatch.
// ---------------------------------------------------------------------------

describe('M7-C PKG (forge-8vfn.8.3.6): sibling overwritten between the gate read and prepareHookRun\'s whole-package re-verify', () => {
  it('a real spawned child must NEVER execute a sibling whose bytes differ from the fingerprint the approval gate just accepted', () => {
    const root = makeForgeRoot();
    const id = 'sibling-gate-swap-hook';

    const benignMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-benign-'));
    createdDirs.push(benignMarkerDir);
    const benignMarkerPath = join(benignMarkerDir, 'benign.marker');
    const benignLib = `helper_main() { echo BENIGN > "${benignMarkerPath}"; }\n`;
    writeHookPackageWithSibling(root, id, benignLib);
    approveHook({ forgeRoot: root, id });

    const libRealPath = realpathSync(join(root, 'studio', 'hooks', id, 'scripts', 'lib.sh'));

    const pwnedMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-pwned-'));
    createdDirs.push(pwnedMarkerDir);
    const pwnedMarkerPath = join(pwnedMarkerDir, 'pwned.marker');
    const maliciousLib = `helper_main() { echo PWNED > "${pwnedMarkerPath}"; }\n`;

    // Trigger on the 1st readFileSync match of lib.sh's real path — that is
    // the gate's own read (hookRunState -> snapshotHookPackage ->
    // readHookPackage), which must see and approve the ORIGINAL benign bytes.
    // Overwriting right after that read returns means prepareHookRun's OWN
    // re-verify (the 2nd matching read) sees the MALICIOUS bytes instead.
    let swapPerformed = false;
    const uninstall = installReadFileSyncSwapOnNthMatch(libRealPath, 1, () => {
      writeFileSync(libRealPath, maliciousLib, 'utf8');
      swapPerformed = true;
    });

    let outcome: ReturnType<typeof runApproved>;
    try {
      outcome = runApproved(root, id, 'sibling-gate-swap');
    } finally {
      uninstall();
    }

    assert.ok(
      swapPerformed,
      'arrange: the readFileSync trigger (1st matching call — the gate\'s own read) must have fired and overwritten the sibling — if false the whole test is vacuous',
    );

    // ---- THE SECURITY ASSERTIONS ----
    assert.equal(
      existsSync(pwnedMarkerPath),
      false,
      'the swapped sibling bytes must NEVER actually execute — a real spawned bash process ran them and wrote the marker file',
    );
    assert.equal(
      outcome.threw,
      true,
      'runHookScript must refuse (throw) once a SIBLING\'s content differs from the ledger\'s approved whole-package fingerprint, rather than executing whatever a later, unverified read of the package happens to find. ' +
        `Observed: ${outcome.threw ? `threw "${outcome.message}"` : `returned normally, stdout=${JSON.stringify(outcome.result?.stdout)}`}.`,
    );
    assert.match(
      outcome.message,
      /fingerprint mismatch/,
      'the refusal must name WHY — a fingerprint mismatch — not an unrelated failure that happens to also throw',
    );
  });
});

// ---------------------------------------------------------------------------
// Door 2 — sibling swapped AFTER prepareHookRun's own whole-package
// re-verify (the decisive window): the APPROVED sibling content must still
// be what runs, because exec now reads it from the private copy and never
// reopens the real path a third time.
// ---------------------------------------------------------------------------

describe("M7-C PKG (forge-8vfn.8.3.6): sibling overwritten AFTER prepareHookRun's verified whole-package read — the approved bytes must still be what runs", () => {
  it('a real spawned child sources the sibling bytes prepareHookRun verified, never a later on-disk overwrite of the same path', () => {
    const root = makeForgeRoot();
    const id = 'sibling-decisive-window-hook';

    const benignMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-benign2-'));
    createdDirs.push(benignMarkerDir);
    const benignMarkerPath = join(benignMarkerDir, 'benign.marker');
    const benignLib = `helper_main() { echo BENIGN > "${benignMarkerPath}"; }\n`;
    writeHookPackageWithSibling(root, id, benignLib);
    approveHook({ forgeRoot: root, id });

    const libRealPath = realpathSync(join(root, 'studio', 'hooks', id, 'scripts', 'lib.sh'));

    const pwnedMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-pwned2-'));
    createdDirs.push(pwnedMarkerDir);
    const pwnedMarkerPath = join(pwnedMarkerDir, 'pwned.marker');
    const maliciousLib = `helper_main() { echo PWNED > "${pwnedMarkerPath}"; }\n`;

    // Trigger on the 2nd readFileSync match of lib.sh's real path —
    // prepareHookRun's OWN whole-package re-verify (the gate's internal read,
    // inside hookRunState, is the 1st). That 2nd read is the one this fix
    // hashes, verifies and copies into the private tree — overwrite the
    // ORIGINAL file on disk right after it returns.
    let swapPerformed = false;
    const uninstall = installReadFileSyncSwapOnNthMatch(libRealPath, 2, () => {
      writeFileSync(libRealPath, maliciousLib, 'utf8');
      swapPerformed = true;
    });

    let outcome: ReturnType<typeof runApproved>;
    try {
      outcome = runApproved(root, id, 'sibling-decisive-window');
    } finally {
      uninstall();
    }

    assert.ok(
      swapPerformed,
      "arrange: the readFileSync trigger (2nd matching call — prepareHookRun's own whole-package re-verify) must have fired and overwritten the sibling — if false the whole test is vacuous. A 0-fire here under the OLD (entry-only) code is itself the bug: that code never re-reads a sibling at all.",
    );

    // ---- THE SECURITY ASSERTIONS ----
    assert.equal(
      existsSync(pwnedMarkerPath),
      false,
      'the post-verify on-disk overwrite of the sibling must NEVER execute',
    );
    assert.equal(
      outcome.threw,
      false,
      'there is nothing left to refuse against in this window — the sibling was already verified before the overwrite — so the approved sibling bytes must ' +
        `still run rather than the call refusing outright. Observed: threw "${outcome.message}"`,
    );
    assert.equal(
      existsSync(benignMarkerPath),
      true,
      'the ORIGINAL, approved sibling bytes — copied into the private tree at the verified read — must actually execute: proof that exec sources the sibling from the private copy and never reopens the real path a third time',
    );
  });
});

// ---------------------------------------------------------------------------
// Door 3 (regression) — a sibling ADDED to the package after approval, never
// part of what was approved: refused. This door does not require this fix's
// own mechanism (hookRunState's pre-existing whole-package packageHash gate
// already refuses an added file), but it is the shape the bead's brief names
// alongside the two above, so it is pinned here too.
// ---------------------------------------------------------------------------

describe('M7-C PKG (forge-8vfn.8.3.6): a sibling ADDED to the package after approval is refused, never silently absent-but-trusted', () => {
  it('runHookScript refuses once a file the ledger never saw appears in the package', () => {
    const root = makeForgeRoot();
    const id = 'sibling-added-after-approval-hook';
    const dir = join(root, 'studio', 'hooks', id);
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    // Guarded by `-f` so approval succeeds cleanly with no sibling present.
    writeFileSync(
      join(dir, 'scripts', 'run.sh'),
      '#!/usr/bin/env bash\nif [ -f "$(dirname "$0")/lib.sh" ]; then . "$(dirname "$0")/lib.sh"; helper_main; fi\necho done\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'hook.yaml'),
      yaml.dump({ id, name: id, description: `Test hook ${id}.`, on: 'PreToolUse', script: 'scripts/run.sh', permissions: NO_ENV }),
      'utf8',
    );
    approveHook({ forgeRoot: root, id });

    // Sanity: the approved, sibling-free hook actually runs.
    const soundness = runApproved(root, id, 'sibling-added-soundness');
    assert.equal(soundness.threw, false, 'sanity: the approved, sibling-free hook must run cleanly before a sibling is ever added');

    const pwnedMarkerDir = mkdtempSync(join(tmpdir(), 'hook-runtime-pkgpin-pwned3-'));
    createdDirs.push(pwnedMarkerDir);
    const pwnedMarkerPath = join(pwnedMarkerDir, 'pwned.marker');
    writeFileSync(join(dir, 'scripts', 'lib.sh'), `helper_main() { echo PWNED > "${pwnedMarkerPath}"; }\n`, 'utf8');

    const outcome = runApproved(root, id, 'sibling-added-after');

    assert.equal(
      existsSync(pwnedMarkerPath),
      false,
      'a sibling added after approval must never execute — it was never part of what the operator approved',
    );
    assert.equal(
      outcome.threw,
      true,
      'runHookScript must refuse once the package contains a file the ledger never saw, rather than treating an added sibling as harmless because it is unmentioned by hook.yaml',
    );
    // Caught by hookRunState's own pre-existing packageHash gate — the TOP of
    // prepareHookRun, before this fix's own whole-package re-verify is ever
    // reached — so the refusal reads as "not runnable" (needsReview: true),
    // not this fix's own "fingerprint mismatch between the gate and the
    // re-verify" message. Both are the SAME underlying fact (the live
    // packageHash no longer matches what was approved); this door pins that
    // the FIRST gate to see an added sibling already refuses it.
    assert.match(
      outcome.message,
      /not runnable.*needsReview: true/,
      'the refusal must be hookRunState\'s own deny-by-default gate for a package that no longer matches its approval, not an unrelated failure',
    );
  });
});
