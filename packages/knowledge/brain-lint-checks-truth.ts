// Why: design.md § Brain-lint truthfulness axis (forge-mfv5.3.4)

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveGuardedPath } from '@forge/kernel';
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
 *  judged on `evidence:` alone, even empty/absent — its claim IS an absence.
 *  Non-string entries are dropped (design.md § Brain-lint truthfulness axis). */
export function extractThemeReferences(body: string, frontmatter: Record<string, unknown>): string[] {
  const evidence = frontmatter.evidence;
  const stringEvidence = Array.isArray(evidence)
    ? evidence.filter((e): e is string => typeof e === 'string')
    : null;
  if (frontmatter.category === 'antipattern') return stringEvidence ?? [];
  if (stringEvidence && stringEvidence.length > 0) return stringEvidence;

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

/** Was `ref` ever committed to ANY ref (`--all`) in `checkoutRoot`'s history
 *  — only called for a ref already absent from the tree. Empty output (exit
 *  0) means never tracked; anything else is a real failure, never swallowed.
 *  `--literal-pathspecs` is load-bearing: `ref` is untrusted (design.md). */
function wasEverTracked(checkoutRoot: string, ref: string): boolean {
  const r = spawnSync(
    'git',
    ['-C', checkoutRoot, '--literal-pathspecs', 'log', '--all', '--format=%H', '-1', '--', ref],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`brain-lint-checks-truth: git log failed for "${ref}" in ${checkoutRoot}: ${r.stderr?.trim() || r.error?.message || `exit ${r.status}`}`);
  }
  return r.stdout.trim().length > 0;
}

// Why: design.md § Brain-lint truthfulness axis (forge-mfv5.3.4)
export function themeTruth(cwd: string, project: string, hasHistoryOverride?: boolean): ThemeTruth[] {
  const themesDir = join(cwd, 'brain', 'projects', project, 'themes');
  // SEC (forge-8vfn.5.33 CONTRACT): `cwd` is the forge root, passed straight
  // through as `root` — NEVER folded into a join()-built root a probe then
  // trusts (the "caller-built root" escape path-guard.ts's own docs warn
  // about, and packages/kernel/tests/regression/path-guard-caller-built-root-ratchet.test.ts
  // ratchets). `'projects'`, `project` (readdir-derived, trusted) and every
  // `ref` (theme frontmatter `evidence:` / body span, UNTRUSTED — evidence:
  // is returned verbatim by extractThemeReferences, bypassing
  // normalizeCandidate's own M1 traversal filter) go through as GUARD
  // SEGMENTS instead. A ref the guard refuses is dropped before existsSync
  // OR `git log -- <ref>` (wasEverTracked) ever sees it.
  const checkoutGuard = resolveGuardedPath(cwd, ['projects', project]);
  const checkoutRoot = checkoutGuard.ok ? checkoutGuard.realPath : join(cwd, 'projects', project);
  const ownPrefix = `projects/${project}/`;
  const hasHistory = hasHistoryOverride ?? (checkoutGuard.ok && checkoutGuard.exists && isGitWorkTree(checkoutRoot));
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
      // A trailing '/' is a legitimate directory-style ref (normalizeCandidate
      // allows it); strip it before splitting so it does not become an empty
      // segment. A LEADING '/' (an absolute path) is left alone on purpose —
      // it produces a leading empty segment, which isSafeSegment always
      // refuses, so an absolute ref is refused exactly like a `..` one.
      const refSegments = ref.replace(/\/+$/, '').split('/');
      const refGuard = resolveGuardedPath(cwd, ['projects', project, ...refSegments]);
      if (!refGuard.ok) continue; // e.g. a `..` segment or an absolute-looking leg — dropped, never probed
      if (refGuard.exists) {
        references.push(ref);
      } else if (hasHistory && wasEverTracked(checkoutRoot, ref)) {
        references.push(ref);
        missing.push(ref);
      }
    }
    return { file, status, references, missing };
  });
}

type ProjectTruthRow = Pick<BrainTruthRate, 'project' | 'checkout' | 'history'> & { themes: ThemeTruth[] };

// Why: design.md § Brain-lint truthfulness axis (forge-mfv5.3.4)
const projectTruthRowsCache = new Map<string, ProjectTruthRow[]>();

/** Scopes the memo to ONE lint pass; `runBrainLint` calls it first (design.md). */
export function resetProjectTruthRowsCache(): void {
  projectTruthRowsCache.clear();
}

/** Every project's checkout + history status and per-theme truth — the
 *  shared basis `brainTruthRates`/`checkThemeTruth` build on (each defined
 *  once; `isGitWorkTree` runs once per project). */
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

// Why: design.md § Brain-lint truthfulness axis (forge-mfv5.3.4)
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
