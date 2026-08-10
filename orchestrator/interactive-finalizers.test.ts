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
import { join } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { FINALIZERS, resolveFinalizer, copyStagingToLibrary } from './interactive-finalizers.ts';

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

test('FINALIZERS is seeded with EXACTLY one row: copyStagingToLibrary', () => {
  assert.equal(
    FINALIZERS.length,
    1,
    `ADR-043 §5 seeds the registry incrementally — this WI ships exactly one entry. Got ${FINALIZERS.length}. ` +
      `Kills a pre-population of the other four ADR-043-named finalizers (promoteToQueue, writeToRepoRoot, ` +
      `commitToCentralBrain, demo's snapshot-restore lock) before their own WIs build them.`,
  );
  assert.equal(FINALIZERS[0].id, 'copyStagingToLibrary');
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
