/**
 * kb-drain-edit-soundness.ts (W8-B2, forge-d8l / knowledge-36) — the drain's
 * SEMANTIC audit of a structural edit.
 *
 * `cli/kb-drain-structural.ts` answers "is this edit SHAPED like a structural
 * change?" — a pure string comparison that never touches the filesystem. That
 * question turned out to be necessary and not sufficient. Two edits landed
 * unattended on the operator's real tree on 2026-08-22, both correctly
 * classified `structural`:
 *
 *   1. a `related_themes` entry was DELETED whose target theme exists in the
 *      same directory — `classifyKbEdit`'s `b.body === a.body` branch treats
 *      ANY frontmatter change as free, so a valid graph edge was destroyed
 *      with no diff, no draft and no undo;
 *   2. a dead markdown link was "repaired" by repointing it at a path that
 *      ALSO does not exist — `classifyKbEdit`'s link-target branch never asks
 *      whether the NEW target resolves — and the finding was reported cleared.
 *
 * This module adds the missing question: **is the edit SOUND?** — i.e. does it
 * destroy resolvable graph structure, or claim a repair that does not resolve.
 * The drain refuses (reverts) every unsound change, and where exactly one real
 * target exists it synthesizes the REPAIR rather than accepting the deletion or
 * the dead-for-dead swap.
 *
 * Three deliberate boundaries:
 *
 *   - **Only `structural` changes are audited.** A `prose` change (which
 *     includes every file creation and deletion) is already refused one layer
 *     up; auditing it too would double-count one edit as two findings.
 *   - **The slug universe is the SAME derivation `checkDanglingEdges` lints
 *     against** — `collectThemeSlugTargets` (cli/brain-lint.ts), brain-wide, one
 *     walk. Two derivations of "does this theme exist" disagreeing is the
 *     original forge-d8l failure shape and must not be reintroduced here.
 *   - **A repair is synthesized only where refusal ALONE would leave a
 *     genuinely dead link, and only when the target is unique.** Reverting an
 *     edge deletion already restores the edge, so nothing is synthesized there;
 *     two candidate targets means the drain would be guessing, so it refuses
 *     instead.
 */

import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { splitFrontmatter, type KbEditChange } from './kb-drain-structural.ts';
import { collectThemeSlugTargets, extractLinks } from './brain-lint.ts';
import { parseThemeRaw } from './theme-frontmatter.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';

/**
 * What makes a structurally-shaped edit unsound.
 *   - `edge-deleted`            — a `related_themes` entry was removed whose
 *                                 target theme really exists.
 *   - `link-deleted`            — a markdown link was removed whose target
 *                                 really exists (reachable on INDEX pages,
 *                                 which `classifyKbEdit` waves through
 *                                 unconditionally; a body link deletion is
 *                                 already `prose`).
 *   - `link-repoint-unresolved` — a link/wikilink target was introduced that
 *                                 resolves to nothing.
 */
export type KbEditUnsoundnessKind = 'edge-deleted' | 'link-deleted' | 'link-repoint-unresolved';

export type KbEditUnsoundness = {
  kind: KbEditUnsoundnessKind;
  /** Path of the edited file, relative to the KB's brain dir. */
  relPath: string;
  /** The slug or link target the edit destroyed or introduced. */
  target: string;
  /** Absolute path(s) at which a real theme for `target` exists — the repair.
   *  Empty when nothing resolves (then refusal is the whole remedy). */
  repairTargets: readonly string[];
  /** Operator-facing one-liner. Rendered verbatim on the finding row. */
  message: string;
};

export type KbEditSoundnessCtx = {
  /** Containment root for link resolution. A brain theme legitimately links
   *  anywhere inside the repo (`../../../docs/decisions/...`, `_logs/...`), so
   *  `brain/` is too narrow a root — but nothing it names is ever OUTSIDE the
   *  repo, and a link target is agent-written text. */
  forgeRoot: string;
  /** Absolute dir every `KbEditChange.relPath` is relative to. */
  brainDir: string;
  /** slug -> every absolute theme file carrying that basename, brain-wide. */
  themeTargets: ReadonlyMap<string, readonly string[]>;
};

