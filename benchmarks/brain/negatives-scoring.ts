/**
 * Scoring rubric for the negatives suite.
 *
 * Different shape from the primary benchmark: we measure gap detection
 * (precision + recall) rather than retrieval accuracy. The brain phase doc's
 * "Coverage" success signal — `brain-gaps.jsonl` rate-of-new-gaps decreases
 * across cycles — depends on brain-query correctly flagging gaps. This suite
 * exercises that signal.
 *
 * Three categories:
 *   - out_of_scope: question has nothing in the brain. Pass = gap=true AND no sources cited.
 *   - forge_adjacent_bait: forge-shaped question with no answer in the brain. Same pass criteria; tests resistance to filling-the-gap-with-fiction.
 *   - partial_match: question mixes brain-known and brain-unknown components. Pass = gap=true AND cite at least one of `must_include_any_of` AND don't exceed `max_sources` (no spam).
 *
 * Hallucination penalty: any cited path that doesn't exist on disk → automatic
 * 0 for that case regardless of category.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalisePath } from './scoring.ts';

export type NegativeCategory = 'out_of_scope' | 'forge_adjacent_bait' | 'partial_match';

export type NegativeCase = {
  id: string;
  category: NegativeCategory;
  question: string;
  expected: {
    gap: boolean;
    max_sources?: number;
    must_include_any_of?: string[];
  };
};

export type NegativeCaseScore = {
  passed: boolean;
  reasons: string[];
  hallucinated: string[];
};

export function scoreNegativeCase(args: {
  expected: NegativeCase['expected'];
  category: NegativeCategory;
  actualGap: boolean;
  actualSources: string[];
  forgeRoot: string;
}): NegativeCaseScore {
  const reasons: string[] = [];
  const hallucinated: string[] = [];

  for (const src of args.actualSources) {
    const norm = normalisePath(src);
    const full = resolve(args.forgeRoot, norm);
    if (!existsSync(full)) hallucinated.push(norm);
  }

  if (hallucinated.length > 0) {
    reasons.push(`hallucinated_path:${hallucinated.length}`);
    return { passed: false, reasons, hallucinated };
  }

  if (args.expected.gap && !args.actualGap) {
    reasons.push('missed_gap');
  }

  if (args.expected.max_sources !== undefined && args.actualSources.length > args.expected.max_sources) {
    reasons.push(`too_many_sources:${args.actualSources.length}>${args.expected.max_sources}`);
  }

  if (args.expected.must_include_any_of && args.expected.must_include_any_of.length > 0) {
    const need = args.expected.must_include_any_of.map(normalisePath);
    const got = args.actualSources.map(normalisePath);
    const overlap = need.some((n) => got.includes(n));
    if (!overlap) reasons.push('missing_required_partial_match');
  }

  // out_of_scope: zero-source is required (the question has nothing in the brain).
  // forge_adjacent_bait: citing 1–2 themes for context-shaping ("we don't have X but here's
  //   what we have instead") is acceptable as long as gap=true. More than 2 is filling-the-gap.
  if (args.category === 'out_of_scope' && args.actualSources.length > 0) {
    reasons.push('unexpected_sources_for_out_of_scope');
  }
  if (args.category === 'forge_adjacent_bait' && args.actualSources.length > 2) {
    reasons.push(`too_many_context_sources_for_bait:${args.actualSources.length}>2`);
  }

  return { passed: reasons.length === 0, reasons, hallucinated };
}

export function summariseNegatives(
  results: { passed: boolean; category: NegativeCategory; hallucinated: string[] }[],
): {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  by_category: Record<NegativeCategory, { total: number; passed: number }>;
  hallucination_rate: number;
} {
  const byCat: Record<NegativeCategory, { total: number; passed: number }> = {
    out_of_scope: { total: 0, passed: 0 },
    forge_adjacent_bait: { total: 0, passed: 0 },
    partial_match: { total: 0, passed: 0 },
  };
  let halls = 0;
  for (const r of results) {
    byCat[r.category].total += 1;
    if (r.passed) byCat[r.category].passed += 1;
    if (r.hallucinated.length > 0) halls += 1;
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    pass_rate: results.length === 0 ? 1 : passed / results.length,
    by_category: byCat,
    hallucination_rate: results.length === 0 ? 0 : halls / results.length,
  };
}
