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
 * A VERBATIM MIRROR of `cli/materials-staging.ts`'s `stageMaterials` — same
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
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveGuardedPath, guardedFile } from './studio-path-guard.ts';

export class SkillStagingError extends Error {}

type SkillEntry = { path: string; contentBase64: string };

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
): string {
  // Phase 1 — resolve + verify every path, AND refuse a duplicate resolved
  // target within this call. Zero side effects. `sourceId` and each entry
  // `path` arrive as their OWN segments (never folded into `stagingRoot`), so
  // the per-segment identity walk applies to both — a symlinked `sourceId`
  // escaping the staging root is refused here, not written through.
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
    if (seenTargets.has(result.realPath)) {
      throw new SkillStagingError(`skill: refused to stage "${entry.path}" — duplicate target within one call`);
    }
    seenTargets.add(result.realPath);
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
