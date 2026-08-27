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
 *   - **EVERY change is audited, whatever its class** (W8-F1). This boundary
 *     used to read "only `structural` changes are audited — a `prose` change
 *     is already refused one layer up". That was true of the DRAIN and false
 *     of the other two callers, and the C4 hostile re-verification walked
 *     straight through the gap: `classifyKbEdit` demotes an edit to `prose`
 *     the moment the body changes, so deleting a resolvable `related_themes`
 *     edge AND rewording one line reported `{unsound:0, refused:0}` — an
 *     affirmative all-clear with the edge gone. The modal agent-tier finding
 *     is `length.soft-cap`, whose remediation is definitionally "condense the
 *     prose", so this was the common case rather than a corner. Class now
 *     decides **draft-vs-auto-apply** at the call site; it never decides
 *     whether soundness is checked.
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

import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';

import { splitFrontmatter, diffKbSnapshot, snapshotKbFiles, type KbEditChange } from './kb-drain-structural.ts';
import { collectThemeSlugTargets, extractLinks } from './brain-lint.ts';
import { parseThemeRaw } from './theme-frontmatter.ts';
import { resolveGuardedPath, guardedWriteFile } from './studio-path-guard.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';

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
export type KbEditUnsoundnessKind =
  | 'edge-deleted'
  | 'link-deleted'
  | 'link-repoint-unresolved'
  /** W8-F1 — the change is outside the brain dir the drained KB resolves to.
   *  Nothing about it is judged on its merits: a turn dispatched for one KB
   *  has no business writing anywhere else, whatever the edit contains. */
  | 'out-of-scope-edit'
  /** W8-F1 — the turn CREATED a file under brain/. A lint-fix turn edits the
   *  one file it was dispatched for; creating corpus is not a repair. */
  | 'file-created'
  /** W8-F1 — the turn DELETED a file under brain/. A deletion destroys the
   *  file and every edge that resolves to it, and the soundness audit is
   *  structurally blind to it (`after === null` has no graph to compare). */
  | 'file-deleted'
  /** W8-F1 — the gate could not audit or dispose of this change. Recorded so
   *  "we did not check" can never be read as "we checked and it was fine". */
  | 'gate-failed';

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
 * means it destroys no resolvable graph structure.
 *
 * W8-F1: this used to open `if (change.klass !== 'structural') return []`, and
 * a sibling `auditProposedEdit` existed as "the same audit without the class
 * filter" for the draft path. Two entry points into one audit, one of which
 * silently answered "sound" for a whole class of edits, is how the class
 * escaped a fourth time — so there is now ONE function and it has no filter.
 * The `klass` field still exists and still matters, but only to the CALLER,
 * for deciding whether a sound edit auto-applies or is parked for approval.
 */
