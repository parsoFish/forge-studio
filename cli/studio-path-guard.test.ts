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

/**
 * ROUND 2 (2026-08-06, adversarial-review MINOR) — the final lexical
 * backstop in `resolveGuardedPath`'s create-mode branch is a false-positive
 * generator, not just a "belt and suspenders" no-op.
 *
 * Root cause: `cli/studio-path-guard.ts` L296-297:
 *
 *   const rel = relative(realRoot, realPath);
 *   if (rel === '' || rel.startsWith('..')) {
 *
 * `rel.startsWith('..')` is a bare STRING-PREFIX test, not a path-traversal
 * test. `isSafeSegment` (L177-179) correctly allows any segment NAME that is
 * merely not exactly `.` or `..` and contains no separator — so a real,
 * legally-named directory entry like `..foo` passes it. When that segment is
 * part of the not-yet-created tail, `realPath` is built as
 * `join(verified, '..foo', 'SKILL.md')`, and `relative(realRoot, realPath)`
 * correctly returns the literal string `"..foo/SKILL.md"` (path.relative only
 * treats a component that is EXACTLY `..` as a traversal token during
 * resolution; `..foo` is one opaque segment, never split). The subsequent
 * `.startsWith('..')` then fires on the first two characters of that string,
 * which happen to be dots — with zero relationship to actual containment.
 * The guard rejects a path that never left `root` at all: a false positive.
 *
 * The comment directly above the check (L293-295: "If this check ever
 * fires, treat it as a BUG IN THIS MODULE ... not as a routine
 * input-rejection path") is itself wrong for this input class — it CAN fire
 * on legitimate, fully-contained input, so "just a defensive unreachable
 * assert" is not an accurate description of the check's current behavior.
 *
 * HONEST SCOPE (do not overclaim): unreachable through all five current call
 * sites today. Every untrusted id arriving here is pre-validated by the
 * caller against `SLUG_RE` (`orchestrator/skill-path.ts:43`,
 * `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/` — MUST start with a lowercase letter,
 * so it can never begin with `.`), and every fixed literal segment this
 * module also receives (`SKILL.md`, `.forge`, `flow.yaml`, `project.json`)
 * is safe by construction. This is a correctness defect in the shared
 * module's OWN contract (and a false claim in its own doc comment), not a
 * live escape at any current route.
 *
 * Tests in this round:
 *   D1 (RED): create-mode arm — `..foo` is a genuine, real, pre-existing
 *     directory (so it passes the per-segment identity walk fine); only the
 *     leaf (`SKILL.md`) is absent, landing in the reassembly-then-lexical-
 *     backstop code path. Correct: `{ok:true, exists:false}`. Today:
 *     `{ok:false, reason:"reassembled path escapes the containment root"}` —
 *     empirically confirmed before writing this test.
 *   D2 (GREEN, already correct — locks it so the fix cannot regress it): the
 *     exists arm — leaf also a real regular file. This one does NOT reach
 *     the buggy line at all (a fully-existing chain returns early via the
 *     per-segment realpath identity walk, L250-266, before the create-mode
 *     lexical backstop ever runs) — empirically confirmed already `ok:true`
 *     today. Included per the fix-author's request so a future fix attempt
 *     that reshuffles the exists/create branches is caught if it regresses.
 *   E (GREEN, non-regression pin): a segment that IS exactly `..` must still
 *     be rejected — by `isSafeSegment`, a DIFFERENT, correct check, not the
 *     buggy lexical backstop. Pins that the fix cannot be "delete the
 *     `rel.startsWith('..')` check" — that would also have to not weaken
 *     `isSafeSegment`, and this test is the reachable place to prove real
 *     traversal segments are still refused after the fix lands.
 *
 * Self-check: D1 is an acceptance test, not characterization — if the
 * lexical backstop were STILL wrong in this exact way after a fix attempt,
 * D1 would report `ok:false` identically to today; only a genuine fix (e.g.
 * checking `rel !== '..' && !rel.startsWith('..' + sep)`, or comparing
 * `path.sep`-aware segments instead of a raw string prefix) makes D1 report
 * `ok:true`. E does not exercise the buggy line — it only proves the fix
 * cannot be "delete the check" by pinning the invariant on the one code path
 * that actually reaches real inputs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  linkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveGuardedPath,
  guardedFile,
  guardedReadFile,
  guardedWriteFile,
  guardedReadDir,
  isSafeSubPath,
} from './studio-path-guard.ts';

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

test('D1 (RED): a real ".."-prefixed directory name in create-mode is a false-positive escape rejection — must accept', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-dotfoo-create-'));
  const dotFooDir = join(root, '..foo');

  try {
    // `..foo` is a genuine, real (non-symlink) directory — a legal
    // directory-entry name: `isSafeSegment` correctly allows it (it is
    // neither `.` nor `..`, has no separator). Only the leaf (`SKILL.md`)
    // is absent, so this exercises the create-mode reassembly + lexical
    // backstop at L268-301.
    mkdirSync(dotFooDir);

    const result = resolveGuardedPath(root, ['..foo', 'SKILL.md']);

    assert.equal(
      result.ok,
      true,
      `expected the guard to ACCEPT — "..foo" is a real, fully-contained directory name, not a parent-directory traversal; containment is not violated. Got ${JSON.stringify(result)}. This is the pinned defect: the lexical backstop's bare \`rel.startsWith('..')\` string check misfires on any segment NAME that merely begins with two dots.`,
    );
    if (result.ok) {
      assert.equal(result.exists, false, 'the leaf does not exist yet — this is a create-mode save, not an edit');
      const realRoot = realpathSync(root);
      assert.equal(
        result.realPath,
        join(realRoot, '..foo', 'SKILL.md'),
        'the reassembled realPath must literally join the verified root with the not-yet-created leaf',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D2 (GREEN, already correct — locks it so the fix cannot regress it): a real ".."-prefixed dir with an existing leaf still accepts', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-dotfoo-exists-'));
  const dotFooDir = join(root, '..foo');

  try {
    // Same real, non-symlink "..foo" directory, but here the leaf ALSO
    // already exists as a real regular file — the full chain is present, so
    // this returns via the per-segment realpath identity walk (L250-266)
    // and never reaches the buggy lexical backstop at all. Confirmed
    // empirically ok:true today (not a red case) — included per the
    // fix-author's request as a non-regression companion so a future
    // reshuffle of the exists/create branches doesn't silently break this
    // arm while "fixing" D1.
    mkdirSync(dotFooDir);
    writeFileSync(join(dotFooDir, 'SKILL.md'), 'purpose: existing agent\n');

    const result = resolveGuardedPath(root, ['..foo', 'SKILL.md']);

    assert.equal(result.ok, true, `expected the guard to ACCEPT an existing, fully-contained "..foo/SKILL.md" — got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(result.exists, true, 'both segments already exist on disk — this is an edit of an existing agent');
      const realRoot = realpathSync(root);
      assert.equal(result.realPath, join(realRoot, '..foo', 'SKILL.md'), 'realPath must be the verified, identity-checked existing path');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('E (GREEN, non-regression pin): a segment that IS exactly ".." is still rejected — the fix cannot be "delete the check"', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-dotdot-segment-'));

  try {
    // This does NOT exercise the buggy lexical backstop (L296-297) — a
    // literal ".." segment is refused earlier, by `isSafeSegment` (L177-179),
    // a correct and unrelated check. It is included because it is the
    // reachable place (through the exported function, not a call site) to
    // pin that real parent-directory traversal is still refused after the
    // D1/D2 fix lands — the fix must distinguish "a name starting with two
    // dots" (D1: legitimate) from "a component that IS two dots" (E: a real
    // traversal token), not simply delete the backstop wholesale.
    const result = resolveGuardedPath(root, ['..', 'SKILL.md']);

    assert.equal(
      result.ok,
      false,
      `expected a literal ".." segment to still be rejected as unsafe — got ${JSON.stringify(result)}`,
    );
    if (!result.ok) {
      assert.match(result.reason, /unsafe path segment/i, `expected the rejection reason to name it as an unsafe segment — got "${result.reason}"`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('E2 (RED → GREEN) [SEC-05 q80 GAP 2]: a segment carrying any C0 control char (0x00 NUL / 0x01 / 0x09 / 0x0a / 0x1f) is rejected as an unsafe segment — create-mode must not reassemble a control-char leaf literally', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-ctrlchar-segment-'));
  try {
    // A FRESH/absent sourceId ('fresh-src') makes the walk break into
    // create-mode immediately, then reassemble the leaf tail literally with no
    // lstat — so before the fix a control-char leaf returns {ok:true} and the
    // caller's writeFileSync throws a raw TypeError on NUL (or silently writes a
    // control-char-named file on the others). isSafeSegment is the correct place
    // to refuse it (mirrors how it already refuses '.'/'..'/separators): the
    // rejection must fire in the up-front all-segments validation, before the
    // walk. Control chars are built from char codes so this SOURCE file carries
    // no raw control bytes.
    for (const code of [0, 1, 9, 10, 31]) {
      const seg = `a${String.fromCharCode(code)}b`;
      const hex = `0x${code.toString(16).padStart(2, '0')}`;
      const result = resolveGuardedPath(root, ['fresh-src', seg]);
      assert.equal(
        result.ok,
        false,
        `expected a segment carrying control char ${hex} to be rejected as unsafe — got ${JSON.stringify(result)}. A fresh/absent leading segment breaks the walk into create-mode, which reassembles this leaf literally WITHOUT any lstat, so an unhardened isSafeSegment lets it return ok:true.`,
      );
      if (!result.ok) {
        assert.match(result.reason, /unsafe path segment/i, `expected the rejection reason to name control char ${hex} as an unsafe segment — got "${result.reason}"`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * ROUND 3 (2026-08-06, guard-attack round, Finding 2, MAJOR) — create-mode
 * skips `isSafeSegment` for every segment AFTER the walk's `break`.
 *
 * Root cause: `resolveGuardedPath`'s per-segment loop (L213-248) calls
 * `isSafeSegment(seg)` only for segments it actually iterates BEFORE the
 * `break` on the first absent segment (L228, "deepest existing ancestor is
 * `verified` — stop, create-mode from here"). Once that break fires, the
 * function falls straight to the create-mode branch:
 *
 *   const realPath = join(verified, ...segments.slice(i));
 *
 * `segments.slice(i)` — every segment from the first non-existent one onward
 * — is joined LITERALLY, with NO re-validation. So a `'..'` (or `'.'`, or a
 * segment carrying an embedded `/`) appearing anywhere AFTER that first
 * absent segment is silently normalized/interpreted by `join()` instead of
 * being rejected by `isSafeSegment` — the exact per-segment check every
 * PRE-break segment gets. This re-opens the cross-object escape shape this
 * whole module exists to close, through create-mode specifically: a walk
 * that starts down one real object's directory can step back OUT via `'..'`
 * and into a DIFFERENT real sibling object once it passes an absent segment.
 * The final `relative()` backstop (L310-313) does not catch it either — its
 * job is only "did the LITERAL reassembly's first segment come out as `..`",
 * and after `join()` normalizes the embedded `..` pair away, the reassembled
 * path's first segment is an ordinary directory name, not `..`.
 *
 * This is the cross-object escape shape (see the module's escape-shape #3 in
 * its own header) re-entering through create-mode, AND the module's own
 * inline comment directly above the create-mode reassembly line — "reassemble
 * them literally (their names already passed isSafeSegment)" — is factually
 * wrong for exactly this reason. Restated here for the record; T3 is
 * tests-only, so the false comment itself is left for the production fix,
 * not corrected in this file.
 *
 * Confirmed live repro: a root containing a real `idA/` and a real
 * `idB/hook.yaml`, `resolveGuardedPath(root, ['idA', 'nonexistent', '..',
 * '..', 'idB', 'hook.yaml'])` returns `{ok:true, exists:false,
 * realPath:'<root>/idB/hook.yaml'}` — pointing at a DIFFERENT, genuinely
 * existing object while falsely reporting `exists:false`.
 *
 * Tests in this round:
 *   F  (RED): the confirmed repro above — pins BOTH that the call must be
 *      REJECTED, and that `exists` must never read `false` for a realPath
 *      that genuinely exists (the second property must hold even if some
 *      future, different-shaped fix somehow left `ok:true` on this input).
 *   G1 (RED): a bare `'..'` as the very LAST segment of the tail.
 *   G2 (RED): a bare `'.'` segment appearing after the break.
 *   G3 (RED): a segment carrying an embedded `/` appearing after the break.
 *   H  (GREEN, non-regression): ordinary create-mode — a brand-new id whose
 *      directory does not exist yet, with only safe, single-component tail
 *      segments — must keep returning `{ok:true, exists:false}` with the
 *      literally-reassembled path. This is the property every create route
 *      (scaffold-on-save for a new agent/flow/project/hook) depends on; a fix
 *      that re-validates the tail must not reject THIS shape.
 */

