/**
 * Brain-lint — structural integrity checks on the brain corpus.
 *
 * CLI: `forge brain lint [--scope <s>] [--project <name>] [--file <path>] [--cycle <id>] [--fix]`
 *
 * Implements 13 checks (per `brain/LINT.md`):
 *
 *   1. checkFrontmatter        — required fields + category whitelist
 *   2. checkIndexSync          — themes appear in their category index exactly once
 *   3. checkSourceLinks        — every link in `## Sources` and every wikilink resolves
 *   4. checkStaleness          — cited forge-internal paths still exist
 *   5. checkOrphans            — themes reachable from INDEX.md → category index → theme
 *   6. checkLengthSoftCap      — > 60 lines warn; > 100 lines error
 *   7. checkContradictions     — warn-only stretch: pattern+antipattern with overlapping keywords
 *   8. checkCleanupCandidates  — retention frontmatter triage (archived/stale themes)
 *   9. checkReflectorLoss      — advisory: `_queue/done/` initiatives missing a reflection archive
 *  10. checkProjectBrainIndexes — project-brain (Brain 3) category-index sync
 *  11. checkCategoryScope      — theme category routes to the brain sub-wiki it lives in
 *  12. checkDanglingEdges      — `related_themes[]` entries that resolve to no theme file
 *  13. checkDuplicateThemes    — near-duplicate theme pairs (title collision / keyword Jaccard)
 *
 * Each check is a pure function `(forgeRoot) => Finding[]`. The CLI aggregates,
 * prints a human-readable report, and exits non-zero iff ≥1 error.
 *
 * Per CONTRACTS.md C7, scopes: `full | forge-only | project-only | single-file |
 * cycle-touched-themes | cleanup-dry-run`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, basename, sep } from 'node:path';

import { cyclesRawDir } from '../orchestrator/brain-paths.ts';
import { applyAutoFixes } from './brain-fix-auto.ts';
import { parseThemeFile, type ParsedThemeFile } from './theme-frontmatter.ts';

// ---------- types ----------

export type FindingCategory = 'auto-fix' | 'flag' | 'error';

/**
 * Resolution tier — WHO clears a finding, orthogonal to `category` (severity):
 *   - `auto`  — a deterministic fixer (regenerate index, clamp dates, git-mv). No LLM.
 *   - `agent` — an LLM can resolve it unattended (infer a description, repoint a link).
 *   - `user`  — needs a human decision (which of a contradicting pair, archive-or-keep).
 * The guided lint-resolution UI dispatches on this tier.
 */
export type Resolution = 'auto' | 'agent' | 'user';

export type Finding = {
  category: FindingCategory;
  file: string; // absolute path
  message: string;
  /** Optional check name for grouping in output. */
  check?: string;
  /** Stable discriminator slug (e.g. `index.not-listed`), stamped by classifyFinding. */
  kind?: string;
  /** Resolution tier, stamped by classifyFinding. */
  resolution?: Resolution;
  /** Agent-tier only: a targeted instruction for the fix turn. */
  fixHint?: string;
};

export type Scope =
  | 'full'
  | 'forge-only'
  | 'project-only'
  | 'single-file'
  | 'cycle-touched-themes'
  | 'cleanup-dry-run';

export type RunBrainLintOptions = {
  cwd: string;
  scope: Scope;
  project?: string;
  file?: string; // relative to cwd
  cycle?: string;
  fix?: boolean;
};

export type RunBrainLintResult = {
  findings: Finding[];
  exitCode: 0 | 1;
};

/**
 * R6-08 4on (F3 hardening) — the single source of truth for the 12 full-scope
 * checks. Declared as `[name, fn]` pairs rather than a bare name list so
 * `runBrainLint` (below) can ITERATE this array to run the checks instead of
 * separately hand-typing the same 12 calls — the shape that let `CHECK_NAMES`
 * (adversarial-review MAJOR F3) drift from the checks `runBrainLint` actually
 * ran, with nothing forcing the two lists to match. `checkCleanupCandidates`
 * is deliberately EXCLUDED from this registry — it only ever contributes
 * findings under `scope:'cleanup-dry-run'` (see `runBrainLint`'s conditional
 * spread below), so a full-scope KB-health itemization has nothing to report
 * for it. Function declarations are hoisted, so referencing them here (above
 * their textual definitions later in this file) is safe both at runtime and
 * under `tsc`.
 */
const FULL_SCOPE_CHECKS: ReadonlyArray<readonly [name: string, fn: (cwd: string) => Finding[]]> = [
  ['checkFrontmatter', checkFrontmatter],
  ['checkIndexSync', checkIndexSync],
  ['checkSourceLinks', checkSourceLinks],
  ['checkStaleness', checkStaleness],
  ['checkOrphans', checkOrphans],
  ['checkProjectBrainIndexes', checkProjectBrainIndexes],
  ['checkLengthSoftCap', checkLengthSoftCap],
  ['checkContradictions', checkContradictions],
  ['checkCategoryScope', checkCategoryScope],
  ['checkReflectorLoss', checkReflectorLoss],
  ['checkDanglingEdges', checkDanglingEdges],
  ['checkDuplicateThemes', checkDuplicateThemes],
];

/**
 * The 12 `check` names a `scope:'full'` run always contributes — DERIVED from
 * `FULL_SCOPE_CHECKS` (never hand-duplicated) so the two can never drift
 * apart. Consumers that need to itemize per-check health (Studio's KB Health
 * tab, `cli/bridge-studio-kbs.ts`'s `buildKbHealth`) import this rather than
 * re-hardcoding the list.
 */
export const CHECK_NAMES = FULL_SCOPE_CHECKS.map(([name]) => name) as readonly string[];

