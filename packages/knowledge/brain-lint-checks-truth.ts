/**
 * Brain-lint truthfulness axis (forge-mfv5.3.4, fix round 1 — d14-review.md).
 * Round 1 checked every inline-code span against the project checkout,
 * including forge-provenance citations and forge-root-relative
 * self-citations — driving betterado's stale rate to 99%. This round
 * excludes provenance (C1), normalises the self-citation prefix (C2),
 * blocks `../` escapes (M1), and judges `antipattern` themes on declared
 * `evidence:` only (M3) — an antipattern's claim IS an absence.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseTheme, readThemeDirFiles } from './brain-lint-theme-paths.ts';
import type { Finding } from './brain-lint-types.ts';

export type ThemeTruth = { file: string; status: 'current' | 'historical'; references: string[]; missing: string[] };

export type BrainTruthRate = {
  project: string; checkout: 'present' | 'absent'; themes: number; historical: number;
  verifiable: number; unverifiable: number; stale: number; rate: number | null;
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

/** Every theme under `brain/projects/<project>/themes/`, and which cited
 *  paths are absent from its checkout. C2: a reference prefixed with the
 *  theme's OWN `projects/<project>/` strips first; a foreign prefix does not. */
export function themeTruth(cwd: string, project: string): ThemeTruth[] {
  const themesDir = join(cwd, 'brain', 'projects', project, 'themes');
  const checkoutRoot = join(cwd, 'projects', project);
  const ownPrefix = `projects/${project}/`;
  return readThemeDirFiles(themesDir).map((file) => {
    const parsed = parseTheme(file);
    const data = parsed?.data ?? {};
    const status: ThemeTruth['status'] = data.status === 'historical' ? 'historical' : 'current';
    const references = extractThemeReferences(parsed?.content ?? '', data).map((ref) =>
      ref.startsWith(ownPrefix) ? ref.slice(ownPrefix.length) : ref,
    );
    const missing = references.filter((ref) => !existsSync(join(checkoutRoot, ref)));
    return { file, status, references, missing };
  });
}

/** Every project's checkout status + per-theme truth, walked ONCE — shared by
 *  `brainTruthRates`/`checkThemeTruth` so "checkout present" is defined once. */
function projectTruthRows(cwd: string): Array<{ project: string; checkout: BrainTruthRate['checkout']; themes: ThemeTruth[] }> {
  const projectsRoot = join(cwd, 'brain', 'projects');
  if (!existsSync(projectsRoot)) return [];
  return readdirSync(projectsRoot)
    .filter((n) => !n.startsWith('.'))
    .map((project) => ({
      project,
      checkout: (existsSync(join(cwd, 'projects', project)) ? 'present' : 'absent') as BrainTruthRate['checkout'],
      themes: themeTruth(cwd, project),
    }));
}

/** One row per project, sorted by name. Checkout-absent → never judged. */
export function brainTruthRates(cwd: string): BrainTruthRate[] {
  const rows = projectTruthRows(cwd).map(({ project, checkout, themes }): BrainTruthRate => {
    const historical = themes.filter((t) => t.status === 'historical').length;
    const current = checkout === 'present' ? themes.filter((t) => t.status === 'current') : [];
    const verifiable = current.filter((t) => t.references.length > 0);
    const stale = verifiable.filter((t) => t.missing.length > 0).length;
    return {
      project, checkout, themes: themes.length, historical,
      verifiable: verifiable.length, unverifiable: current.length - verifiable.length, stale,
      rate: checkout === 'present' && verifiable.length > 0 ? stale / verifiable.length : null,
    };
  });
  return rows.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
}

/** One `flag` finding per stale CURRENT theme in a checkout-present brain. */
export function checkThemeTruth(cwd: string): Finding[] {
  return projectTruthRows(cwd)
    .filter((row) => row.checkout === 'present')
    .flatMap((row) => row.themes)
    .filter((t) => t.status === 'current' && t.missing.length > 0)
    .map((t): Finding => ({
      category: 'flag',
      file: t.file,
      check: 'checkThemeTruth',
      message: `cites missing path(s): ${t.missing.join(', ')} — the theme may describe code that no longer exists`,
    }));
}

/** `truthfulness:` lines, one per row, printed unconditionally (M2: pre-filter rows to scope by project). */
export function formatTruthfulnessLines(rows: readonly BrainTruthRate[]): string[] {
  return rows.map((r) => {
    if (r.checkout === 'absent') return `truthfulness: ${r.project} — checkout absent, not judged`;
    const pct = r.verifiable > 0 ? Math.round((r.stale / r.verifiable) * 100) : 0;
    return `truthfulness: ${r.project} — ${r.stale}/${r.verifiable} stale (${pct}%) · ${r.unverifiable} unverifiable · ${r.historical} historical`;
  });
}
