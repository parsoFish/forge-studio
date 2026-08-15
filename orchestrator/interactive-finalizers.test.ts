/**
 * R4-22 WI-2 (T3, acceptance tests) — pins the contract for
 * `orchestrator/interactive-finalizers.ts` BEFORE it exists (ADR-043 §2/§5).
 *
 * ADR-043 §5 ratifies a deep-frozen `FINALIZERS` registry of pure exported
 * functions with explicit error contracts (ADR-042's third boundary), seeded
 * incrementally — THIS WI seeds exactly ONE entry: `copyStagingToLibrary`,
 * the step a generic interactive runner invokes at the `committing` phase to
 * install a drafted package from its session's staging dir into the real
 * library under the forge root.
 *
 * THE CONTRACT THIS FILE PINS (my call, as the writer of these tests, on the
 * parts ADR-043/the WI leave open — stated explicitly so the implementer has
 * one target):
 *
 *   export type FinalizerId = 'copyStagingToLibrary';
 *   export type FinalizerFn = (ctx: FinalizerContext) => string[] | Promise<string[]>;
 *   export type FinalizerRow = { readonly id: FinalizerId; readonly run: FinalizerFn };
 *   export const FINALIZERS: readonly FinalizerRow[];               // deep-frozen, exactly 1 row today
 *   export function resolveFinalizer(id: string): FinalizerFn | undefined;  // TOTAL, never throws
 *   export function copyStagingToLibrary(ctx: {
 *     sessionDir: string;    // trusted — the caller already SEC-04-guarded this
 *     forgeRoot: string;     // trusted, config-derived
 *     libraryRoot: string;   // trusted, config-derived containment root
 *     packageId: string;     // UNTRUSTED, request-derived
 *   }): string[] | Promise<string[]>;                                // sync OR async — tests below `await`
 *                                                                     // either shape uniformly and never assume one
 *
 * Layout pinned: walks `<sessionDir>/staging/` recursively; installs each
 * entry at `<libraryRoot>/<packageId>/<relPath...>`, resolving that FULL
 * destination (leaf included) through the EXISTING `resolveGuardedPath`
 * (`cli/studio-path-guard.ts`) with `packageId` and every relative-path
 * component passed as their OWN elements of `segments[]` — never folded into
 * the `root` argument (see that module's CONTRACT section: folding makes the
 * containment comparison tautological).
 *
 * Row field name (`run`) is my own naming choice — not dictated by the WI,
 * which specifies only the `id` vocabulary and the total-lookup shape.
 *
 * DISCIPLINE: this file is black-box against `copyStagingToLibrary` — it
 * never imports `resolveGuardedPath` directly and never assumes an internal
 * mechanism. Every escape test plants a distinguishable SECRET/CANARY
 * *before* invoking the finalizer and byte-compares it *after*, so a
 * rejection is proven to be containment, not an accidental miss (the
 * "counter-proof" discipline already established in
 * cli/studio-path-guard.test.ts SEC-04 P1 etc.). Every symlink/hardlink
 * fixture asserts its own precondition (lstat/nlink) before reading the
 * verdict, and skips cleanly via `t.skip` if the platform cannot create the
 * link — never silently passes.
 *
 * RED-NOW: the entire suite fails at import time ("Cannot find module
 * './interactive-finalizers.ts'") because the module does not exist yet —
 * see the run output recorded in this WI's report.
 *
 * ADDENDUM (T3 second pass, R4-22 WI-2): a TOCTOU test pinning an
 * adversarial-review-REPRODUCED finding (not discovered by this file) was
 * added at the bottom — `copyStagingToLibrary`'s CHECK-THEN-WRITE is two
 * PHASES (`discoverStagingEntries` validates + records every entry's
 * `srcRealPath`; a later, separate loop `readFileSync`s each recorded path)
 * with a real gap between them: a staged entry swapped for a symlink to an
 * outside secret AFTER it passes Phase-1 containment but BEFORE Phase-2
 * reads it is followed straight into the library. See that test's own
 * header comment for the full mechanism, the determinism approach, and the
 * two dead-end probe attempts it documents to avoid repeating.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  linkSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { FINALIZERS, resolveFinalizer, copyStagingToLibrary } from './interactive-finalizers.ts';
import { deriveSessionArtifact } from './studio/session-transcript.ts';
import type { SessionKindDescriptor } from './studio/session-kinds.ts';

/** Repo root, computed the same way orchestrator/interactive-runner.test.ts's
 *  own REPO_ROOT does (`resolve(import.meta.dirname, '..')`) — robust
 *  regardless of the shell's cwd when the test runner is invoked, unlike a
 *  `process.cwd()`-relative path. Only P3 (below) reads a real, checked-in
 *  repo file (`skills/creation-agent/SKILL.md`); every other test in this
 *  file stays a pure isolated-tmpdir fixture, unaffected. */
const REPO_ROOT = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// Scratch fs helpers — every test builds its own isolated tree under a fresh
// mkdtemp dir; nothing depends on process.cwd() or ambient state.
// ---------------------------------------------------------------------------

type Scratch = {
  base: string;
  forgeRoot: string;
  libraryRoot: string;
  sessionDir: string;
  stagingDir: string;
};

