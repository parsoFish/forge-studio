/**
 * The single, generalized realpath-based containment guard for every Studio
 * bridge write route that resolves a request-supplied id/slug into an
 * on-disk path under a fixed containment root (2026-08-06, R2-09 WI-fix2).
 *
 * This closes the NINTH confirmed arbitrary-file-write/-read escape across
 * six initiatives in this campaign — every prior instance was a *lexical*
 * `startsWith`/`join`/`resolve` check on an UNRESOLVED path. That shape is
 * worthless: `join()`/`resolve()` normalize `..` before the comparison ever
 * runs, and a symlink's own on-disk LOCATION is lexically inside the allowed
 * root even when it POINTS somewhere else entirely.
 *
 * Generalises the former `skill-md-path-guard.ts` (hardcoded to
 * `skills/<slug>/SKILL.md`) to ANY `<root>/<segments...>` shape — one choke
 * point for all five current callers:
 *   - PUT  /api/studio/agents/:slug        → skills/<slug>/SKILL.md
 *   - POST /api/studio/skills              → skills/<slug>/SKILL.md
 *   - PUT  /api/studio/flows/:id           → studio/flows/<id>/flow.yaml
 *   - PUT  /api/studio/projects/:id        → <projectRoot>/.forge/project.json
 *   - POST /api/studio/agents/:slug/instructions-draft → skills/<slug>/SKILL.md
 *
 * Every id/slug reaching this module MUST already have been validated
 * against `SLUG_RE` by its caller (defense in depth — this module only
 * re-verifies path containment, never slug shape; see each call site).
 *
 * Escape shapes closed here, all confirmed live in this campaign's rounds:
 *   1. A symlinked LEAF file (`SKILL.md`/`flow.yaml`/`project.json`) inside a
 *      genuinely real containing directory, pointing outside the root.
 *   2. A symlinked <root>/<id> DIRECTORY itself, pointing outside the root.
 *   3. A symlinked <root>/<id> DIRECTORY pointing at a DIFFERENT REAL object
 *      under the SAME root (`evil` → `legit`) — a plain "is the resolved
 *      path somewhere under root" check reports this as contained (it IS,
 *      genuinely, under root) while silently reading/writing the WRONG
 *      object. Containment must mean "this id's own directory", not merely
 *      "somewhere under root" — see the per-segment IDENTITY check below.
 *   4. A symlinked NESTED segment one or more levels below the id directory
 *      (a real project whose `.forge` is a symlinked directory; a real
 *      agent whose SKILL.md's PARENT is real but SKILL.md itself is a
 *      symlink) — closed by walking EVERY segment, not just the first.
 *   5. A HARDLINKED leaf. `realpathSync` only resolves symlinks — a
 *      hardlinked file is a genuine, non-symlink directory entry, lexically
 *      AND really inside the root, sharing an inode with the outside file it
 *      was linked from. `realpathSync` returns the in-tree path unchanged
 *      (nothing to resolve), so a realpath-only containment check passes —
 *      yet writing through it mutates the shared inode. No race required;
 *      100% deterministic. Closed by the `nlink === 1` check on the leaf.
 *   6. A dangling symlink at any segment — the existence probe (lstat-based)
 *      reports it as "there", so it is routed into the realpath check (which
 *      throws) rather than mistaken for a free-to-create slot.
 *   7. A non-ENOENT `lstat` failure at any segment (EACCES on a
 *      no-search-permission ancestor, ENOTDIR when a regular file occupies a
 *      path slot expected to be a directory, or any other/missing errno)
 *      misread as "does not exist". That inference is only valid for a
 *      genuine ENOENT; anything else means the guard cannot determine
 *      existence and must fail CLOSED rather than fall into create-mode for
 *      a segment it never actually inspected (R2-09 WI-fix3).
 *
 * CONTRACT — the `root` parameter is TRUSTED, not another guarded segment
 * (R2-09 WI-fix3; a follow-on security WI, bd `forge-wze`, relies on this
 * being stated here):
 *   - `root` MUST be a fixed, config-derived constant (e.g. `skills/`,
 *     `studio/flows/`, a project's own root directory) — NEVER
 *     request-derived, and never built by folding a caller-supplied id into
 *     it before calling this function.
 *   - `realpathSync(root)` below deliberately resolves `root` itself with NO
 *     identity check on it at all — a legitimately symlinked checkout must
 *     still work. That means anything folded into `root` is trusted
 *     IMPLICITLY and bypasses every check this module makes; it never
 *     enters the per-segment identity walk that catches everything else.
 *   - Every untrusted id MUST arrive as its own element of `segments[]`,
 *     never concatenated/joined into `root`. For the same malicious
 *     `untrustedId`, compare:
 *       WRONG (root-folding — total containment bypass):
 *         resolveGuardedPath(join(base, untrustedId), ['kb.yaml'])
 *       RIGHT (per-segment identity check applies):
 *         resolveGuardedPath(base, [untrustedId, 'kb.yaml'])
 *     These two calls look nearly identical at a glance; only the second is
 *     safe. Proven live: with `untrustedId` a symlink pointing outside
 *     `base`, the WRONG form still returns `{ok:true}` for a path entirely
 *     outside containment, because `realpathSync(root)` silently folds and
 *     resolves it before any per-segment check ever runs. Safe TODAY only
 *     because every current call site passes a trusted, config-derived
 *     constant for `root` — this is the "guard that cannot fail" shape (see
 *     the escape-shapes list above) relocated to the `root` parameter
 *     instead of a `segments[]` element.
 *
 * Create is preserved: the leaf legitimately does not exist yet for a
 * brand-new agent/flow/project (each route's scaffold-on-save path). Rather
 * than requiring the whole chain to exist, this walks to the DEEPEST
 * EXISTING ancestor (lstat-based existence, so a dangling symlink is never
 * mistaken for "free to create"), identity-verifies only THAT (only a real
 * filesystem entry can carry a symlink or hardlink), then reassembles the
 * not-yet-created tail literally — a non-existent path component cannot
 * itself be a symlink or hardlink.
 *
 * Residual TOCTOU (disclosed, not silently accepted): between this
 * function's `realpathSync`/`lstatSync` calls and a caller's later
 * `readFileSync`/`writeFileSync`, the filesystem could in theory change (a
 * symlink or hardlink swapped in after this check but before the write
 * completes). In every PUT/POST route that calls this guard, that window is
 * WIDER than just "the local fs calls that follow" — it spans an
 * attacker-paced `await readJson(req)` that runs AFTER the guard check but
 * BEFORE the write: the guard resolves the path first, then the route awaits
 * the request body, and only then reads/writes through the resolved path. A
 * slow-body attacker (deliberately trickling bytes) can hold that window
 * open indefinitely. This is the standard check-then-use TOCTOU inherent to
 * any non-atomic filesystem API and is NOT closed here — an atomic
 * `O_NOFOLLOW`-based open-if-still-contained would be needed to fully close
 * it, which Node's `fs` module does not expose ergonomically for this call
 * shape. Stated honestly, not understated: this guard closes every
 * DETERMINISTIC bypass (symlink, hardlink, cross-object same-root alias,
 * nested-segment symlink) but does not, and cannot by itself, close the
 * timing window between "verified safe" and "used".
 */

