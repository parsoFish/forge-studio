/**
 * Theme-directory enumeration and the path rules the brain layout implies:
 * which directories hold themes, which of them are the two FORGE sub-wikis, and
 * how a theme file is located and read.
 *
 * Split out of `brain-lint.ts` (M4 step 4, the 800-line cap). Every check module
 * asks THIS module where the themes are and never re-derives the layout — the
 * mistake `themeScanFiles`' own doc comment records a consumer making once
 * already, when Studio kept its own copy of "which dirs the scan walks" and
 * reported `n/a` for four checks that scan a project brain perfectly well.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { parseThemeFile, type ParsedThemeFile } from './theme-frontmatter.ts';
/**
 * Every theme file a `scope:'full'` run actually reads, absolute. THE export a
 * per-KB consumer asks "did the scan open anything in this KB?" with — so
 * Studio can never hold its own copy of the answer, which is how it came to
 * hardcode `brainDir === brain/cycles || brainDir === brain/forge-dev` and
 * report `n/a` for four checks that scan a project brain perfectly well.
 *
 * FILES, not dirs, deliberately: a KB with a `themes/` dir and nothing in it
 * has had no content examined, so its checks are `n/a` — not a `pass` earned
 * over an empty set. That is the same reasoning `checkProjectBrainIndexes`
 * already applies when it skips a themeless project brain.
 */
export function themeScanFiles(forgeRoot: string): string[] {
  return readThemeFiles(join(forgeRoot, 'brain'));
}

/**
 * Is this KB dir one of the two FORGE sub-wikis — the domain of the ADR 018
 * category→sub-wiki routing rules (`CHECK_SCOPE: 'forge-themes'`)? Derived from
 * `THEME_SUBDIRS`, never re-listed by a caller.
 */
export function isForgeBrainDir(forgeRoot: string, brainDir: string): boolean {
  const brainRoot = join(forgeRoot, 'brain');
  return (THEME_SUBDIRS as readonly string[]).some((sub) => join(brainRoot, sub) === brainDir);
}

/**
 * The two FORGE sub-wikis, relative to `brain/` (ADR 018). This is the
 * category-routing domain (`pattern`→`cycles`, `decision`→`forge-dev`) and the
 * `forge-only` scope filter — it is NOT the set of theme dirs the lint walks.
 * That universe is `themeDirs()` below, which also covers Brain 3
 * (`brain/projects/<name>/themes/`, ADR 035) and operator-created KBs
 * (`brain/<id>/themes/`).
 */
export const THEME_SUBDIRS = ['cycles', 'forge-dev'] as const;

/**
 * THE one enumeration of every brain theme directory: each `brain/<kb>/themes/`
 * plus each `brain/projects/<name>/themes/` (ADR 035 moved Brain 3 into this
 * repo; ADR 018 is the sub-wiki layout). `readThemeFiles`, `findThemeBySlug`
 * and `collectThemeSlugTargets` all derive from this — three callers, one walk,
 * so no caller can hold a stale idea of what exists.
 *
 * It used to be two: `collectThemeSlugTargets` already walked all of them for
 * the slug universe while `readThemeFiles` walked only the two forge sub-wikis
 * and said so ("It does not change which files are LINTED"). That seam is the
 * defect this function removes — every check built on `readThemeFiles` reported
 * clean on Brain 3 files it had never opened (campaign ledger, "OPEN RULE
 * result — 2026-08-29").
 */
export function themeDirs(brainRoot: string): string[] {
  const dirs: string[] = [];
  for (const name of existsSync(brainRoot) ? readdirSync(brainRoot) : []) {
    // `.staging-<id>-*` create leftovers (SEC-05 4on) and any dot-dir.
    if (name.startsWith('.') || name === 'projects') continue;
    dirs.push(join(brainRoot, name, 'themes'));
  }
  const projectsRoot = join(brainRoot, 'projects');
  if (existsSync(projectsRoot)) {
    for (const name of readdirSync(projectsRoot)) {
      if (name.startsWith('.')) continue;
      dirs.push(join(projectsRoot, name, 'themes'));
    }
  }
  return dirs.filter((d) => existsSync(d));
}

/**
 * Is this absolute path inside a managed project's ground clone
 * (`<forgeRoot>/projects/<name>/`)? Those clones are gitignored working copies
 * of OTHER repositories — present locally, absent in CI — so nothing the forge
 * lint asserts may depend on their contents.
 */
export function isGroundClonePath(forgeRoot: string, target: string): boolean {
  const groundRoot = resolve(forgeRoot, 'projects');
  return target === groundRoot || target.startsWith(groundRoot + sep);
}

/** The brain sub-wiki segment a theme file sits under (`cycles`, `projects`, an operator KB id). */
export function themeSubdir(brainRoot: string, file: string): string {
  const rel = file.slice(brainRoot.length).replace(/\\/g, '/');
  return rel.split('/').filter(Boolean)[0] ?? '';
}

/**
 * Is this theme one of the two FORGE sub-wikis' own themes? The rules keyed to
 * the three-brain routing convention (category→sub-wiki, forge category-index
 * sync) govern only those; a project or operator-KB theme is exempt, and saying
 * so once here is what stops the exemption being re-derived per check.
 */
export function isForgeTheme(brainRoot: string, file: string): boolean {
  return (THEME_SUBDIRS as readonly string[]).includes(themeSubdir(brainRoot, file));
}

// ---------- helpers ----------

export function readThemeFiles(brainRoot: string): string[] {
  const files: string[] = [];
  if (!existsSync(brainRoot)) return files;
  for (const dir of themeDirs(brainRoot)) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'README.md' || !entry.endsWith('.md')) continue;
      files.push(join(dir, entry));
    }
  }
  return files;
}

/** Absolute path to a theme slug if it exists in ANY brain theme dir (`themeDirs`). */
export function findThemeBySlug(brainRoot: string, slug: string): string | null {
  for (const dir of themeDirs(brainRoot)) {
    const candidate = join(dir, `${slug}.md`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Lenient frontmatter parser — delegates to the ONE shared implementation in
 * packages/knowledge/theme-frontmatter.ts (W7 FIX-B-KB: extracted so the deterministic
 * fixers in packages/knowledge/brain-fix-auto.ts parse themes with the exact same lenient
 * fallback the lint checks use; the two used to disagree, so the fixer
 * refused the very theme lint had just flagged). Null only on a READ
 * failure — the parse itself always produces a result (gray-matter first,
 * cache-bypassed; regex line-extractor fallback on YAML failure, e.g. an
 * unquoted `:` in a description value).
 */
export function parseTheme(file: string): ParsedThemeFile | null {
  return parseThemeFile(file);
}
