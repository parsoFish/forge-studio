/**
 * Brain-lint truthfulness axis (bead forge-mfv5.3.4) — does a CURRENT project
 * (Brain 3) theme's cited code still exist in its ground clone
 * (`<forgeRoot>/projects/<name>/`)? `forge brain lint` verifies STRUCTURE
 * only today; this module measures whether the brain's own assertions are
 * still TRUE. Extraction rules and the `truthfulness:` line format follow
 * `.superpowers/d14-tests-brief.md` verbatim.
 *
 * Reuses the shared theme parse (`parseTheme`, `brain-lint-theme-paths.ts` →
 * `theme-frontmatter.ts`) — never a second frontmatter parser or theme walker.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseTheme } from './brain-lint-theme-paths.ts';
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
  themes: number;
  historical: number;
  verifiable: number;
  unverifiable: number;
  stale: number;
  rate: number | null;
};

const FENCE_RE = /```[\s\S]*?```/g;
const SPAN_RE = /`([^`\n]+)`/g;
const FORBIDDEN_CHARS = /[*<>{$:]/;

/** One inline-code span → a repo-relative reference, or null if it isn't one. */
function normalizeCandidate(raw: string): string | null {
  if (raw === '' || /\s/.test(raw)) return null;
  let candidate = raw;
  if (candidate.startsWith('./')) {
    candidate = candidate.slice(2);
  } else if (candidate.startsWith('/') || candidate.startsWith('~') || candidate.startsWith('http')) {
    return null;
  }
  if (!candidate.includes('/') || FORBIDDEN_CHARS.test(candidate)) return null;
  const lastSegment = candidate.slice(candidate.lastIndexOf('/') + 1);
  if (!candidate.endsWith('/') && !lastSegment.includes('.')) return null;
  return candidate;
}

/**
 * A non-empty `evidence:` frontmatter list is the COMPLETE reference set (the
 * body is ignored). Otherwise every inline-code span outside a fenced block
 * that looks like a repo-relative path, deduplicated in first-seen order.
 */
export function extractThemeReferences(body: string, frontmatter: Record<string, unknown>): string[] {
  const evidence = frontmatter.evidence;
  if (Array.isArray(evidence) && evidence.length > 0) return [...evidence] as string[];

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

/**
 * Every theme under `brain/projects/<project>/themes/` (README excluded, same
 * as every other project-brain check): its status and which of its cited
 * paths are absent from the project's ground clone (`<cwd>/projects/<project>/`).
 */
export function themeTruth(cwd: string, project: string): ThemeTruth[] {
  const themesDir = join(cwd, 'brain', 'projects', project, 'themes');
  if (!existsSync(themesDir)) return [];
  const checkoutRoot = join(cwd, 'projects', project);
  const entries = readdirSync(themesDir).filter((e) => e.endsWith('.md') && e !== 'README.md');
  return entries.map((entry) => {
    const file = join(themesDir, entry);
    const parsed = parseTheme(file);
    const data = parsed?.data ?? {};
    const status: ThemeTruth['status'] = data.status === 'historical' ? 'historical' : 'current';
    const references = extractThemeReferences(parsed?.content ?? '', data);
    const missing = references.filter((ref) => !existsSync(join(checkoutRoot, ref)));
    return { file, status, references, missing };
  });
}

/**
 * One row per `brain/projects/<p>/`, sorted by project name. A checkout-absent
 * brain is never judged — `verifiable`/`unverifiable`/`stale` stay 0 and
 * `rate` is `null` rather than guessed at from a ground clone that isn't there.
 */
export function brainTruthRates(cwd: string): BrainTruthRate[] {
  const projectsRoot = join(cwd, 'brain', 'projects');
  if (!existsSync(projectsRoot)) return [];
  const projects = readdirSync(projectsRoot).filter((n) => !n.startsWith('.'));

  const rows = projects.map((project): BrainTruthRate => {
    const checkout: BrainTruthRate['checkout'] = existsSync(join(cwd, 'projects', project)) ? 'present' : 'absent';
    const themes = themeTruth(cwd, project);
    const historical = themes.filter((t) => t.status === 'historical').length;
    let verifiable = 0;
    let unverifiable = 0;
    let stale = 0;
    if (checkout === 'present') {
      for (const t of themes) {
        if (t.status !== 'current') continue;
        if (t.references.length === 0) unverifiable += 1;
        else {
          verifiable += 1;
          if (t.missing.length > 0) stale += 1;
        }
      }
    }
    return {
      project,
      checkout,
      themes: themes.length,
      historical,
      verifiable,
      unverifiable,
      stale,
      rate: checkout === 'present' && verifiable > 0 ? stale / verifiable : null,
    };
  });

  return rows.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
}

/**
 * One `flag` finding per stale CURRENT theme in a checkout-present project
 * brain — never `error` (this must never gate `forge brain lint`). Historical
 * themes and checkout-absent brains never yield a finding: a missing ground
 * clone is reported by `brainTruthRates`'s `checkout:'absent'` row, never
 * guessed at here.
 */
export function checkThemeTruth(cwd: string): Finding[] {
  const projectsRoot = join(cwd, 'brain', 'projects');
  if (!existsSync(projectsRoot)) return [];
  const findings: Finding[] = [];
  for (const project of readdirSync(projectsRoot)) {
    if (project.startsWith('.') || !existsSync(join(cwd, 'projects', project))) continue;
    for (const t of themeTruth(cwd, project)) {
      if (t.status !== 'current' || t.missing.length === 0) continue;
      findings.push({
        category: 'flag',
        file: t.file,
        check: 'checkThemeTruth',
        message: `cites missing path(s): ${t.missing.join(', ')} — the theme may describe code that no longer exists`,
      });
    }
  }
  return findings;
}

/**
 * The `truthfulness:` summary lines — one per `brainTruthRates` row, printed
 * UNCONDITIONALLY (a 0% rate is a measurement; an absent line is not) by both
 * CLI entries (`brain-lint.ts`'s own CLI and `forge brain lint`).
 */
export function formatTruthfulnessLines(rows: readonly BrainTruthRate[]): string[] {
  return rows.map((r) => {
    if (r.checkout === 'absent') return `truthfulness: ${r.project} — checkout absent, not judged`;
    const pct = r.verifiable > 0 ? Math.round((r.stale / r.verifiable) * 100) : 0;
    return `truthfulness: ${r.project} — ${r.stale}/${r.verifiable} stale (${pct}%) · ${r.unverifiable} unverifiable · ${r.historical} historical`;
  });
}