function mkScratch(prefix: string): Scratch {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const forgeRoot = join(base, 'forge');
  const libraryRoot = join(forgeRoot, 'library');
  const sessionDir = join(forgeRoot, '_authoring', 'sess-001');
  const stagingDir = join(sessionDir, 'staging');
  mkdirSync(libraryRoot, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  return { base, forgeRoot, libraryRoot, sessionDir, stagingDir };
}

function cleanup(...roots: string[]): void {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}

/** Calls the finalizer and normalizes sync-throw / async-reject / sync-return
 *  / async-resolve into one shape, so tests never have to guess which of the
 *  two the implementation picked. `await` on a non-promise value just resolves
 *  to it immediately, and a synchronous throw inside the awaited expression is
 *  still caught by the surrounding try/catch — both cases collapse cleanly. */
async function callAndCapture(ctx: {
  sessionDir: string;
  forgeRoot: string;
  libraryRoot: string;
  packageId: string;
}): Promise<{ error: (Error & { name: string }) | null; wrote: string[] | null }> {
  try {
    const wrote = await copyStagingToLibrary(ctx as never);
    return { error: null, wrote };
  } catch (err) {
    return { error: err as Error & { name: string }, wrote: null };
  }
}

/** JS-runtime built-in error names — a throw carrying one of these is an
 *  ACCIDENTAL crash (a bug), not a deliberate, explicit error contract. The
 *  finalizer must throw its OWN named error class. */
const BUILTIN_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function assertNamedThrow(err: (Error & { name: string }) | null, context: string): void {
  assert.ok(err, `${context}: must throw/reject, not silently succeed`);
  assert.ok(err instanceof Error, `${context}: rejection must be a real Error instance`);
  assert.ok(
    !BUILTIN_ERROR_NAMES.has(err!.name),
    `${context}: must throw a deliberately NAMED custom error (explicit error contract — ADR-042's third boundary), ` +
      `not a bare/accidental ${err!.name}. Got: ${err!.name}: ${err!.message}`,
  );
}

// ---------------------------------------------------------------------------
// Registry structure — FINALIZERS + resolveFinalizer.
// ---------------------------------------------------------------------------

test('FINALIZERS is seeded with EXACTLY the two real turnSpec finalizers: copyStagingToLibrary, commitRegistryDraft', () => {
  // ADR-043 §5 seeds the registry incrementally. R4-22 WI-2 pinned "exactly
  // one" as a ratchet against a PRE-population of the other ADR-043-named
  // finalizers (promoteToQueue, writeToRepoRoot, commitToCentralBrain,
  // demo's snapshot-restore lock) before their own WIs build them.
  // `commitRegistryDraft` (W6-CR-3) is not a pre-population — it is a real,
  // dispatched `turnSpec` finalizer (the `community-refresh` kind's
  // `committing` phase) landing in the SAME change as its own WI, so the
  // ratchet widens to admit it by id, not by loosening the count check.
  const ids = FINALIZERS.map((row) => row.id).sort();
  assert.deepEqual(
    ids,
    ['commitRegistryDraft', 'copyStagingToLibrary'],
    `Got ${JSON.stringify(ids)}. This ratchet still kills a pre-population of the remaining ADR-043-named ` +
      `finalizers (promoteToQueue, writeToRepoRoot, commitToCentralBrain, demo's snapshot-restore lock) before ` +
      `their own WIs build them — it now also asserts commitRegistryDraft is present, not just absent.`,
  );
});

test('FINALIZERS (outer container) is frozen', () => {
  assert.ok(Object.isFrozen(FINALIZERS), 'the FINALIZERS array/object itself must be frozen');
});

test('every FINALIZERS row is individually frozen (deep-freeze, not shallow)', () => {
  for (const row of FINALIZERS) {
    assert.ok(
      Object.isFrozen(row),
      `row ${JSON.stringify((row as { id?: unknown }).id)} must be individually frozen — Object.freeze is SHALLOW: ` +
        `freezing only the outer array leaves each row object mutable (SESSION_ARTIFACT_KINDS's own documented defect ` +
        `this pattern must avoid). Kills a lone Object.freeze(FINALIZERS) with un-frozen row literals.`,
    );
  }
});

test('mutating a frozen FINALIZERS row never changes what resolveFinalizer resolves for ANY caller', () => {
  const before = resolveFinalizer('copyStagingToLibrary');
  assert.throws(
    () => {
      (FINALIZERS[0] as { id: string }).id = 'HACKED';
    },
    'a frozen row must refuse mutation in strict-mode ESM (every .ts module here runs strict) — a shallow freeze on ' +
      'only the outer array would let this silently succeed instead of throwing',
  );
  // Whichever way the assignment behaves, the registry must be provably
  // UNCHANGED afterward — this is the assertion that actually proves the
  // freeze is real, not merely that one particular JS engine happened to
  // throw on this particular assignment shape.
  assert.equal(
    resolveFinalizer('copyStagingToLibrary'),
    before,
    'a mutation attempt on a row must never change what resolveFinalizer("copyStagingToLibrary") returns',
  );
  assert.equal(FINALIZERS[0].id, 'copyStagingToLibrary', 'the id must still read back as the original value');
});

test('resolveFinalizer("copyStagingToLibrary") resolves to the SAME function reference exported as copyStagingToLibrary', () => {
  const fn = resolveFinalizer('copyStagingToLibrary');
  assert.equal(typeof fn, 'function');
  assert.equal(
    fn,
    copyStagingToLibrary,
    'resolveFinalizer must return the identical function reference, not a wrapper/copy that could silently drift from ' +
      'the directly-exported symbol',
  );
});

test('resolveFinalizer is TOTAL: an unknown id returns undefined, never throws', () => {
  assert.equal(resolveFinalizer('does-not-exist'), undefined);
  assert.equal(
    resolveFinalizer('promoteToQueue'),
    undefined,
    'ADR-043 names 4 more finalizers for LATER WIs — none of them exist yet; resolving one today must be undefined, ' +
      'never a silent no-op stub',
  );
});

test('resolveFinalizer("") returns undefined', () => {
  assert.equal(resolveFinalizer(''), undefined);
});

test('resolveFinalizer never falls through the Object prototype chain ("__proto__", "constructor", "toString", "hasOwnProperty")', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(
      resolveFinalizer(id),
      undefined,
      `resolveFinalizer(${JSON.stringify(id)}) must be undefined. Kills a lookup implemented as a plain {} map indexed ` +
        `by id (FINALIZERS_BY_ID[id]) — that would instead return Object.prototype's own ${id} member (truthy/defined), ` +
        `letting a caller "resolve" an id that was never declared. The array + .find() pattern this WI mandates ` +
        `(copied from sessionArtifactKindState) has no prototype chain to fall through.`,
    );
  }
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS — without these, every negative test below could be
// passing because the guard refuses EVERYTHING, not because containment
// specifically works.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: a normal nested package installs correctly (recursive walk reaches nested files)', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-legit-nested-');
  try {
    writeFileSync(join(stagingDir, 'README.md'), 'TOP-LEVEL-CONTENT-a1b2c3');
    mkdirSync(join(stagingDir, 'scripts'), { recursive: true });
    writeFileSync(join(stagingDir, 'scripts', 'run.sh'), '#!/bin/sh\necho NESTED-CONTENT-d4e5f6\n');

    const { error, wrote } = await callAndCapture({
      sessionDir,
      forgeRoot,
      libraryRoot,
      packageId: 'legit-nested',
    });
    assert.equal(error, null, `a normal nested package must install cleanly. Got: ${error}`);

    const readmeDest = join(libraryRoot, 'legit-nested', 'README.md');
    const scriptDest = join(libraryRoot, 'legit-nested', 'scripts', 'run.sh');
    assert.ok(existsSync(readmeDest), 'top-level staged file must be installed');
    assert.ok(
      existsSync(scriptDest),
      'the NESTED staged file must be installed too. Kills a top-level-only walk that hits EISDIR on the nested ' +
        '"scripts" dir, catches it, and silently drops run.sh — the exact bug a sibling initiative shipped.',
    );
    assert.equal(readFileSync(readmeDest, 'utf8'), 'TOP-LEVEL-CONTENT-a1b2c3');
    assert.equal(readFileSync(scriptDest, 'utf8'), '#!/bin/sh\necho NESTED-CONTENT-d4e5f6\n');
    assert.ok(wrote, 'must return the list of written paths');
    assert.ok(wrote!.some((p) => realpathSync(p) === realpathSync(readmeDest)), 'wrote[] must include the top-level file');
    assert.ok(wrote!.some((p) => realpathSync(p) === realpathSync(scriptDest)), 'wrote[] must include the NESTED file');
  } finally {
    cleanup(base);
  }
});

test('POSITIVE CONTROL: a legitimate staged file literally named "..foo" is NOT falsely rejected', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-dotted-name-');
  try {
    writeFileSync(join(stagingDir, '..foo'), 'DOTTED-NAME-CONTENT-9f8e7d');

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'dotted-name-pkg' });
    assert.equal(
      error,
      null,
      `"..foo" is a perfectly legal, fully-contained directory-entry name — it is neither "." nor ".." and holds no ` +
        `separator (the exact reasoning documented in cli/studio-path-guard.ts's isSafeSegment). A regex-based ` +
        `traversal check (e.g. /^\\.\\./) instead of strict equality to ".." would wrongly reject this. Got: ${error}`,
    );
    const dest = join(libraryRoot, 'dotted-name-pkg', '..foo');
    assert.ok(existsSync(dest), 'the dotted-name file must actually be installed');
    assert.equal(readFileSync(dest, 'utf8'), 'DOTTED-NAME-CONTENT-9f8e7d');
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// ESCAPE SHAPES — each plants a distinguishable secret/canary BEFORE invoking
// the finalizer, and byte-compares it AFTER, so a "contained" verdict is
// proven, not accidental.
// ---------------------------------------------------------------------------

