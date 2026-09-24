/**
 * `stageSkillPackage` — the write-path for the RULED inline-upload folded
 * staging step behind `POST /api/studio/skills/install` (SEC-05 q80, d1). This
 * is the ONLY place in that path that touches the filesystem: the route mints
 * an unpredictable server-derived `sourceId`, validates every entry's shape,
 * then calls this function to stage each inline-uploaded
 * `{ path, contentBase64 }` under `<stagingRoot>/<sourceId>/` through the
 * shared realpath containment guard, hands the returned staged-dir realpath to
 * `installSkillPackage` to copy, and rm's `<stagingRoot>/<sourceId>` in a
 * `finally`.
 *
 * A VERBATIM MIRROR of `packages/agents/materials-staging.ts`'s `stageMaterials` — same
 * two-phase check-then-write shape, same shared guard, same throw-not-return
 * convention, same zero-partial-write guarantee — differing only where the
 * skill-install contract differs: the untrusted leaf is an entry `path` (a
 * relative, possibly-nested package path) carrying base64 `contentBase64`
 * rather than a flat `filename` + `bytes`, the containment prefix is
 * `<stagingRoot>/<sourceId>` rather than `<runDir>/materials`, and the function
 * returns the staged `<stagingRoot>/<sourceId>` realpath (the copy source
 * `installSkillPackage` needs) rather than `void`.
 *
 * PRECONDITION — load-bearing, mirrors `resolveGuardedPath`'s own CONTRACT in
 * `cli/studio-path-guard.ts` (read that module's docstring in full before
 * touching this one): `stagingRoot` MUST be trusted / server-derived — a
 * fixed, config-derived staging directory — NEVER a caller-supplied value.
 * `sourceId` is server-minted (the route derives an unpredictable id it fully
 * controls) and each entry's `path` is untrusted; BOTH reach the guard as
 * their OWN path segments (`resolveGuardedPath(stagingRoot, [sourceId,
 * ...entry.path.split('/')])`), never folded into `stagingRoot` first. Folding
 * any value into `root` makes the guard's realpath comparison tautological —
 * `realRoot` is already the escaped path, so the identity check can never fail
 * — the root-folding escape shape live in this codebase's own catalogue (see
 * the `adversarial-containment-review` skill). Because `sourceId` arrives as
 * its own segment, a `sourceId` that is itself a PRE-PLANTED SYMLINK escaping
 * `stagingRoot` is caught by the guard's per-segment identity check and
 * refused here, before any write.
 *
 * SECOND PRECONDITION (forge-gp4): `stagingRoot` itself MUST already exist —
 * this function never creates it (mirrors `stageMaterials`'s own contract for
 * `runDir`, rather than a defensive `mkdirSync` here; the real caller,
 * `bridge-studio-skills.ts`, already creates it before every call). A
 * not-yet-created root is refused with `SkillStagingError`, never tolerated —
 * see the PRECONDITION test in `skill-staging-case.test.ts`.
 */

import { mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveGuardedPath, guardedFile } from '@forge/kernel';

export class SkillStagingError extends Error {}

type SkillEntry = { path: string; contentBase64: string };

/** Injectable seam for volume case-behaviour detection (forge-gp4, mirroring
 *  `materials-staging.ts`'s `CaseFoldingProbe`/bead forge-qn8) — drives the
 *  folding code path deterministically in tests on a case-sensitive dev
 *  machine. `dir` is always `stagingRoot` (real at call time). */
export type CaseFoldingProbe = (dir: string) => boolean;

/** Marker-name prefix for `detectVolumeCaseFolding`'s throwaway probe entry
 *  — namespaced and unlikely to collide with a real staged package entry. */
const CASE_PROBE_PREFIX = '.forge-case-probe-';

/** Flips the case of every ASCII letter in `s` — the exact shape of the real
 *  bug (`SKILL.md` vs `skill.md`), never any other change. */
function flipAsciiCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
}

