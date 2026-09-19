/**
 * Brain-lint truthfulness axis (forge-mfv5.3.4).
 *
 * Fix round 1 (d14-review.md) excludes forge-provenance citations (C1),
 * normalises the self-citation prefix (C2), blocks `../` escapes (M1), and
 * judges `antipattern` themes on declared `evidence:` only (M3) — an
 * antipattern's claim IS an absence. Root cause: checking every inline-code
 * span against the project checkout drove betterado's stale rate to 99%.
 *
 * Fix round 2 (d14-fix1-rereview.md, T2 ruling): most REMAINING "stale"
 * verdicts cited something that was never a tracked file (a token string, a
 * Go idiom, a module pin, a generated artifact). "Stale" now means "cited a
 * file the project once had, and no longer has": a currently-absent
 * reference only counts when `git log --all` finds it on some ref; a
 * never-tracked absence is dropped from `references` outright, not judged.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { parseTheme, readThemeDirFiles } from './brain-lint-theme-paths.ts';
import type { Finding } from './brain-lint-types.ts';

export type ThemeTruth = {
  file: string;
  status: 'current' | 'historical';
  references: string[];
  missing: string[];
};

export type BrainTruthRate = {
  project: string;
  checkout: 'present' | 'absent';
  history: 'present' | 'absent';
  themes: number;
  historical: number;
  verifiable: number;
  unverifiable: number;
  stale: number;
  rate: number | null;
};

/** First path segment naming one of these is forge provenance, not a project claim. */
export const FORGE_PROVENANCE_ROOTS = ['_logs', '_queue', '_worktrees', 'brain'] as const;