test('ESCAPE: a directory symlink inside staging/ pointing outside the session is refused, not followed', async (t) => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-dirsym-staging-');
  const outside = mkdtempSync(join(tmpdir(), 'finalizer-dirsym-OUTSIDE-'));
  try {
    const victimFile = join(outside, 'lookalike-secret.txt');
    const secretBytes = 'SECRET-HOST-CONTENT-7d3a1c';
    writeFileSync(victimFile, secretBytes);

    try {
      symlinkSync(outside, join(stagingDir, 'evil-dir'));
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }
    assert.ok(
      lstatSync(join(stagingDir, 'evil-dir')).isSymbolicLink(),
      'arrange: evil-dir must genuinely be a symlink or the test is vacuous',
    );

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'dirsym-pkg' });
    assertNamedThrow(error, 'directory symlink in staging/ pointing outside the session');

    assert.ok(
      !existsSync(join(libraryRoot, 'dirsym-pkg')),
      'no half-written package dir may exist afterward (check-then-write)',
    );
    assert.equal(
      readFileSync(victimFile, 'utf8'),
      secretBytes,
      'the outside victim file must be byte-unchanged. Kills a walker that lstat-checks only TOP-LEVEL staging ' +
        'entries, then blindly readdirSync()/readFileSync()s through a symlinked subdirectory without ever noticing ' +
        'it left the real staging tree — a source-side exfiltration of arbitrary host content into the library.',
    );
  } finally {
    cleanup(base);
    rmSync(outside, { recursive: true, force: true });
  }
});

test('ESCAPE: a FILE symlink inside a real staging subdirectory (absolute target) is refused — guarding the directory alone misses it', async (t) => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-filesym-staging-');
  const outside = mkdtempSync(join(tmpdir(), 'finalizer-filesym-OUTSIDE-'));
  try {
    const victimFile = join(outside, 'secrets.env');
    const secretBytes = 'API_KEY=SECRET-b91f4e';
    writeFileSync(victimFile, secretBytes);

    const realSubdir = join(stagingDir, 'config'); // a GENUINELY real, non-symlinked directory
    mkdirSync(realSubdir, { recursive: true });
    const leaf = join(realSubdir, 'settings.json');
    try {
      symlinkSync(victimFile, leaf); // absolute target — also stands in for "absolute path as a staged entry path"
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }
    assert.ok(lstatSync(leaf).isSymbolicLink(), 'arrange: leaf must be a symlink or the test is vacuous');
    assert.equal(
      realpathSync(leaf),
      realpathSync(victimFile),
      'arrange: leaf must resolve to the absolute outside target',
    );

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'filesym-pkg' });
    assertNamedThrow(error, 'file symlink (absolute target) whose parent directory in staging is genuinely real');

    assert.ok(
      !existsSync(join(libraryRoot, 'filesym-pkg')),
      'no half-written package dir — check-then-write (config/ alone being real must not be enough to proceed)',
    );
    assert.equal(
      readFileSync(victimFile, 'utf8'),
      secretBytes,
      'outside victim must be byte-unchanged. Kills an implementation that validates only the CONTAINING directory ' +
        'of each staged file (confirms "config/" is real) and then blindly reads the LEAF through the symlink — the ' +
        'classic "guard the directory, not the leaf" defect (SEC-04), replayed on the read side.',
    );
  } finally {
    cleanup(base);
    rmSync(outside, { recursive: true, force: true });
  }
});

test('ESCAPE: a HARDLINKED file inside staging (nlink != 1, shares an inode with an outside file) is refused', async (t) => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-hardlink-staging-');
  const outside = mkdtempSync(join(tmpdir(), 'finalizer-hardlink-OUTSIDE-'));
  try {
    const victimFile = join(outside, 'id_rsa_lookalike');
    const secretBytes = 'SECRET-PRIVATE-KEY-CONTENT-c2e9a0';
    writeFileSync(victimFile, secretBytes);

    const leaf = join(stagingDir, 'payload.bin');
    try {
      linkSync(victimFile, leaf);
    } catch {
      t.skip('hardlink creation (linkSync) unavailable in this environment (EXDEV or unsupported)');
      return;
    }
    const st = lstatSync(leaf);
    assert.ok(
      !st.isSymbolicLink(),
      'arrange: a hardlink is NOT a symlink — realpathSync(leaf) resolves to itself, nothing for a symlink check ' +
        'alone to catch',
    );
    assert.equal(st.nlink, 2, 'arrange: nlink must be 2 (shared inode) or the fixture is vacuous');
    assert.equal(
      realpathSync(leaf),
      leaf,
      'arrange: realpath leaves a hardlinked path unchanged — exactly why an nlink check is required',
    );

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'hardlink-pkg' });
    assertNamedThrow(error, 'hardlinked leaf inside staging (realpath structurally blind to it)');

    assert.ok(!existsSync(join(libraryRoot, 'hardlink-pkg')), 'no half-written package dir');
    assert.equal(
      readFileSync(victimFile, 'utf8'),
      secretBytes,
      'outside victim must be byte-unchanged. Kills a walker that checks isSymbolicLink() on every staged entry ' +
        '(correctly catching symlinks) but has NO nlink check at all.',
    );
  } finally {
    cleanup(base);
    rmSync(outside, { recursive: true, force: true });
  }
});

test('ESCAPE: a self-referential symlink inside staging/ (degenerate/empty relative path) is refused, not walked into a loop', { timeout: 5_000 }, async (t) => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-selfloop-');
  try {
    try {
      symlinkSync(stagingDir, join(stagingDir, 'selfloop'));
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }
    assert.ok(
      lstatSync(join(stagingDir, 'selfloop')).isSymbolicLink(),
      'arrange: selfloop must be a symlink or the test is vacuous',
    );

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'selfloop-pkg' });
    assertNamedThrow(
      error,
      'self-referential symlink in staging/ (my best-effort construction of "empty relative path" — see report caveat)',
    );
    assert.ok(
      !existsSync(join(libraryRoot, 'selfloop-pkg')),
      'no half-written package dir from a walk that partially unrolled the loop before detecting it',
    );
  } finally {
    cleanup(base);
  }
});

test('ESCAPE: packageId containing ".." is refused — never folded into the containment root', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-pkgid-dotdot-');
  try {
    const canaryFile = join(forgeRoot, 'sentinel.txt'); // one level ABOVE libraryRoot
    const canaryBytes = 'SENTINEL-ABOVE-LIBRARY-ROOT-4a7c2f';
    writeFileSync(canaryFile, canaryBytes);
    writeFileSync(join(stagingDir, 'payload.txt'), 'ATTACKER-PAYLOAD');

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: '../escaped-pkg' });
    assertNamedThrow(error, 'packageId containing ".."');

    assert.equal(
      readFileSync(canaryFile, 'utf8'),
      canaryBytes,
      'the file one level above libraryRoot must be byte-unchanged — proves the write never climbed out via packageId',
    );
    assert.ok(
      !existsSync(join(forgeRoot, 'escaped-pkg')),
      'no directory may be created outside libraryRoot. Kills an implementation that builds the destination via ' +
        'join(libraryRoot, packageId, ...relSegments) as ONE joined string used as the `root` argument to ' +
        'resolveGuardedPath (root-folding) instead of resolveGuardedPath(libraryRoot, [packageId, ...relSegments]) — ' +
        'join() silently normalizes ".." away before any identity check runs.',
    );
  } finally {
    cleanup(base);
  }
});