/**
 * R6-08 4on (F1/F2 hardening) — which scan domain each full-scope check
 * actually inspects. A per-KB consumer (`buildKbHealth`) uses this to tell
 * whether a check even LOOKS at a given KB before reporting a verdict —
 * reporting `pass` for a check that never scanned the KB is exactly the
 * declared-data-fails-open defect this hardens against.
 *
 *   - `forge-themes`    — `readThemeFiles`-based; scans ONLY
 *                          `brain/cycles/themes/` and `brain/forge-dev/themes/`
 *                          (see `readThemeFiles` below). Never sees a project
 *                          or band KB's own themes.
 *   - `project-indexes` — `checkProjectBrainIndexes`; scans `brain/projects/*`.
 *   - `global`          — `checkReflectorLoss`; scans `_queue/done` —  an
 *                          advisory over the WHOLE queue, not scoped to any
 *                          single KB's brain dir. Never applicable per-KB.
 */
export type CheckScope = 'forge-themes' | 'project-indexes' | 'global';

export const CHECK_SCOPE: Readonly<Record<string, CheckScope>> = {
  checkFrontmatter: 'forge-themes',
  checkIndexSync: 'forge-themes',
  checkSourceLinks: 'forge-themes',
  checkStaleness: 'forge-themes',
  checkOrphans: 'forge-themes',
  checkProjectBrainIndexes: 'project-indexes',
  checkLengthSoftCap: 'forge-themes',
  checkContradictions: 'forge-themes',
  checkCategoryScope: 'forge-themes',
  checkReflectorLoss: 'global',
  checkDanglingEdges: 'forge-themes',
  checkDuplicateThemes: 'forge-themes',
};

const ALLOWED_CATEGORIES = new Set([
  'pattern',
  'antipattern',
  'decision',
  'operation',
  'reference',
]);

const REQUIRED_FRONTMATTER_FIELDS = [
  'title',
  'description',
  'category',
  'created_at',
  'updated_at',
];

const CATEGORY_TO_INDEX_FILE: Record<string, string> = {
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
const CATEGORY_TO_BRAIN_SUBDIR: Record<string, string> = {
  pattern: 'cycles',
  antipattern: 'cycles',
  operation: 'cycles',
  decision: 'forge-dev',
  reference: 'forge-dev',
};

/** The two forge-side theme directories, relative to `brain/`. */
const THEME_SUBDIRS = ['cycles', 'forge-dev'] as const;

// ---------- helpers ----------

function readThemeFiles(brainRoot: string): string[] {
  const files: string[] = [];
  if (!existsSync(brainRoot)) return files;

  // Forge-side themes live in two sub-wikis (three-brain model, ADR 018):
  // cycles/themes/ (Brain 2) and forge-dev/themes/ (Brain 1).
  for (const sub of THEME_SUBDIRS) {
    const dir = join(brainRoot, sub, 'themes');
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry === 'README.md' || !entry.endsWith('.md')) continue;
      files.push(join(dir, entry));
    }
  }

  // Project themes now live in <project-repo>/brain/themes/ (separate git repos).
  // They are not linted from forge-side; lint them inside the project repo instead.

  return files;
}

/** Absolute path to a theme slug if it exists in either forge-side theme dir. */
function findThemeBySlug(brainRoot: string, slug: string): string | null {
  for (const sub of THEME_SUBDIRS) {
    const candidate = join(brainRoot, sub, 'themes', `${slug}.md`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Lenient frontmatter parser — delegates to the ONE shared implementation in
 * cli/theme-frontmatter.ts (W7 FIX-B-KB: extracted so the deterministic
 * fixers in cli/brain-fix-auto.ts parse themes with the exact same lenient
 * fallback the lint checks use; the two used to disagree, so the fixer
 * refused the very theme lint had just flagged). Null only on a READ
 * failure — the parse itself always produces a result (gray-matter first,
 * cache-bypassed; regex line-extractor fallback on YAML failure, e.g. an
 * unquoted `:` in a description value).
 */
function parseTheme(file: string): ParsedThemeFile | null {
  return parseThemeFile(file);
}

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

function readIndexEntries(indexFile: string): string[] {
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

// ---------- checkSourceLinks ----------

/** Extract relative-link targets and wikilink slugs from a theme body. */
/**
 * Every on-disk link target a body names: relative markdown link targets
 * (anchors stripped, `http(s)`/`mailto:`/bare-`#` skipped) and wikilink slugs,
 * in document order.
 *
 * Exported because the KB drain's edit-soundness audit
 * (cli/kb-drain-edit-soundness.ts) must extract link targets EXACTLY the way
 * `checkSourceLinks` does — a second extractor that disagreed about what
 * counts as a link would let the audit miss the very repoint it exists to
 * refuse.
 */
export function extractLinks(body: string): { relLinks: string[]; wikilinks: string[] } {
  const relLinks: string[] = [];
  const wikilinks: string[] = [];

  // Markdown links: [text](path)
  const mdRe = /\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(body)) !== null) {
    const target = m[1].split(' ')[0].trim();
    if (target.startsWith('http://') || target.startsWith('https://')) continue;
    if (target.startsWith('#')) continue;
    if (target.startsWith('mailto:')) continue;
    // Strip anchor fragments.
    const path = target.split('#')[0];
    if (path) relLinks.push(path);
  }

  // Wikilinks: [[slug]]
  const wikiRe = /\[\[([^\]]+)\]\]/g;
  while ((m = wikiRe.exec(body)) !== null) {
    wikilinks.push(m[1].trim());
  }

  return { relLinks, wikilinks };
}

export function checkSourceLinks(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');

  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const dir = dirname(file);
    const { relLinks, wikilinks } = extractLinks(parsed.content);

    for (const link of relLinks) {
      // Resolve relative to the theme file.
      const target = resolve(dir, link);
      if (!existsSync(target)) {
        findings.push({
          category: 'error',
          file,
          message: `broken link: ${link}`,
          check: 'checkSourceLinks',
        });
      }
    }

    for (const slug of wikilinks) {
      // Resolve against either forge-side theme dir (cycles/ or forge-dev/).
      // Project themes (Brain 3) live in separate repos — not resolvable here.
      const hit = findThemeBySlug(brainRoot, slug) !== null;
      if (!hit) {
        findings.push({
          category: 'error',
          file,
          message: `broken wikilink: [[${slug}]]`,
          check: 'checkSourceLinks',
        });
      }
    }
  }

  return findings;
}