/**
 * The REAL, default `CaseFoldingProbe` — a verbatim mirror of
 * `materials-staging.ts`'s `detectVolumeCaseFolding` (see that function's own
 * docstring for the full method/rationale): create a throwaway marker under
 * `dir`, stat it, stat its case-flipped spelling, and compare `{dev, ino}`.
 * `ENOENT` on the flipped spelling → case-sensitive (`false`); any other stat
 * failure is indeterminate and defaults CONSERVATIVELY to `true` (folding),
 * never silently to `false`. If the marker itself cannot be created, this
 * throws `SkillStagingError` rather than silently falling back to a literal
 * comparison — a duplicate-target check that might silently be wrong is
 * worse than one that refuses to run.
 */
export function detectVolumeCaseFolding(dir: string): boolean {
  const marker = `${CASE_PROBE_PREFIX}${randomBytes(8).toString('hex')}-AbCdEf`;
  const markerPath = join(dir, marker);
  const flippedPath = join(dir, flipAsciiCase(marker));

  let markerStat: ReturnType<typeof statSync>;
  try {
    writeFileSync(markerPath, '');
    markerStat = statSync(markerPath);
  } catch (err) {
    throw new SkillStagingError(
      `skill: case-folding probe could not run — refusing to stage without a reliable duplicate-target check: ${(err as Error).message}`,
    );
  }

  try {
    const flippedStat = statSync(flippedPath);
    return flippedStat.dev === markerStat.dev && flippedStat.ino === markerStat.ino;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return false;
    return true; // indeterminate read-back — conservative default, see docstring
  } finally {
    try {
      unlinkSync(markerPath);
    } catch {
      /* best-effort cleanup only — the folding decision above is already made */
    }
  }
}

/**
 * Stage one skill-install request's package entries under
 * `<stagingRoot>/<sourceId>/`, returning that staged directory's realpath.
 *
 * Two-phase, check-then-write, with ZERO partial writes on refusal:
 *   Phase 1 resolves and containment-checks EVERY entry's target path through
 *   `resolveGuardedPath` (the shared, generalized realpath-based guard —
 *   symlinked directory, symlinked leaf, hardlinked leaf, cross-object
 *   same-root alias, and nested-segment symlink are all caught there; see that
 *   module's docstring for the full escape-shape catalogue) — with NO
 *   filesystem writes at all. Each untrusted entry `path` is exploded into its
 *   OWN segments (`entry.path.split('/')`) so a nested package path
 *   (`scripts/collect.sh`) is walked segment-by-segment and a traversal path
 *   (`../evil`, `/etc/x`, `a/../../../../tmp/OUT/x`) is rejected on its unsafe
 *   segment. Phase 1 ALSO refuses a DUPLICATE resolved target within the same
 *   call — see the paragraph below; this is not a containment check, but the
 *   same phase catches it for the same reason (still zero side effects). Only
 *   once every single entry has passed BOTH checks does Phase 2 run, writing
 *   each file. If entry N (of any N, including the very last) fails either
 *   check, entries 1..N-1 are NEVER written — moving a write earlier would only
 *   change which artifact gets orphaned on a later refusal, not eliminate the
 *   problem.
 *
 * DUPLICATE-TARGET refusal (mirrors `stageMaterials`) — this function does NOT
 * trust its caller to have deduped. Without this check, two entries sharing one
 * resolved target would each pass Phase 1 independently (it is side-effect-free,
 * so neither sees the other), and Phase 2 would then write both, the SECOND
 * silently clobbering the first — a full, undocumented overwrite, not a partial
 * write, and therefore NOT covered by the "zero partial writes" guarantee above
 * without this explicit check. The comparison is on each entry's RESOLVED
 * `realPath` (from `resolveGuardedPath`), not the raw input `path` string, so a
 * path that resolves onto an ALREADY-EXISTING sibling target is caught. The
 * check is scoped to entries WITHIN one call only — the route rm's the staged
 * directory between calls, so cross-call reuse of a `sourceId` is not this
 * module's concern.
 *
 * VOLUME CASE-BEHAVIOUR DETECTION (forge-gp4, mirroring bead forge-qn8's fix
 * in `stageMaterials`) — in CREATE mode, `resolveGuardedPath` reassembles a
 * non-existent leaf's tail LITERALLY, so two entry `path`s the filesystem
 * folds to one directory entry (`SKILL.md` vs `skill.md` on a case-insensitive
 * volume) would pass the literal check as distinct and collide at
 * `writeFileSync`. The fix DETECTS the volume's case behaviour
 * (`detectVolumeCaseFolding` above, never a `process.platform` guess), probed
 * ONCE per call against `stagingRoot`, and folds the dedup key with
 * `.toLowerCase()` ONLY when the probe reports folding — a case-sensitive
 * volume still accepts both as distinct targets. The WHOLE resolved path is
 * folded, not just the leaf: a directory segment differing only in case
 * collides on disk the same way a leaf does.
 *
 * Throws `SkillStagingError` on any refusal (mirrors the established
 * throw-not-return convention of `stageMaterials` and this route's sibling
 * resolvers — no separate result/error channel). The thrown message names no
 * absolute filesystem path (mirrors `PathGuardReject.reason`'s rule: the
 * guard's internal diagnostic is never forwarded).
 */
