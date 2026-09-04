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

import { join, relative, sep, dirname } from 'node:path';
import { lstatSync, realpathSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync } from 'node:fs';

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

/**
 * Shared exception type for a `resolveGuardedPath` rejection that a caller
 * wants to fail an entire operation closed on, rather than silently skip
 * (SEC-03 Finding A/round-2). One class, imported by any module that needs
 * to distinguish "the containment guard rejected this write" from an
 * unrelated internal error in a `catch` block that lives in a DIFFERENT
 * file than the `throw` (e.g. `orchestrator/project-brain-seed.ts` throwing,
 * `apps/forge/bridge-studio-writes.ts` catching) — mirroring the established
 * `orchestrator/ -> cli/` import direction this module already anchors
 * (SEC-01, `resolveKbBrainDir`). The message is for internal
 * diagnostics/logging only, same rule as `PathGuardReject.reason`: a call
 * site's `catch` block sends its OWN fixed, generic 4xx text to the client,
 * never this constructor argument verbatim.
 */
export class PathGuardContainmentError extends Error {}

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

/** C0 control characters (U+0000 NUL through U+001F). No legitimate path
 *  segment — a SLUG_RE-gated id, or a fixed literal ('SKILL.md', '.forge',
 *  'flow.yaml', 'project.json') — ever contains one. Left unrejected, a control
 *  char slips past `isSafeSegment`, and because a not-yet-existing (create-mode)
 *  leaf is reassembled literally WITHOUT any `lstat`, it reaches the caller's
 *  `writeFileSync`: a NUL segment throws a RAW, untyped OS `TypeError` (whose
 *  message even leaks an absolute filesystem path, violating this module's own
 *  no-path-in-diagnostics rule), and any other C0 control silently materialises
 *  a control-char-named file. Rejecting the whole 0x00-0x1f range here is
 *  strictly MORE restrictive, so it cannot false-reject any legitimate path
 *  (SEC-05 q80 GAP 2). */
const CONTROL_CHAR_RE = /[\u0000-\u001f]/;

/** A path segment is safe to `join()` literally only if it is a single,
 *  non-empty directory-entry NAME — no separators, no `.`/`..`, no control
 *  characters. Every caller's id/slug is already SLUG_RE-validated before it
 *  reaches here (defense in depth, not a replacement — see each call site's own
 *  guard); the fixed literal segments this module also receives ('SKILL.md',
 *  '.forge', 'flow.yaml', 'project.json') trivially satisfy this too. This is
 *  the belt for whichever suspenders a future caller forgets.
 *
 * LOAD-BEARING structural gate (forge-01u): `seg: string` is only a
 * compile-time claim. Every segment on the request path ultimately
 * originates from a parsed JSON request body (see `apps/forge/ui-bridge.ts`'s route
 * handlers), and nothing upstream enforces the TypeScript annotation at
 * runtime — a JSON array, plain object, number, boolean, `null`, or
 * `undefined` all type-check as `any`/`unknown` at the body-parsing boundary
 * and can be handed to this function despite the `string` signature; a
 * direct in-process caller can go further still and pass a `Symbol`. Without
 * the `typeof` check below, an array slips past every remaining line here —
 * `Array.prototype.includes` is element-wise so `!seg.includes('/')` is
 * `true`, a non-empty array's `.length > 0` is `true`, and `CONTROL_CHAR_RE`
 * coerces its argument to a string before testing — and only fails much
 * later, when the wrongly-accepted "safe" segment reaches `path.join()`,
 * which throws a raw `TypeError`; `null`/`undefined` throw immediately on
 * the `.length` read below. A structurally invalid value must produce this
 * function's own ordinary `false` — the guard's ordinary rejection, never an
 * uncaught exception — so every caller (HTTP route included) sees its normal
 * 400-shaped failure instead of a 500. `typeof` performs a genuine runtime
 * check here even though the compile-time `string` annotation immediately
 * narrows the "non-string" branch to `never`; that is expected, not a sign
 * the check is unreachable — the annotation is exactly the boundary claim
 * this check exists to verify at runtime. */