// ---------- checkStaleness ----------

/**
 * For each theme citing a path in `## Sources` (or anywhere in the body):
 * - For project themes (`brain/projects/<n>/themes/<file>.md`): resolve the
 *   project repo path as `<forgeRoot>/projects/<n>/`. If the path exists, OK.
 *   If the path is missing AND the project repo exists, flag as stale.
 * - For forge themes: resolve relative to `<forgeRoot>/`. Flag missing files
 *   that look like source paths.
 *
 * Citations are detected as backtick-wrapped paths that look like file paths:
 *   `src/foo.ts` `orchestrator/cycle.ts` `tests/x.test.ts`
 */
function extractCitedPaths(content: string): string[] {
  const out: string[] = [];
  // Backtick-wrapped path-looking strings.
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const s = m[1].trim();
    // Heuristic: looks like a path (has a / and a . extension) and doesn't look
    // like a code snippet (no spaces, no parens).
    if (s.includes('/') && /\.[a-zA-Z0-9]+$/.test(s) && !s.includes(' ') && !s.includes('(')) {
      out.push(s);
    }
  }
  return out;
}

export function checkStaleness(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');

  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const cited = extractCitedPaths(parsed.content);
    if (cited.length === 0) continue;

    for (const p of cited) {
      // Skip URLs and absolute-system paths.
      if (p.startsWith('http://') || p.startsWith('https://')) continue;
      if (p.startsWith('/')) continue;

      // Skip references to forge brain paths themselves — those are linked,
      // and checkSourceLinks already handles those.
      if (p.startsWith('brain/')) continue;
      if (p.startsWith('docs/') || p.startsWith('orchestrator/') || p.startsWith('skills/') || p.startsWith('loops/')) {
        // Forge-internal path. Resolve against forge root.
        const target = resolve(forgeRoot, p);
        if (!existsSync(target)) {
          findings.push({
            category: 'flag',
            file,
            message: `stale citation (missing): ${p}`,
            check: 'checkStaleness',
          });
        }
        continue;
      }
      // Project-scoped citations can't be verified from the forge side —
      // project themes (Brain 3) live in their own repos. Skip them.
    }
  }

  return findings;
}

// ---------- checkOrphans ----------

function collectIndexLinkTargets(brainRoot: string): Set<string> {
  const targets = new Set<string>();
  const indexFiles: string[] = [];

  const topIndex = join(brainRoot, 'INDEX.md');
  if (existsSync(topIndex)) indexFiles.push(topIndex);

  // cycles/ category indexes
  const cyclesDir = join(brainRoot, 'cycles');
  if (existsSync(cyclesDir)) {
    for (const entry of readdirSync(cyclesDir)) {
      if (entry.endsWith('.md')) indexFiles.push(join(cyclesDir, entry));
    }
  }

  // forge-dev/ index files
  const forgeDevDir = join(brainRoot, 'forge-dev');
  if (existsSync(forgeDevDir)) {
    for (const entry of readdirSync(forgeDevDir)) {
      if (entry.endsWith('.md')) indexFiles.push(join(forgeDevDir, entry));
    }
  }

  // Project category indexes now live in separate repos; not scanned from forge.

  for (const f of indexFiles) {
    let body: string;
    try {
      body = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const dir = dirname(f);
    // Markdown links pointing at .md files under themes/ or forge/themes or projects/.../themes
    const mdRe = /\[[^\]]*\]\(([^)]+\.md[^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdRe.exec(body)) !== null) {
      const target = m[1].split('#')[0].trim();
      const resolved = resolve(dir, target);
      targets.add(resolved);
    }
  }

  return targets;
}

export function checkOrphans(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');
  const reachable = collectIndexLinkTargets(brainRoot);
  for (const file of readThemeFiles(brainRoot)) {
    if (!reachable.has(file)) {
      findings.push({
        category: 'flag',
        file,
        message: 'orphan: not linked from INDEX.md or any category/profile index',
        check: 'checkOrphans',
      });
    }
  }
  return findings;
}

// ---------- checkLengthSoftCap ----------

export function checkLengthSoftCap(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');
  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    // Count BODY lines only (post-frontmatter). The cap measures how long the
    // page is to read; YAML frontmatter is structured metadata (description +
    // keywords feed brain-query relevance) and shouldn't count against prose.
    const lines = parsed.content.replace(/\n+$/, '').split('\n').length;
    if (lines > 100) {
      findings.push({
        category: 'error',
        file,
        message: `theme too long: ${lines} body lines (hard cap 100)`,
        check: 'checkLengthSoftCap',
      });
    } else if (lines > 60) {
      findings.push({
        category: 'flag',
        file,
        message: `theme over soft cap: ${lines} body lines (> 60)`,
        check: 'checkLengthSoftCap',
      });
    }
  }
  return findings;
}

// ---------- checkCleanupCandidates (S6A — retention-aware) ----------

/**
 * S6A — surface cleanup candidates by reading each cycle archive's
 * `retention` frontmatter (written by the reflector + post-processed by
 * `orchestrator/cycle-retention.ts`). Tiers:
 *
 *   - `routine`     ⇒ Tier B (archive-and-summarise eligible if older
 *                     than CLEANUP_ROUTINE_MIN_AGE_DAYS).
 *   - `load-bearing` ⇒ Tier C (never auto). Surfaced as info-level so the
 *                     operator can see it in cleanup-dry-run output.
 *   - `interesting` ⇒ tier-A-ish (keep verbatim; not a cleanup candidate).
 *   - missing       ⇒ "pre-S6A archive, manual triage".
 *
 * Only fires when scope is `cleanup-dry-run` (caller-filtered in
 * `filterFindingsByScope`). All findings are `flag` category — this check
 * never errors.
 */
const CLEANUP_ROUTINE_MIN_AGE_DAYS = 30;

