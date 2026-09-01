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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, basename, sep } from 'node:path';

import { applyAutoFixes } from './brain-fix-auto.ts';

import type {
  Finding,
  FindingCategory,
  Resolution,
  RunBrainLintOptions,
  RunBrainLintResult,
  Scope,
} from './brain-lint-types.ts';
import { THEME_SUBDIRS, parseTheme, readThemeFiles } from './brain-lint-theme-paths.ts';
import {
  ALLOWED_CATEGORIES,
  CATEGORY_TO_BRAIN_SUBDIR,
  CATEGORY_TO_INDEX_FILE,
  REQUIRED_FRONTMATTER_FIELDS,
  checkCategoryScope,
  checkFrontmatter,
  checkIndexSync,
  checkProjectBrainIndexes,
  readIndexEntries,
} from './brain-lint-checks-filing.ts';
import {
  extractLinks,
  checkCleanupCandidates,
  checkLengthSoftCap,
  checkOrphans,
  checkReflectorLoss,
  checkSourceLinks,
  checkStaleness,
} from './brain-lint-checks-integrity.ts';
import {
  checkDanglingEdges,
  checkDuplicateThemes,
  collectAllThemeSlugs,
  danglingEdgeFindings,
  duplicateThemeFindings,
} from './brain-lint-checks-graph.ts';

// THE SPLIT KEPT THIS PATH (M4 step 4). 27 files across packages/, cli/, apps/
// and scripts/ import `brain-lint.ts` directly — `packages/knowledge/index.ts`
// is an intentionally empty barrel — so re-exporting here is what makes the
// split invisible to every one of them. What remains in this module is the
// CHECK REGISTRY and the run orchestration: which checks exist, which scan
// domain each covers, how a scope selects among them, and how a run is
// assembled, classified and printed.
export type {
  Finding,
  FindingCategory,
  Resolution,
  RunBrainLintOptions,
  RunBrainLintResult,
  Scope,
} from './brain-lint-types.ts';
export {
  THEME_SUBDIRS,
  findThemeBySlug,
  isForgeBrainDir,
  isForgeTheme,
  isGroundClonePath,
  parseTheme,
  readThemeFiles,
  themeDirs,
  themeScanFiles,
  themeSubdir,
} from './brain-lint-theme-paths.ts';
export {
  ALLOWED_CATEGORIES,
  CATEGORY_TO_BRAIN_SUBDIR,
  CATEGORY_TO_INDEX_FILE,
  REQUIRED_FRONTMATTER_FIELDS,
  checkCategoryScope,
  checkFrontmatter,
  checkIndexSync,
  checkProjectBrainIndexes,
} from './brain-lint-checks-filing.ts';
export {
  STALENESS_PREFIXES,
  STALENESS_PREFIX_EXCLUSIONS,
  checkCleanupCandidates,
  checkLengthSoftCap,
  checkOrphans,
  checkReflectorLoss,
  checkSourceLinks,
  checkStaleness,
  extractCitedPaths,
  extractLinks,
} from './brain-lint-checks-integrity.ts';
export {
  checkDanglingEdges,
  checkDuplicateThemes,
  collectAllThemeSlugs,
  collectThemeSlugTargets,
  danglingEdgeFindings,
  duplicateThemeFindings,
} from './brain-lint-checks-graph.ts';

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
 *   - `themes`          — `readThemeFiles`-based; scans EVERY theme dir
 *                          `themeScanDirs` yields, which since ADR 035
 *                          includes `brain/projects/<name>/themes/`. Applicable
 *                          to any KB whose own `themes/` dir the scan walks.
 *   - `forge-themes`    — `readThemeFiles`-based, but the rule itself is the
 *                          ADR 018 category→sub-wiki routing convention, which
 *                          governs `brain/cycles` and `brain/forge-dev` alone.
 *                          Genuinely inapplicable to any other KB — a project
 *                          brain indexes its own themes in its own dir and gets
 *                          its verdict from `checkProjectBrainIndexes`.
 *   - `project-indexes` — `checkProjectBrainIndexes`; scans `brain/projects/*`.
 *   - `global`          — `checkReflectorLoss`; scans `_queue/done` —  an
 *                          advisory over the WHOLE queue, not scoped to any
 *                          single KB's brain dir. Never applicable per-KB.
 *
 * The `themes`/`forge-themes` split is load-bearing for the honesty invariant.
 * Before it, all ten theme checks claimed the forge-only domain, which was true
 * of the scan but not of the rules — so a per-KB consumer could only report
 * `n/a` for a project brain on checks that in fact apply to it perfectly well.
 */
export type CheckScope = 'themes' | 'forge-themes' | 'project-indexes' | 'global';

export const CHECK_SCOPE: Readonly<Record<string, CheckScope>> = {
  checkFrontmatter: 'themes',
  checkIndexSync: 'forge-themes',
  checkSourceLinks: 'themes',
  checkStaleness: 'themes',
  checkOrphans: 'themes',
  checkProjectBrainIndexes: 'project-indexes',
  checkLengthSoftCap: 'themes',
  checkCategoryScope: 'forge-themes',
  checkReflectorLoss: 'global',
  checkDanglingEdges: 'themes',
  checkDuplicateThemes: 'themes',
};

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
 * `checkLengthSoftCap`/`checkProjectBrainIndexes`/
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
      // Brain 3 is forge-owned and central (ADR 035): `brain/projects/<name>/`.
      // This arm returned [] while that was still believed to live in the
      // managed project's own repo.
      const prefix = join(brainRoot, 'projects') + sep;
      return findings.filter((f) => f.file.startsWith(prefix));
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
 * It also took an `extraFindings` source (W7-B2, knowledge-10), through which
 * the per-KB own-theme lens rode in so a project KB's own auto-tier findings
 * were visible to the fixed-point loop — the full-scope scan structurally
 * never surfaced them. The scan covers every theme dir now (ADR 035), so that
 * option had no caller and no test; it is gone rather than left as a second
 * way for a finding to reach the fixers.
 */
export function applyAutoFixesUntilStable(
  forgeRoot: string,
  opts: { maxRounds?: number; filter?: (f: Finding) => boolean } = {},
): AutoFixStableResult {
  const maxRounds = opts.maxRounds ?? 12;
  const filter = opts.filter ?? (() => true);
  const lintOnce = (): Finding[] =>
    runBrainLint({ cwd: forgeRoot, scope: 'full' }).findings.filter(filter);
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
    cwd: resolve(import.meta.dirname, '..', '..'),
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