test('ESCAPE: an absolute-path packageId is refused', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-pkgid-absolute-');
  const outsideTarget = mkdtempSync(join(tmpdir(), 'finalizer-absolute-target-'));
  try {
    writeFileSync(join(stagingDir, 'payload.txt'), 'ATTACKER-PAYLOAD');

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: outsideTarget });
    assertNamedThrow(error, 'absolute-path packageId');

    assert.ok(
      !existsSync(join(outsideTarget, 'payload.txt')),
      'nothing may be written under the absolute path supplied as packageId. Kills an implementation that uses ' +
        'path.resolve(libraryRoot, packageId) instead of routing packageId through resolveGuardedPath\'s per-segment ' +
        'walk — path.resolve() treats a leading-"/" argument as an absolute OVERRIDE, discarding libraryRoot entirely ' +
        '(unlike path.join(), which would merely concatenate it) — and also kills skipping isSafeSegment\'s charset ' +
        'check (which already rejects any segment containing "/") for packageId specifically.',
    );
  } finally {
    cleanup(base);
    rmSync(outsideTarget, { recursive: true, force: true });
  }
});

test('ESCAPE: an empty-string packageId is refused', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-pkgid-empty-');
  try {
    writeFileSync(join(stagingDir, 'payload.txt'), 'ATTACKER-PAYLOAD');
    const before = readdirSync(libraryRoot).sort();

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: '' });
    assertNamedThrow(error, 'empty-string packageId');

    assert.deepEqual(
      readdirSync(libraryRoot).sort(),
      before,
      'libraryRoot must be unchanged. Kills join(libraryRoot, "", "payload.txt") collapsing (Node\'s path.join ' +
        'treats an empty-string segment as a no-op) to join(libraryRoot, "payload.txt") — writing DIRECTLY into the ' +
        'shared libraryRoot instead of a per-package subdirectory, potentially clobbering an existing top-level entry.',
    );
  } finally {
    cleanup(base);
  }
});

test('ESCAPE: escape-and-return — packageId "legit-object/../other-legit-object" must not redirect to the other real object', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-escape-return-');
  try {
    mkdirSync(join(libraryRoot, 'legit-object'), { recursive: true });
    mkdirSync(join(libraryRoot, 'other-legit-object'), { recursive: true });
    const otherMarker = join(libraryRoot, 'other-legit-object', 'marker.txt');
    const originalBytes = 'ORIGINAL-LEGIT-CONTENT-6b3f9a';
    writeFileSync(otherMarker, originalBytes);

    writeFileSync(join(stagingDir, 'marker.txt'), 'ATTACKER-OVERWRITE');

    const { error } = await callAndCapture({
      sessionDir,
      forgeRoot,
      libraryRoot,
      packageId: 'legit-object/../other-legit-object',
    });
    assertNamedThrow(
      error,
      'packageId embedding a ".." component that numerically round-trips back under a DIFFERENT real, legitimate object',
    );

    assert.equal(
      readFileSync(otherMarker, 'utf8'),
      originalBytes,
      'other-legit-object/marker.txt must be byte-unchanged. Kills an implementation that PRE-NORMALIZES ' +
        '(path.normalize()/path.join()) a multi-component packageId string BEFORE splitting it into segments — ' +
        '"legit-object/../other-legit-object" normalizes away to "other-legit-object", at which point no remaining ' +
        'segment is literally ".." for a per-segment check to catch, even though the DECLARED packageId was never a ' +
        'legitimate single opaque id (it contains "/" at all, which isSafeSegment must reject outright, unnormalized).',
    );
  } finally {
    cleanup(base);
  }
});

test('ESCAPE: cross-object alias — a packageId that resolves via a pre-existing symlink to a DIFFERENT real library object', async (t) => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-crossobj-');
  try {
    mkdirSync(join(libraryRoot, 'legit-object'), { recursive: true });
    const marker = join(libraryRoot, 'legit-object', 'marker.txt');
    const originalBytes = 'ORIGINAL-CONTENT-e91a4c';
    writeFileSync(marker, originalBytes);

    try {
      symlinkSync(join(libraryRoot, 'legit-object'), join(libraryRoot, 'alias'));
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }
    assert.ok(lstatSync(join(libraryRoot, 'alias')).isSymbolicLink(), 'arrange: alias must be a symlink');
    assert.equal(
      realpathSync(join(libraryRoot, 'alias')),
      realpathSync(join(libraryRoot, 'legit-object')),
      'arrange: alias must resolve to legit-object — a "somewhere under root" MEMBERSHIP check would call this ' +
        'contained, which is exactly the trap this test exists to catch',
    );

    writeFileSync(join(stagingDir, 'marker.txt'), 'ATTACKER-OVERWRITE-VIA-ALIAS');

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'alias' });
    assertNamedThrow(error, 'packageId aliasing (via a pre-existing symlinked top-level entry) a DIFFERENT real library object');

    assert.equal(
      readFileSync(marker, 'utf8'),
      originalBytes,
      'legit-object/marker.txt must be byte-unchanged — proves IDENTITY was checked (alias\'s own expected realpath ' +
        'must equal itself), not mere membership under libraryRoot. Kills a check shaped like ' +
        'realpath(dest).startsWith(realpath(libraryRoot)), which would wrongly ACCEPT this: legit-object genuinely ' +
        'IS under libraryRoot.',
    );
  } finally {
    cleanup(base);
  }
});

test('ESCAPE: a percent-encoded traversal string in packageId must never be decoded-then-escape', async () => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-percent-');
  try {
    const forgeRootBefore = readdirSync(forgeRoot).sort();
    writeFileSync(join(stagingDir, 'payload.txt'), 'ATTACKER-PAYLOAD');

    // Literal characters only — no real "/" is present in this string, so
    // isSafeSegment's charset check would legitimately ALLOW it as an
    // opaque (if odd) single id. What must never happen is some layer
    // decoding %2f into "/" (and %2e%2e into "..") before or after the
    // safety check, turning an opaque-looking id into a real traversal.
    const oddId = '..%2f..%2fescaped-pkg';

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: oddId });

    // Either accept-as-opaque-id or refuse is fine in isolation; what must
    // hold regardless is that forgeRoot's OWN top-level listing (one level
    // above libraryRoot — where a decode-then-".."-climb would land) never
    // gains a new entry.
    assert.deepEqual(
      readdirSync(forgeRoot).sort(),
      forgeRootBefore,
      `no new entry may appear directly under forgeRoot. Kills an implementation that runs decodeURIComponent() (or ` +
        `an equivalent) on packageId before or after the segment-safety check. (call outcome: ${error ? `threw ${error.name}` : 'accepted'})`,
    );
  } finally {
    cleanup(base);
  }
});