/** Build the audit context for one KB. `themeTargets` is captured ONCE per
 *  turn: the audit compares an edit against the brain as it stood, and a
 *  per-target re-walk would be O(files) per link. */
export function buildKbEditSoundnessCtx(forgeRoot: string, brainDir: string): KbEditSoundnessCtx {
  return { forgeRoot, brainDir, themeTargets: collectThemeSlugTargets(join(forgeRoot, 'brain')) };
}

export function isUnsound(found: readonly KbEditUnsoundness[]): boolean {
  return found.length > 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** `related_themes` as a list of bare slugs, normalized the same way
 *  `danglingEdgeFindings` normalizes them (trim, drop a trailing `.md`). */
function relatedSlugs(raw: string): string[] {
  const related = parseThemeRaw(raw).data.related_themes;
  if (!Array.isArray(related)) return [];
  return related
    .map((entry) => String(entry).trim().replace(/\.md$/, '').trim())
    .filter((slug) => slug !== '');
}

/** Entries present more often in `before` than in `after`, one per excess
 *  occurrence, in `before` order. */
function multisetRemoved(before: readonly string[], after: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const v of after) remaining.set(v, (remaining.get(v) ?? 0) + 1);
  const out: string[] = [];
  for (const v of before) {
    const n = remaining.get(v) ?? 0;
    if (n > 0) remaining.set(v, n - 1);
    else out.push(v);
  }
  return out;
}

/** The theme slug a link target names — its basename without `.md`. */
function targetSlug(target: string): string {
  return basename(target.replace(/\.md$/, ''));
}

function repairsFor(ctx: KbEditSoundnessCtx, slug: string): readonly string[] {
  return ctx.themeTargets.get(slug) ?? [];
}

/**
 * Does a relative link target resolve to a real file, from the edited file's
 * own directory? This is the check the drain never made — and the target is
 * text an AGENT wrote, so the probe is contained rather than trusted.
 *
 * `resolve()` normalises the `..` segments a legitimate cross-directory theme
 * link is full of, so what reaches the guard is a clean segment list; a target
 * that climbed out of `forgeRoot` yields a leading `..` segment that
 * `isSafeSegment` rejects, and `resolveGuardedPath` additionally realpath-walks
 * the prefix, so a symlinked ancestor cannot smuggle the probe outside either.
 * A rejection is reported as "does not resolve", which makes the gate MORE
 * restrictive (the edit is refused) — the safe direction to fail.
 */
