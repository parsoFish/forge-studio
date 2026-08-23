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

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { splitFrontmatter, diffKbSnapshot, type KbEditChange } from './kb-drain-structural.ts';
import { collectThemeSlugTargets, extractLinks } from './brain-lint.ts';
import { parseThemeRaw } from './theme-frontmatter.ts';
import { resolveGuardedPath, guardedWriteFile } from './studio-path-guard.ts';

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

function normalizeSlug(entry: string): string {
  return entry.trim().replace(/^['"]|['"]$/g, '').trim().replace(/\.md$/, '').trim();
}

/**
 * `related_themes` as a list of bare slugs, normalized the same way
 * `danglingEdgeFindings` normalizes them (trim, drop a trailing `.md`).
 *
 * The `Array.isArray` tolerance clause is NOT enough on its own (adversarial
 * round 1). `parseThemeRaw`'s lenient fallback fires whenever gray-matter
 * rejects the YAML — an unquoted `:` in a description, which
 * `cli/theme-frontmatter.ts`'s own header calls "a real, common theme shape",
 * and which one live theme has today — and that fallback is line-based, so a
 * BLOCK-style list decodes to `''`, not an array. The audit then saw zero
 * edges and an edge deletion on such a theme landed ungated: this lane's own
 * defect, re-shipped one layer over.
 *
 * So a non-array result falls back to scanning the frontmatter TEXT for both
 * list shapes. It fails toward SEEING edges, never toward missing them.
 */
function relatedSlugs(raw: string): string[] {
  const related = parseThemeRaw(raw).data.related_themes;
  if (Array.isArray(related)) return related.map((e) => normalizeSlug(String(e))).filter((s) => s !== '');
  return scanRelatedThemesBlock(splitFrontmatter(raw).fm);
}

/** Both YAML list shapes, read off the raw frontmatter text:
 *    related_themes: [a, b]        (inline flow list)
 *    related_themes:
 *      - a
 *      - b                          (block list)
 *  Used only when the structured parse could not produce an array. */
export function scanRelatedThemesBlock(fm: string): string[] {
  const lines = fm.split('\n');
  const at = lines.findIndex((l) => /^related_themes\s*:/.test(l));
  if (at === -1) return [];
  const inline = lines[at].replace(/^related_themes\s*:/, '').trim();
  if (inline.startsWith('[')) {
    const close = inline.indexOf(']');
    const body = (close === -1 ? inline.slice(1) : inline.slice(1, close)).trim();
    return body === '' ? [] : body.split(',').map(normalizeSlug).filter((s) => s !== '');
  }
  if (inline !== '') return [normalizeSlug(inline)].filter((s) => s !== '');
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^\s+-\s*(.+)$/);
    if (!m) break; // the block ends at the first non-item line
    const slug = normalizeSlug(m[1]);
    if (slug !== '') out.push(slug);
  }
  return out;
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
  return auditProposedEdit(change, ctx);
}

/**
 * The same audit, WITHOUT the structural-class filter.
 *
 * For an edit that is being PARKED rather than disposed of — a prose rewrite
 * heading for a kb-cleanup draft. Approving that draft writes `after` back
 * byte-for-byte, so a prose rewrite that ALSO deletes a resolvable edge is a
 * one-click button for exactly the destruction `auditKbEdit` refuses when the
 * same edit happens to be structural (adversarial round 1). The draft plan
 * carries these reasons so the operator approves with them in front of them;
 * the edit is still theirs to accept, because prose IS what they are being
 * asked to judge.
 */
