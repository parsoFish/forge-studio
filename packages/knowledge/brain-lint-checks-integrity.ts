/**
 * Content-integrity checks — do a theme's own claims still hold? Its links
 * (`checkSourceLinks`), its citations of forge paths (`checkStaleness`), its
 * reachability from an index (`checkOrphans`), its length
 * (`checkLengthSoftCap`), its retention (`checkCleanupCandidates`), and the
 * reflector queue's own losses (`checkReflectorLoss`).
 *
 * Split out of `brain-lint.ts` (M4 step 4, the 800-line cap).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { cyclesRawDir } from './brain-paths.ts';
import { findThemeBySlug, isForgeTheme, isGroundClonePath, parseTheme, readThemeFiles, themeDirs } from './brain-lint-theme-paths.ts';
import type { Finding } from './brain-lint-types.ts';
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
      // A managed project's own repo is a GROUND CLONE under `projects/<name>/`
      // — gitignored, cloned on demand, absent in CI and in a fresh worktree.
      // ADR 035 keeps the brain forge-owned while the project stays a separate
      // repo, so forge cannot assert anything about that tree's contents: a
      // theme citing its project's source would flag or clear depending only on
      // whether the clone happened to be checked out, which is a gate that
      // reports on the environment rather than on the brain. Out of scope in
      // EVERY environment — the same bounding `checkStaleness` already applies
      // to citations outside docs/orchestrator/skills/loops.
      if (isGroundClonePath(forgeRoot, target)) continue;
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
      // Resolved against EVERY brain theme dir (`themeDirs`), so a Brain 3
      // theme's link to a sibling in its own project brain resolves — it used
      // to be searched for in the two forge sub-wikis only, which reported 317
      // of this corpus's live wikilinks as broken.
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
 * Top-level directories a FORGE theme's citation resolves against the forge
 * root. The set FOLLOWS THE TREE, and a test enforces that: `brain-lint.test.ts`
 * fails if the repo grows a tracked top-level source directory this set does not
 * name. That test is the point of the constant — the old inline list
 * (`docs/|orchestrator/|skills/|loops/`) was correct when it was written and
 * then silently stopped covering the tree, so every citation under `packages/`
 * and `apps/` went un-staleness-checked with nothing red (bead
 * `forge-8vfn.5.24`).
 *
 * Deliberately absent, each with its reason:
 *   `brain/`            — skipped earlier in `checkStaleness`; `checkSourceLinks` owns it
 *   `projects/`         — managed-project clones, absent on a cold checkout, so a
 *                         citation there would flag on one machine and not another
 *   `_logs/`, `_queue/`, `.forge/` — runtime state, not source. `.forge/` is
 *                         gitignored in this repo, so it is present on a
 *                         developer's checkout and absent on a fresh clone
 */
const FORGE_INTERNAL_PREFIXES = [
  '.claude/',
  '.github/',
  'apps/',
  'bin/',
  'cli/',
  'demos/',
  'docs/',
  'loops/',
  'orchestrator/',
  'packages/',
  'scripts/',
  'skills/',
  'studio/',
  'tests/',
] as const;

/** The exclusions above, exported so the coverage test asserts against ONE list. */
export const STALENESS_PREFIX_EXCLUSIONS = ['brain', 'projects', '_logs', '_queue', '.forge'] as const;

/** Every prefix a forge citation may resolve against. Exported for the coverage test. */
export const STALENESS_PREFIXES: readonly string[] = FORGE_INTERNAL_PREFIXES;


/**
 * For each theme citing a path in `## Sources` (or anywhere in the body):
 * - For FORGE themes: resolve relative to `<forgeRoot>/`. Flag missing files
 *   that look like source paths.
 * - For a theme in any OTHER brain — a project brain (ADR 035) or an
 *   operator-created KB — a bare `docs/…` citation names THAT project's docs,
 *   which live in its ground clone under `projects/<name>/`: gitignored,
 *   absent in CI, another repository's tree. Forge cannot resolve it, so it is
 *   not checked. Resolving it against the forge root instead produced 27 flags
 *   naming files that were sitting in the project all along —
 *   `brain/projects/trafficGame/themes/2026-05-10-*` cite `docs/LEARNINGS.md`,
 *   which is `projects/trafficGame/docs/LEARNINGS.md` and present, while forge
 *   has no such file. This is what the docblock above already described and
 *   the code never did.
 *
 * Citations are detected as backtick-wrapped paths that look like file paths:
 *   `src/foo.ts` `orchestrator/cycle.ts` `tests/x.test.ts`
 */
export function extractCitedPaths(content: string): string[] {
  const out: string[] = [];
  // Backtick-wrapped path-looking strings.
  const re = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const s = m[1].trim();
    // Heuristic: looks like a path (has a / and a . extension) and doesn't look
    // like a code snippet (no spaces, no parens).
    // A citation carrying a wildcard is a PATTERN, not a path — `scripts/*.mjs`
    // names a set, and existence-checking it would flag forever. Surfaced by
    // widening the staleness prefix set (bead `forge-8vfn.5.24`): `scripts/`
    // was previously unchecked, so this class had never been reachable.
    if (s.includes('*') || s.includes('?')) continue;
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

      // Only a FORGE theme's citation is a forge path (see the docblock).
      if (!isForgeTheme(brainRoot, file)) continue;
      if (FORGE_INTERNAL_PREFIXES.some((prefix) => p.startsWith(prefix))) {
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

  // A KB's index pages sit beside its `themes/` dir — for the forge sub-wikis
  // and, since ADR 035, for every project brain at `brain/projects/<name>/`
  // too. Derived from `themeDirs` so a KB whose themes are LINTED can never be
  // a KB whose indexes are unread: that mismatch is what made every Brain 3
  // theme look like an orphan.
  for (const dir of themeDirs(brainRoot)) {
    const kbDir = dirname(dir);
    for (const entry of readdirSync(kbDir)) {
      if (entry.endsWith('.md')) indexFiles.push(join(kbDir, entry));
    }
  }

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