test('CHECK-THEN-WRITE: one legit entry (encountered first) + one escaping entry (encountered last) writes NOTHING', async (t) => {
  const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-atomic-');
  const outside = mkdtempSync(join(tmpdir(), 'finalizer-atomic-OUTSIDE-'));
  try {
    writeFileSync(join(stagingDir, 'aaa-good.txt'), 'GOOD-CONTENT-should-never-land-alone');
    const victim = join(outside, 'victim.txt');
    writeFileSync(victim, 'VICTIM-ORIGINAL');
    try {
      symlinkSync(victim, join(stagingDir, 'zzz-evil.txt'));
    } catch {
      t.skip('symlink creation unavailable in this environment');
      return;
    }

    const { error } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'atomic-pkg' });
    assertNamedThrow(error, 'one escaping entry among otherwise-legit staged entries');

    assert.ok(
      !existsSync(join(libraryRoot, 'atomic-pkg')),
      'ARTIFACT check: the package directory must not exist AT ALL afterward — not even containing aaa-good.txt. A ' +
        'sequential validate+write-as-you-go implementation would already have written aaa-good.txt (encountered ' +
        'before the rejected zzz-evil.txt) before reaching the escape, leaving a half-written package directory. ' +
        'CHECK-THEN-WRITE requires validating EVERY entry before writing ANY.',
    );
    assert.equal(readFileSync(victim, 'utf8'), 'VICTIM-ORIGINAL', 'outside victim unchanged');
  } finally {
    cleanup(base);
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TOCTOU — R4-22 WI-2 reproduced finding (adversarial-review pass; the race
// was ALREADY reproduced 3/3 deterministic runs before this test was
// written — this test PINS it, it does not discover it).
//
// copyStagingToLibrary's containment is CHECK-THEN-WRITE across TWO PHASES
// with a real gap between them, not one atomic check-then-use:
//   Phase 1 — discoverStagingEntries validates EVERY staged entry through
//     resolveGuardedPath and records each entry's `srcRealPath` (a PATH
//     STRING) into an array. This runs to completion for the WHOLE tree
//     before phase 2 starts.
//   Phase 2 — a separate loop (interactive-finalizers.ts ~246-250) later
//     does `readFileSync(srcRealPath)` for each recorded entry and writes
//     the result into the library.
// Between "aaa.txt passed its Phase-1 check and got recorded" and "Phase 2
// reads aaa.txt's recorded path", NOTHING re-verifies that the thing living
// at that path is still the same regular, non-symlinked, single-link file
// Phase 1 actually looked at. Swap it for a symlink to an outside secret in
// that window and readFileSync follows the symlink straight into the
// library, while every resolveGuardedPath call along the way reported
// {ok:true}. Phase separation WIDENS this window relative to an immediate
// check-then-use — the module's header (lines ~53-61) currently frames
// check-then-write purely as an atomicity property and does not disclose
// that cost; fixing that framing is the implementer's job, not this file's.
//
// KILLS: any Phase-2 read that trusts a Phase-1-recorded path string as-is
// (e.g. a bare `readFileSync(srcRealPath)`) without re-verifying, AT READ
// TIME, that the path still resolves to a regular file with nlink===1 and is
// not a symlink. The planned fix — openSync(path, O_RDONLY | O_NOFOLLOW) +
// an fstatSync re-verification on the returned fd — is deliberately NOT
// asserted on below; only the security OUTCOME is (a swapped-in refusal is
// just as acceptable a fix as a throw, so long as the secret's bytes never
// reach the library).
//
// DETERMINISM — how the swap is triggered, and the two dead ends to avoid
// repeating (both empirically probed before landing on this approach; see
// this WI's report for the throwaway two-file harness that proved each):
//
//   1. Trigger KEY: the hook below fires on an EXACT match of the absolute
//      real path of the SECOND staged entry ("bbb-trigger.txt", which sorts
//      after "aaa-swap-target.txt" and is therefore validated strictly
//      AFTER aaa.txt is already recorded). An exact-path match — never a
//      filename substring — matters because this test's OWN cleanup
//      (`rmSync(base, {recursive:true})` in the `finally` below) walks the
//      very same tree and would otherwise risk re-matching a loosely-keyed
//      trigger; a prior probe that used a substring/name-based trigger saw
//      its one-shot flag silently consumed by rmSync's own internal walk
//      BEFORE the real copyStagingToLibrary walk ever ran, printing a false
//      "swap performed: true" while the swap had never actually fired
//      against the SUT. Here the hook is installed immediately before, and
//      uninstalled immediately after, the single `callAndCapture` call —
//      it is never live during cleanup at all, so that failure mode cannot
//      recur, and `swapPerformed`/a direct `lstatSync(...).isSymbolicLink()`
//      check on the swapped path are asserted true BEFORE any verdict is
//      read, so a hook that silently didn't fire cannot be mistaken for a
//      passing (or a meaningfully failing) containment check.
//
//   2. Patch MECHANISM: a bare `require('node:fs').lstatSync = patched` (via
//      `createRequire`) is SILENTLY INERT here — proven with a throwaway
//      two-file probe (a "producer" module statically importing
//      `{ lstatSync } from 'node:fs'`, plus a "patcher" file shaped exactly
//      like this one: its own top-level static `import { ... } from
//      'node:fs'` for scratch-fs helpers, then a require()-based patch of
//      the CJS fs object). The probe's patched function was never invoked:
//      this file, like interactive-finalizers.ts itself, has a top-level
//      static `import { ... } from 'node:fs'`, and Node materializes
//      concrete function values onto node:fs's synthetic ESM namespace the
//      first time ANY code anywhere in the process statically imports it —
//      a snapshot taken once, process-wide, not a live view of the CJS
//      exports object. Later CJS-side mutation alone is never observed by
//      an already-loaded static importer, no matter which file performs the
//      require() or in what order. `syncBuiltinESMExports()` — a
//      documented, NON-experimental `node:module` API ("updates all the
//      live bindings for builtin ES Modules to match the properties of the
//      CommonJS exports") — is the one mechanism that reaches back into an
//      already-materialized facade; the same throwaway probe, re-run with a
//      `syncBuiltinESMExports()` call added right after the CJS-side patch,
//      DID observe the patched function fire from the statically-importing
//      producer. That is the mechanism `installLstatTrigger` below uses.
// ---------------------------------------------------------------------------

/** Recursively reads every regular file's utf8 content under `root` (or `[]`
 *  if `root` does not exist). Used ONLY to prove the ARTIFACT-level claim —
 *  "no file ANYWHERE under the library contains the secret's bytes" — not
 *  merely that one particular expected destination path is absent; a
 *  symlink-follow escape could in principle land leaked content somewhere
 *  other than the naively-expected path, and this check must catch that
 *  too. Directories are walked (not followed if they were symlinks — this
 *  finalizer's own contract never plants symlinked directories in a
 *  freshly-written library, so `isFile()`/`isDirectory()` on a bare
 *  `lstatSync` is sufficient here). */
function collectFileContentsRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        out.push(readFileSync(full, 'utf8'));
      }
    }
  }
  walk(root);
  return out;
}

/**
 * Monkeypatches node:fs's `lstatSync` (CJS side, pushed into the already-
 * materialized ESM facade via `syncBuiltinESMExports()` — see the section
 * header above for why a bare CJS-side patch alone is inert) so the FIRST
 * call whose `path` argument is EXACTLY `triggerPath` invokes `onTrigger()`
 * before falling through to the real implementation. Every other call
 * (including a SECOND call with the same path) passes through untouched.
 * Returns an uninstall function; callers MUST call it (in a `finally`) so
 * the patch never leaks into a later test running in this same process.
 */
function installLstatTrigger(triggerPath: string, onTrigger: () => void): () => void {
  const require = createRequire(import.meta.url);
  const fsCjs = require('node:fs') as unknown as { lstatSync: unknown };
  const original = fsCjs.lstatSync as (...args: unknown[]) => unknown;
  let fired = false;
  const patched = (...args: unknown[]): unknown => {
    if (!fired && args[0] === triggerPath) {
      fired = true;
      onTrigger();
    }
    return original(...args);
  };
  fsCjs.lstatSync = patched;
  syncBuiltinESMExports();

  return function uninstall(): void {
    fsCjs.lstatSync = original;
    syncBuiltinESMExports();
  };
}

