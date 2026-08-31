/**
 * `FINALIZERS` — the deep-frozen registry of finalize-phase steps a generic
 * interactive runner invokes at its `committing` stage (ADR-043 §2/§5,
 * R4-22 WI-2). Seeded incrementally; THIS WI ships exactly ONE entry,
 * `copyStagingToLibrary` — the COPY primitive that installs the package an
 * interactive agent drafted into a session's `staging/` dir into the real
 * library under a trusted, config-derived containment root. Later WIs add
 * `promoteToQueue`, `writeToRepoRoot`, `commitToCentralBrain`, and the demo
 * snapshot-restore lock (ADR-043 §5) as their own rows — none of them exist
 * yet, and `resolveFinalizer` must resolve them to `undefined` until they do.
 *
 * Scope discipline: this is the generic COPY primitive only. It does not
 * validate frontmatter, enforce skill/hook-specific semantics, or otherwise
 * duplicate `installSkillPackage` — that stays a separate concern.
 *
 * ---------------------------------------------------------------------------
 * CONTAINMENT (the whole point of this WI — see the
 * `adversarial-containment-review` skill and `cli/studio-path-guard.ts`'s own
 * header before touching this file)
 * ---------------------------------------------------------------------------
 *
 * Reuses the EXISTING guard (`resolveGuardedPath`, `cli/studio-path-guard.ts`)
 * on BOTH sides of the copy — no hand-rolled containment logic anywhere here:
 *
 *   - DESTINATION: `resolveGuardedPath(libraryRoot, [packageId, ...relParts])`.
 *     `libraryRoot` is the trusted, config-derived containment root (per that
 *     module's CONTRACT section — never itself built by folding an untrusted
 *     value in); `packageId` (request-derived/untrusted) and every
 *     relative-path component of a staged entry ride as their OWN elements of
 *     `segments[]`, never folded into `root` — folding is the root-folding
 *     escape shape that module's docstring documents as a total containment
 *     bypass (the comparison becomes tautological). Passing `packageId` as a
 *     single, unsplit segment also means `resolveGuardedPath`'s own
 *     `isSafeSegment` (rejects `''`, `.`, `..`, any segment containing a path
 *     separator, and C0 control characters) is the ONLY validation this
 *     module needs for it — no parallel hand-rolled check.
 *
 *   - SOURCE: the same guard, anchored at the session's own trusted root —
 *     `resolveGuardedPath(sessionDir, ['staging', ...relParts])` — for EVERY
 *     entry the recursive walk discovers, directories included, before ever
 *     `readdirSync`-ing into one. This is what closes the source-side
 *     symlink/hardlink escapes (a directory symlink under `staging/`, a file
 *     symlink whose *containing* directory is genuinely real, a hardlinked
 *     leaf `realpath` is structurally blind to, a self-referential symlink):
 *     the guard's per-segment IDENTITY check (not mere "somewhere under
 *     root" membership) and its `nlink === 1` leaf check both fire on the
 *     source path exactly as they do on the destination path — reused, not
 *     reimplemented. Critically, the walker never `readdirSync`s a directory
 *     entry until AFTER that entry's own guard check has passed, so a
 *     directory symlink is refused before its (potentially attacker-owned,
 *     outside-the-tree) contents are ever listed.
 *
 * CHECK-THEN-WRITE, two distinct phases: `discoverStagingEntries` (source
 * validation) and the destination-guard loop below it run to completion —
 * validating EVERY entry the operation will touch — with ZERO filesystem
 * writes, before `copyStagingToLibrary`'s second half performs any
 * `mkdirSync`/write. An escaping entry anywhere in the staged tree throws
 * before the write phase starts, so a package directory with one legitimate
 * entry and one escaping entry never gets its legitimate entry written
 * either — moving a writing operation earlier only changes which artifact
 * gets orphaned, so nothing here writes speculatively. That is the ONE
 * property phase separation buys: no partial package.
 *
 * WHAT PHASE SEPARATION COSTS (stated honestly — R4-22 WI-2, an
 * adversarial-review-REPRODUCED finding this module previously did NOT
 * disclose): validating every entry before writing any also WIDENS the
 * window between "an entry was checked" and "that entry is used", relative
 * to an immediate check-then-use. Phase 1 records each entry's realpath as a
 * PATH STRING; for the first entry discovered, that string then sits unused
 * across the validation of every OTHER entry plus the whole destination
 * pass before Phase 2 ever opens it. A staged entry unlinked and re-created
 * as a symlink to an outside file inside that window is — if Phase 2 trusts
 * the recorded string and reopens it BY NAME — followed straight into the
 * library, with every `resolveGuardedPath` call along the way having
 * reported `{ok:true}` (this exact race was reproduced, twice, before this
 * sentence was written). This is a *widening* of the residual TOCTOU gap
 * `cli/studio-path-guard.ts`'s own header already discloses as un-closed by
 * that module alone ("between this function's realpathSync/lstatSync calls
 * and a caller's later readFileSync/writeFileSync"): a caller that turns a
 * two-phase check into a two-phase check-then-USE makes that caller's own
 * slice of the gap longer, not shorter.
 *
 * THE FIX, without abandoning check-then-write (the no-partial-package
 * property above is separately load-bearing and stays): Phase 2 never
 * reopens a Phase-1-recorded path BY NAME. Every read (`readValidatedStagedFile`)
 * and every write (`writeValidatedLibraryFile`) goes through
 * `openSync(path, O_NOFOLLOW | ...)` — which fails outright if the final
 * path component is now a symlink, exactly the swap the finding
 * demonstrates — followed by `fstatSync` on the returned FILE DESCRIPTOR
 * (not the path) re-verifying `isFile()` and, on the read side, `nlink===1`
 * (closing the hardlink-swap variant too). Re-verifying on the fd closes the
 * gap between "checked" and "used" to zero: there is no second name lookup
 * left to race, because nothing after the `openSync` call ever looks the
 * path up again.
 *
 * RESIDUAL (disclosed, not closed here): `O_NOFOLLOW` guards only the FINAL
 * path component. Neither this fix nor `resolveGuardedPath`'s own walk
 * re-verifies each INTERMEDIATE directory component of `srcRealPath` /
 * `destPath` at the moment `mkdirSync`/`openSync` actually traverses it —
 * an attacker who could swap an intermediate directory (not the leaf)
 * between the Phase-1 check and the Phase-2 open could still redirect the
 * walk. Closing that would require a per-segment `openat`-style walk with
 * `O_NOFOLLOW` at every level, not just the leaf; out of scope for this fix,
 * which closes exactly the reproduced leaf-swap shape.
 *
 * Recursive, not top-level-only: `discoverStagingEntries` branches explicitly
 * on `isDirectory()` vs `isFile()` (never silently swallowing an EISDIR from
 * a naive top-level `readFileSync` the way a sibling initiative once did) so
 * nested staged files install too.
 * ---------------------------------------------------------------------------
 */

