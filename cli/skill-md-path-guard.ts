/**
 * Shared realpath-based containment guard for a `skills/<slug>/SKILL.md`
 * path (2026-08-05 adversarial-review round 2, finding C/6 — the FIFTH
 * traversal-family instance in this campaign). Both the PUT write route
 * (cli/bridge-studio-writes.ts) and the instructions-draft route
 * (cli/bridge-studio-instructions.ts) route their SKILL.md path resolution
 * through this ONE choke point instead of each re-implementing the same
 * realpath dance — the prior state (each route growing its own lexical or
 * partial check) is exactly how the escape reappeared a fifth time.
 *
 * A LEXICAL `startsWith(skillsDir + sep)` check on the unresolved,
 * `join()`-constructed path is NEVER sufficient: `join()`/`resolve()`
 * normalize `..` before the comparison even runs, and — the shape that
 * actually defeated the PUT route live — a symlink's own on-disk LOCATION is
 * lexically inside `skills/` even when it POINTS somewhere else entirely.
 * Only a `realpathSync` comparison catches that. Two escape shapes are
 * covered here:
 *   - a symlinked `SKILL.md` FILE inside a genuinely real `skills/<slug>/`
 *     directory (a fix that only re-canonicalises the DIRECTORY misses this)
 *   - a symlinked `skills/<slug>` DIRECTORY itself
 *
 * The slug-shape regex (`SLUG_RE`, orchestrator/studio/validate.ts) is kept
 * as the FIRST, independent layer by both callers — this function does not
 * re-derive slug safety, only path containment, so both layers must run
 * (defense in depth, not a replacement).
 *
 * Create is preserved: `skills/<slug>/SKILL.md` legitimately does not exist
 * yet for a brand-new agent (the PUT route's scaffold-on-save flow). Rather
 * than requiring the leaf to exist, this walks up to the DEEPEST EXISTING
 * ancestor (lstat-based existence — see `lexists` below), realpaths only
 * THAT (only an existing filesystem entry can carry a symlink), verifies
 * containment, then reassembles the not-yet-created tail literally (a
 * non-existent path component cannot itself be a symlink). A dangling
 * symlink found at the deepest "existing" ancestor (an entry that lexically
 * exists per `lstatSync` but whose target does not resolve, so
 * `realpathSync` throws) is treated as unsafe and rejected outright — a
 * genuine "not created yet" path has NO entry at all at that location,
 * dangling or otherwise, so a stray dangling link there is itself
 * suspicious, never a creation opportunity to build on top of.
 *
 * Residual TOCTOU (disclosed, not silently accepted — an earlier initiative
 * in this campaign disclosed the identical residual and it was accepted as
 * the standing bar): between this function's `realpathSync` calls and the
 * caller's later `readFileSync`/`writeFileSync`, the filesystem could in
 * theory change (e.g. a symlink swapped in after this check but before the
 * write completes). This is the standard check-then-use TOCTOU window
 * inherent to any non-atomic filesystem API and is NOT closed here — an
 * atomic `O_NOFOLLOW`-based open would be needed to fully close it, which
 * Node's `fs` module does not expose ergonomically for this call shape
 * (open-for-write-if-real-path-still-contained, in one syscall).
 */

import { basename, dirname, resolve, sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

import { skillsDir as toSkillsDir, skillPath } from '../orchestrator/skill-path.ts';

export interface SkillMdPathGuardResult {
  /** false ⇒ reject (escape, missing `skills/` root, or an unsafe/dangling
   *  ancestor entry); `realPath`/`exists` are unset in that case. */
  ok: boolean;
  /** The fully realpath-resolved `SKILL.md` path, safe to read/write. Only
   *  set when `ok` is true. */
  realPath?: string;
  /** True iff `SKILL.md` already exists on disk at this path (an edit of an
   *  existing agent); false iff it — and possibly its containing directory —
   *  does not exist yet (a legitimate new-agent create). Only set when `ok`
   *  is true. */
  exists?: boolean;
}

/** Existence test that does NOT follow the final path component — a
 *  dangling symlink (whose target is gone) still "exists" here, so it is
 *  routed into the realpath check below rather than mistaken for an empty
 *  creation slot. */
function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve and verify `<forgeRoot>/skills/<slug>/SKILL.md` is genuinely
 * contained within the real, symlink-resolved `skills/` root.
 *
 * Caller MUST have already validated `slug` against `SLUG_RE` (defense in
 * depth — this function only re-verifies path containment, not slug shape).
 */
export function resolveGuardedSkillMdPath(forgeRoot: string, slug: string): SkillMdPathGuardResult {
  const skillsRoot = toSkillsDir(forgeRoot);
  let realSkillsRoot: string;
  try {
    realSkillsRoot = realpathSync(skillsRoot);
  } catch {
    return { ok: false }; // no skills/ directory at all
  }

  let candidate: string;
  try {
    candidate = skillPath(slug, forgeRoot);
  } catch {
    return { ok: false }; // defensive — SLUG_RE should already have rejected this
  }

  // Walk up from the candidate SKILL.md path to the deepest ancestor that
  // actually exists (lstat-based, so a dangling symlink counts as "exists"
  // and gets realpath-checked below rather than treated as free-to-create).
  const tail: string[] = [];
  let probe = candidate;
  while (!lexists(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return { ok: false }; // walked to the fs root — unreachable in practice, fail closed
    tail.unshift(basename(probe));
    probe = parent;
  }

  let realAncestor: string;
  try {
    realAncestor = realpathSync(probe);
  } catch {
    // The deepest "existing" entry is a dangling symlink (or otherwise
    // unresolvable) — refuse rather than guess at safety.
    return { ok: false };
  }

  if (realAncestor !== realSkillsRoot && !realAncestor.startsWith(realSkillsRoot + sep)) {
    return { ok: false }; // escapes skills/ — a symlinked dir or file
  }

  const realPath = tail.length > 0 ? resolve(realAncestor, ...tail) : realAncestor;

  // Defensive re-check on the fully-assembled path (tail segments are
  // literal, post-SLUG_RE directory-entry names, so this should never
  // diverge from the ancestor check above — belt and suspenders).
  if (realPath !== realSkillsRoot && !realPath.startsWith(realSkillsRoot + sep)) {
    return { ok: false };
  }

  return { ok: true, realPath, exists: tail.length === 0 };
}