test('F (RED) [Finding 2]: create-mode reassembly skips isSafeSegment past the break — a ".." pair after a nonexistent segment walks back into a DIFFERENT REAL sibling object', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-createskip-crossobject-'));
  try {
    mkdirSync(join(root, 'idA'));
    mkdirSync(join(root, 'idB'));
    writeFileSync(join(root, 'idB', 'hook.yaml'), 'name: legit idB hook\n');

    const result = resolveGuardedPath(root, ['idA', 'nonexistent', '..', '..', 'idB', 'hook.yaml']);

    // Property 2 is asserted FIRST, deliberately: `assert.equal` carries an
    // `asserts actual is T` signature, so asserting property 1 narrows
    // `result` to PathGuardReject and makes this branch statically dead
    // (`never`). Checking it while the type is still the union keeps BOTH
    // properties genuinely live rather than one of them silently unreachable.
    //
    // Property 2 (must hold independent of how property 1 is satisfied): a
    // path that genuinely exists on disk (idB/hook.yaml is real) must NEVER
    // be reported exists:false — that exact combination (ok:true,
    // exists:false, realPath pointing at a real object) is the false "safe to
    // create" certification this defect produces.
    if (result.ok) {
      assert.notEqual(
        result.exists,
        false,
        `a path pointing at a genuinely EXISTING file (${join(root, 'idB', 'hook.yaml')}) must never be reported exists:false — got ${JSON.stringify(result)}`,
      );
    }
    // Property 1: the call must be rejected outright — a ".." segment
    // anywhere in the input is exactly what isSafeSegment exists to catch,
    // and it must be checked regardless of which side of the break it falls on.
    assert.equal(
      result.ok,
      false,
      `expected the guard to REJECT this create-mode walk — got ${JSON.stringify(result)}. The walk breaks at the first absent segment ("nonexistent") and reassembles the REMAINING segments with a bare join(verified, ...segments.slice(i)) — never re-running isSafeSegment on them — so the two ".." segments that follow are silently normalized away by join(), walking back OUT of idA/ and INTO idB/, a different, genuinely real sibling object.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('G1 (RED) [Finding 2]: a bare ".." as the very LAST tail segment is never re-checked by isSafeSegment', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-createskip-trailingdotdot-'));
  try {
    mkdirSync(join(root, 'idA'));

    const result = resolveGuardedPath(root, ['idA', 'nonexistent', 'legit', '..']);

    assert.equal(
      result.ok,
      false,
      `expected the guard to reject a tail containing a literal ".." segment (here, the very last one) — got ${JSON.stringify(result)}. isSafeSegment is the check that exists to catch this, and it is only applied to segments visited BEFORE the break.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('G2 (RED) [Finding 2]: a bare "." segment after the break is never re-checked by isSafeSegment', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-createskip-dotseg-'));
  try {
    mkdirSync(join(root, 'idA'));

    const result = resolveGuardedPath(root, ['idA', 'nonexistent', '.', 'hook.yaml']);

    assert.equal(
      result.ok,
      false,
      `expected the guard to reject a tail containing a literal "." segment after the break — got ${JSON.stringify(result)}. join() silently collapses "." away, so the reassembled path looks perfectly ordinary even though a segment isSafeSegment would refuse was never checked.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('G3 (RED) [Finding 2]: a segment carrying an embedded "/" after the break is never re-checked by isSafeSegment', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-createskip-slashseg-'));
  try {
    mkdirSync(join(root, 'idA'));

    const result = resolveGuardedPath(root, ['idA', 'nonexistent', 'sub/evil', 'hook.yaml']);

    assert.equal(
      result.ok,
      false,
      `expected the guard to reject a tail segment carrying an embedded "/" after the break — got ${JSON.stringify(result)}. isSafeSegment refuses any segment containing a separator (it exists precisely so a single logical segment can never inject extra path components); join() happily interprets the embedded "/" as two directory levels instead.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('H (GREEN, non-regression) [Finding 2]: ordinary create-mode for a brand-new id (no break-then-tail shenanigans) still returns {ok:true, exists:false} with the literal path — the fix must not break scaffold-on-save', () => {
  const root = mkdtempSync(join(tmpdir(), 'path-guard-createskip-nonregression-'));
  try {
    // 'newid' does not exist under root at all — the break fires on the
    // VERY FIRST segment, and both tail segments are ordinary, single-
    // component, safe names. Every create route (new agent/flow/project/hook)
    // depends on exactly this shape working.
    const result = resolveGuardedPath(root, ['newid', 'SKILL.md']);

    assert.equal(result.ok, true, `expected ordinary create-mode to still succeed — got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(result.exists, false, 'a brand-new id path must report exists:false');
      const realRoot = realpathSync(root);
      assert.equal(
        result.realPath,
        join(realRoot, 'newid', 'SKILL.md'),
        'the reassembled realPath must literally join the verified root with the not-yet-created segments',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * ===========================================================================
 * SEC-04 — the FULL-PATH sink primitive (`guardedFile` + ergonomic wrappers).
 * ===========================================================================
 *
 * SEC-04 class: contain the FULL opened file path (LEAF INCLUDED) at every
 * project-derived fs sink. The shipped defect shape is "guard the DIRECTORY
 * with resolveGuardedPath, then RAW-APPEND the leaf with join(dir, 'status.json')
 * and read/write THAT" — a symlinked/hardlinked LEAF inside a genuinely real,
 * identity-verified directory escapes because the guard never inspected the
 * filename. `guardedFile` routes the entire path (leaf included) through ONE
 * resolveGuardedPath call so the per-segment identity walk + nlink check reach
 * the leaf.
 *
 * These are primitive tests, not RED-first pins (the primitive is new). To keep
 * them from "passing by accident" (immutable-gates catalogue), each rejection
 * test plants a distinguishable SECRET at the escape target and a COUNTER-PROOF
 * that a naive raw-append read WOULD have leaked it — so a `null` is proven to
 * be containment, not an incidental miss. Each fixture carries an arrange-step
 * self-check asserting the symlink/hardlink is genuinely what the test claims,
 * so the assertion is never vacuous.
 *
 * `realpathSync(tmpdir())` is used as the containment baseline throughout:
 * on macOS/some Linux setups /tmp is itself a symlink, and the guard realpaths
 * its root, so comparisons must be against the resolved root.
 */

test('SEC-04 P1 (read): a symlinked LEAF inside a real directory → guardedFile null (no leaf escape); a raw-append read WOULD have leaked', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-symleaf-'));
  const outside = mkdtempSync(join(tmpdir(), 'sec04-symleaf-OUTSIDE-'));
  try {
    const secretPath = join(outside, 'secret.json');
    writeFileSync(secretPath, JSON.stringify({ SECRET: 'victim-cross-project-read' }));

    const agentDir = join(root, 'agent');
    mkdirSync(agentDir); // a GENUINELY real, identity-clean directory
    const leaf = join(agentDir, 'status.json');
    symlinkSync(secretPath, leaf); // the LEAF is a symlink pointing OUTSIDE root

    // Arrange self-check: the leaf is really a symlink resolving outside root.
    assert.ok(lstatSync(leaf).isSymbolicLink(), 'arrange: leaf must be a symlink or the test is vacuous');
    assert.equal(realpathSync(leaf), realpathSync(secretPath), 'arrange: leaf must resolve to the outside secret');

    // Counter-proof: the exact "guard the dir, raw-append the leaf" shape SEC-04
    // closes WOULD read the outside secret. Proves the fixture is a real escape
    // vector, so the null below is protection, not an accidental miss.
    const dirGuard = resolveGuardedPath(root, ['agent']);
    assert.equal(dirGuard.ok, true, 'arrange: the DIRECTORY guard passes (it is a real dir) — that is exactly the trap');
    if (dirGuard.ok) {
      const leaked = readFileSync(join(dirGuard.realPath, 'status.json'), 'utf8');
      assert.match(leaked, /victim-cross-project-read/, 'arrange: a raw-append read leaks the outside secret — the defect this closes');
    }

    // Act: guardedFile routes the LEAF through the guard → rejected.
    assert.equal(guardedFile(root, ['agent', 'status.json'], 'read'), null, 'symlinked leaf must be rejected (null)');
    assert.equal(guardedReadFile(root, ['agent', 'status.json']), null, 'the ergonomic read wrapper must not leak the secret either');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('SEC-04 P2 (read): a real leaf in a real directory → guardedFile returns the realpath; guardedReadFile returns the contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-realleaf-'));
  try {
    const agentDir = join(root, 'agent');
    mkdirSync(agentDir);
    const leaf = join(agentDir, 'status.json');
    writeFileSync(leaf, JSON.stringify({ phase: 'exploring' }));

    const got = guardedFile(root, ['agent', 'status.json'], 'read');
    assert.equal(got, realpathSync(leaf), 'a real, contained leaf must return its realpath-verified absolute path');

    const contents = guardedReadFile(root, ['agent', 'status.json']);
    assert.ok(contents !== null, 'guardedReadFile must return contents for a real contained leaf');
    assert.match(contents!, /exploring/, 'guardedReadFile must return the actual file contents');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SEC-04 P3 (write): create-mode — a not-yet-existing leaf (and dir) returns its reassembled path; guardedWriteFile creates+writes it', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-createleaf-'));
  try {
    const realRoot = realpathSync(root);
    // Neither the 'newagent' dir NOR the 'status.json' leaf exist yet — the
    // legitimate scaffold-on-save shape. Write mode must return the path.
    const got = guardedFile(root, ['newagent', 'status.json'], 'write');
    assert.equal(got, join(realRoot, 'newagent', 'status.json'), 'create-mode write must return the reassembled path for a missing leaf');
    assert.ok(!existsSync(join(realRoot, 'newagent', 'status.json')), 'guardedFile itself must NOT create anything — it only resolves');

    // The ergonomic writer creates the parent dir + writes, returns the path.
    const written = guardedWriteFile(root, ['newagent', 'status.json'], JSON.stringify({ phase: 'drafting' }));
    assert.equal(written, join(realRoot, 'newagent', 'status.json'), 'guardedWriteFile returns the written path');
    assert.ok(existsSync(written!), 'guardedWriteFile must have created the file');
    assert.match(readFileSync(written!, 'utf8'), /drafting/, 'the written contents must be readable back');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SEC-04 P3b (write): a symlinked create-mode leaf is still rejected (null) — write never escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-writesym-'));
  const outside = mkdtempSync(join(tmpdir(), 'sec04-writesym-OUTSIDE-'));
  try {
    const victim = join(outside, 'victim.json');
    writeFileSync(victim, 'original-untouched');
    const agentDir = join(root, 'agent');
    mkdirSync(agentDir);
    const leaf = join(agentDir, 'status.json');
    symlinkSync(victim, leaf); // leaf exists as a symlink to an outside file
    assert.ok(lstatSync(leaf).isSymbolicLink(), 'arrange: leaf must be a symlink');

    assert.equal(guardedFile(root, ['agent', 'status.json'], 'write'), null, 'a symlinked write leaf must be rejected');
    assert.equal(guardedWriteFile(root, ['agent', 'status.json'], 'ATTACKER'), null, 'guardedWriteFile must refuse and write nothing');
    assert.equal(readFileSync(victim, 'utf8'), 'original-untouched', 'the outside victim file must be byte-unchanged (artifact-level assertion)');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('SEC-04 P4 (readdir): a real directory leaf → guardedFile returns its realpath; guardedReadDir lists it; a real FILE leaf → null', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-realdir-'));
  try {
    const dir = join(root, 'kind');
    mkdirSync(dir);
    mkdirSync(join(dir, 'sess-A'));
    mkdirSync(join(dir, 'sess-B'));

    const got = guardedFile(root, ['kind'], 'readdir');
    assert.equal(got, realpathSync(dir), 'a real contained directory must return its realpath for readdir');

    const entries = guardedReadDir(root, ['kind']);
    assert.ok(entries !== null, 'guardedReadDir must return entries for a real directory');
    assert.deepEqual(entries!.sort(), ['sess-A', 'sess-B'], 'guardedReadDir must list the real entries');

    // A real FILE (not a directory) in readdir mode collapses to null.
    writeFileSync(join(root, 'afile'), 'x');
    assert.equal(guardedFile(root, ['afile'], 'readdir'), null, 'readdir mode on a real FILE leaf must return null (isDirectory gate)');
    assert.equal(guardedReadDir(root, ['afile']), null, 'guardedReadDir on a file must return null');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SEC-04 P5 (readdir): a symlinked DIRECTORY leaf → null (no directory-symlink enumeration escape); raw readdir WOULD have listed the outside dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-symdir-'));
  const outside = mkdtempSync(join(tmpdir(), 'sec04-symdir-OUTSIDE-'));
  try {
    mkdirSync(join(outside, 'sess-VICTIM')); // an outside session id an attacker wants to enumerate
    const evil = join(root, 'evil');
    symlinkSync(outside, evil); // the directory leaf itself is a symlink pointing outside
    assert.ok(lstatSync(evil).isSymbolicLink(), 'arrange: the dir leaf must be a symlink');

    // Counter-proof: realpath of the symlink IS the outside dir (a raw readdir
    // would enumerate the victim ids — the R6-06 no-guessing chain).
    assert.equal(realpathSync(evil), realpathSync(outside), 'arrange: the symlink resolves to the outside dir');

    assert.equal(guardedFile(root, ['evil'], 'readdir'), null, 'a symlinked directory leaf must be rejected for readdir');
    assert.equal(guardedReadDir(root, ['evil']), null, 'guardedReadDir must refuse the symlinked directory (no enumeration escape)');
    // And a leaf UNDER the symlinked dir is rejected too (the R6-06 read leg).
    assert.equal(guardedFile(root, ['evil', 'sess-VICTIM', 'status.json'], 'read'), null, 'reading through a symlinked dir leaf must be rejected');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('SEC-04 P6 (read): a HARDLINKED file leaf (nlink != 1) → null; a raw read WOULD have leaked the shared inode', () => {
  const root = mkdtempSync(join(tmpdir(), 'sec04-hardlink-'));
  const outside = mkdtempSync(join(tmpdir(), 'sec04-hardlink-OUTSIDE-'));
  try {
    const secretPath = join(outside, 'secret.json');
    writeFileSync(secretPath, JSON.stringify({ SECRET: 'hardlink-shared-inode' }));

    const agentDir = join(root, 'agent');
    mkdirSync(agentDir);
    const leaf = join(agentDir, 'status.json');
    // A HARDLINK: same inode as the outside secret, but a genuine (non-symlink)
    // directory entry lexically AND really inside root — realpath is blind to it.
    linkSync(secretPath, leaf);

    // Arrange self-check: the leaf is NOT a symlink, shares the inode, nlink==2.
    const st = lstatSync(leaf);
    assert.ok(!st.isSymbolicLink(), 'arrange: a hardlink is not a symlink');
    assert.equal(st.nlink, 2, 'arrange: the hardlinked leaf must have nlink 2 (shared inode)');
    assert.equal(realpathSync(leaf), leaf, 'arrange: realpath leaves a hardlink path unchanged — nothing to resolve (why realpath-only checks miss it)');

    // Counter-proof: a raw read through the in-tree path leaks the shared inode.
    assert.match(readFileSync(leaf, 'utf8'), /hardlink-shared-inode/, 'arrange: raw read leaks the shared-inode secret — the defect nlink!=1 closes');

    assert.equal(guardedFile(root, ['agent', 'status.json'], 'read'), null, 'a hardlinked leaf (nlink != 1) must be rejected');
    assert.equal(guardedReadFile(root, ['agent', 'status.json']), null, 'guardedReadFile must not leak through the shared inode');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('SEC-04 P7 (root-trust contract): a request-influenced project id as a SEGMENT is contained; folded into ROOT it escapes — the primitive cannot self-detect a bad root', () => {
  // This pins the SEC-04 root cause asymmetry (the module docstring CONTRACT):
  // project_repo_path is REQUEST-INFLUENCED (persisted from a /start body) and
  // MUST NOT be passed as the guard `root`. The trusted root is
  // projectsRoot/logsRoot/forgeRoot.
  const projectsRoot = mkdtempSync(join(tmpdir(), 'sec04-contract-PROJECTS-'));
  const outsideVictim = mkdtempSync(join(tmpdir(), 'sec04-contract-VICTIM-'));
  try {
    const victimStatus = join(outsideVictim, 'status.json');
    writeFileSync(victimStatus, JSON.stringify({ SECRET: 'victim-project-status' }));

    // The attacker project's on-disk dir is a symlink pointing at the victim —
    // plantable by an ordinary git commit (git tracks symlinks). Its path is
    // exactly what would be persisted as project_repo_path from a /start body.
    const projectRepoPath = join(projectsRoot, 'attacker');
    symlinkSync(outsideVictim, projectRepoPath);
    assert.ok(lstatSync(projectRepoPath).isSymbolicLink(), 'arrange: the attacker project dir is a symlink to the victim');

    // SAFE FORM — the request-influenced id arrives as its OWN segment under the
    // TRUSTED projectsRoot: the per-segment identity walk catches the symlink.
    assert.equal(
      guardedFile(projectsRoot, ['attacker', 'status.json'], 'read'),
      null,
      'CONTAINED: a symlinked project id passed as a SEGMENT under the trusted root is rejected',
    );

    // WRONG FORM — project_repo_path folded into `root` (the SEC-04 root cause):
    // resolveGuardedPath realpaths `root` with NO identity check, so containment
    // is tautological and the outside victim is read. This is the DOCUMENTED
    // hole the caller contract forbids — the primitive CANNOT detect a
    // request-derived root (indistinguishable from a trusted string here).
    const escaped = guardedFile(projectRepoPath, ['status.json'], 'read');
    assert.notEqual(escaped, null, 'CONTRACT-FLAG: folding project_repo_path into root escapes — the guard cannot self-detect a bad root');
    assert.equal(
      realpathSync(escaped!),
      realpathSync(victimStatus),
      'CONTRACT-FLAG: the escaped read resolves to the OUTSIDE victim status — proving why the caller must pass projectsRoot/logsRoot/forgeRoot as root, never project_repo_path',
    );
    // And that escaped path is genuinely OUTSIDE the trusted projectsRoot.
    assert.ok(
      !realpathSync(escaped!).startsWith(realpathSync(projectsRoot)),
      'CONTRACT-FLAG: the folded-root read landed outside the trusted projectsRoot entirely',
    );
  } finally {
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(outsideVictim, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// isSafeSubPath — W7-C3 review (A-M6). The shared DENY predicate the artifact
// route's cheap 400 layer and `resolveGuardedPath`'s containment layer both
// read, so the two cannot drift. Its predecessor was an allow-list charset
// that rejected 10.8% of the operator's real on-disk artifact files while
// adding zero containment; these two tests are the both-ways pin.
// ---------------------------------------------------------------------------

test('isSafeSubPath ALLOWS the shapes real artifact filenames actually take', () => {
  const legitimate = [
    'PLAN.md',
    '.capture/after/Acceptance fixture gate (npm run acceptance).out',
    '.capture/before/Quality gate \u2014 release + taskagent packages green.out',
    "operator's notes.md", // an apostrophe
    '..foo.txt', // a dot-dot PREFIX is a name, not traversal
    'a..b.txt', // and so is an infix
    'WI-1 [done].md',
    '\u65e5\u672c\u8a9e.txt', // non-ASCII is a filename, not an attack
  ];
  for (const name of legitimate) {
    assert.equal(isSafeSubPath(name), true, `a legitimate artifact name was refused: ${JSON.stringify(name)}`);
  }
});

test('isSafeSubPath DENIES the shapes that matter', () => {
  const denied: Array<[string, unknown]> = [
    ['empty', ''],
    ['a "." segment', './ok.txt'],
    ['a ".." segment', '../ok.txt'],
    ['a trailing ".." segment', 'a/..'],
    ['an empty middle segment', 'a//b.txt'],
    ['a backslash separator', 'a\\b.txt'],
    ['a NUL byte', 'ok\u0000.txt'],
    ['a C0 control', 'ok\u0001.txt'],
    ['DEL', 'ok\u007f.txt'],
    ['an encoded forward slash', 'a%2Fb.txt'],
    ['an encoded backslash', 'a%5Cb.txt'],
    ['an encoded NUL', 'a%00b.txt'],
    ['encoded dot-dot', 'a%2e%2eb.txt'],
    // Runtime boundary: the annotation is a claim, not a check.
    ['a non-string', 42],
    ['null', null],
    ['an array', ['a', 'b']],
  ];
  for (const [label, value] of denied) {
    assert.equal(isSafeSubPath(value as string), false, `${label} must be denied: ${JSON.stringify(value)}`);
  }
});
