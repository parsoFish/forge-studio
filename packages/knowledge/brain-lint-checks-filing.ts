/**
 * Filing checks — is a theme in the right place, declared correctly, and listed
 * where the brain says it should be? `checkFrontmatter`, `checkIndexSync`,
 * `checkProjectBrainIndexes`, `checkCategoryScope`, and the category tables the
 * four of them share.
 *
 * Split out of `brain-lint.ts` (M4 step 4, the 800-line cap). The category
 * tables live here rather than with the layout rules because they encode ADR
 * 018's routing convention — a filing rule — not where files sit on disk.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { isForgeTheme, parseTheme, readThemeFiles, themeSubdir } from './brain-lint-theme-paths.ts';
import type { Finding } from './brain-lint-types.ts';

export const ALLOWED_CATEGORIES = new Set([
  'pattern',
  'antipattern',
  'decision',
  'operation',
  'reference',
]);

export const REQUIRED_FRONTMATTER_FIELDS = [
  'title',
  'description',
  'category',
  'created_at',
  'updated_at',
];

export const CATEGORY_TO_INDEX_FILE: Record<string, string> = {
  pattern: 'patterns.md',
  antipattern: 'antipatterns.md',
  decision: 'decisions.md',
  operation: 'operations.md',
  reference: 'reference.md',
};

/**
 * Which brain sub-wiki owns each theme category (three-brain model, ADR 018).
 * Cycle-derived knowledge (patterns/antipatterns/operations) lives in Brain 2
 * (`cycles/`); forge-engineering knowledge (decisions/reference) lives in
 * Brain 1 (`forge-dev/`). Both the theme files and their category index sit in
 * the owning sub-wiki.
 */
export const CATEGORY_TO_BRAIN_SUBDIR: Record<string, string> = {
  pattern: 'cycles',
  antipattern: 'cycles',
  operation: 'cycles',
  decision: 'forge-dev',
  reference: 'forge-dev',
};

// ---------- checkFrontmatter ----------

export function checkFrontmatter(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');
  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) {
      findings.push({
        category: 'error',
        file,
        message: 'unparseable frontmatter (gray-matter failed)',
        check: 'checkFrontmatter',
      });
      continue;
    }
    const { data } = parsed;
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        findings.push({
          category: 'error',
          file,
          message: `missing required frontmatter field: ${field}`,
          check: 'checkFrontmatter',
        });
      }
    }
    if (data.category && !ALLOWED_CATEGORIES.has(String(data.category))) {
      findings.push({
        category: 'error',
        file,
        message: `category "${data.category}" not in whitelist {${[...ALLOWED_CATEGORIES].join('|')}}`,
        check: 'checkFrontmatter',
      });
    }
    if (data.created_at && data.updated_at) {
      try {
        const c = new Date(String(data.created_at)).getTime();
        const u = new Date(String(data.updated_at)).getTime();
        if (!Number.isNaN(c) && !Number.isNaN(u) && c > u) {
          findings.push({
            category: 'error',
            file,
            message: 'created_at > updated_at',
            check: 'checkFrontmatter',
          });
        }
      } catch {
        /* ignore parse failure; not load-bearing */
      }
    }
  }
  return findings;
}

// ---------- checkIndexSync ----------

export function readIndexEntries(indexFile: string): string[] {
  if (!existsSync(indexFile)) return [];
  const body = readFileSync(indexFile, 'utf8');
  // Match links of shape ./themes/<slug>.md or themes/<slug>.md
  const slugs: string[] = [];
  const re = /\(\.?\.?\/?(?:themes\/)([a-zA-Z0-9._-]+?)(?:\.md)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    slugs.push(m[1]);
  }
  // Also accept bare-style: [`<slug>`](./themes/<slug>.md) — captured by re above already.
  return slugs;
}

export function checkIndexSync(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');

  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const cat = String(parsed.data.category ?? '');
    if (!ALLOWED_CATEGORIES.has(cat)) continue; // checkFrontmatter handles the bad-category case
    const indexFile = CATEGORY_TO_INDEX_FILE[cat];
    if (!indexFile) continue;

    // Forge sub-wikis only: this check resolves the index through the
    // category→sub-wiki routing map, which governs `cycles`/`forge-dev` alone.
    // A project brain indexes its own themes in its OWN dir and gets a real
    // verdict from `checkProjectBrainIndexes`; resolving a Brain 3 theme
    // through this map would look for it in `brain/cycles/patterns.md` and
    // flag all 185 project themes as unindexed.
    if (!isForgeTheme(brainRoot, file)) continue;
    const indexPath = join(brainRoot, CATEGORY_TO_BRAIN_SUBDIR[cat] ?? 'cycles', indexFile);

    if (!existsSync(indexPath)) {
      findings.push({
        category: 'flag',
        file,
        message: `category index missing: ${relative(forgeRoot, indexPath)}`,
        check: 'checkIndexSync',
      });
      continue;
    }
    const slug = basename(file, '.md');
    const entries = readIndexEntries(indexPath);
    const hit = entries.filter((e) => e === slug).length;
    if (hit === 0) {
      findings.push({
        category: 'flag',
        file,
        message: `not listed in category index: ${relative(forgeRoot, indexPath)}`,
        check: 'checkIndexSync',
      });
    } else if (hit > 1) {
      findings.push({
        category: 'flag',
        file,
        message: `listed ${hit} times in category index: ${relative(forgeRoot, indexPath)}`,
        check: 'checkIndexSync',
      });
    }
  }

  return findings;
}

// ---------- checkProjectBrainIndexes ----------