test(
  'ESCAPE (TOCTOU, R4-22 WI-2 reproduced finding): a staged entry swapped for a symlink AFTER it passes Phase-1 ' +
    "containment but BEFORE Phase-2 reads it still lands the outside secret's bytes in the library",
  async (t) => {
    const { base, forgeRoot, libraryRoot, sessionDir, stagingDir } = mkScratch('finalizer-toctou-');
    const outside = mkdtempSync(join(tmpdir(), 'finalizer-toctou-OUTSIDE-'));
    let uninstall: (() => void) | null = null;
    try {
      // Alphabetical order matters (discoverStagingEntries sorts): aaa is
      // validated, and its srcRealPath recorded, strictly BEFORE bbb.
      const aaaPath = join(stagingDir, 'aaa-swap-target.txt');
      const bbbPath = join(stagingDir, 'bbb-trigger.txt');
      const originalAaaBytes = 'ORIGINAL-AAA-CONTENT-legit-2f6c19';
      writeFileSync(aaaPath, originalAaaBytes);
      writeFileSync(bbbPath, 'BBB-CONTENT-just-needs-to-exist-and-sort-after-aaa');

      const secretFile = join(outside, 'outside-secret.txt');
      const secretBytes = 'OUTSIDE-SECRET-MUST-NEVER-REACH-THE-LIBRARY-9a41ee';
      writeFileSync(secretFile, secretBytes);

      // Arrange preconditions BEFORE the call, not after.
      assert.equal(readFileSync(secretFile, 'utf8'), secretBytes, 'arrange: outside secret has known bytes');
      assert.equal(readFileSync(aaaPath, 'utf8'), originalAaaBytes, 'arrange: aaa.txt starts as a real, legit file');
      assert.ok(!lstatSync(aaaPath).isSymbolicLink(), 'arrange: aaa.txt is not yet a symlink');

      const stagingReal = realpathSync(stagingDir);
      const aaaRealPath = join(stagingReal, 'aaa-swap-target.txt');
      const bbbExpectedPath = join(stagingReal, 'bbb-trigger.txt'); // EXACT-match trigger key — see header

      let swapPerformed = false;
      let symlinkCreationUnavailable = false;
      let swapArrangeError: unknown = null;

      uninstall = installLstatTrigger(bbbExpectedPath, () => {
        // Fires the FIRST time anything lstat()s bbb's exact staging path —
        // i.e. strictly after aaa.txt has already passed its own Phase-1
        // guard check and been pushed into discoverStagingEntries' out[]
        // (aaa sorts first and is fully processed — including its own
        // explicit isFile() lstat — before the walk ever touches bbb).
        unlinkSync(aaaRealPath);
        try {
          symlinkSync(secretFile, aaaRealPath);
          swapPerformed = true;
        } catch (err) {
          symlinkCreationUnavailable = true;
          swapArrangeError = err;
        }
      });

      const { error, wrote } = await callAndCapture({ sessionDir, forgeRoot, libraryRoot, packageId: 'toctou-pkg' });

      if (symlinkCreationUnavailable) {
        t.skip(`symlink creation unavailable in this environment: ${String(swapArrangeError)}`);
        return;
      }

      // Prove the hook actually fired and the swap actually happened —
      // never trust a verdict behind a trigger that might have silently
      // misfired (the exact false-"no race" trap a prior probe of this
      // race hit; see the section header above).
      assert.ok(
        swapPerformed,
        'arrange: the lstatSync trigger keyed on bbb\'s exact staging path must have fired and swapped aaa.txt ' +
          'for a symlink — if this is false the whole test is vacuous (the race never happened)',
      );
      assert.ok(
        lstatSync(aaaRealPath).isSymbolicLink(),
        "arrange: aaa.txt's staging path must genuinely be a symlink after the swap — proves the trigger fired " +
          'for real against the live filesystem, not merely that an in-memory flag was set',
      );
      assert.equal(
        realpathSync(aaaRealPath),
        realpathSync(secretFile),
        'arrange: the planted symlink must genuinely resolve to the outside secret file',
      );

      // ---- THE SECURITY ASSERTION — this is what fails RED today ----

      // The outside secret itself must always be untouched regardless of
      // what copyStagingToLibrary does with it.
      assert.equal(readFileSync(secretFile, 'utf8'), secretBytes, 'the outside secret file must be byte-unchanged');

      // No file ANYWHERE under libraryRoot may contain the secret's bytes —
      // whichever way the call resolves. A bare "it must throw" is NOT
      // enough here: today's implementation does not throw AT ALL for this
      // attack — readFileSync(srcRealPath) happily follows the planted
      // symlink, writeFileSync happily writes the result, and the call
      // returns normally with `wrote` naming the poisoned destination.
      const leakedContent = collectFileContentsRecursively(libraryRoot).some((bytes) => bytes === secretBytes);
      assert.ok(
        !leakedContent,
        'no file anywhere under libraryRoot may contain the outside secret\'s bytes. Kills a Phase-2 read ' +
          '(readFileSync(srcRealPath), interactive-finalizers.ts ~246-250) that reuses a Phase-1-recorded PATH ' +
          'STRING without re-verifying, AT READ TIME, that whatever now sits at that path is still the same ' +
          'regular, non-symlinked, single-link file Phase 1 actually validated — the reproduced R4-22 WI-2 TOCTOU ' +
          `finding. Observed outcome: error=${error ? `${error.name}: ${error.message}` : 'none (call returned normally)'}, ` +
          `wrote=${JSON.stringify(wrote)}.`,
      );
    } finally {
      if (uninstall) uninstall();
      cleanup(base);
      rmSync(outside, { recursive: true, force: true });
    }
  },
);

// ===========================================================================
// R4-21 phase 2, pin round 4 (T3 — the orchestrator's own misdecomposition,
// not this round's fault; _wave5/unit-specs/R4-21-phase2.md amend4).
// TEST-WRITER ONLY — no implementation code lives in this file.
//
// Pin round 3's P2/P3 imported a new `STAGING_DIRNAME` export from
// interactive-finalizers.ts. That demands new production surface under
// `orchestrator/`, which this project's ADR-042 cap makes operator-ask-first
// (not one of the three ratified boundaries: `cli/` routes, additive-optional
// fields, or a pure function with an explicit error contract). This round
// closes the SAME defect class WITHOUT that export: a source-text RATCHET
// that reads BOTH production files' real, checked-in source and asserts
// every staging-dirname literal across them is the identical string.
// Precedent, not invention: `scripts/check-raw-fs-guarded.mjs` is the same
// source-scanning ratchet pattern already used elsewhere in this repo, for a
// filesystem-sink invariant.
//
// THE DEFECT CLASS (not hypothetical — already shipped once): the finalizer
// landed 'staging' in R4-22 while the derivation side
// (session-transcript.ts's PACKAGE_DIRNAME) still said 'package' — a feature
// where the agent wrote where nothing read, with BOTH modules' own test
// suites green throughout, because neither suite read the OTHER module's
// literal.
//
// EXPECTED STATE (stated explicitly, per the pin brief): this file now RUNS
// end-to-end (no more import-time failure), and every test below is GREEN
// against current production — because the two literals already agree today
// and skills/creation-agent/SKILL.md already says the right thing. This
// pin's value is NOT that it is red today; it is established by two
// mutation proofs (mutate the transcript side, separately mutate the
// finalizer side — both turn the ratchet RED) plus a third mutation proof for
// P3 (reverting SKILL.md's prose to `package/` turns P3 RED). All three are
// recorded in this WI's report, applied and reverted in the live worktree,
// never left uncommitted.
// ===========================================================================

const TRANSCRIPT_SOURCE_PATH = join(REPO_ROOT, 'orchestrator', 'studio', 'session-transcript.ts');
const FINALIZERS_SOURCE_PATH = join(REPO_ROOT, 'orchestrator', 'interactive-finalizers.ts');

/** Extracts session-transcript.ts's `PACKAGE_DIRNAME` module-private constant
 *  declaration from its real, checked-in source text. Anchored on the exact
 *  declaration shape (`const PACKAGE_DIRNAME = <quoted-literal>`) — robust to
 *  quote style (single/double) and incidental whitespace, but NOT a loose
 *  scan for the word "staging" anywhere in the file (which would also match
 *  this module's own prose comments describing the constant, e.g. its
 *  "R4-21 phase 2, WI-1, D2" doc comment). Returns `null` if the declaration
 *  shape is not found — callers must treat that as a FAILED extraction,
 *  never as "the value is empty". */