export function auditKbEdit(change: KbEditChange, ctx: KbEditSoundnessCtx): KbEditUnsoundness[] {
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
  /** Changes reverted to their pre-turn bytes (any class — W8-F1). */
  refused: KbEditChange[];
  /** Changes replaced by a verified repair (carrying it in `after`). */
  repaired: KbEditChange[];
  /** Every reason, across every change. */
  unsound: KbEditUnsoundness[];
  /**
   * W8-F1 — every disposal the gate could NOT carry out, named. Non-empty
   * means bytes this gate wanted to revert may still be on disk.
   *
   * The pre-W8-F1 shape had no such channel: `runBrainFixTurn.applyEditGate`
   * caught any throw out of this function and returned `undefined`, so the
   * turn reported normally with the agent's writes intact and nothing
   * downstream treated a missing audit as a failure. "We could not check" must
   * never be indistinguishable from "we checked and it was fine".
   */
  errors: string[];
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
 * The audit of a turn that wrote nothing.
 *
 * W8-F1 made `RunBrainFixResult.editAudit` REQUIRED, which is the point: a
 * turn that was not audited must not be representable. Test stubs and the
 * no-spawn stand-in genuinely write nothing, so they say so EXPLICITLY through
 * this named constructor rather than by omitting the field — the omission is
 * exactly what used to be indistinguishable from "the gate threw and we
 * dropped the result on the floor".
 *
 * A function, not a shared constant: the drain merges a turn's audit into its
 * own by pushing onto the arrays, and a shared literal would accumulate one
 * caller's findings into the next one's.
 */
export function noKbEdits(): KbEditGateResult {
  return { changes: [], refused: [], repaired: [], unsound: [], errors: [] };
}

/** `<forgeRoot>/brain` — the ONLY root this gate ever snapshots or diffs. */
export function brainRootDir(forgeRoot: string): string {
  return join(forgeRoot, 'brain');
}

/**
 * The pre-turn snapshot every caller of {@link guardAgentKbEdits} must take.
 *
 * W8-F1: both callers used to snapshot `resolveKbBrainDir(kbId)` — one KB —
 * while the brain-fix agent runs with `cwd = forgeRoot`. The C4 hostile
 * re-verification deleted a resolvable `related_themes` edge one directory
 * over, through the REAL `runKbDrain`, and the gate reported
 * `{unsound:0, refused:0, changes:0}`: an affirmative all-clear with a real
 * edge destroyed. The audit was never wrong — it could not SEE the file.
 *
 * There is deliberately no parameter for narrowing this. A snapshot scope a
 * caller can choose is a snapshot scope a caller can get wrong, twice.
 */
export function snapshotBrainTree(forgeRoot: string): Map<string, string> {
  return snapshotKbFiles(brainRootDir(forgeRoot));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Realpath of the brain root, for comparing against `resolveKbBrainDir`'s
 *  already-realpath-resolved answer. Falls back to the lexical path when the
 *  root does not exist yet — then nothing resolves under it either, and the
 *  scope check below fails CLOSED. */
function realBrainRoot(brainRoot: string): string {
  try {
    return realpathSync(brainRoot);
  } catch {
    return brainRoot;
  }
}

/** Is this brain-relative path inside the drained KB's own brain dir? A null
 *  `kbBrainDir` (the kbId resolves to no KB) puts EVERYTHING out of scope —
 *  "no KB to guard" must mean "nothing may be written", never "write freely". */
function inKbScope(root: string, kbBrainDir: string | null, relPath: string): boolean {
  if (kbBrainDir === null) return false;
  return join(root, relPath).startsWith(kbBrainDir + sep);
}

/**
 * W8-F1 — a change that CREATES or DELETES a file, which the soundness audit
 * is structurally unable to judge: `auditKbEdit` compares two graphs, and a
 * creation/deletion has only one, so it correctly returns `[]` for both.
 *
 * That `[]` used to mean "may land". It was safe only by accident: the DRAIN
 * reverts creations and deletions through its own prose gate
 * (`classifyKbEdit` classes both as `prose`), and the two callers without a
 * prose gate — `runBrainConsolidateNow` and `forge brain fix` — therefore let
 * an agent DELETE a brain theme outright, destroying every edge resolving to
 * it, with the gate reporting a clean audit. Same escape shape as the class
 * filter, one field over.
 *
 * A lint-fix turn edits the single file it was dispatched for. Creating or
 * removing corpus is the deterministic auto-tier fixers' job, outside the
 * turn, so both are refused here rather than judged.
 */
function lifecycleReason(c: KbEditChange): KbEditUnsoundness | null {
  if (c.before === null && c.after !== null) {
    return {
      kind: 'file-created',
      relPath: c.relPath,
      target: c.relPath,
      repairTargets: [],
      message: `refused: creates brain/${c.relPath} — a fix turn repairs the file it was dispatched for, it does not add corpus`,
    };
  }
  if (c.before !== null && c.after === null) {
    return {
      kind: 'file-deleted',
      relPath: c.relPath,
      target: c.relPath,
      repairTargets: [],
      message: `refused: deletes brain/${c.relPath}, destroying the file and every edge that resolves to it — a theme is never removed to clear lint`,
    };
  }
  return null;
}

function outOfScopeReason(relPath: string, kbId: string, kbBrainDir: string | null): KbEditUnsoundness {
  return {
    kind: 'out-of-scope-edit',
    relPath,
    target: relPath,
    repairTargets: [],
    message: kbBrainDir === null
      ? `refused: writes brain/${relPath}, but the kb id "${kbId}" resolves to no brain directory — a turn with no KB may not write to the brain at all`
      : `refused: writes brain/${relPath}, which is outside the drained KB "${kbId}" — a fix turn may only touch the KB it was dispatched for`,
  };
}

/**
 * Audit everything an agent turn wrote anywhere under `brain/` and dispose of
 * it.
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
 * **W8-F1 — the scope is DERIVED, never supplied.** This function used to take
 * a `brainDir` from its caller, and both callers handed it one KB's directory
 * while the agent could write to the whole repo. It now takes the `kbId` and
 * resolves both the brain root it audits and the KB dir it permits, so no call
 * site — present or future — can re-narrow it. That, plus the `canUseTool`
 * fence at the spawn seam (orchestrator/brain-fix-runner.ts), is deliberately
 * belt AND braces: the write is refused before it happens, and audited if it
 * happens anyway. A class that has recurred four times does not get a single
 * point of failure.
 *
 * Disposition, for every change regardless of class:
 *
 *   - sound, in scope     → left on disk (the caller decides apply-vs-draft);
 *   - unsound, repairable → the repair is written and RE-AUDITED; a repair that
 *                           is itself unsound is discarded and the change
 *                           reverted, because the fix may not re-ship the defect;
 *   - unsound, otherwise  → reverted to its pre-turn bytes;
 *   - out of scope        → reverted, unconditionally, unjudged.
 *
 * **TOTAL: this function never throws.** Anything it cannot audit or dispose
 * of is named in `errors` and counted as refused. The old shape let a throw
 * escape into a caller-side `catch` that returned `undefined` and left the
 * writes on disk.
 */
export function guardAgentKbEdits(
  forgeRoot: string,
  kbId: string,
  snapshot: ReadonlyMap<string, string>,
): KbEditGateResult {
  const brainRoot = brainRootDir(forgeRoot);
  const root = realBrainRoot(brainRoot);
  const kbBrainDir = resolveKbBrainDir(forgeRoot, kbId);

  const refused: KbEditChange[] = [];
  const repaired: KbEditChange[] = [];
  const unsound: KbEditUnsoundness[] = [];
  const errors: string[] = [];

  let changes: KbEditChange[];
  try {
    changes = diffKbSnapshot(brainRoot, snapshot as Map<string, string>);
  } catch (err) {
    // The gate cannot even see what changed. Restore every file we hold
    // pre-turn bytes for and say so — the one thing it may not do is return a
    // clean audit it never performed.
    errors.push(`kb-edit-gate: could not diff brain/ (${errText(err)}) — restoring every file from the pre-turn snapshot`);
    errors.push(...restoreFromSnapshot(brainRoot, snapshot));
    return { changes: [], refused: [], repaired: [], unsound: [], errors };
  }

  const ctx = buildKbEditSoundnessCtx(forgeRoot, brainRoot);

  for (const c of changes) {
    let found: KbEditUnsoundness[];
    try {
      const lifecycle = lifecycleReason(c);
      found = !inKbScope(root, kbBrainDir, c.relPath)
        ? [outOfScopeReason(c.relPath, kbId, kbBrainDir)]
        : lifecycle !== null
          ? [lifecycle]
          : auditKbEdit(c, ctx);
    } catch (err) {
      // An audit that threw has not cleared anything. Treat the change as
      // unsound so it is reverted below.
      found = [{
        kind: 'gate-failed',
        relPath: c.relPath,
        target: c.relPath,
        repairTargets: [],
        message: `refused: the soundness audit of brain/${c.relPath} failed (${errText(err)}) — an edit that could not be checked is not allowed to land`,
      }];
    }
    if (found.length === 0) continue;
    unsound.push(...found);

    try {
      // `repairKbEdit` synthesizes only for `link-repoint-unresolved` and only
      // when EVERY reason is repointable, so an out-of-scope or gate-failed
      // reason in `found` already blocks synthesis — no extra guard needed.
      const fix = repairKbEdit(c, found, ctx);
      if (fix !== null && auditKbEdit({ ...c, after: fix }, ctx).length === 0
          && guardedWriteFile(brainRoot, c.relPath.split('/'), fix) !== null) {
        repaired.push({ ...c, after: fix });
        continue;
      }
      revertChange(brainRoot, c);
      refused.push(c);
    } catch (err) {
      // The disposal itself failed (a theme replaced by a DIRECTORY of the
      // same name makes writing the pre-turn bytes back throw EISDIR). The
      // change is refused in intent; the failure to carry that out is declared
      // rather than swallowed.
      errors.push(`kb-edit-gate: could not restore brain/${c.relPath} (${errText(err)}) — the turn's write to that path may still be on disk`);
      refused.push(c);
    }
  }

  return { changes, refused, repaired, unsound, errors };
}

/** Last-resort disposal: put every file back the way the snapshot holds it,
 *  and remove anything the snapshot does not know about. Used only when the
 *  gate could not diff at all. Per-file failures are returned, never thrown —
 *  one unrestorable file must not abandon the rest. */
function restoreFromSnapshot(brainRoot: string, snapshot: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  let current: Map<string, string>;
  try {
    current = snapshotKbFiles(brainRoot);
  } catch (err) {
    return [`kb-edit-gate: could not re-walk brain/ to restore it (${errText(err)})`];
  }
  for (const [relPath, before] of snapshot) {
    if (current.get(relPath) === before) continue;
    try {
      revertChange(brainRoot, { relPath, before, after: null, klass: 'prose' });
    } catch (err) {
      problems.push(`kb-edit-gate: could not restore brain/${relPath} (${errText(err)})`);
    }
  }
  for (const relPath of current.keys()) {
    if (snapshot.has(relPath)) continue;
    try {
      rmSync(join(brainRoot, relPath), { force: true });
    } catch (err) {
      problems.push(`kb-edit-gate: could not remove brain/${relPath} written by the turn (${errText(err)})`);
    }
  }
  return problems;
}