export function isSafeSegment(seg: string): boolean {
  if (typeof seg !== 'string') return false;
  return (
    seg.length > 0 &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.includes('/') &&
    !seg.includes('\\') &&
    !seg.includes(sep) &&
    !CONTROL_CHAR_RE.test(seg)
  );
}

/** DEL (0x7f) is not in the C0 range `CONTROL_CHAR_RE` covers, and is no more
 *  a legitimate filename character than the rest of them. */
const DEL_RE = /\u007f/;

/** Percent-encoded separators and traversal. These are NOT escapes on their
 *  own — a route that has already decoded once hands us a LITERAL `%2f`,
 *  which `join()` treats as an ordinary character and `realpath` resolves to
 *  a file that will not exist (the observed behaviour is a 404, not a
 *  disclosure). They are denied because a second decode ANYWHERE downstream
 *  — a client, a log replayer, a future caller that re-decodes defensively —
 *  turns them into the separator they spell. */
const ENCODED_TRAVERSAL_RE = /%(?:2f|5c|00|2e%2e)/i;

/**
 * Is `relPath` a safe `<a>/<b>/<leaf>` tail to append beneath a trusted root?
 *
 * A DENY-list, deliberately, and a shared one: it is `isSafeSegment` applied
 * per segment (the SAME predicate `resolveGuardedPath` walks with, so the
 * cheap 400 layer and the containment 404 layer cannot drift) plus DEL and
 * percent-encoded separators.
 *
 * W7-C3 review (A-M6) — the first cut of the artifact-filename gate was an
 * ALLOW-list, `/^[A-Za-z0-9._-]+$/` per segment plus `.includes('..')`. A
 * guard written as an allow-list of characters rots against real data: it
 * rejected 55 of 508 real on-disk artifact files across 7 cycles (10.8%) —
 * every `_logs/<cycleId>/artifacts/.capture/{before,after}` `.out` file,
 * demo-capture
 * evidence named from acceptance-criteria titles, where spaces, parentheses
 * and em-dashes are the NORM — while adding zero containment: every escape
 * shape (`%2E%2E%2F`, double-encoded, `..%2F`, `%00`, unicode, `CON`,
 * trailing `%20`) was already refused by `guardedReadFile`. `.includes('..')`
 * additionally false-rejected the legitimate names `..foo.txt` and `a..b.txt`
 * — the exact `..`-normalisation false positive the containment-review
 * catalogue names.
 *
 * So this DENIES the shapes that matter and says nothing about the rest:
 * spaces, parentheses, em-dashes, apostrophes and a leading/infix `..` all
 * pass; empty segments, `.`/`..` as a whole segment, separators, C0
 * controls, NUL, DEL and encoded separators do not.
 */