export function checkCleanupCandidates(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const cyclesDir = cyclesRawDir(forgeRoot);
  if (!existsSync(cyclesDir)) return findings;
  let entries: string[];
  try {
    entries = readdirSync(cyclesDir);
  } catch {
    return findings;
  }
  const nowMs = Date.now();
  const ageMs = CLEANUP_ROUTINE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const full = join(cyclesDir, file);
    let raw: string;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let mtimeMs: number;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch {
      mtimeMs = nowMs;
    }
    const fmEnd = raw.indexOf('\n---', 4);
    if (fmEnd === -1) {
      findings.push({
        category: 'flag',
        file: full,
        message: 'cleanup: pre-S6A archive, manual triage (no frontmatter)',
        check: 'checkCleanupCandidates',
      });
      continue;
    }
    const fmBlock = raw.slice(4, fmEnd);
    let retention: string | null = null;
    for (const line of fmBlock.split(/\r?\n/)) {
      const m = line.match(/^retention:\s*(.*)$/);
      if (m) {
        retention = m[1].trim();
        break;
      }
    }
    if (!retention || retention === 'auto') {
      findings.push({
        category: 'flag',
        file: full,
        message: 'cleanup: pre-S6A archive or placeholder retention, manual triage',
        check: 'checkCleanupCandidates',
      });
      continue;
    }
    if (retention === 'load-bearing') {
      findings.push({
        category: 'flag',
        file: full,
        message: 'cleanup: tier-C (load-bearing — never auto)',
        check: 'checkCleanupCandidates',
      });
      continue;
    }
    if (retention === 'routine' && nowMs - mtimeMs > ageMs) {
      findings.push({
        category: 'flag',
        file: full,
        message: `cleanup: tier-B (routine, > ${CLEANUP_ROUTINE_MIN_AGE_DAYS} days old — archive-and-summarise eligible)`,
        check: 'checkCleanupCandidates',
      });
    }
    // `interesting` and recent `routine`: not surfaced.
  }
  return findings;
}

// ---------- checkContradictions (warn-only stretch) ----------