/**
 * Project-brain (Brain 3) category-index sync. Mirrors checkIndexSync, but each
 * project brain (`brain/projects/<name>/`) resolves its category indexes in its
 * OWN dir (patterns.md / antipatterns.md / decisions.md / reference.md), not the
 * forge sub-wikis. ADR 035 made project brains forge-owned central, so lint now
 * covers them. Flag severity — advisory, never gates.
 */
export function checkProjectBrainIndexes(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const projectsRoot = join(forgeRoot, 'brain', 'projects');
  if (!existsSync(projectsRoot)) return findings;

  for (const name of readdirSync(projectsRoot)) {
    if (name.startsWith('.')) continue; // skip `.staging-<id>-*` create leftovers (SEC-05 4on) + any dot-dir
    const projectDir = join(projectsRoot, name);
    const themesDir = join(projectDir, 'themes');
    if (!existsSync(themesDir)) continue;

    const themeFiles = readdirSync(themesDir).filter(
      (e) => e.endsWith('.md') && e !== 'README.md',
    );
    // A project brain holding only a README is SKIPPED, deliberately (forge-4qf,
    // W8-B2 — attempted and reverted on evidence). Flagging it looks right and
    // is not: this check is `resolution:'agent'`, so the finding would be
    // dispatched to a brain-fix turn carrying an index-sync fixHint, against a
    // brain with no themes to index. The turn can only no-op — burning a drain
    // round and real money every round without ever clearing — or invent theme
    // content to make the finding go away. Both are worse than silence, and the
    // second is the exact class this lane exists to stop.
    //
    // The bead's own remedy is to cross-reference `discoverProjects`
    // (orchestrator/studio/registry.ts), and that cannot live here: `projects/`
    // is gitignored, so on a fresh checkout and in CI it is absent, and every
    // project brain would flag on every run. An empty brain dir and a
    // freshly-seeded one are indistinguishable from the brain alone — which is
    // precisely why this needs the project roster, not another brain check.
    if (themeFiles.length === 0) continue;

    // A project brain with themes but no category index files is unindexed — its
    // themes are unreachable from the meta-index and invisible to the
    // category-first brain-query read. Flag once (does not gate).
    const hasAnyIndex = Object.values(CATEGORY_TO_INDEX_FILE).some((f) =>
      existsSync(join(projectDir, f)),
    );
    if (!hasAnyIndex) {
      findings.push({
        category: 'flag',
        file: relative(forgeRoot, themesDir),
        message: `project brain "${name}" has ${themeFiles.length} theme(s) but no category index files (patterns.md/antipatterns.md/decisions.md/reference.md); themes are unindexed`,
        check: 'checkProjectBrainIndexes',
      });
      continue;
    }

    for (const entry of themeFiles) {
      const file = join(themesDir, entry);
      const parsed = parseTheme(file);
      if (!parsed) continue;
      const cat = String(parsed.data.category ?? '');
      if (!ALLOWED_CATEGORIES.has(cat)) continue;
      const indexFile = CATEGORY_TO_INDEX_FILE[cat];
      if (!indexFile) continue;
      const indexPath = join(projectDir, indexFile);
      if (!existsSync(indexPath)) {
        findings.push({
          category: 'flag',
          file,
          message: `category index missing: ${relative(forgeRoot, indexPath)}`,
          check: 'checkProjectBrainIndexes',
        });
        continue;
      }
      const slug = basename(file, '.md');
      const hit = readIndexEntries(indexPath).filter((e) => e === slug).length;
      if (hit === 0) {
        findings.push({
          category: 'flag',
          file,
          message: `not listed in project category index: ${relative(forgeRoot, indexPath)}`,
          check: 'checkProjectBrainIndexes',
        });
      } else if (hit > 1) {
        findings.push({
          category: 'flag',
          file,
          message: `listed ${hit} times in project category index: ${relative(forgeRoot, indexPath)}`,
          check: 'checkProjectBrainIndexes',
        });
      }
    }
  }
  return findings;
}

// ---------- checkCategoryScope (brain gap #8) ----------

/**
 * Verify that each theme's `category` routes to the brain sub-wiki it
 * actually lives in, per CATEGORY_TO_BRAIN_SUBDIR.
 *
 * A `pattern|antipattern|operation` theme must live in `brain/cycles/themes/`;
 * a `decision|reference` theme must live in `brain/forge-dev/themes/`.
 * A mis-routed theme (e.g. an `antipattern` in `forge-dev/themes/`) is a
 * structural routing violation → `error` (matching the whitelist-enforcement
 * style used by checkFrontmatter).
 *
 * Closes brain gap #8.
 */
export function checkCategoryScope(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');

  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const cat = String(parsed.data.category ?? '');
    // Only check categories we recognise (checkFrontmatter catches unknown ones)
    if (!ALLOWED_CATEGORIES.has(cat)) continue;

    const expectedSubdir = CATEGORY_TO_BRAIN_SUBDIR[cat];
    if (!expectedSubdir) continue;

    // category→sub-wiki routing is an ADR 018 convention over the two FORGE
    // sub-wikis only. A Brain 3 or operator-KB theme keeps its own category in
    // its own brain, so it is exempt — the same exemption `lintThemeFiles` has
    // always applied, now stated once in `isForgeTheme`.
    if (!isForgeTheme(brainRoot, file)) continue;
    const actualSubdir = themeSubdir(brainRoot, file);

    if (actualSubdir !== expectedSubdir) {
      findings.push({
        category: 'error',
        file,
        message:
          `category "${cat}" belongs in brain/${expectedSubdir}/themes/ ` +
          `but this file is in brain/${actualSubdir}/themes/ ` +
          `(category→brain routing: ${cat}→${expectedSubdir})`,
        check: 'checkCategoryScope',
      });
    }
  }

  return findings;
}