export function stageSkillPackage(
  stagingRoot: string,
  sourceId: string,
  entries: ReadonlyArray<SkillEntry>,
  options: { probeCaseFolding?: CaseFoldingProbe } = {},
): string {
  // Probed ONCE per call (not per entry — the same volume backs every entry
  // staged in one call) against `stagingRoot` itself.
  const probeCaseFolding = options.probeCaseFolding ?? detectVolumeCaseFolding;
  const volumeFoldsCase = probeCaseFolding(stagingRoot);

  // Phase 1 — resolve + verify every path, AND refuse a duplicate resolved
  // target within this call. Zero side effects (the case-folding probe above
  // is a throwaway, self-cleaning marker — see its own docstring — not a
  // package write). `sourceId` and each entry `path` arrive as their OWN
  // segments (never folded into `stagingRoot`), so the per-segment identity
  // walk applies to both — a symlinked `sourceId` escaping the staging root
  // is refused here, not written through.
  const resolved: Array<{ realPath: string; bytes: Buffer }> = [];
  const seenTargets = new Set<string>();
  for (const entry of entries) {
    const result = resolveGuardedPath(stagingRoot, [sourceId, ...entry.path.split('/')]);
    if (!result.ok) {
      // `result.reason` is an internal diagnostic only (per
      // studio-path-guard.ts's own PathGuardReject contract) and is never
      // forwarded — this message names neither it nor any filesystem path.
      throw new SkillStagingError(`skill: refused to stage "${entry.path}" — containment check failed`);
    }
    // Keyed by the case-FOLDED realPath only when the probe says this volume
    // folds case; otherwise keyed literally, exactly as before this fix — so
    // a case-sensitive volume never sees a false "duplicate".
    const dedupeKey = volumeFoldsCase ? result.realPath.toLowerCase() : result.realPath;
    if (seenTargets.has(dedupeKey)) {
      throw new SkillStagingError(`skill: refused to stage "${entry.path}" — duplicate target within one call`);
    }
    seenTargets.add(dedupeKey);
    resolved.push({ realPath: result.realPath, bytes: Buffer.from(entry.contentBase64, 'base64') });
  }

  // Phase 2 — write. Every path was already identity-verified AND
  // uniqueness-checked above; each entry's parent directory (including
  // `<stagingRoot>/<sourceId>/` and any nested package subdirectory) is created
  // here (mkdirSync recursive) on first write into it.
  for (const item of resolved) {
    mkdirSync(dirname(item.realPath), { recursive: true });
    writeFileSync(item.realPath, item.bytes);
  }

  // Return the staged `<stagingRoot>/<sourceId>` directory realpath — the copy
  // source `installSkillPackage` reads from. Routed back through the same guard
  // (readdir intent: the leaf must now exist AND be a real directory), so the
  // returned path is the fully realpath-resolved, per-segment identity-checked
  // location, never a raw `join`.
  const stagedDir = guardedFile(stagingRoot, [sourceId], 'readdir');
  if (stagedDir === null) {
    throw new SkillStagingError(`skill: staged directory for "${sourceId}" is not resolvable after staging`);
  }
  return stagedDir;
}