export function isSafeSubPath(relPath: string): boolean {
  if (typeof relPath !== 'string') return false;
  if (relPath.length === 0) return false;
  if (DEL_RE.test(relPath) || ENCODED_TRAVERSAL_RE.test(relPath)) return false;
  return relPath.split('/').every((seg) => isSafeSegment(seg));
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
  // Same runtime-boundary reasoning as the per-segment `typeof` gate below, for
  // the one non-string root that does NOT fail safe on its own: `realpathSync`
  // throws for a number, an object, `null`, `undefined` or a Symbol (the catch
  // below turns that into an ordinary rejection), but an EMPTY ARRAY
  // stringifies to `''`, which `realpathSync` resolves to the process working
  // directory — the guard would then contain its segments beneath a root
  // nobody chose and report `ok`. Not reachable from any current call site
  // (every one passes a fixed or config-derived root, which is this module's
  // CONTRACT), so this is the cheap way to make that contract's guarantee true
  // rather than approximately true.
  if (typeof root !== 'string') return { ok: false, reason: 'containment root is not a string' };
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
    // A non-string `seg` must NEVER be raw-interpolated into the rejection
    // message below — that is a second, independent way this boundary used
    // to throw even after `isSafeSegment` itself was hardened: a `Symbol`
    // is correctly rejected by `isSafeSegment` (no `.length`), but template
    // literals refuse to implicitly convert a Symbol to a string, so
    // `` `unsafe path segment "${seg}"` `` throws `TypeError:
    // Cannot convert a Symbol value to a string` right here. `reason` is
    // documented as internal-diagnostics-only (see `PathGuardReject` above)
    // and is never required to echo the offending value, so the non-string
    // case gets a fixed, value-free message instead of ever touching `seg`
    // in a template literal. `typeof` is checked explicitly here — not
    // inferred from `isSafeSegment`'s return — precisely so this file has no
    // OTHER path that could reach a `${seg}` interpolation with a
    // non-string value.
    if (typeof seg !== 'string') return { ok: false, reason: 'unsafe path segment (non-string value)' };
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

// ---------------------------------------------------------------------------
// SEC-04 — the FULL-PATH sink primitive (leaf included).
//
// The systemic SEC-04 defect: callers guard the DIRECTORY with
// `resolveGuardedPath(root, [...dirSegments])`, then RAW-APPEND the leaf
// filename with `join(guardedDir, 'status.json')` and read/write through THAT.
// A symlinked leaf (`status.json` -> outside root) inside a genuinely real,
// identity-verified directory sails straight through — the guard never saw the
// leaf. `guardedFile` closes the class by routing the ENTIRE opened path,
// LEAF INCLUDED, through one `resolveGuardedPath` call so the per-segment
// identity walk + `nlink === 1` leaf check apply to the filename itself.
//
// This adds NO new containment/fs-resolution logic: every symlink / hardlink /
// cross-object / nested-segment / root-escape decision stays inside
// `resolveGuardedPath`. `guardedFile` only maps that ONE call's
// `{ok, exists, realPath}` verdict onto a read/write/readdir intent, and the
// ergonomic wrappers below only perform the I/O once the path is blessed.
//
// CONTRACT (inherited verbatim from `resolveGuardedPath`, restated because
// SEC-04's root cause is a request-influenced value reaching the WRONG
// parameter): `root` is TRUSTED and MUST be a fixed, config-derived constant —
// `projectsRoot` / `logsRoot` / `forgeRoot`. A `project_repo_path` (or any
// value persisted from a request body, e.g. an architect `/start` payload) is
// REQUEST-INFLUENCED and MUST arrive as an element of `segments[]`, NEVER
// folded into `root`. Folded into `root`, `realpathSync(root)` resolves it with
// no identity check and containment becomes tautological — the root-folding
// escape shape. `guardedFile` cannot detect a violated root contract (a
// request-derived string is indistinguishable from a trusted one at this
// layer); the caller owns it. The contract test in the suite pins exactly this
// asymmetry: as a `segments[]` element a symlinked project id is REJECTED; as
// `root` it silently escapes.
// ---------------------------------------------------------------------------

/**
 * Resolve `<root>/<segments...>` (LEAF INCLUDED) through `resolveGuardedPath`
 * and return the blessed absolute path, or `null` if containment rejected it —
 * for the given filesystem intent:
 *
 *   - `'read'`    → `(ok && exists) ? realPath : null`. A missing leaf collapses
 *                   to `null` with NO distinct signal, so a caller cannot use
 *                   this to probe existence outside the root (no oracle): a
 *                   rejected path and an absent-but-contained path are
 *                   indistinguishable to the caller — both `null`.
 *   - `'write'`   → `ok ? realPath : null`. Create-mode is preserved: a
 *                   not-yet-existing leaf is a legitimate scaffold-on-save
 *                   target and returns its reassembled path.
 *   - `'readdir'` → `(ok && exists && isDirectory) ? realPath : null`. The leaf
 *                   must already exist AND be a real directory. Because
 *                   `resolveGuardedPath` already identity-verified every
 *                   segment including the leaf, an `lstatSync` here can never be
 *                   traversing a symlink — it is a genuine type check on the
 *                   real entry.
 *
 * Returns the PATH (not file contents) so a caller can do its own typed
 * read/write; the wrappers below are the ergonomic contents-level shortcuts.
 */
export function guardedFile(
  root: string,
  segments: readonly string[],
  mode: 'read' | 'write' | 'readdir',
): string | null {
  const guarded = resolveGuardedPath(root, segments);
  if (!guarded.ok) return null;

  switch (mode) {
    case 'read':
      // Missing leaf collapses to null — no existence oracle across the root.
      return guarded.exists ? guarded.realPath : null;
    case 'write':
      // Create-mode leaf is fine: resolveGuardedPath already proved every
      // EXISTING ancestor identity-clean and the not-yet-created tail literal.
      return guarded.realPath;
    case 'readdir': {
      if (!guarded.exists) return null;
      let st;
      try {
        // realPath is fully realpath-resolved + per-segment identity-checked by
        // resolveGuardedPath, so this lstat cannot be following a symlink — it
        // is a real directory-vs-not type check, no new containment logic.
        st = lstatSync(guarded.realPath);
      } catch {
        return null;
      }
      return st.isDirectory() ? guarded.realPath : null;
    }
  }
}

/**
 * Ergonomic read: guard `<root>/<segments...>` then return the file contents,
 * or `null` if rejected / absent. Same no-oracle collapse as `guardedFile`'s
 * read mode — a rejected path and an absent one both return `null`.
 */
export function guardedReadFile(
  root: string,
  segments: readonly string[],
  encoding: BufferEncoding = 'utf8',
): string | null {
  const p = guardedFile(root, segments, 'read');
  if (p === null) return null;
  try {
    return readFileSync(p, encoding);
  } catch {
    return null;
  }
}

/**
 * Ergonomic write: guard `<root>/<segments...>` (leaf included, create-mode
 * allowed), create the parent directory if needed, write `data`, and return the
 * written path — or `null` if containment rejected the path (the write never
 * happens). Mirrors the mkdir-then-write the raw session-status writers already
 * do; the ONLY new thing is that the leaf itself is now guarded.
 */
export function guardedWriteFile(
  root: string,
  segments: readonly string[],
  data: string,
): string | null {
  const p = guardedFile(root, segments, 'write');
  if (p === null) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

/**
 * Ergonomic readdir: guard `<root>/<segments...>`, require it be an existing
 * real directory, and return its entry names — or `null` if rejected / absent /
 * not-a-directory.
 */
export function guardedReadDir(root: string, segments: readonly string[]): string[] | null {
  const p = guardedFile(root, segments, 'readdir');
  if (p === null) return null;
  try {
    return readdirSync(p);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// guardedRename — the containment guard for MOVING an already-guarded path to
// a new location under the SAME trusted root. Added for the project-contract
// reset, which relocates directories inside a managed project's repo from a
// request-supplied project id (every path this function is handed traces back
// to that id).
// ---------------------------------------------------------------------------

/**
 * Rename `<root>/<fromSegments...>` to `<root>/<toSegments...>`, with BOTH
 * endpoints resolved INDEPENDENTLY through `resolveGuardedPath` — never the
 * defect this repo has closed five times, where a guard verifies one side
 * and then builds the other with a plain `join()`/`resolve()` off it (or off
 * `root`) instead of running it through its OWN per-segment identity walk.
 * Every `..`, symlink, cross-object-alias and nested-segment check
 * `resolveGuardedPath` performs for a read/write applies here, separately,
 * to `fromSegments` AND `toSegments`.
 *
 * CHECK-THEN-ACT (the same two-phase shape `seedProjectBrain` was fixed into
 * — `docs/reference/request-path-sinks.md`): both endpoints are resolved and
 * validated FIRST, with zero filesystem writes; `renameSync` runs only after
 * BOTH have passed every check below. On any rejection this throws
 * `PathGuardContainmentError` naming which endpoint failed and why (internal
 * diagnostics only — never forward verbatim to an untrusted client, same
 * rule as `PathGuardReject.reason`), and nothing is written, removed or
 * moved at either endpoint.
 *
 * Checks, in order:
 *   1. `resolveGuardedPath(root, fromSegments)` must succeed AND the source
 *      must already `exist` — renaming a path that is not there yet is not
 *      a legitimate call; unlike `guardedFile`'s `'write'` mode, there is no
 *      create-mode for a rename's SOURCE.
 *   2. `resolveGuardedPath(root, toSegments)` must succeed.
 *   3. The destination must NOT already exist. Unlike `guardedWriteFile`
 *      (which overwrites a leaf on every call — that is its whole
 *      contract), silently clobbering an existing directory on rename would
 *      destroy whatever was there with no record of what it was. This
 *      refuses rather than clobbers, mirroring the skip/refuse (never
 *      overwrite) stance `seedProjectBrain` already takes for its own
 *      files; a caller that needs to replace something removes the stale
 *      target itself, through its own guarded call, before renaming onto it.
 *
 * DESTINATION PARENT — NOT created here; the caller's responsibility. This
 * function requires the destination's immediate parent directory to already
 * exist, and lets the plain Node `ENOENT` `renameSync` raises when it does
 * not propagate uncaught — a containment PASS (both endpoints resolved and
 * validated cleanly) meeting an ordinary OS-level precondition failure, not
 * a containment rejection, so it is deliberately not wrapped as
 * `PathGuardContainmentError`. Every existing `renameSync` call site in this
 * codebase (`packages/projects/project-create.ts`,
 * `packages/knowledge/kb-drain-store.ts`, `packages/flows/queue.ts`, ...)
 * already assumes this: the destination's parent is either the trusted root
 * itself or a directory a prior step created, and none of them mkdir the
 * destination side at rename time. Building that here would add a second,
 * freshly-written piece of mkdir-under-containment logic for a case this
 * function's actual callers do not need; a future caller that DOES need a
 * fresh destination parent creates it through its own
 * `resolveGuardedPath`/`guardedFile` call first — so the created directory
 * is itself guarded — rather than this function creating one implicitly.
 *
 * CROSS-FILESYSTEM — Node's `renameSync` fails (`EXDEV`) across filesystem
 * boundaries. Both endpoints here resolve under the SAME `root` via
 * `realpathSync`, and this function exists specifically for moves INSIDE a
 * single managed project's repo tree, so there is no cross-filesystem case
 * in its intended use unless `root` itself spans a mount point (a bind
 * mount or separate volume grafted inside the tree) — a deployment concern
 * outside this module's contract, not something a path guard can detect. No
 * copy-then-delete fallback is added for `EXDEV`: that would be a SECOND,
 * unguarded write path (a copy loop has to walk and write every file under
 * the source with none of the atomic identity guarantee a straight rename
 * gets from the OS) — exactly the class of defect this module exists to
 * prevent, not something to reintroduce for convenience. An `EXDEV` failure
 * surfaces as `renameSync`'s own raw error, same as `ENOENT` above.
 */
export function guardedRename(root: string, fromSegments: readonly string[], toSegments: readonly string[]): void {
  const fromLabel = fromSegments.join('/');
  const toLabel = toSegments.join('/');

  const source = resolveGuardedPath(root, fromSegments);
  if (!source.ok) {
    throw new PathGuardContainmentError(`guardedRename: source containment check failed for "${fromLabel}": ${source.reason}`);
  }
  if (!source.exists) {
    throw new PathGuardContainmentError(`guardedRename: source "${fromLabel}" does not exist`);
  }

  const dest = resolveGuardedPath(root, toSegments);
  if (!dest.ok) {
    throw new PathGuardContainmentError(`guardedRename: destination containment check failed for "${toLabel}": ${dest.reason}`);
  }
  if (dest.exists) {
    throw new PathGuardContainmentError(`guardedRename: destination "${toLabel}" already exists — refusing to overwrite`);
  }

  // Both endpoints independently resolved and validated above with ZERO side
  // effects — only now that both checks have passed does the actual move
  // happen.
  renameSync(source.realPath, dest.realPath);
}