import { join, relative, sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

export interface PathGuardOk {
  ok: true;
  /** Fully realpath-verified (for the existing prefix) + literally
   *  reassembled (for the not-yet-created tail) absolute path. Safe to
   *  read/write/mkdir through, subject to the disclosed residual TOCTOU
   *  above. */
  realPath: string;
  /** True iff every segment — including the leaf — already exists on disk
   *  (an edit of an existing object). False iff the leaf (or an
   *  intermediate ancestor) does not exist yet (a legitimate create/scaffold
   *  path). */
  exists: boolean;
}

export interface PathGuardReject {
  ok: false;
  /** Internal diagnostic only — NEVER forward verbatim to an untrusted
   *  client. It can name which segment failed, which is a fingerprinting
   *  aid for an attacker iterating on the guard; every call site sends a
   *  fixed, generic 4xx message instead and logs/discards this reason. */
  reason: string;
}

export type PathGuardResult = PathGuardOk | PathGuardReject;

/** Three-way outcome of probing a segment's existence. Collapsing this to a
 *  boolean is exactly the fail-open defect this module used to have:
 *  `lstatSync` can fail for reasons that have nothing to do with absence
 *  (EACCES on a no-search-permission ancestor, ENOTDIR when a file occupies a
 *  directory's slot, ...) — those are "cannot determine", not "absent", and
 *  must fail closed rather than be silently treated as a free creation slot. */
type ExistenceProbe = { kind: 'exists' } | { kind: 'absent' } | { kind: 'indeterminate'; code: string };

/** Existence probe that does NOT follow the final path component — a
 *  dangling symlink (whose target is gone) still counts as "there", so it is
 *  routed into the realpath identity check below rather than mistaken for an
 *  empty creation slot. Only a genuine ENOENT means "absent"; every other
 *  `lstatSync` failure (including a missing/undefined `.code`) is
 *  "indeterminate" and must be handled as fail-closed by the caller — never
 *  treated as absence. */
function probeExistence(path: string): ExistenceProbe {
  try {
    lstatSync(path);
    return { kind: 'exists' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'indeterminate', code: code ?? '<no error code>' };
  }
}

/** A path segment is safe to `join()` literally only if it is a single,
 *  non-empty directory-entry NAME — no separators, no `.`/`..`. Every
 *  caller's id/slug is already SLUG_RE-validated before it reaches here
 *  (defense in depth, not a replacement — see each call site's own guard);
 *  the fixed literal segments this module also receives ('SKILL.md',
 *  '.forge', 'flow.yaml', 'project.json') trivially satisfy this too. This
 *  is the belt for whichever suspenders a future caller forgets. */
function isSafeSegment(seg: string): boolean {
  return seg.length > 0 && seg !== '.' && seg !== '..' && !seg.includes('/') && !seg.includes('\\') && !seg.includes(sep);
}

/**
 * Resolve `<root>/<segments[0]>/<segments[1]>/...` with genuine, per-segment
 * IDENTITY containment — never a lexical prefix check on the unresolved,
 * `join()`-constructed string.
 *
 * Algorithm: realpath the root first (so a legitimately symlinked checkout
 * still works — this is intentional, not a bypass). Then walk the segments
 * one at a time: for each segment that already exists on disk, realpath it
 * and assert the result is EQUAL to the literal expected path
 * (`join(<verified-so-far>, seg)`) — not merely "somewhere under root", the
 * exact expected location. The first segment that does not yet exist stops
 * the walk; the remaining segments are reassembled literally (a
 * non-existent path cannot be a symlink). If the whole chain exists, the
 * leaf gets one more check: `nlink === 1` when it is a regular file, closing
 * the hardlink bypass realpath is structurally blind to.
 */
export function resolveGuardedPath(root: string, segments: readonly string[]): PathGuardResult {
  if (segments.length === 0) return { ok: false, reason: 'no path segments given' };

  // Validate EVERY segment up front, before the walk — not lazily as the walk
  // reaches each one (SEC-01 guard-attack round). The walk stops at the first
  // segment that does not exist and reassembles the remaining tail literally;
  // when the check lived inside the loop, every segment AFTER that break was
  // never inspected at all, and `join()` silently normalised a later `..`
  // away. Live repro:
  //   resolveGuardedPath(root, ['idA','nonexistent','..','..','idB','kb.yaml'])
  // returned `{ok:true, exists:false}` with a realPath pointing at `idB` — a
  // DIFFERENT, genuinely existing object, additionally misreported as absent.
  // That is escape shape 3 (cross-object) re-entering through create-mode, and
  // it also falsified this module's own claim below that every reassembled
  // segment "already passed isSafeSegment". Hoisting the check makes that
  // claim true for the first time.
  for (const seg of segments) {
    if (!isSafeSegment(seg)) return { ok: false, reason: `unsafe path segment "${seg}"` };
  }

  let realRoot: string;
  try {
    // See the module docstring's CONTRACT section: this deliberately
    // performs NO identity check on `root` itself (only on `segments`
    // below) — `root` must be trusted/config-derived, never built by
    // folding a caller-supplied id into it.
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, reason: 'containment root does not exist' };
  }

  let verified = realRoot; // the deepest ancestor verified identical to its expected path so far
  let i = 0;
  for (; i < segments.length; i++) {
    const seg = segments[i]; // already isSafeSegment-validated above, for ALL segments
    const expected = join(verified, seg);
    const probe = probeExistence(expected);
    if (probe.kind === 'indeterminate') {
      // Cannot determine whether this segment exists — fail CLOSED. Only a
      // genuine ENOENT means "absent"; any other errno (permission denied, a
      // file occupying a directory's slot, an unrecognized or missing code)
      // means this segment was never actually inspected, and certifying
      // "safe to create" for an uninspected segment is precisely the
      // fail-open shape this module exists to close everywhere else.
      return { ok: false, reason: `cannot determine existence of segment "${seg}" (lstat failed: ${probe.code})` };
    }
    if (probe.kind === 'absent') break; // deepest existing ancestor is `verified` — stop, create-mode from here

    let real: string;
    try {
      real = realpathSync(expected);
    } catch {
      // lstat says it's there but realpath can't resolve it — a dangling
      // symlink. Never a creation opportunity to build on top of; refuse.
      return { ok: false, reason: `dangling or unresolvable entry at segment "${seg}"` };
    }
    if (real !== expected) {
      // The IDENTITY check (not mere containment): a symlink at this
      // segment resolves somewhere other than its own expected location —
      // whether that "somewhere" is outside root entirely, or (the
      // same-root cross-object escape) a DIFFERENT real object's directory
      // that also happens to live under root. "Somewhere under root" is not
      // the guarantee needed; "exactly this expected path" is.
      return { ok: false, reason: `identity mismatch at segment "${seg}"` };
    }
    verified = expected;
  }

  if (i === segments.length) {
    // The full path already exists and every segment passed its identity
    // check. One more deterministic bypass realpath is structurally blind
    // to: a hardlinked leaf shares an inode with a file outside root while
    // its OWN directory-entry name is genuinely, really inside root — no
    // symlink anywhere, nothing for realpathSync to resolve away.
    let st;
    try {
      st = lstatSync(verified);
    } catch {
      return { ok: false, reason: 'leaf disappeared between the existence check and stat' };
    }
    if (st.isFile() && st.nlink !== 1) {
      return { ok: false, reason: 'leaf is hardlinked (nlink != 1) — refusing a write/read through a shared inode' };
    }
    return { ok: true, realPath: verified, exists: true };
  }

  // Create-mode: `verified` is the deepest EXISTING ancestor, already
  // identity-checked above. The remaining segments do not exist yet, so —
  // by definition — none of them can currently be a symlink or hardlink;
  // reassemble them literally (their names already passed isSafeSegment).
  const realPath = join(verified, ...segments.slice(i));

  // Defensive final assertion (belt and suspenders, should be unreachable
  // given every consumed segment is single-component with no '/' or '..'):
  // the reassembled path must still resolve as a descendant of realRoot.
  //
  // Scope — what this check does NOT cover; do not mistake it for the
  // containment guarantee:
  //   - It is a LEXICAL string check (`relative`/`startsWith`) on an
  //     UNRESOLVED path — exactly the shape this whole module exists to
  //     replace (see the module docstring's opening paragraph). It is a
  //     backstop on the literal reassembly directly above, nothing more.
  //   - It cannot and does not detect symlinks, hardlinks, cross-object
  //     same-root aliases, or nested-segment escapes. Those are caught
  //     ONLY by the per-segment realpath identity walk and the `nlink`
  //     check earlier in this function — both already ran before this
  //     line, over the segments that walk proved do not exist yet.
  //   - It cannot protect a `root` that was itself unsafe (see the
  //     CONTRACT section in the module docstring): `realRoot` is this
  //     check's baseline, so anything wrong with `root` is baked into the
  //     comparison before this line ever runs.
  //   - If this check ever fires, treat it as a BUG IN THIS MODULE (an
  //     earlier invariant — `isSafeSegment` — was violated), not as a
  //     routine input-rejection path.
  //
  // The comparison is SEGMENT-WISE, not a bare `startsWith('..')`. A path
  // "steps out of root" only when the relative path's FIRST SEGMENT is
  // exactly `..` — a directory-entry name that merely BEGINS with two dots
  // (`..foo` is a perfectly legal, perfectly contained name that
  // `isSafeSegment` correctly allows, since it is neither `.` nor `..` and
  // holds no separator) yields `rel = "..foo/<leaf>"`, which a bare prefix
  // test would reject even though the path never left the root. Rejecting a
  // contained path is a false positive, and it would ALSO have falsified the
  // "if this ever fires it is a bug in this module" line above. Unreachable
  // from the five current call sites — every untrusted id is SLUG_RE-gated
  // to start with a lowercase letter, and every fixed literal segment is
  // safe — so this is a correctness fix in the module's own contract, not a
  // closed escape.
  const rel = relative(realRoot, realPath);
  const relFirstSegment = rel.split(sep)[0];
  if (rel === '' || relFirstSegment === '..') {
    return { ok: false, reason: 'reassembled path escapes the containment root' };
  }

  return { ok: true, realPath, exists: false };
}
