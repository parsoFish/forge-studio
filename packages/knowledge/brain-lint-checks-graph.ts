/**
 * Theme-graph checks — the edges between themes. `checkDanglingEdges` (a
 * `related_themes` slug pointing at nothing) and `checkDuplicateThemes` (two
 * themes that are the same theme), plus the slug collection both walk.
 *
 * Split out of `brain-lint.ts` (M4 step 4, the 800-line cap).
 * `collectThemeSlugTargets` is exported beyond this module —
 * `kb-drain-edit-soundness.ts` and `kb-graph.ts` both consume it — and travels
 * back out through `brain-lint.ts`'s barrel so neither importer moves.
 */

import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parseTheme, readThemeFiles, themeDirs } from './brain-lint-theme-paths.ts';
import type { Finding } from './brain-lint-types.ts';
// ---------- checkDanglingEdges / checkDuplicateThemes (R4-19-F2) ----------

/**
 * Slug universe for dangling-edge resolution, as slug -> the absolute file(s)
 * carrying it: EVERY theme file anywhere under `brain/**\/themes/` — both forge
 * sub-wikis (`cycles/`, `forge-dev/`) AND every project brain
 * (`brain/projects/*\/themes/`). A `cycles` theme legitimately points at a
 * `forge-dev` theme (and vice versa), so the universe must span both forge
 * sub-wikis even though the SOURCE iteration for the full-scope check stays
 * forge-only (see `checkDanglingEdges` below) — narrowing this to "the same
 * sub-wiki" is exactly the naive shape a pinned test kills.
 *
 * A slug can legitimately map to MORE THAN ONE file (the same basename in two
 * sub-wikis), so the value is a list — a caller acting on a target must decide
 * what a non-unique match means instead of silently taking the first.
 */
export function collectThemeSlugTargets(brainRoot: string): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  const addDir = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'README.md' || !entry.endsWith('.md')) continue;
      const slug = basename(entry, '.md');
      const list = targets.get(slug);
      if (list) list.push(join(dir, entry));
      else targets.set(slug, [join(dir, entry)]);
    }
  };
  // W8-F1 — EVERY `brain/<x>/themes` dir, not just the two OOTB sub-wikis:
  // `POST /api/studio/kbs` scaffolds an operator-created KB at `brain/<id>/`,
  // which is neither `cycles`, `forge-dev`, nor under `projects/`. Its themes
  // were absent from this universe, so `repairsFor()` returned [] for them and
  // the drain's edit-soundness audit read a deletion of a REAL edge as "a
  // genuinely dangling entry may go" (forge-d8l). The walk is now `themeDirs`,
  // shared with `readThemeFiles` and `findThemeBySlug`.
  for (const dir of themeDirs(brainRoot)) addDir(dir);
  return targets;
}

/**
 * The same universe as a bare slug SET.
 *
 * DERIVED from `collectThemeSlugTargets`, never a second walk: the KB drain's
 * edit-soundness audit (packages/knowledge/kb-drain-edit-soundness.ts) needs the target PATHS
 * to decide whether an edit destroyed a real edge, and a second, narrower
 * derivation answering "does this theme exist?" is exactly how drain-to-green
 * came to delete a valid `related_themes` edge whose target sat in the same
 * directory (forge-d8l). One walk, two views.
 */
export function collectAllThemeSlugs(brainRoot: string): Set<string> {
  return new Set(collectThemeSlugTargets(brainRoot).keys());
}

/**
 * Pure core shared by `checkDanglingEdges` (full-scope, `readThemeFiles`
 * domain) and `lintThemeFiles` (explicit per-KB file list) — ONE
 * implementation of the rule, never two. `files` is the set of theme files to
 * SCAN for dangling entries; `knownSlugs` is the (separately-scoped)
 * universe an entry is checked against — always ALL brain theme basenames,
 * regardless of which `files` are being scanned, because a KB's theme may
 * legitimately reference a theme outside that KB.
 */
export function danglingEdgeFindings(files: string[], knownSlugs: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const related = parsed.data.related_themes;
    if (!Array.isArray(related)) continue; // tolerate missing/absent/non-array — many themes predate this field
    for (const rawEntry of related) {
      // Strip a trailing `.md` and surrounding whitespace before resolving.
      const slug = String(rawEntry).trim().replace(/\.md$/, '').trim();
      if (!slug) continue;
      if (!knownSlugs.has(slug)) {
        findings.push({
          category: 'flag',
          file,
          message: `dangling related_themes entry: "${slug}" (no theme file found anywhere under brain/**/themes/)`,
          check: 'checkDanglingEdges',
        });
      }
    }
  }
  return findings;
}

/**
 * checkDanglingEdges — a `related_themes[]` entry whose slug resolves to no
 * theme file anywhere in the brain is a broken graph edge with NO upstream
 * signal today: `orchestrator/kb-graph.ts:407`'s `if (nodeIds.has(relSlug))`
 * silently SKIPS emitting the edge when the target doesn't exist, and the
 * `validEdges` filter at `orchestrator/kb-graph.ts:464` drops it a second
 * time when building the KB graph — the entry just quietly fails to render,
 * with nothing telling the reflector or a maintenance agent it's stale.
 *
 * Source iteration is `readThemeFiles`'s existing forge-only domain
 * (`brain/cycles/themes` + `brain/forge-dev/themes`), matching this check's
 * `CHECK_SCOPE: 'forge-themes'` classification — the per-KB path for
 * project/band brains is `lintThemeFiles` (below), which reuses the same
 * `danglingEdgeFindings` core over its own explicit file list.
 *
 * SCOPE HONESTY (adversarial review, 2026-08-14 — measured, do not "fix" by
 * widening this check). The slug universe here is deliberately EVERY brain
 * theme basename, so a `cycles` theme referencing a `forge-dev` theme is
 * legitimate CONTENT and is NOT reported. `buildKbGraph`, by contrast, scopes
 * `nodeIds` to the ONE KB it is graphing, so it drops those cross-sub-wiki
 * edges too — 25 of them exist in the live brain today. This check does NOT
 * surface that second, separate case, and must not: flagging 25 correct links
 * as broken would steer the maintenance agent into "repairing" them. The
 * silent cross-KB drop is a defect on the GRAPH side (a per-KB graph
 * discarding declared, resolvable links with no signal) and is filed as its
 * own bead. What this check closes is exactly the UNRESOLVABLE-slug case.
 */