const FENCE_RE = /```[\s\S]*?```/g;
const SPAN_RE = /`([^`\n]+)`/g;
const FORBIDDEN_CHARS = /[*<>{$:]/;

/** One inline-code span → a repo-relative project-code reference, or null. */
function normalizeCandidate(raw: string): string | null {
  if (raw === '' || /\s/.test(raw)) return null;
  let candidate = raw;
  if (candidate.startsWith('./')) candidate = candidate.slice(2);
  else if (candidate.startsWith('/') || candidate.startsWith('~') || candidate.startsWith('http')) return null;
  if (candidate.startsWith('../') || candidate.includes('/../')) return null; // M1
  if (!candidate.includes('/') || FORBIDDEN_CHARS.test(candidate)) return null;
  if ((FORGE_PROVENANCE_ROOTS as readonly string[]).includes(candidate.split('/')[0])) return null; // C1
  const last = candidate.slice(candidate.lastIndexOf('/') + 1);
  if (!candidate.endsWith('/') && !last.includes('.')) return null;
  return candidate;
}

/** Non-empty `evidence:` is the complete reference set. `antipattern` (M3) is
 *  judged on `evidence:` alone, even empty/absent — its claim IS an absence. */
export function extractThemeReferences(body: string, frontmatter: Record<string, unknown>): string[] {
  const evidence = frontmatter.evidence;
  const hasEvidence = Array.isArray(evidence);
  if (frontmatter.category === 'antipattern') return hasEvidence ? [...(evidence as string[])] : [];
  if (hasEvidence && (evidence as string[]).length > 0) return [...(evidence as string[])];

  const seen = new Set<string>();
  const refs: string[] = [];
  for (const m of body.replace(FENCE_RE, '').matchAll(SPAN_RE)) {
    const candidate = normalizeCandidate(m[1]);
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      refs.push(candidate);
    }
  }
  return refs;
}

/** Is `checkoutRoot` inside a git work tree (its own repo, or nested inside
 *  one)? Any failure (not a repo at all) correctly reads as "no history". */
function isGitWorkTree(checkoutRoot: string): boolean {
  const r = spawnSync('git', ['-C', checkoutRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** Was `ref` ever committed to ANY ref (`--all`) in `checkoutRoot`'s history —
 *  tracked at some point, even on an unmerged branch? Only called for a ref
 *  already confirmed absent from the working tree. Empty output (exit 0) is
 *  the normal "never tracked" case; anything else is a real failure. */
function wasEverTracked(checkoutRoot: string, ref: string): boolean {
  const r = spawnSync('git', ['-C', checkoutRoot, 'log', '--all', '--format=%H', '-1', '--', ref], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`brain-lint-checks-truth: git log failed for "${ref}" in ${checkoutRoot}: ${r.stderr?.trim() || r.error?.message || `exit ${r.status}`}`);
  }
  return r.stdout.trim().length > 0;
}

/**
 * Every theme under `brain/projects/<project>/themes/`, and which cited
 * paths are absent from its checkout (C2: a `projects/<project>/`-prefixed
 * self-citation strips first; a foreign prefix does not). A candidate is
 * PRESENT if it exists in the working tree, MISSING if absent but once
 * tracked (`git log --all` finds it), or DROPPED if absent and never
 * tracked (or no git history at all) — never evidence of staleness.
 * `hasHistoryOverride` lets `projectTruthRows` skip a redundant `rev-parse`.
 */
export function themeTruth(cwd: string, project: string, hasHistoryOverride?: boolean): ThemeTruth[] {
  const themesDir = join(cwd, 'brain', 'projects', project, 'themes');
  const checkoutRoot = join(cwd, 'projects', project);
  const ownPrefix = `projects/${project}/`;
  const hasHistory = hasHistoryOverride ?? (existsSync(checkoutRoot) && isGitWorkTree(checkoutRoot));
  return readThemeDirFiles(themesDir).map((file) => {
    const parsed = parseTheme(file);
    const data = parsed?.data ?? {};
    const status: ThemeTruth['status'] = data.status === 'historical' ? 'historical' : 'current';
    const candidates = extractThemeReferences(parsed?.content ?? '', data).map((ref) =>
      ref.startsWith(ownPrefix) ? ref.slice(ownPrefix.length) : ref,
    );
    const references: string[] = [];
    const missing: string[] = [];
    for (const ref of candidates) {
      if (existsSync(join(checkoutRoot, ref))) {
        references.push(ref);
      } else if (hasHistory && wasEverTracked(checkoutRoot, ref)) {
        references.push(ref);
        missing.push(ref);
      }
      // else: never tracked (or no git history available) — dropped.
    }
    return { file, status, references, missing };
  });
}

type ProjectTruthRow = Pick<BrainTruthRate, 'project' | 'checkout' | 'history'> & { themes: ThemeTruth[] };

/** Process-lifetime memo, keyed by `cwd` — see `projectTruthRows` below for
 *  why. Never invalidated: nothing in this module writes to `brain/projects/`
 *  or a managed project's checkout, so within one process the rows for a
 *  given `cwd` cannot change after the first walk. */
const projectTruthRowsCache = new Map<string, ProjectTruthRow[]>();

/** Every project's checkout + history status and per-theme truth, walked
 *  ONCE — the shared basis `brainTruthRates`/`checkThemeTruth` build on, so
 *  each is defined in one place and `isGitWorkTree` runs once per project.
 *
 *  Memoised per `cwd` (module-level Map): `forge brain lint` calls this
 *  TWICE in one process today — once via the `checkThemeTruth` registry
 *  entry (`FULL_SCOPE_CHECKS`), once via the CLI's own unconditional
 *  `truthfulness:` rate lines (`brainTruthRates`, called after `runBrainLint`
 *  returns) — both walking the SAME git-backed rows for the SAME `cwd`. The
 *  `git log --all` spawn inside `wasEverTracked` is the expensive part; this
 *  cache halves it per invocation without changing what either caller sees. */
function projectTruthRows(cwd: string): ProjectTruthRow[] {
  const cached = projectTruthRowsCache.get(cwd);
  if (cached) return cached;
  const projectsRoot = join(cwd, 'brain', 'projects');
  const rows = !existsSync(projectsRoot)
    ? []
    : readdirSync(projectsRoot)
        .filter((n) => !n.startsWith('.'))
        .map((project) => {
          const checkoutRoot = join(cwd, 'projects', project);
          const checkout: BrainTruthRate['checkout'] = existsSync(checkoutRoot) ? 'present' : 'absent';
          const history: BrainTruthRate['history'] = checkout === 'present' && isGitWorkTree(checkoutRoot) ? 'present' : 'absent';
          return { project, checkout, history, themes: themeTruth(cwd, project, history === 'present') };
        });
  projectTruthRowsCache.set(cwd, rows);
  return rows;
}

/** One row per project, sorted by name. `verifiable`/`unverifiable`/`stale`
 *  count whatever `themeTruth` resolved (never `missing` without git — see
 *  above), so `stale` is naturally 0 with no history. `rate` is additionally
 *  gated on `history`: a rate claims "we know the true count", which no
 *  history to check absences against cannot claim — never guessed. */
export function brainTruthRates(cwd: string): BrainTruthRate[] {
  const rows = projectTruthRows(cwd).map(({ project, checkout, history, themes }): BrainTruthRate => {
    const historical = themes.filter((t) => t.status === 'historical').length;
    const current = checkout === 'present' ? themes.filter((t) => t.status === 'current') : [];
    const verifiable = current.filter((t) => t.references.length > 0);
    const stale = verifiable.filter((t) => t.missing.length > 0).length;
    return {
      project,
      checkout,
      history,
      themes: themes.length,
      historical,
      verifiable: verifiable.length,
      unverifiable: current.length - verifiable.length,
      stale,
      rate: history === 'present' && verifiable.length > 0 ? stale / verifiable.length : null,
    };
  });
  return rows.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
}

/** One `flag` finding per stale CURRENT theme in a project with a present
 *  checkout AND present git history — never `error`, never guessed. */
export function checkThemeTruth(cwd: string): Finding[] {
  return projectTruthRows(cwd)
    .filter((row) => row.checkout === 'present' && row.history === 'present')
    .flatMap((row) => row.themes)
    .filter((t) => t.status === 'current' && t.missing.length > 0)
    .map((t): Finding => ({
      category: 'flag',
      file: t.file,
      check: 'checkThemeTruth',
      message: `cites missing path(s): ${t.missing.join(', ')} — the theme may describe code that no longer exists`,
    }));
}

/** `truthfulness:` lines, one per row, printed unconditionally (M2: the
 *  caller pre-filters `rows` to scope the output to one project). */
export function formatTruthfulnessLines(rows: readonly BrainTruthRate[]): string[] {
  return rows.map((r) => {
    if (r.checkout === 'absent') return `truthfulness: ${r.project} — checkout absent, not judged`;
    const pct = r.verifiable > 0 ? Math.round((r.stale / r.verifiable) * 100) : 0;
    return `truthfulness: ${r.project} — ${r.stale}/${r.verifiable} stale (${pct}%) · ${r.unverifiable} unverifiable · ${r.historical} historical`;
  });
}
