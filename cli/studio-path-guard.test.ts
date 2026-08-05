/**
 * ACCEPTANCE TEST (must be RED until fixed) — R2-09: `resolveGuardedPath`'s
 * existence probe converts "cannot determine" into "definitely absent",
 * which is a fail-open CLASSIFICATION defect (not a demonstrated
 * write-through escape — see the honest-scope note below).
 *
 * Root cause: `cli/studio-path-guard.ts`'s module-private `lexists()`
 * (L112-119) is a blanket try/catch around `lstatSync`:
 *
 *   function lexists(path: string): boolean {
 *     try { lstatSync(path); return true; } catch { return false; }
 *   }
 *
 * It reports "does not exist" for EVERY `lstatSync` failure, not just
 * ENOENT. `resolveGuardedPath`'s per-segment walk (L165) uses it as the sole
 * stop condition: `if (!lexists(expected)) break;` — the break means "the
 * deepest existing ancestor is `verified`; everything from here down is
 * create-mode, reassembled literally, because a non-existent path component
 * cannot itself be a symlink or hardlink" (see the function's own docstring,
 * L51-58). That reasoning is sound ONLY when the negative genuinely means
 * ENOENT. When `lstatSync` throws for a DIFFERENT reason — EACCES (a
 * directory ancestor with no search permission) or ENOTDIR (a regular FILE
 * occupying a path segment expected to be a directory) — the guard cannot
 * tell whether the entry exists, yet treats "cannot tell" identically to
 * "confirmed absent" and falls into the SAME create-mode branch, returning
 * `{ok: true, exists: false, realPath}` for a leaf it never actually
 * inspected — the guard's own stated job (its file-header docstring:
 * "identity-verifies only [the deepest existing ancestor]") is silently
 * skipped for that segment.
 *
 * Correct behaviour: an `lstatSync` failure that is NOT `ENOENT` must fail
 * CLOSED — `{ok: false, reason: <names the undeterminable segment>}` —
 * never fall into create-mode reassembly. A genuine `ENOENT` must keep
 * working EXACTLY as today (create-mode); that non-regression is pinned in
 * test C below, because a fix that rejects unconditionally on ANY
 * `lstatSync` throw would also make A and B pass while breaking every
 * legitimate create-a-new-agent/-flow/-project save.
 *
 * HONEST SCOPE (do not overclaim): this pins a fail-open CLASSIFICATION
 * defect, not a demonstrated arbitrary-file-write escape at the four current
 * call sites. The same permission/type error that blinds the guard also
 * blocks the caller's own subsequent `readFileSync`/`writeFileSync` through
 * that same path — the caller cannot actually read or write through an
 * EACCES- or ENOTDIR-blocked path either. What's wrong is narrower and still
 * real: the guard certifies "verified safe to create" for a path segment it
 * never inspected — the identical "certifies what it did not check" shape
 * this campaign has repeatedly closed elsewhere (c.f. the ledger's
 * root-folding finding). No test here asserts a write-through actually
 * occurring.
 *
 * Each assertion below pins the CLASSIFICATION, not incidental output shape:
 *   A. EACCES ancestor  → asserts `ok === false` (today: `true`) — RED.
 *   B. ENOTDIR mid-path → asserts `ok === false` (today: `true`) — RED.
 *   C. Genuine ENOENT   → asserts `ok === true, exists === false` with the
 *      correctly reassembled `realPath`, UNCHANGED — GREEN, guards against a
 *      "reject everything" over-fix.
 * Self-check: if the implementation were wrong in the pinned way, A and B
 * would report `ok:true` identically to today — that IS today's bug — so an
 * `ok:false` result is the one thing a correct fix must produce that the
 * current code structurally cannot. That is what makes these acceptance
 * tests rather than characterization tests.
 *
 * Both A and B include an arrange-step self-check: each first calls
 * `lstatSync` directly on the probe path and asserts it throws with the
 * expected `code` (`EACCES` / `ENOTDIR`). The test process runs as uid 1000
 * (asserted in the sanity test below) — without this self-check, a test
 * running as root (or on a filesystem that doesn't enforce the permission
 * bit) would silently pass vacuously instead of exercising the real code
 * path.
 *
 * Mode-000 directories are restored to 0o700 in a `finally` before
 * `rmSync` — `rmSync(..., {recursive:true})` cannot descend into or remove a
 * mode-000 directory as a non-root user, and leaving one behind pollutes
 * /tmp for every later cleanup that touches it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveGuardedPath } from './studio-path-guard.ts';

test('sanity: test process is non-root (uid 1000) — mode 000 genuinely denies access, not bypassed', () => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  assert.notEqual(uid, 0, `expected a non-root uid so mode-000 permission checks are actually enforced; got uid ${uid}`);
});

test('A (RED): EACCES on a blocked-ancestor lstat is misclassified as "does not exist" — must reject, not create-mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-eacces-'));
  const blockedDir = join(root, 'blocked-agent');
  mkdirSync(blockedDir);

  try {
    chmodSync(blockedDir, 0o000); // no read, no search/execute — even the owner is denied on Linux

    // Arrange-step self-check: prove the permission bit genuinely blocks
    // lstat through this ancestor for THIS process, or the rest of the test
    // would pass vacuously.
    const probePath = join(blockedDir, 'SKILL.md');
    let arrangeThrew = false;
    try {
      lstatSync(probePath);
    } catch (err) {
      arrangeThrew = true;
      assert.equal(
        (err as NodeJS.ErrnoException).code,
        'EACCES',
        `expected lstatSync through the mode-000 ancestor to throw EACCES — got ${(err as NodeJS.ErrnoException).code}`,
      );
    }
    assert.ok(
      arrangeThrew,
      'arrange-step failed: lstatSync through the mode-000 directory did not throw at all — this test would be vacuous (running as root?)',
    );

    // Act: ask the guard for <root>/blocked-agent/SKILL.md. `blocked-agent`
    // itself is identity-verified fine (lstat/realpath OF it only needs
    // search permission ON `root`, not on itself); the walk then tries to
    // lstat the SKILL.md child THROUGH the mode-000 dir and gets EACCES,
    // which today's `lexists` swallows into "does not exist".
    const result = resolveGuardedPath(root, ['blocked-agent', 'SKILL.md']);

    assert.equal(
      result.ok,
      false,
      `expected the guard to REJECT (cannot determine whether SKILL.md exists behind an EACCES ancestor) — got ${JSON.stringify(result)}. This is the pinned defect: an undeterminable segment is being certified "safe to create".`,
    );
  } finally {
    chmodSync(blockedDir, 0o700); // restore before rmSync, or cleanup fails and leaks into /tmp
    rmSync(root, { recursive: true, force: true });
  }
});

test('B (RED): ENOTDIR from a file occupying a mid-path segment is misclassified as "does not exist" — must reject, not create-mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-enotdir-'));
  const fileWhereDirExpected = join(root, 'file-not-dir-agent');

  try {
    writeFileSync(fileWhereDirExpected, 'this is a regular file, not a directory');

    // Arrange-step self-check: prove lstat through the file-as-directory
    // segment genuinely throws ENOTDIR for this filesystem/process.
    const probePath = join(fileWhereDirExpected, 'SKILL.md');
    let arrangeThrew = false;
    try {
      lstatSync(probePath);
    } catch (err) {
      arrangeThrew = true;
      assert.equal(
        (err as NodeJS.ErrnoException).code,
        'ENOTDIR',
        `expected lstatSync through a file-occupied segment to throw ENOTDIR — got ${(err as NodeJS.ErrnoException).code}`,
      );
    }
    assert.ok(arrangeThrew, 'arrange-step failed: lstatSync did not throw at all — this test would be vacuous');

    // Act: <root>/file-not-dir-agent is a real, identity-verified FILE
    // (correctly so — no bug there); the walk then asks for a SKILL.md
    // "inside" it, which is structurally impossible, and gets ENOTDIR —
    // today's `lexists` swallows this into "does not exist" too.
    const result = resolveGuardedPath(root, ['file-not-dir-agent', 'SKILL.md']);

    assert.equal(
      result.ok,
      false,
      `expected the guard to REJECT (a file occupies the parent segment, so existence of the child is undeterminable, not "absent") — got ${JSON.stringify(result)}.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('C (GREEN, non-regression): genuine ENOENT still returns create-mode {ok:true, exists:false} with the correct reassembled realPath', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-enoent-'));

  try {
    // Nothing named 'nonexistent-agent' exists under root at all — a
    // genuine, unambiguous absence. This is the ONLY case where "does not
    // exist" is actually true, and it must keep working exactly as today: a
    // fix that rejects on every lstatSync throw (not just non-ENOENT ones)
    // would break every legitimate create-a-new-agent/-flow/-project save.
    const result = resolveGuardedPath(root, ['nonexistent-agent', 'SKILL.md']);

    assert.equal(result.ok, true, `expected create-mode to still succeed for a genuinely absent path — got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(result.exists, false, 'a brand-new agent path must report exists:false');
      const realRoot = realpathSync(root);
      assert.equal(
        result.realPath,
        join(realRoot, 'nonexistent-agent', 'SKILL.md'),
        'the reassembled realPath must literally join the verified root with the not-yet-created segments',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