export function checkDanglingEdges(forgeRoot: string): Finding[] {
  const brainRoot = join(forgeRoot, 'brain');
  const knownSlugs = collectAllThemeSlugs(brainRoot);
  return danglingEdgeFindings(readThemeFiles(brainRoot), knownSlugs);
}

/** Jaccard threshold a keyword-set pair must meet/exceed to count as a near-duplicate. */
const DUPLICATE_KEYWORD_JACCARD_THRESHOLD = 0.8;
/** Minimum keywords BOTH themes in a pair must declare before the keyword clause is even evaluated. */
const DUPLICATE_KEYWORD_MIN_DECLARED = 3;

/** `String(title)` lowercased, non-`[a-z0-9 ]` stripped, whitespace runs collapsed, trimmed. */
function normalizeThemeTitle(title: unknown): string {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Pure core shared by `checkDuplicateThemes` (full-scope) and
 * `lintThemeFiles` (explicit per-KB file list) — ONE implementation of the
 * near-duplicate rule. Reports ONE finding per pair, filed on the
 * lexicographically-LATER absolute file path (plain string comparison of the
 * paths as returned by the caller — theme files always come from `join()`
 * against an absolute `forgeRoot`/`brainRoot`, so this is stable), naming the
 * earlier (partner) file in the message.
 */
export function duplicateThemeFindings(files: string[]): Finding[] {
  type ThemeDupMeta = { file: string; normTitle: string; keywords: Set<string>; recurrence: string };
  const metas: ThemeDupMeta[] = [];
  for (const file of files) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const kwArr = Array.isArray(parsed.data.keywords) ? parsed.data.keywords.map(String) : [];
    metas.push({
      file,
      normTitle: normalizeThemeTitle(parsed.data.title),
      keywords: new Set(kwArr),
      recurrence: String(parsed.data.recurrence ?? '').trim(),
    });
  }

  const findings: Finding[] = [];
  const seenPairs = new Set<string>();
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const a = metas[i];
      const b = metas[j];

      // A DELIBERATE RECURRENCE SERIES. Some brains record the same failure
      // once per cycle it recurred in, and the count is the point: gitpulse
      // carries six `gitignored-scratch-*` themes, and M0-A cited the sixth as
      // the evidence for the M5-A decomposition-time fix (forge-6gv.17).
      // Merged into one theme, that argument no longer exists. This checker
      // cannot tell such a series from a brain that quietly re-captured one
      // lesson twice, so the theme says which it is: `recurrence: <series>` in
      // its frontmatter names the series it is a record of, and two records of
      // the SAME series are not duplicates of each other.
      //
      // The check is not weakened by it. The exemption is an author's explicit
      // statement in the data, it costs a declaration on BOTH files, it is
      // scoped to that one pair, and every other pairing of a declaring theme
      // — including against an undeclared near-duplicate — still flags. It is
      // deliberately not a list of paths in this file: an allowlist would
      // exempt those exact three files forever and teach the next series
      // nothing.
      if (a.recurrence !== '' && a.recurrence === b.recurrence) continue;

      // An empty normalized title never participates in a title collision.
      const titleCollision = a.normTitle !== '' && a.normTitle === b.normTitle;

      const keywordCollision =
        a.keywords.size >= DUPLICATE_KEYWORD_MIN_DECLARED &&
        b.keywords.size >= DUPLICATE_KEYWORD_MIN_DECLARED &&
        jaccardSimilarity(a.keywords, b.keywords) >= DUPLICATE_KEYWORD_JACCARD_THRESHOLD;

      if (!titleCollision && !keywordCollision) continue;

      const [earlier, later] = a.file <= b.file ? [a, b] : [b, a];
      const pairKey = `${earlier.file}::${later.file}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const reason = titleCollision
        ? 'normalized-title collision'
        : `keyword Jaccard ${jaccardSimilarity(a.keywords, b.keywords).toFixed(2)} over >=${DUPLICATE_KEYWORD_MIN_DECLARED} declared keywords`;

      findings.push({
        category: 'flag',
        file: later.file,
        message: `possible duplicate theme: ${basename(later.file)} ~ ${basename(earlier.file)} (${reason})`,
        check: 'checkDuplicateThemes',
      });
    }
  }
  return findings;
}

/**
 * checkDuplicateThemes — near-duplicate theme pairs the brain has quietly
 * accumulated (e.g. the same lesson re-captured across cycles under a
 * slightly different title). Flag severity: a merge decision needs the fuller
 * content of both files, so this never gates — it only surfaces the pair for
 * a maintenance agent (`runBrainConsolidateNow`) to fold together.
 */
export function checkDuplicateThemes(forgeRoot: string): Finding[] {
  const brainRoot = join(forgeRoot, 'brain');
  return duplicateThemeFindings(readThemeFiles(brainRoot));
}
