/**
 * Pure scoring functions for the brain benchmark. Kept separate from score.ts
 * (the runner) so they're trivially unit-testable without mocking the SDK.
 *
 * Per benchmarks/brain/README.md:
 *   score = 0.4 * source_recall + 0.6 * keyword_match
 *   source_recall = |expected ∩ actual| / |expected|  (extras don't penalise)
 *   keyword_match = mean of per-keyword scores (layered matcher: full / stem / token-overlap)
 *   hallucinated_path: any cited path that doesn't exist on disk → score = 0
 *   gap_rate = aggregate, summary-only metric (no per-case penalty)
 *
 * Why recall (not F1): the Opus LLM-judge experiment in May 2026 showed that
 * F1 over-penalises citation extras the judge calls "minor issue, still pass."
 * Recall + judge-validated weights match Opus on 88% of cases (vs 53% for the
 * F1 formulation). See _logs/2026-05-08T*-judge-validation/ for the data.
 *
 * Q15-style failures ("claims unverifiable from cited content") are a known
 * deterministic blind spot — they require subjective content evaluation. Use
 * the Opus judge (score-judged.ts) for periodic validation.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { contentTokens, simpleStem, tokenize } from './stemmer.ts';

export function normalisePath(p: string): string {
  let s = p.trim().toLowerCase();
  if (s.startsWith('./')) s = s.slice(2);
  if (s.startsWith('/')) s = s.slice(1);
  if (!s.startsWith('brain/')) s = `brain/${s}`;
  return s;
}

export function sourceRecall(expected: string[], actual: string[]): number {
  const e = new Set(expected.map(normalisePath));
  const a = new Set(actual.map(normalisePath));
  if (e.size === 0) return 1;
  let intersection = 0;
  for (const x of e) if (a.has(x)) intersection += 1;
  return intersection / e.size;
}

/** F1 retained for diagnostics / dashboards. Not used in the pass score. */
export function sourceF1(expected: string[], actual: string[]): number {
  const e = new Set(expected.map(normalisePath));
  const a = new Set(actual.map(normalisePath));
  if (e.size === 0 && a.size === 0) return 1;
  if (e.size === 0 || a.size === 0) return 0;
  let intersection = 0;
  for (const x of e) if (a.has(x)) intersection += 1;
  return (2 * intersection) / (e.size + a.size);
}

/**
 * Returns the list of cited paths that don't exist on disk relative to forgeRoot.
 * Case-insensitive: the model often lowercases project names (e.g.
 * `brain/projects/gitweave/...`) when the actual directory is `GitWeave`. That's
 * a citation-rendering quirk, not a hallucinated file. Walk the path
 * component-by-component matching case-insensitively against real entries.
 */
export function detectHallucinatedPaths(actual: string[], forgeRoot: string): string[] {
  return actual.map(normalisePath).filter((p) => !existsCaseInsensitive(forgeRoot, p));
}

function existsCaseInsensitive(forgeRoot: string, relPath: string): boolean {
  if (existsSync(resolve(forgeRoot, relPath))) return true;
  const parts = relPath.split('/').filter((s) => s.length > 0);
  let current = forgeRoot;
  for (const part of parts) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return false;
    }
    const match = entries.find((e) => e.toLowerCase() === part.toLowerCase());
    if (!match) return false;
    current = resolve(current, match);
  }
  return existsSync(current);
}

/**
 * Score a single keyword against a synthesised answer in [0, 1].
 *
 * Layered:
 *   - Tier 1 (1.0): full lowercased substring match. Preserves precision when
 *     the model echoes terminology verbatim (e.g. `gw:plan`, `48%`).
 *   - Tier 2 (0.7 / 0.4): stemmed token overlap. After tokenising the keyword
 *     and dropping stop-words, score by the fraction of stemmed tokens whose
 *     stem appears in the stemmed answer. All-present → 0.7; ≥half → 0.4.
 *   - Tier 0: no signal → 0.
 *
 * The full-substring tier-1 ceiling stays at 1.0 so models that preserve
 * vocabulary aren't penalised. Tier-2 partial credit caps at 0.7 because
 * paraphrased matches genuinely lose precision (e.g. `agent stage` ≠
 * "two-stage pipeline"; partial credit is fair, full credit isn't).
 */
export function matchKeyword(keyword: string, answer: string): number {
  const kwLower = keyword.toLowerCase().trim();
  const ansLower = answer.toLowerCase();
  if (kwLower.length === 0) return 1;

  if (ansLower.includes(kwLower)) return 1;

  const kwTokens = contentTokens(kwLower);
  if (kwTokens.length === 0) {
    const fallback = simpleStem(kwLower);
    return ansLower.includes(fallback) ? 1 : 0;
  }

  const ansTokenSet = new Set(tokenize(ansLower).map(simpleStem));
  const hits = kwTokens.filter((t) => ansTokenSet.has(t)).length;
  const fraction = hits / kwTokens.length;

  if (fraction >= 1) return 0.7;
  if (fraction >= 0.5) return 0.4;
  return 0;
}

export function keywordMatch(expected: string[], answer: string): number {
  if (expected.length === 0) return 1;
  let total = 0;
  for (const k of expected) total += matchKeyword(k, answer);
  return total / expected.length;
}

export type CaseScore = {
  score: number;
  source_recall: number;
  source_f1: number;
  keyword_match: number;
  hallucinated_paths: string[];
};

export function caseScore(args: {
  expectedSources: string[];
  expectedKeywords: string[];
  actualSources: string[];
  actualAnswer: string;
  forgeRoot?: string;
}): CaseScore {
  const recall = sourceRecall(args.expectedSources, args.actualSources);
  const f1 = sourceF1(args.expectedSources, args.actualSources);
  const km = keywordMatch(args.expectedKeywords, args.actualAnswer);
  const hallucinated = args.forgeRoot
    ? detectHallucinatedPaths(args.actualSources, args.forgeRoot)
    : [];

  // Hallucinated path → automatic 0; the answer can't be trusted regardless of recall/keyword.
  const score = hallucinated.length > 0 ? 0 : 0.4 * recall + 0.6 * km;

  return {
    score,
    source_recall: recall,
    source_f1: f1,
    keyword_match: km,
    hallucinated_paths: hallucinated,
  };
}