import {
  readdirSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  openSync,
  fstatSync,
  readSync,
  writeSync,
  closeSync,
  constants as fsConstants,
} from 'node:fs';
import { join, dirname } from 'node:path';

import { resolveGuardedPath } from '../cli/studio-path-guard.ts';

// ---------------------------------------------------------------------------
// Error contract (ADR-042's third boundary — a pure function with an
// explicit error contract). A deliberately NAMED class, never a bare Error,
// so a caller can distinguish "the finalizer refused this operation" from an
// accidental crash bubbling up through the same call.
// ---------------------------------------------------------------------------

export class InteractiveFinalizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveFinalizerError';
    // Restores the prototype chain under the ES5-target transpilation some
    // toolchains still apply to `extends Error` — belt-and-suspenders, cheap
    // insurance so `instanceof InteractiveFinalizerError` never silently lies.
    Object.setPrototypeOf(this, InteractiveFinalizerError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export type FinalizerId = 'copyStagingToLibrary';

export type FinalizerContext = {
  /** Trusted — the caller already SEC-04-guarded this. */
  sessionDir: string;
  /** Trusted, config-derived. */
  forgeRoot: string;
  /** Trusted, config-derived containment root. */
  libraryRoot: string;
  /** UNTRUSTED, request-derived. */
  packageId: string;
};

export type FinalizerFn = (ctx: FinalizerContext) => string[] | Promise<string[]>;

export type FinalizerRow = {
  readonly id: FinalizerId;
  readonly run: FinalizerFn;
};

// ---------------------------------------------------------------------------
// copyStagingToLibrary
// ---------------------------------------------------------------------------

/** One discovered staged file: its path relative to `staging/` (as
 *  individual segments) plus the guard-verified real path it was found at. */
type StagedEntry = { relParts: string[]; srcRealPath: string };

/**
 * Recursively walk `<sessionDir>/staging/`, routing EVERY discovered entry —
 * directories included, before descending into them — through
 * `resolveGuardedPath(sessionDir, ['staging', ...relParts])`. Throws
 * `InteractiveFinalizerError` on the first entry that fails containment
 * (symlink, hardlink, or any other guard rejection); performs no writes.
 */
function discoverStagingEntries(sessionDir: string): StagedEntry[] {
  const out: StagedEntry[] = [];

  function walk(currentReal: string, relParts: string[]): void {
    let names: string[];
    try {
      names = readdirSync(currentReal).sort();
    } catch (err) {
      throw new InteractiveFinalizerError(
        `copyStagingToLibrary: failed to list staging directory at "${relParts.join('/') || '.'}": ` +
          `${(err as NodeJS.ErrnoException).message}`,
      );
    }

    for (const name of names) {
      const nextRelParts = [...relParts, name];
      // Reuse the EXISTING guard for the SOURCE side too — the same
      // per-segment identity walk + nlink===1 leaf check that protects the
      // destination, anchored at the trusted sessionDir. This is what stops
      // us from ever readdirSync-ing THROUGH a directory symlink: the guard
      // check on the entry itself runs before any recursion into it.
      const guarded = resolveGuardedPath(sessionDir, ['staging', ...nextRelParts]);
      if (!guarded.ok) {
        throw new InteractiveFinalizerError(
          `copyStagingToLibrary: staged entry "${nextRelParts.join('/')}" failed source containment (${guarded.reason}).`,
        );
      }
      if (!guarded.exists) {
        // Discovered via readdirSync a moment ago, gone (or never real) by
        // the time the guard re-probed it — fail loud, never silently skip.
        throw new InteractiveFinalizerError(
          `copyStagingToLibrary: staged entry "${nextRelParts.join('/')}" vanished mid-walk.`,
        );
      }

      let st;
      try {
        // Safe: `guarded.realPath` is already identity-verified by
        // resolveGuardedPath above — this lstat cannot be following anything
        // new, it is a pure type check (file vs directory) on the real entry.
        st = lstatSync(guarded.realPath);
      } catch (err) {
        throw new InteractiveFinalizerError(
          `copyStagingToLibrary: staged entry "${nextRelParts.join('/')}" vanished after its containment check: ` +
            `${(err as NodeJS.ErrnoException).message}`,
        );
      }

      if (st.isDirectory()) {
        walk(guarded.realPath, nextRelParts);
      } else if (st.isFile()) {
        out.push({ relParts: nextRelParts, srcRealPath: guarded.realPath });
      } else {
        // A FIFO, socket, device node, etc. — never silently drop it.
        throw new InteractiveFinalizerError(
          `copyStagingToLibrary: staged entry "${nextRelParts.join('/')}" is neither a regular file nor a directory — refusing.`,
        );
      }
    }
  }

  const stagingRoot = join(sessionDir, 'staging');
  let rootReal: string;
  try {
    // `sessionDir` (and therefore its 'staging' child) is TRUSTED per this
    // module's contract — no identity check here, matching how
    // resolveGuardedPath itself treats its own `root` parameter.
    rootReal = realpathSync(stagingRoot);
  } catch (err) {
    throw new InteractiveFinalizerError(
      `copyStagingToLibrary: session staging directory is missing or unreadable: ${(err as NodeJS.ErrnoException).message}`,
    );
  }

  walk(rootReal, []);
  return out;
}

/**
 * Read a Phase-1-validated staged entry's bytes AT READ TIME, closing the
 * TOCTOU window between validation and use (R4-22 WI-2 reproduced finding —
 * see the module header). `openSync(..., O_NOFOLLOW)` makes the open itself
 * FAIL if the final path component is now a symlink — exactly the swap the
 * finding demonstrates. `fstatSync` then re-verifies on the returned FILE
 * DESCRIPTOR, not the path string, so nothing between "opened" and
 * "verified" is a second name lookup left to race: `isFile()` (refuses a
 * FIFO/device/anything-but-regular swapped in), and `nlink === 1` (refuses a
 * hardlink swap — `realpath` is structurally blind to a shared inode, the fd
 * stat is not). Closes the fd in `finally` on every path, including every
 * throw, so a rejected entry never leaks a descriptor.
 */
function readValidatedStagedFile(srcRealPath: string, relLabel: string): Buffer {
  let fd: number;
  try {
    fd = openSync(srcRealPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    throw new InteractiveFinalizerError(
      `copyStagingToLibrary: staged entry "${relLabel}" could not be opened for read at write time — changed since ` +
        `its Phase-1 check (most likely swapped for a symlink): ${(err as NodeJS.ErrnoException).message}`,
    );
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) {
      throw new InteractiveFinalizerError(
        `copyStagingToLibrary: staged entry "${relLabel}" is no longer a regular file at read time — refusing ` +
          `(TOCTOU guard).`,
      );
    }
    if (st.nlink !== 1) {
      throw new InteractiveFinalizerError(
        `copyStagingToLibrary: staged entry "${relLabel}" gained additional hard links between its Phase-1 check ` +
          `and read time (nlink=${st.nlink}) — refusing (TOCTOU guard).`,
      );
    }
    const size = st.size;
    const buf = Buffer.alloc(size);
    let readTotal = 0;
    while (readTotal < size) {
      const n = readSync(fd, buf, readTotal, size - readTotal, readTotal);
      if (n === 0) break; // EOF before the fstat'd size — file shrank under us; take what we got, never hang.
      readTotal += n;
    }
    return readTotal === size ? buf : buf.subarray(0, readTotal);
  } finally {
    closeSync(fd);
  }
}

/**
 * Write `buf` to `destPath` with the SAME fd-based discipline as the read
 * side, closing the SYMMETRIC destination-side gap: `resolveGuardedPath`
 * verified `destPath` at Phase-1 check time, but re-opening it BY NAME at
 * write time (a plain `writeFileSync`) would happily follow a symlink an
 * attacker plants at that exact leaf in the window between the check and
 * this write. `O_EXCL` refuses to open through anything that already exists
 * at that leaf — symlink or otherwise — so this only ever creates a brand
 * new destination file, never overwrites one; `O_NOFOLLOW` is
 * belt-and-suspenders for the identical reason as the read side. Closes the
 * fd in `finally` on every path.
 */
function writeValidatedLibraryFile(destPath: string, buf: Buffer, relLabel: string): void {
  let fd: number;
  try {
    fd = openSync(
      destPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    );
  } catch (err) {
    throw new InteractiveFinalizerError(
      `copyStagingToLibrary: destination for "${relLabel}" could not be created at write time — already exists or ` +
        `was swapped for a symlink since its Phase-1 check: ${(err as NodeJS.ErrnoException).message}`,
    );
  }
  try {
    let written = 0;
    while (written < buf.length) {
      written += writeSync(fd, buf, written, buf.length - written);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Install the package drafted at `<sessionDir>/staging/` into
 * `<libraryRoot>/<packageId>/<relPath...>`. Synchronous (matches the
 * existing finalizer-equivalents `runCommitStep`/`runLockStep`). Throws
 * `InteractiveFinalizerError` — and writes NOTHING — if any staged entry or
 * its destination fails containment; returns the list of written destination
 * paths on success.
 */
export function copyStagingToLibrary(ctx: FinalizerContext): string[] {
  const { sessionDir, libraryRoot, packageId } = ctx;

  // ---- Phase 1: resolve and validate EVERY entry, zero side effects ----

  // Validate packageId's own directory up front — even a staging tree with
  // zero entries must not silently accept an escaping packageId.
  const pkgGuard = resolveGuardedPath(libraryRoot, [packageId]);
  if (!pkgGuard.ok) {
    throw new InteractiveFinalizerError(`copyStagingToLibrary: packageId failed containment (${pkgGuard.reason}).`);
  }

  const staged = discoverStagingEntries(sessionDir);

  const planned: { destPath: string; srcRealPath: string; relLabel: string }[] = [];
  for (const entry of staged) {
    const destGuard = resolveGuardedPath(libraryRoot, [packageId, ...entry.relParts]);
    if (!destGuard.ok) {
      throw new InteractiveFinalizerError(
        `copyStagingToLibrary: destination for "${entry.relParts.join('/')}" failed containment (${destGuard.reason}).`,
      );
    }
    planned.push({ destPath: destGuard.realPath, srcRealPath: entry.srcRealPath, relLabel: entry.relParts.join('/') });
  }

  // ---- Phase 2: use. Every entry above already passed both guards; the
  // read and write below each re-verify AT THE POINT OF USE (on the open
  // file descriptor, never by re-resolving the path string) so nothing in
  // this loop trusts a Phase-1 check across the gap to when it is actually
  // used — see readValidatedStagedFile / writeValidatedLibraryFile above. ----

  const wrote: string[] = [];
  for (const { destPath, srcRealPath, relLabel } of planned) {
    const buf = readValidatedStagedFile(srcRealPath, relLabel);
    mkdirSync(dirname(destPath), { recursive: true });
    writeValidatedLibraryFile(destPath, buf, relLabel);
    wrote.push(destPath);
  }

  return wrote;
}

// ---------------------------------------------------------------------------
// FINALIZERS registry — deep-frozen (each row individually, BEFORE the outer
// array — Object.freeze is SHALLOW, so freezing only the outer container
// would leave each row object mutable). Copied verbatim from
// SESSION_ARTIFACT_KINDS's own pattern/reasoning in
// `orchestrator/studio/session-kinds.ts`: freezing only the outer array
// would let `FINALIZERS[0].id = 'HACKED'` silently succeed, and since
// `resolveFinalizer` reads straight off these rows, an in-process mutation
// could flip which function an id resolves to for the rest of the process.
// ---------------------------------------------------------------------------

export const FINALIZERS: readonly FinalizerRow[] = Object.freeze([
  Object.freeze({ id: 'copyStagingToLibrary', run: copyStagingToLibrary }),
] as const);

/** Total lookup: an array + `.find()`, never a plain `{}` id-keyed map — a
 *  map lookup falls through the Object prototype chain for ids like
 *  `"__proto__"`/`"constructor"`/`"toString"`/`"hasOwnProperty"`, resolving
 *  them to a truthy prototype member instead of `undefined`. `.find()` over
 *  an array has no prototype chain to fall through. Never throws. */
export function resolveFinalizer(id: string): FinalizerFn | undefined {
  return FINALIZERS.find((row) => row.id === id)?.run;
}