function extractTranscriptPackageDirname(source: string): string | null {
  const m = source.match(/const\s+PACKAGE_DIRNAME\s*=\s*(['"])([^'"]*)\1/);
  return m ? m[2] : null;
}

/** One call site in interactive-finalizers.ts that hardcodes the staging
 *  dirname literal, keyed by a human-readable label naming the site. */
type FinalizerStagingSite = { readonly label: string; readonly re: RegExp };

/** The two real, current call sites in interactive-finalizers.ts that
 *  hardcode the staging dirname (located by reading the file — see its
 *  module header's CONTAINMENT section and `discoverStagingEntries`). Each
 *  regex is anchored on the surrounding variable/call names ACTUALLY PRESENT
 *  at that site (`nextRelParts`, `stagingRoot = join(...)`), not merely on
 *  the word "staging" — this is deliberately what keeps these regexes from
 *  also matching interactive-finalizers.ts's OWN prose comments, several of
 *  which literally reproduce `resolveGuardedPath(sessionDir, ['staging',
 *  ...relParts])` as backtick-quoted example text (using `relParts`, never
 *  `nextRelParts` — the real destructured loop variable at the real call
 *  site), or the standalone phrase "'staging' child" in another comment.
 *  Verified empirically before this test was written: each regex matches
 *  EXACTLY ONCE against the real file (`.matchAll` count === 1), proving
 *  neither pattern is accidentally loose enough to also catch a lookalike
 *  comment. Robust to quote style and incidental whitespace at each site;
 *  NOT robust to the call sites being restructured entirely — an intentional
 *  restructure must update these patterns, which is the point of a ratchet
 *  (fail LOUD the moment its target shape moves, never silently stop
 *  checking). */
const FINALIZER_STAGING_SITES: readonly FinalizerStagingSite[] = [
  {
    label: `discoverStagingEntries's resolveGuardedPath(sessionDir, [<literal>, ...nextRelParts]) call in ${FINALIZERS_SOURCE_PATH}`,
    re: /resolveGuardedPath\(\s*sessionDir\s*,\s*\[\s*(['"])([^'"]*)\1\s*,\s*\.\.\.nextRelParts\s*\]\s*\)/,
  },
  {
    label: `discoverStagingEntries's "const stagingRoot = join(sessionDir, <literal>)" in ${FINALIZERS_SOURCE_PATH}`,
    re: /const\s+stagingRoot\s*=\s*join\(\s*sessionDir\s*,\s*(['"])([^'"]*)\1\s*\)/,
  },
];

/** Extracts EVERY staging-dirname literal from interactive-finalizers.ts's
 *  real, checked-in source text, one entry per `FINALIZER_STAGING_SITES` row
 *  that actually matched. A site whose pattern does not match is OMITTED,
 *  never defaulted to a placeholder — callers must check the returned
 *  array's length against `FINALIZER_STAGING_SITES.length` to detect a
 *  failed (vacuous) extraction at any individual site. */
function extractFinalizerStagingLiterals(source: string): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const site of FINALIZER_STAGING_SITES) {
    const m = source.match(site.re);
    if (m) out.push({ label: site.label, value: m[2] });
  }
  return out;
}

/** Today's independently-verified staging-dirname value — used ONLY to prove
 *  the extraction regexes above are targeting the RIGHT declarations (not
 *  merely matching something that happens to parse), never as a third source
 *  of truth the ratchet's own cross-file-agreement assertion depends on
 *  (that assertion below compares the extracted values only to EACH OTHER).
 *  A deliberate, coordinated rename of the shared dirname across both
 *  production files must update this constant in the SAME commit — that is
 *  expected maintenance, not the drift this ratchet exists to catch. */
const EXPECTED_STAGING_DIRNAME_TODAY = 'staging';

test('RATCHET: every staging-dirname literal in session-transcript.ts (PACKAGE_DIRNAME) and interactive-finalizers.ts (its two hardcoded call sites) is the IDENTICAL string', () => {
  const transcriptSource = readFileSync(TRANSCRIPT_SOURCE_PATH, 'utf8');
  const finalizersSource = readFileSync(FINALIZERS_SOURCE_PATH, 'utf8');

  const transcriptValue = extractTranscriptPackageDirname(transcriptSource);
  assert.ok(
    transcriptValue !== null && transcriptValue.length > 0,
    `NON-VACUOUS CHECK FAILED (the single most important assertion in this test): could not find ` +
      `"const PACKAGE_DIRNAME = '...'" anywhere in ${TRANSCRIPT_SOURCE_PATH}. An extraction that silently matches ` +
      'nothing would make this ratchet vacuously pass no matter what either production file says. If ' +
      'PACKAGE_DIRNAME was renamed or its declaration shape changed, UPDATE THIS TEST\'S REGEX to match the new ' +
      'shape — do not delete this check.',
  );

  const finalizerLiterals = extractFinalizerStagingLiterals(finalizersSource);
  assert.equal(
    finalizerLiterals.length,
    FINALIZER_STAGING_SITES.length,
    `NON-VACUOUS CHECK FAILED: expected to extract a literal from all ${FINALIZER_STAGING_SITES.length} known ` +
      `call sites in ${FINALIZERS_SOURCE_PATH}, but only matched ${finalizerLiterals.length} ` +
      `(matched: ${JSON.stringify(finalizerLiterals.map((l) => l.label))}). A site whose regex silently stops ` +
      'matching is a site this ratchet has gone BLIND to — either that call site was restructured (update this ' +
      'test\'s regex for it) or it was deleted (remove its row from FINALIZER_STAGING_SITES deliberately, with a ' +
      'comment saying why).',
  );

  // Prove the regexes are targeting the RIGHT declarations, not merely
  // matching something that happens to parse: every extracted value must
  // equal today's independently-verified on-disk value.
  assert.equal(
    transcriptValue,
    EXPECTED_STAGING_DIRNAME_TODAY,
    `session-transcript.ts's extracted PACKAGE_DIRNAME (${JSON.stringify(transcriptValue)}) does not match the ` +
      `independently-verified current value (${JSON.stringify(EXPECTED_STAGING_DIRNAME_TODAY)}) — either the ` +
      'extraction regex is matching the wrong thing, or the value genuinely changed (update ' +
      'EXPECTED_STAGING_DIRNAME_TODAY here too, in the SAME commit as the production rename).',
  );
  for (const { label, value } of finalizerLiterals) {
    assert.equal(
      value,
      EXPECTED_STAGING_DIRNAME_TODAY,
      `extracted literal at ${label} (${JSON.stringify(value)}) does not match the independently-verified current ` +
        `value (${JSON.stringify(EXPECTED_STAGING_DIRNAME_TODAY)}) — either the extraction regex is matching the ` +
        'wrong thing, or the value genuinely changed (update EXPECTED_STAGING_DIRNAME_TODAY here too, in the SAME ' +
        'commit).',
    );
  }

  // THE RATCHET: every extracted literal — session-transcript.ts's
  // PACKAGE_DIRNAME AND both of interactive-finalizers.ts's call sites — must
  // be the IDENTICAL string. This is the assertion that fails LOUD the
  // moment either module's dirname literal moves out of sync with the
  // other — the exact defect class that already shipped once (R4-22: the
  // finalizer said 'staging' while the derivation side still said 'package',
  // both suites green throughout, because neither suite read the other's
  // literal).
  const allExtracted: Array<{ label: string; value: string }> = [
    { label: `PACKAGE_DIRNAME in ${TRANSCRIPT_SOURCE_PATH}`, value: transcriptValue as string },
    ...finalizerLiterals,
  ];
  const distinctValues = [...new Set(allExtracted.map((e) => e.value))];
  assert.equal(
    distinctValues.length,
    1,
    'STAGING-DIRNAME LITERALS HAVE DRIFTED APART:\n' +
      allExtracted.map((e) => `  - ${e.label}: ${JSON.stringify(e.value)}`).join('\n') +
      '\nFIX: either make every site above use the SAME string, or — better — introduce one shared, exported ' +
      'source-of-truth constant both modules import (this ratchet is deliberately written WITHOUT demanding that ' +
      'export today, since a new orchestrator/ export is operator-ask-first per this project\'s ADR-042 surface ' +
      'cap; if you are adding that export now, simplify this test to import it directly instead of scanning ' +
      'source text).',
  );
});

// ---------------------------------------------------------------------------
// BEHAVIOUR — the ratchet above proves the two literals AGREE as text; this
// proves they agree in a way that actually MATTERS: both real consumers
// (deriveSessionArtifact's file-package renderer, and this module's own
// copyStagingToLibrary) genuinely read/write through the SAME directory name
// the ratchet extracted. The fixture path below is built from EXTRACTION —
// never a hardcoded 'staging' literal — so this test and the ratchet above
// can never silently diverge from each other; if a future rename moves the
// extracted value, this test's fixture path moves right along with it.
// ---------------------------------------------------------------------------

test('BEHAVIOUR: deriveSessionArtifact(file-package) and copyStagingToLibrary both actually operate on the SAME directory name the ratchet extracts — fixture path derived from EXTRACTION, never a hardcoded "staging" literal', async () => {
  const transcriptSource = readFileSync(TRANSCRIPT_SOURCE_PATH, 'utf8');
  const stagingDirname = extractTranscriptPackageDirname(transcriptSource);
  assert.ok(
    stagingDirname !== null && stagingDirname.length > 0,
    'arrange: extraction must succeed before this behaviour test can build a meaningful fixture path (see the ' +
      'RATCHET test above for the full non-vacuous-extraction assertion)',
  );

  const scratch = mkScratch('interactive-finalizers-ratchet-behaviour-');
  try {
    // Deliberately NOT scratch.stagingDir (mkScratch's own hand-written
    // 'staging' literal, used by every OTHER test in this file).
    const derivedStagingDir = join(scratch.sessionDir, stagingDirname!);
    mkdirSync(derivedStagingDir, { recursive: true });
    const MARKER = '# ratchet behaviour cross-module marker f7e21c\n';
    writeFileSync(join(derivedStagingDir, 'SKILL.md'), MARKER, 'utf8');
    // Precondition, asserted before reading any verdict.
    assert.equal(
      readFileSync(join(derivedStagingDir, 'SKILL.md'), 'utf8'),
      MARKER,
      'arrange: staged file present at the EXTRACTED-derived path',
    );

    // Consumer 1: session-transcript.ts's deriveFilePackage, via the public
    // deriveSessionArtifact entry point (deriveFilePackage itself is not
    // exported — mirrors this repo's own session-transcript.test.ts idiom).
    const descriptor = {
      id: 'authoring',
      agent: 'creation-agent',
      title: 'Authoring session',
      legacyRoutes: [],
      stages: ['roadmap'],
      defaultStage: 'roadmap',
      artifact: { kind: 'file-package', label: 'Draft package' },
    } as SessionKindDescriptor;
    const artifact = deriveSessionArtifact({ descriptor, sessionDir: scratch.sessionDir }) as {
      files: Array<{ path: string; body: string }>;
    };
    assert.ok(
      artifact.files.some((f) => f.path === 'SKILL.md' && f.body === MARKER),
      `deriveSessionArtifact must read files under <extracted-dirname>/, not a hardcoded 'staging' literal — got ` +
        `files=${JSON.stringify(artifact.files)}`,
    );

    // Consumer 2: THIS module's own copyStagingToLibrary.
    const { error, wrote } = await callAndCapture({
      sessionDir: scratch.sessionDir,
      forgeRoot: scratch.forgeRoot,
      libraryRoot: scratch.libraryRoot,
      packageId: 'ratchet-behaviour-cross-module',
    });
    assert.equal(
      error,
      null,
      `copyStagingToLibrary must not throw when staged content lives under <extracted-dirname>/: ${error ? `${(error as Error & { name: string }).name}: ${(error as Error).message}` : ''}`,
    );
    const landed = (wrote ?? []).find((p) => p.endsWith(join('ratchet-behaviour-cross-module', 'SKILL.md')));
    assert.ok(landed, `expected a landed SKILL.md under the packageId dir, got wrote=${JSON.stringify(wrote)}`);
    assert.equal(readFileSync(landed!, 'utf8'), MARKER, 'the landed file must carry the staged content verbatim');
  } finally {
    cleanup(scratch.base);
  }
});

// ---------------------------------------------------------------------------
// P3 — skills/creation-agent/SKILL.md's directory prose is unpinned.
//
// MUTATION-PROVEN (originally by the reviewer, re-proven this round — see
// report): reverting skills/creation-agent/SKILL.md to its pre-rename
// `package/` prose produces ZERO new test failures across the WHOLE suite.
// The prose is what tells the LIVE agent where to write — if it says
// `package/` while the code reads `staging/`, drafted content never lands
// where `deriveFilePackage`/`copyStagingToLibrary` look, and the feature is
// completely non-functional with a green suite. This pin closes that gap: it
// reads the REAL, checked-in SKILL.md and asserts its CONTRACT (where the
// agent is told to write), deriving the expected directory name from the
// SAME EXTRACTED value the ratchet above uses — never a hardcoded literal
// and never the retired `STAGING_DIRNAME` import — so a future rename of the
// production constant moves this pin's expectation along with it instead of
// it silently rotting into a stale comparison.
//
// Deliberately NOT a full-text/verbatim-prose diff (that would be brittle —
// rewording the SKILL.md's prose without changing its CONTRACT should not
// fail this test): it asserts the directory token appears in a
// write-instruction context (a `<dirname>/` reference) and that the retired
// `package/` token does not appear anywhere in the file.
// ---------------------------------------------------------------------------

test('P3: skills/creation-agent/SKILL.md instructs the agent to write into <extracted-staging-dirname>/, not the retired package/ dir', () => {
  const transcriptSource = readFileSync(TRANSCRIPT_SOURCE_PATH, 'utf8');
  const stagingDirname = extractTranscriptPackageDirname(transcriptSource);
  assert.ok(
    stagingDirname !== null && stagingDirname.length > 0,
    'arrange: extraction must succeed before this test can derive its expectation (see the RATCHET test above)',
  );

  const skillMdPath = join(REPO_ROOT, 'skills', 'creation-agent', 'SKILL.md');
  assert.ok(existsSync(skillMdPath), 'arrange: skills/creation-agent/SKILL.md must exist on this branch');
  const body = readFileSync(skillMdPath, 'utf8');

  const stagingRef = new RegExp(`${stagingDirname}/`);
  assert.match(
    body,
    stagingRef,
    `SKILL.md must instruct the agent to write under <extracted-staging-dirname>/ ("${stagingDirname}/") — the ` +
      'directory deriveFilePackage/copyStagingToLibrary actually read. A prose-only revert to the pre-rename ' +
      'dirname would silently break the live agent with zero test failures anywhere else in the whole suite (the ' +
      'original mutation proof, re-proven for this pin round — see report).',
  );
  assert.doesNotMatch(
    body,
    /\bpackage\//,
    'SKILL.md must NOT still instruct the agent to write into the retired package/ dir — the rename (D2) is ' +
      'complete, not additive; a leftover "package/" instruction would mean the live agent drafts into a directory ' +
      'nothing on the read side scans anymore.',
  );
});