export function auditProposedEdit(change: KbEditChange, ctx: KbEditSoundnessCtx): KbEditUnsoundness[] {
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

  // ---- 2/3. link and wikilink changes, paired BY SLUG ---------------------
  //
  // Pairing by slug is load-bearing (adversarial round 1). Two earlier shapes
  // were both wrong:
  //   - a `netDeleted` budget: an index page could drop EVERY real theme link
  //     and add the same number of self-links, and the deletion check never
  //     ran at all;
  //   - checking only INTRODUCED targets: a link silently repointed from one
  //     real theme to a DIFFERENT real theme landed clean, while the identical
  //     destruction in `related_themes` was refused — the same edit judged two
  //     ways depending on which half of the file it lived in.
  //
  // A slug whose occurrence count DROPS lost an edge, whatever else changed. A
  // slug whose count holds was repointed, and the only question is whether the
  // new target resolves — which is what makes a genuine dead->real repair pass
  // while the 2026-08-22 dead->dead swap does not.
  found.push(...auditTargets(ctx, absFile, beforeLinks.relLinks, afterLinks.relLinks, relPath, 'link'));
  found.push(...auditTargets(ctx, absFile, beforeLinks.wikilinks, afterLinks.wikilinks, relPath, 'wikilink'));

  return found;
}

function countBySlug(targets: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of targets) {
    const slug = targetSlug(t);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}