function linkResolves(ctx: KbEditSoundnessCtx, absFile: string, target: string): boolean {
  const abs = resolve(dirname(absFile), target);
  const rel = relative(ctx.forgeRoot, abs);
  if (rel === '') return false; // the repo root itself is not a link target
  const guarded = resolveGuardedPath(ctx.forgeRoot, rel.split(sep));
  return guarded.ok && guarded.exists;
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

/**
 * Audit ONE change. Returns every reason the edit is unsound; an empty array
 * means it may land.
 *
 * Only `structural` changes are audited — see the module header for why.
 */
export function auditKbEdit(change: KbEditChange, ctx: KbEditSoundnessCtx): KbEditUnsoundness[] {
  if (change.klass !== 'structural') return [];
  const { before, after, relPath } = change;
  if (before === null || after === null) return [];

  const absFile = join(ctx.brainDir, relPath);
  const found: KbEditUnsoundness[] = [];

  // ---- 1. related_themes entries removed whose target really exists -------
  for (const slug of multisetRemoved(relatedSlugs(before), relatedSlugs(after))) {
    const repairTargets = repairsFor(ctx, slug);
    if (repairTargets.length === 0) continue; // a genuinely dangling entry may go
    found.push({
      kind: 'edge-deleted',
      relPath,
      target: slug,
      repairTargets,
      message: `refused: deletes the related_themes edge "${slug}", whose theme exists at ${repairTargets.map((p) => basename(p)).join(', ')} — a valid edge is never dropped to clear lint`,
    });
  }

  const beforeBody = splitFrontmatter(before).body;
  const afterBody = splitFrontmatter(after).body;
  const beforeLinks = extractLinks(beforeBody);
  const afterLinks = extractLinks(afterBody);

  // ---- 2. link targets INTRODUCED that resolve to nothing -----------------
  for (const target of multisetRemoved(afterLinks.relLinks, beforeLinks.relLinks)) {
    if (linkResolves(ctx, absFile, target)) continue;
    const repairTargets = repairsFor(ctx, targetSlug(target));
    found.push({
      kind: 'link-repoint-unresolved',
      relPath,
      target,
      repairTargets,
      message: repairTargets.length > 0
        ? `refused: repoints a link at "${target}", which does not exist — the real target is ${repairTargets.map((p) => basename(p)).join(', ')}`
        : `refused: repoints a link at "${target}", which does not exist — a dead link may not be exchanged for another dead link`,
    });
  }
  for (const slug of multisetRemoved(afterLinks.wikilinks, beforeLinks.wikilinks)) {
    if (repairsFor(ctx, slug).length > 0) continue;
    found.push({
      kind: 'link-repoint-unresolved',
      relPath,
      target: slug,
      repairTargets: [],
      message: `refused: repoints a wikilink at "[[${slug}]]", which resolves to no theme anywhere under brain/**/themes/`,
    });
  }

  // ---- 3. links genuinely REMOVED whose target really exists --------------
  // Only as many deletions as the link count actually dropped by: a repoint is
  // a remove+add pair and must never be reported as a deletion.
  const netDeleted = Math.max(0, beforeLinks.relLinks.length - afterLinks.relLinks.length);
  if (netDeleted > 0) {
    let budget = netDeleted;
    for (const target of multisetRemoved(beforeLinks.relLinks, afterLinks.relLinks)) {
      if (budget === 0) break;
      const onDisk = linkResolves(ctx, absFile, target);
      const repairTargets = onDisk ? [resolve(dirname(absFile), target)] : repairsFor(ctx, targetSlug(target));
      if (repairTargets.length === 0) continue; // a genuinely dead link may go
      budget -= 1;
      found.push({
        kind: 'link-deleted',
        relPath,
        target,
        repairTargets,
        message: onDisk
          ? `refused: deletes the link "${target}", whose target exists — repair a link, never drop it`
          : `refused: deletes the link "${target}"; the theme it names exists at ${repairTargets.map((p) => basename(p)).join(', ')} — repair is preferred over deletion`,
      });
    }
  }

  return found;
}

/** Audit a whole turn's worth of changes. */
export function auditKbEdits(
  changes: readonly KbEditChange[],
  ctx: KbEditSoundnessCtx,
): KbEditUnsoundness[] {
  return changes.flatMap((c) => auditKbEdit(c, ctx));
}

/**
 * The REPAIRED content for an unsound change, or `null` when refusal alone is
 * the whole remedy.
 *
 * Synthesized only for `link-repoint-unresolved` with exactly ONE resolvable
 * target: the dead target is rewritten to the real file's path, relative to the
 * edited file's own directory. Everything else returns `null` — an
 * `edge-deleted` is remedied by the revert itself (which restores the edge),
 * and two candidate targets means guessing.
 *
 * The caller MUST re-audit the result before writing it (the drain does): a
 * fix that re-ships its own defect is this campaign's dominant failure mode.
 */
export function repairKbEdit(
  change: KbEditChange,
  found: readonly KbEditUnsoundness[],
  ctx: KbEditSoundnessCtx,
): string | null {
  if (change.after === null) return null;
  const repointable = found.filter(
    (u) => u.kind === 'link-repoint-unresolved' && u.repairTargets.length === 1,
  );
  if (repointable.length === 0) return null;
  // Every unsoundness must be addressed by the synthesis, or the result is a
  // partial repair that still lands something refused.
  if (repointable.length !== found.length) return null;

  const absFile = join(ctx.brainDir, change.relPath);
  let repaired = change.after;
  for (const u of repointable) {
    const rel = relative(dirname(absFile), u.repairTargets[0]).split(/[\\/]/).join('/');
    repaired = repaired.split(`](${u.target})`).join(`](${rel})`);
  }
  return repaired === change.after ? null : repaired;
}