export function checkContradictions(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const brainRoot = join(forgeRoot, 'brain');

  type ThemeMeta = {
    file: string;
    category: string;
    keywords: string[];
  };

  const themes: ThemeMeta[] = [];
  for (const file of readThemeFiles(brainRoot)) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const kw = Array.isArray(parsed.data.keywords) ? parsed.data.keywords.map(String) : [];
    themes.push({ file, category: String(parsed.data.category ?? ''), keywords: kw });
  }

  const seen = new Set<string>();
  for (let i = 0; i < themes.length; i++) {
    for (let j = i + 1; j < themes.length; j++) {
      const a = themes[i];
      const b = themes[j];
      const aIsPattern = a.category === 'pattern' || a.file.includes('-pattern');
      const aIsAnti = a.category === 'antipattern' || a.file.includes('-antipattern');
      const bIsPattern = b.category === 'pattern' || b.file.includes('-pattern');
      const bIsAnti = b.category === 'antipattern' || b.file.includes('-antipattern');
      const opposing = (aIsPattern && bIsAnti) || (aIsAnti && bIsPattern);
      if (!opposing) continue;

      const overlap = a.keywords.filter((k) => b.keywords.includes(k));
      if (overlap.length >= 3) {
        const key = [a.file, b.file].sort().join('::');
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          category: 'flag',
          file: a.file,
          message: `possible contradiction with ${relative(forgeRoot, b.file)} (${overlap.length} keyword overlaps: ${overlap.slice(0, 5).join(', ')})`,
          check: 'checkContradictions',
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

    // Derive the actual brain sub-wiki from the file's path
    // file is: <brainRoot>/<subdir>/themes/<slug>.md
    const rel = file.slice(brainRoot.length).replace(/\\/g, '/');
    // rel looks like /cycles/themes/foo.md or /forge-dev/themes/foo.md
    const parts = rel.split('/').filter(Boolean); // ['cycles','themes','foo.md']
    const actualSubdir = parts[0] ?? '';

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
  for (const sub of THEME_SUBDIRS) {
    addDir(join(brainRoot, sub, 'themes'));
  }
  const projectsRoot = join(brainRoot, 'projects');
  if (existsSync(projectsRoot)) {
    for (const name of readdirSync(projectsRoot)) {
      if (name.startsWith('.')) continue; // skip `.staging-<id>-*` leftovers, same guard as checkProjectBrainIndexes
      addDir(join(projectsRoot, name, 'themes'));
    }
  }
  return targets;
}

/**
 * The same universe as a bare slug SET.
 *
 * DERIVED from `collectThemeSlugTargets`, never a second walk: the KB drain's
 * edit-soundness audit (cli/kb-drain-edit-soundness.ts) needs the target PATHS
 * to decide whether an edit destroyed a real edge, and a second, narrower
 * derivation answering "does this theme exist?" is exactly how drain-to-green
 * came to delete a valid `related_themes` edge whose target sat in the same
 * directory (forge-d8l). One walk, two views.
 */
function collectAllThemeSlugs(brainRoot: string): Set<string> {
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
function danglingEdgeFindings(files: string[], knownSlugs: ReadonlySet<string>): Finding[] {
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
function duplicateThemeFindings(files: string[]): Finding[] {
  type ThemeDupMeta = { file: string; normTitle: string; keywords: Set<string> };
  const metas: ThemeDupMeta[] = [];
  for (const file of files) {
    const parsed = parseTheme(file);
    if (!parsed) continue;
    const kwArr = Array.isArray(parsed.data.keywords) ? parsed.data.keywords.map(String) : [];
    metas.push({
      file,
      normTitle: normalizeThemeTitle(parsed.data.title),
      keywords: new Set(kwArr),
    });
  }

  const findings: Finding[] = [];
  const seenPairs = new Set<string>();
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const a = metas[i];
      const b = metas[j];

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

// ---------- lintThemeFiles (explicit file list, project-aware) ----------

/**
 * R4-09-F5 — structurally lint an EXPLICIT list of theme files, regardless of
 * which brain sub-wiki they live in (including `brain/projects/<name>/themes/`,
 * which the shared checks never scan via `readThemeFiles`). Used by the
 * post-cycle KB-health dispatcher to give a REAL per-KB lint of exactly the
 * themes a reflect run just wrote — scoped to those files so historical themes
 * are never touched (no repo-wide red), and project-aware so a project theme's
 * content is actually validated (the finding that a project KB's declared lint
 * was structurally vacuous).
 *
 * Emits findings with the SAME `check`/`message` shapes the shared checks use,
 * so `classify` + `applyAutoFixes` recognise them. Deliberately runs only the
 * checks that are unambiguously correct per-file for BOTH forge and project
 * themes: required frontmatter, category-value whitelist, date order, broken
 * relative links, category→sub-wiki routing (forge themes only — project
 * themes are exempt per the reflector contract), and category-index sync.
 * Wikilink resolution is skipped (a project theme legitimately links project
 * siblings the forge-side resolver can't see — checking it here would false-
 * positive), matching the shared `checkSourceLinks`' own project caveat.
 */
/**
 * R6-08 4on (F1 hardening); extended R4-19-F2 — the exact `check` names
 * `lintThemeFiles` (below) emits findings under: `checkFrontmatter`,
 * `checkSourceLinks`, `checkCategoryScope`, `checkIndexSync`,
 * `checkDanglingEdges`, `checkDuplicateThemes` (mirrors the `check:` literals
 * in the function body — never `checkStaleness`/`checkOrphans`/
 * `checkLengthSoftCap`/`checkContradictions`/`checkProjectBrainIndexes`/
 * `checkReflectorLoss`, which `lintThemeFiles` does not implement). A per-KB
 * consumer (`buildKbHealth`) uses this to know which checks get a REAL
 * verdict from a KB's OWN theme files even when the shared
 * `readThemeFiles`-based full-scope checks never see that KB's brain dir
 * (project/band KBs) — the fix for the declared-data-fails-open defect where
 * those checks silently reported `pass`. `checkDanglingEdges` and
 * `checkDuplicateThemes` are meaningful per-KB regardless of KB type (a
 * dangling `related_themes` entry or a near-duplicate pair is just as real
 * inside one KB's own theme set), unlike `checkCategoryScope` below.
 */
// The per-KB checks lintThemeFiles gives a REAL verdict on for a KB's OWN
// themes, regardless of KB type. checkCategoryScope is deliberately EXCLUDED:
// the category→sub-wiki routing rule (pattern→cycles, decision→forge-dev) is a
// three-brain (ADR 018) convention that governs ONLY the forge brains, so it is
// meaningful per-KB solely for the forge KBs (cycles/forge-dev) via the
// forge-themes scoped path. Running it over a band/flow KB's own themes would
// false-FAIL every category-bearing theme (lintThemeFiles exempts only
// `projects` themes from the routing check); the Health tab reports it 'n/a'
// for every non-forge KB instead.
export const LINT_THEME_FILE_CHECKS: ReadonlySet<string> = new Set([
  'checkFrontmatter',
  'checkSourceLinks',
  'checkIndexSync',
  'checkDanglingEdges',
  'checkDuplicateThemes',
]);

export function lintThemeFiles(forgeRoot: string, files: string[]): Finding[] {
  const brainRoot = join(forgeRoot, 'brain');
  const findings: Finding[] = [];
  for (const file of files) {
    const parsed = parseTheme(file);
    if (!parsed) {
      findings.push({ category: 'error', file, message: 'unparseable frontmatter (gray-matter failed)', check: 'checkFrontmatter' });
      continue;
    }
    const { data } = parsed;
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        findings.push({ category: 'error', file, message: `missing required frontmatter field: ${field}`, check: 'checkFrontmatter' });
      }
    }
    const cat = String(data.category ?? '');
    if (data.category && !ALLOWED_CATEGORIES.has(cat)) {
      findings.push({ category: 'error', file, message: `category "${data.category}" not in whitelist {${[...ALLOWED_CATEGORIES].join('|')}}`, check: 'checkFrontmatter' });
    }
    if (data.created_at && data.updated_at) {
      const c = new Date(String(data.created_at)).getTime();
      const u = new Date(String(data.updated_at)).getTime();
      if (!Number.isNaN(c) && !Number.isNaN(u) && c > u) {
        findings.push({ category: 'error', file, message: 'created_at > updated_at', check: 'checkFrontmatter' });
      }
    }
    for (const link of extractLinks(parsed.content).relLinks) {
      if (!existsSync(resolve(dirname(file), link))) {
        findings.push({ category: 'error', file, message: `broken link: ${link}`, check: 'checkSourceLinks' });
      }
    }
    // Locate the file's brain sub-wiki: forge → brain/<subdir>/themes/…,
    // project → brain/projects/<name>/themes/…
    const rel = file.slice(brainRoot.length).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    const actualSubdir = parts[0] ?? '';
    const isProjectTheme = actualSubdir === 'projects';
    // checkCategoryScope governs ONLY the forge sub-wikis (three-brain
    // routing, ADR 018) — see LINT_THEME_FILE_CHECKS's own exclusion note.
    // W7 FIX-B-KB: this used to fire for ANY non-`projects` location, so a
    // top-level scratch/flow/band KB's category-bearing themes were all
    // flagged mis-routed — an AUTO-tier finding whose fixer (`fixMisRouted`,
    // cli/brain-fix-auto.ts) git-mv's the file into brain/cycles|forge-dev,
    // i.e. a scratch KB's own themes migrating into the real forge brains.
    const isForgeTheme = (THEME_SUBDIRS as readonly string[]).includes(actualSubdir);
    if (isForgeTheme && ALLOWED_CATEGORIES.has(cat)) {
      const expected = CATEGORY_TO_BRAIN_SUBDIR[cat];
      if (expected && actualSubdir !== expected) {
        findings.push({
          category: 'error',
          file,
          message: `category "${cat}" belongs in brain/${expected}/themes/ but this file is in brain/${actualSubdir}/themes/ (category→brain routing: ${cat}→${expected})`,
          check: 'checkCategoryScope',
        });
      }
    }
    if (ALLOWED_CATEGORIES.has(cat)) {
      const indexFile = CATEGORY_TO_INDEX_FILE[cat];
      if (indexFile) {
        const indexDir = isProjectTheme ? join(brainRoot, 'projects', parts[1] ?? '') : join(brainRoot, actualSubdir);
        const indexPath = join(indexDir, indexFile);
        if (!existsSync(indexPath)) {
          findings.push({ category: 'flag', file, message: `category index missing: ${relative(forgeRoot, indexPath)}`, check: 'checkIndexSync' });
        } else {
          const slug = basename(file, '.md');
          const hit = readIndexEntries(indexPath).filter((e) => e === slug).length;
          if (hit === 0) findings.push({ category: 'flag', file, message: `not listed in category index: ${relative(forgeRoot, indexPath)}`, check: 'checkIndexSync' });
          else if (hit > 1) findings.push({ category: 'flag', file, message: `listed ${hit} times in category index: ${relative(forgeRoot, indexPath)}`, check: 'checkIndexSync' });
        }
      }
    }
  }

  // checkDanglingEdges — the slug universe is ALL brain theme basenames, NOT
  // just the supplied `files` list: a project KB's theme legitimately
  // references a forge theme (or vice versa), so scoping the universe to
  // `files` alone would false-positive on every cross-KB related_themes edge.
  // Shares the exact same core `checkDanglingEdges` (full-scope) uses.
  const knownSlugs = collectAllThemeSlugs(brainRoot);
  findings.push(...danglingEdgeFindings(files, knownSlugs));

  // checkDuplicateThemes — scoped to exactly the supplied `files` list: a
  // per-KB duplicate scan naturally only compares that KB's own themes
  // against each other. Shares the exact same core `checkDuplicateThemes`
  // (full-scope) uses.
  findings.push(...duplicateThemeFindings(files));

  return findings;
}

// ---------- checkReflectorLoss ----------

/**
 * 9. checkReflectorLoss — advisory only (S6-follow-on). Nothing else diffs
 * completed initiatives against the reflection archive, so a reflector
 * crash/skip on a merged initiative goes unnoticed until someone audits
 * `_queue/done/` by hand (10 initiatives lost reflection in the 2026-07
 * betterado roadmap wave with zero signal at the time).
 *
 * For every manifest under `_queue/done/`, flag when no file in
 * `brain/cycles/_raw/` matches its initiative id. The scheduler always
 * writes/moves a manifest as `<initiative_id>.md` (queue.ts `moveTo`
 * preserves the filename across states), so the filename stem IS the
 * initiative id — no frontmatter parse needed. Archives are named
 * `<timestamp>_<initiativeId>.md` (cycle.ts `newCycleId`); a reflector may
 * emit more than one archive per initiative (retries), so ANY match passes.
 *
 * `_queue/` is gitignored and may not exist at all (fresh checkout, CI) —
 * this is an instrument, not a guardrail, so it no-ops rather than erroring
 * when `_queue/done/` is absent.
 */
export function checkReflectorLoss(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];
  const doneDir = join(forgeRoot, '_queue', 'done');
  if (!existsSync(doneDir)) return findings;

  let entries: string[];
  try {
    entries = readdirSync(doneDir);
  } catch {
    return findings;
  }

  const cyclesDir = cyclesRawDir(forgeRoot);
  let archiveFiles: string[] = [];
  if (existsSync(cyclesDir)) {
    try {
      archiveFiles = readdirSync(cyclesDir);
    } catch {
      archiveFiles = [];
    }
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const manifestPath = join(doneDir, entry);
    const initiativeId = basename(entry, '.md');

    const hasArchive = archiveFiles.some(
      (f) => f.endsWith('.md') && f.endsWith(`_${initiativeId}.md`),
    );
    if (!hasArchive) {
      findings.push({
        category: 'flag',
        file: manifestPath,
        message: `no reflection archive found for ${initiativeId} in brain/cycles/_raw/`,
        check: 'checkReflectorLoss',
      });
    }
  }

  return findings;
}

// ---------- classification (resolution tier) ----------

/**
 * Classify a raw finding into a stable `kind` slug + a `resolution` tier (and,
 * for agent-tier findings, a targeted `fixHint`). Keyed on (check, message
 * discriminator) — NOT check alone, because checkFrontmatter + checkIndexSync
 * each span multiple tiers depending on which branch fired (a missing-date field
 * is `auto`, a missing-description field is `agent`, a bad category is `user`).
 *
 * Pure + the single source of truth for the AUTO/AGENT/USER split the
 * lint-resolution UI dispatches on. Unknown findings default to `user` (safest —
 * surfaces for a human rather than silently auto-editing the brain).
 */
export function classifyFinding(f: Finding): { kind: string; resolution: Resolution; fixHint?: string } {
  const msg = f.message;
  switch (f.check) {
    case 'checkFrontmatter':
      if (/unparseable/.test(msg)) return { kind: 'frontmatter.unparseable', resolution: 'agent', fixHint: 'Re-author the YAML frontmatter block from the theme body (title, description, category, created_at, updated_at).' };
      if (/missing required frontmatter field: (created_at|updated_at)/.test(msg)) return { kind: 'frontmatter.missing-date', resolution: 'auto' };
      if (/missing required frontmatter field:/.test(msg)) return { kind: 'frontmatter.missing-field', resolution: 'agent', fixHint: 'Infer the missing field (title/description) from the theme body and add it to the frontmatter.' };
      if (/not in whitelist/.test(msg)) return { kind: 'frontmatter.bad-category', resolution: 'user' };
      if (/created_at > updated_at/.test(msg)) return { kind: 'frontmatter.date-order', resolution: 'auto' };
      return { kind: 'frontmatter.other', resolution: 'user' };
    case 'checkIndexSync':
      if (/category index missing/.test(msg)) return { kind: 'index.missing', resolution: 'agent', fixHint: 'Create the missing category index file with a heading and a link to each theme of this category.' };
      if (/not listed/.test(msg)) return { kind: 'index.not-listed', resolution: 'auto' };
      if (/listed \d+ times/.test(msg)) return { kind: 'index.duplicate', resolution: 'auto' };
      return { kind: 'index.other', resolution: 'auto' };
    case 'checkSourceLinks':
      if (/broken wikilink/.test(msg)) return { kind: 'links.broken-wikilink', resolution: 'agent', fixHint: 'Repoint the [[wikilink]] to the correct existing theme slug; if no unambiguous match exists, report unresolved.' };
      return { kind: 'links.broken', resolution: 'agent', fixHint: 'Repoint the broken relative link to the moved file; if no unambiguous target exists, report unresolved.' };
    case 'checkStaleness':
      return { kind: 'staleness.missing', resolution: 'agent', fixHint: 'Repoint the stale cited path to where the file moved; if the cited thing is genuinely gone, report unresolved so the operator can decide.' };
    case 'checkOrphans':
      return { kind: 'orphan', resolution: 'auto' };
    case 'checkLengthSoftCap':
      if (/hard cap/.test(msg)) return { kind: 'length.hard-cap', resolution: 'agent', fixHint: 'Condense the theme under 100 body lines (tighten prose; do not drop load-bearing facts).' };
      return { kind: 'length.soft-cap', resolution: 'agent', fixHint: 'Condense the theme toward 60 body lines without losing substance.' };
    case 'checkContradictions':
      return { kind: 'contradiction', resolution: 'user' };
    case 'checkCategoryScope':
      return { kind: 'category.mis-routed', resolution: 'auto' };
    case 'checkCleanupCandidates':
      if (/tier-C|load-bearing/.test(msg)) return { kind: 'cleanup.load-bearing', resolution: 'user' };
      if (/tier-B/.test(msg)) return { kind: 'cleanup.routine', resolution: 'user' };
      return { kind: 'cleanup.untriaged', resolution: 'user' };
    case 'checkReflectorLoss':
      return { kind: 'reflector.loss', resolution: 'user' };
    case 'checkProjectBrainIndexes':
      return { kind: 'index.project', resolution: 'agent', fixHint: 'In the project brain dir (brain/projects/<name>/), ensure this theme is listed exactly once under its category index (patterns/antipatterns/decisions/reference.md), creating the index from the cycles-index template if absent.' };
    case 'checkDanglingEdges':
      return { kind: 'edge.dangling', resolution: 'agent', fixHint: 'Repoint the related_themes entry at the correct existing slug (very often the same title carrying a date prefix), or drop the entry entirely if the target theme is genuinely gone.' };
    case 'checkDuplicateThemes':
      return { kind: 'theme.duplicate', resolution: 'agent', fixHint: 'Keep the richer file as survivor, fold in any unique facts from the other file, repoint related_themes/wikilinks/index entries at the survivor, then delete the loser.' };
    default:
      return { kind: 'unknown', resolution: 'user' };
  }
}

/** Stamp `kind` + `resolution` (+ `fixHint`) onto a finding via classifyFinding. */
export function classify(f: Finding): Finding {
  const { kind, resolution, fixHint } = classifyFinding(f);
  return { ...f, kind, resolution, fixHint };
}

/** Tally findings by resolution tier — drives the lint-resolution UI's stage counts. */
export function resolutionCounts(findings: Finding[]): { auto: number; agent: number; user: number } {
  const counts = { auto: 0, agent: 0, user: 0 };
  for (const f of findings) {
    const r = f.resolution ?? classifyFinding(f).resolution;
    counts[r] += 1;
  }
  return counts;
}

// ---------- runBrainLint ----------

function filterFindingsByScope(
  findings: Finding[],
  opts: RunBrainLintOptions,
): Finding[] {
  const brainRoot = join(opts.cwd, 'brain');
  switch (opts.scope) {
    case 'full':
      return findings;
    case 'forge-only': {
      // Forge-side themes live in both forge sub-wikis (three-brain model):
      // brain/cycles/themes/ (Brain 2) and brain/forge-dev/themes/ (Brain 1).
      const prefixes = THEME_SUBDIRS.map((sub) => join(brainRoot, sub) + sep);
      return findings.filter((f) =>
        prefixes.some(
          (p) => f.file.startsWith(p) || f.file.startsWith(p.replace(/\//g, '\\')),
        ),
      );
    }
    case 'project-only': {
      // Project themes now live in separate repos (three-brain restructure 2026-05-26).
      // Forge-side brain-lint does not scan project themes; this scope returns empty.
      return [];
    }
    case 'single-file': {
      if (!opts.file) return findings;
      const target = resolve(opts.cwd, opts.file);
      return findings.filter((f) => f.file === target);
    }
    case 'cycle-touched-themes': {
      if (!opts.cycle) return findings;
      const cycleId = opts.cycle;
      // Re-walk themes; only keep findings whose theme references this cycle.
      const touched = new Set<string>();
      for (const file of readThemeFiles(brainRoot)) {
        let body: string;
        try {
          body = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        if (body.includes(`cycles/_raw/${cycleId}`) || body.includes(cycleId)) {
          touched.add(file);
        }
      }
      return findings.filter((f) => touched.has(f.file));
    }
    case 'cleanup-dry-run':
      // Inventory-only: surface contamination + orphans + length warnings, no errors.
      return findings;
    default:
      return findings;
  }
}

export function runBrainLint(opts: RunBrainLintOptions): RunBrainLintResult {
  // Run all checks via the FULL_SCOPE_CHECKS registry (F3 hardening) — same
  // 10 checks, same order as before this refactor, now iterated from the ONE
  // array CHECK_NAMES is also derived from, so the two can never drift. The
  // scope filter is applied afterwards.
  const allFindings: Finding[] = [
    ...FULL_SCOPE_CHECKS.flatMap(([, fn]) => fn(opts.cwd)),
    // S6A — cleanup-candidates only contributes when scope is
    // `cleanup-dry-run`; filterFindingsByScope drops everything else.
    ...(opts.scope === 'cleanup-dry-run' ? checkCleanupCandidates(opts.cwd) : []),
  ];

  let findings = filterFindingsByScope(allFindings, opts).map(classify);

  // cleanup-dry-run never errors — it is inventory.
  if (opts.scope === 'cleanup-dry-run') {
    findings = findings.map((f) =>
      f.category === 'error' ? { ...f, category: 'flag' as FindingCategory } : f,
    );
  }

  // --fix mode: apply the deterministic AUTO-tier fixers to a FIXED POINT (one
  // fix can surface the next — e.g. a git-mv then needs an index re-link), then
  // re-lint so the returned findings + exitCode reflect what remains (agent/user).
  if (opts.fix) {
    applyAutoFixesUntilStable(opts.cwd);
    return runBrainLint({ ...opts, fix: false });
  }

  const hasError = findings.some((f) => f.category === 'error');
  return { findings, exitCode: hasError ? 1 : 0 };
}

// ---------- applyAutoFixesUntilStable ----------

export type AutoFixStableResult = {
  applied: Array<{ kind: string; file: string; detail: string }>;
  skipped: Array<{ kind: string; file: string; reason: string }>;
  /** How many apply rounds ran before reaching a fixed point. */
  rounds: number;
  /** Classified findings after the loop (agent/user + any un-applyable auto). */
  remaining: Finding[];
};

/**
 * Apply the deterministic AUTO-tier fixers REPEATEDLY until no auto findings
 * remain or a round makes no progress (capped at maxRounds). Re-lints between
 * rounds because one fix surfaces the next — git-mv'ing a mis-routed theme then
 * leaves it unlinked (index.not-listed), etc. The operator's intent when they
 * ask to apply fixes is "resolve them", not "resolve one layer" — so this drains
 * the whole auto tier in a single call instead of needing repeat runs.
 *
 * `filter` scopes which findings are eligible (e.g. one kb); defaults to all.
 *
 * `extraFindings` (W7-B2, knowledge-10): an additional CLASSIFIED finding
 * source re-evaluated every round alongside the internal full-scope re-lint —
 * the per-KB own-theme lens (`ownThemeFindingsLens`, cli/kb-lint-summary.ts)
 * rides in here so a project/band KB's own auto-tier findings (which the
 * full-scope scan structurally never surfaces) are visible to the fixed-point
 * loop. Deduped against the full-scan findings by (check, file, message).
 */
export function applyAutoFixesUntilStable(
  forgeRoot: string,
  opts: { maxRounds?: number; filter?: (f: Finding) => boolean; extraFindings?: () => Finding[] } = {},
): AutoFixStableResult {
  const maxRounds = opts.maxRounds ?? 12;
  const filter = opts.filter ?? (() => true);
  const extraFindings = opts.extraFindings ?? (() => []);
  const identity = (f: Finding): string => `${f.check ?? ''}::${f.file}::${f.message}`;
  const lintOnce = (): Finding[] => {
    const base = runBrainLint({ cwd: forgeRoot, scope: 'full' }).findings;
    const seen = new Set(base.map(identity));
    const extras = extraFindings().filter((f) => !seen.has(identity(f)));
    return [...base, ...extras].filter(filter);
  };
  const applied: AutoFixStableResult['applied'] = [];
  const skipped: AutoFixStableResult['skipped'] = [];
  let rounds = 0;
  let remaining = lintOnce();
  while (rounds < maxRounds) {
    const auto = remaining.filter((f) => f.resolution === 'auto');
    if (auto.length === 0) break;
    const r = applyAutoFixes(forgeRoot, auto);
    rounds += 1;
    applied.push(...r.applied);
    skipped.push(...r.skipped);
    // No progress this round (everything skipped, e.g. a dirty worktree blocks a
    // git-mv) → stop rather than spin to the cap.
    if (r.applied.length === 0) break;
    remaining = lintOnce();
  }
  return { applied, skipped, rounds, remaining };
}

// ---------- pretty-print ----------

function formatFindings(findings: Finding[], cwd: string): string {
  if (findings.length === 0) return '(no findings)';
  const errors = findings.filter((f) => f.category === 'error');
  const flags = findings.filter((f) => f.category === 'flag');
  const fixes = findings.filter((f) => f.category === 'auto-fix');
  const out: string[] = [];
  for (const [label, group] of [
    ['ERRORS', errors],
    ['FLAGS', flags],
    ['AUTO-FIXES', fixes],
  ] as const) {
    if (group.length === 0) continue;
    out.push(`## ${label} (${group.length})`);
    for (const f of group) {
      out.push(`- [${f.check ?? 'check'}] ${relative(cwd, f.file)}: ${f.message}`);
    }
    out.push('');
  }
  out.push(`Summary: ${errors.length} error(s), ${flags.length} flag(s), ${fixes.length} auto-fix(es).`);
  return out.join('\n');
}

// ---------- CLI entry ----------

function parseArgs(argv: string[]): RunBrainLintOptions {
  const opts: RunBrainLintOptions = {
    cwd: resolve(import.meta.dirname, '..'),
    scope: 'full',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scope') {
      const v = argv[++i];
      const allowed: Scope[] = [
        'full',
        'forge-only',
        'project-only',
        'single-file',
        'cycle-touched-themes',
        'cleanup-dry-run',
      ];
      if (!allowed.includes(v as Scope)) {
        throw new Error(`unknown --scope: ${v}`);
      }
      opts.scope = v as Scope;
    } else if (a === '--project') {
      opts.project = argv[++i];
    } else if (a === '--file') {
      opts.file = argv[++i];
    } else if (a === '--cycle') {
      opts.cycle = argv[++i];
    } else if (a === '--fix') {
      opts.fix = true;
    } else if (a === '--cwd') {
      opts.cwd = resolve(argv[++i]);
    }
  }
  return opts;
}

const isCli = process.argv[1] && process.argv[1].endsWith('brain-lint.ts');
if (isCli) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = runBrainLint(opts);
    process.stdout.write(formatFindings(result.findings, opts.cwd) + '\n');
    process.exit(result.exitCode);
  } catch (err) {
    process.stderr.write(`brain-lint: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}