/** One pass over one link CLASS (markdown targets, or wikilink slugs). */
function auditTargets(
  ctx: KbEditSoundnessCtx,
  absFile: string,
  before: readonly string[],
  after: readonly string[],
  relPath: string,
  klass: 'link' | 'wikilink',
): KbEditUnsoundness[] {
  const found: KbEditUnsoundness[] = [];
  const beforeBySlug = countBySlug(before);
  const afterBySlug = countBySlug(after);
  const resolves = (t: string): boolean =>
    klass === 'wikilink' ? repairsFor(ctx, t).length > 0 : linkResolves(ctx, absFile, t);

  // (a) targets INTRODUCED that resolve to nothing.
  for (const target of multisetRemoved(after, before)) {
    if (resolves(target)) continue;
    const repairTargets = repairsFor(ctx, targetSlug(target));
    found.push({
      kind: 'link-repoint-unresolved',
      relPath,
      target,
      repairTargets: klass === 'wikilink' ? [] : repairTargets,
      message: klass === 'wikilink'
        ? `refused: repoints a wikilink at "[[${target}]]", which resolves to no theme anywhere under brain/**/themes/`
        : repairTargets.length > 0
          ? `refused: repoints a link at "${target}", which does not exist — the real target is ${repairTargets.map((p) => basename(p)).join(', ')}`
          : `refused: repoints a link at "${target}", which does not exist — a dead link may not be exchanged for another dead link`,
    });
  }

  // (b) SLUGS whose occurrence count dropped — an edge was destroyed, not
  //     repointed. A slug whose count held is a repoint and is judged by (a).
  for (const [slug, beforeCount] of beforeBySlug) {
    const lost = beforeCount - (afterBySlug.get(slug) ?? 0);
    if (lost <= 0) continue;
    const originals = before.filter((t) => targetSlug(t) === slug);
    for (let i = 0; i < lost; i++) {
      const target = originals[i] ?? slug;
      const onDisk = klass === 'link' && linkResolves(ctx, absFile, target);
      const repairTargets = onDisk ? [resolve(dirname(absFile), target)] : repairsFor(ctx, slug);
      if (repairTargets.length === 0) continue; // a genuinely dead link may go
      found.push({
        kind: 'link-deleted',
        relPath,
        target,
        repairTargets,
        message: onDisk
          ? `refused: deletes the ${klass} "${target}", whose target exists — repair a link, never drop it`
          : `refused: deletes the ${klass} "${target}"; the theme it names exists at ${repairTargets.map((p) => basename(p)).join(', ')} — repair is preferred over deletion`,
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
  if (change.after === null || change.before === null) return null;
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
    // COLLATERAL GUARD (adversarial round 1): a target that also appears in
    // `before` has occurrences the turn never touched, and rewriting those
    // would put changes in the diff the audit never justified. Refuse rather
    // than repair-and-overreach.
    if (linkOccurrences(change.before, u.target) > 0) return null;
    const rel = relative(dirname(absFile), u.repairTargets[0]).split(/[\\/]/).join('/');
    // Anchor/query/title-preserving: `extractLinks` strips `#frag` before the
    // target ever reaches the audit, so a literal `](target)` replacement
    // silently missed every anchored link — which is how the first cut both
    // failed to repair `../beta.md#sec` AND produced a half-repaired file when
    // one of two identical targets carried an anchor.
    repaired = repaired.replace(
      new RegExp(`\\]\\(${escapeRegExp(u.target)}((?:[#?][^)\\s]*)?(?:\\s+"[^"]*")?)\\)`, 'g'),
      (_m, tail: string) => `](${rel}${tail})`,
    );
  }
  return repaired === change.after ? null : repaired;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How many markdown links in `text` point at exactly `target` (anchor,
 *  query and title tails allowed). */
function linkOccurrences(text: string, target: string): number {
  const re = new RegExp(`\\]\\(${escapeRegExp(target)}(?:[#?][^)\\s]*)?(?:\\s+"[^"]*")?\\)`, 'g');
  return (text.match(re) ?? []).length;
}


// ---------------------------------------------------------------------------
// The gate itself — ONE implementation, for EVERY path that lets an agent
// write into a brain dir.
// ---------------------------------------------------------------------------

export type KbEditGateResult = {
  /** Every file the turn changed, as diffed against the pre-turn snapshot. */
  changes: KbEditChange[];
  /** Structural changes reverted to their pre-turn bytes. */
  refused: KbEditChange[];
  /** Structural changes replaced by a verified repair (carrying it in `after`). */
  repaired: KbEditChange[];
  /** Every reason, across every change. */
  unsound: KbEditUnsoundness[];
};

/** Restore one change to its pre-turn content — a created file removed, an
 *  edited/deleted file written back byte-for-byte. `relPath` comes from our
 *  OWN walk of the trusted `brainDir`, never request or agent text. */
function revertChange(brainDir: string, c: KbEditChange): void {
  const abs = join(brainDir, c.relPath);
  if (c.before === null) {
    rmSync(abs, { force: true });
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, c.before, 'utf8');
}

/**
 * Audit everything an agent turn wrote into `brainDir` and dispose of it.
 *
 * **This is the whole class's chokepoint, and that placement is the fix.** The
 * first cut wired the audit into the drain's round loop alone — one of the
 * THREE production paths that reach `runBrainFixTurn`. The other two are the
 * ones an operator clicks by hand (`runBrainConsolidateNow`, and the
 * per-finding `op=fix-agent` route the needs-you walkthrough dispatches), and
 * both could still land the exact 2026-08-22 edits. Adding the audit to a call
 * site closes a door; making the turn itself unable to run ungated closes the
 * class.
 *
 * Structural changes only — the PROSE gate is the drain's own policy, and
 * consolidate legitimately rewrites prose for a living.
 *
 *   - sound              → left on disk;
 *   - unsound, repairable → the repair is written and RE-AUDITED; a repair that
 *                           is itself unsound is discarded and the change
 *                           reverted, because the fix may not re-ship the defect;
 *   - unsound, otherwise  → reverted to its pre-turn bytes.
 */
export function guardAgentKbEdits(
  forgeRoot: string,
  brainDir: string,
  snapshot: ReadonlyMap<string, string>,
): KbEditGateResult {
  const changes = diffKbSnapshot(brainDir, snapshot as Map<string, string>);
  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainDir);
  const refused: KbEditChange[] = [];
  const repaired: KbEditChange[] = [];
  const unsound: KbEditUnsoundness[] = [];

  for (const c of changes) {
    if (c.klass !== 'structural') continue;
    const found = auditKbEdit(c, ctx);
    if (found.length === 0) continue;
    unsound.push(...found);

    const fix = repairKbEdit(c, found, ctx);
    if (fix !== null && auditKbEdit({ ...c, after: fix }, ctx).length === 0
        && guardedWriteFile(brainDir, c.relPath.split('/'), fix) !== null) {
      repaired.push({ ...c, after: fix });
      continue;
    }
    revertChange(brainDir, c);
    refused.push(c);
  }

  return { changes, refused, repaired, unsound };
}
