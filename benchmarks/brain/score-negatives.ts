#!/usr/bin/env node
/**
 * Benchmark — Brain (negatives suite).
 *
 * Reads negatives.json (out-of-scope / forge-adjacent-bait / partial-match
 * questions) and scores brain-query's gap-detection behaviour. The primary
 * suite (score.ts) measures retrieval accuracy; this one measures whether the
 * model correctly says "I don't know" when the brain doesn't.
 *
 * Pass criteria are per-case (different rubric — see negatives-scoring.ts).
 * Hallucinated paths (citing files that don't exist on disk) are an automatic
 * 0 regardless of other criteria.
 *
 * Event-log emission deliberately not wired — benchmarks run outside cycles
 * per ADR 005.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { p95 } from '../_lib/percentile.ts';
import { mapConcurrent } from '../_lib/concurrent.ts';
import { runBrainQuery } from './sdk.ts';
import { normalisePath } from './scoring.ts';
import {
  scoreNegativeCase,
  summariseNegatives,
  type NegativeCase,
  type NegativeCategory,
} from './negatives-scoring.ts';

type CaseResult = {
  id: string;
  category: NegativeCategory;
  passed: boolean;
  reasons: string[];
  actual: { sources: string[]; answer: string; confidence?: string; gap?: boolean } | null;
  hallucinated: string[];
  elapsed_ms: number;
  cost_usd: number;
  runner_error?: { kind: string; message: string };
};

const SESSION_BUDGET_USD = 5;
const CONCURRENCY = 4;

const here = import.meta.dirname;
const forgeRoot = resolve(here, '..', '..');
const negativesPath = join(here, 'negatives.json');
const cases: NegativeCase[] = JSON.parse(readFileSync(negativesPath, 'utf8'));
const ranAt = new Date().toISOString();

let totalCostUsd = 0;
let aborted = false;

const results = await mapConcurrent(cases, CONCURRENCY, async (c): Promise<CaseResult> => {
  if (aborted || totalCostUsd >= SESSION_BUDGET_USD) {
    aborted = true;
    return {
      id: c.id,
      category: c.category,
      passed: false,
      reasons: [`session_budget_exceeded:$${totalCostUsd.toFixed(4)}`],
      actual: null,
      hallucinated: [],
      elapsed_ms: 0,
      cost_usd: 0,
    };
  }

  let r;
  try {
    r = await runBrainQuery({ question: c.question });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: c.id,
      category: c.category,
      passed: false,
      reasons: ['runner_threw'],
      actual: null,
      hallucinated: [],
      elapsed_ms: 0,
      cost_usd: 0,
      runner_error: { kind: 'thrown', message },
    };
  }

  totalCostUsd += r.costUsd;

  const answer = r.structured?.answers[0] ?? null;
  if (!answer) {
    return {
      id: c.id,
      category: c.category,
      passed: false,
      reasons: ['no_answer'],
      actual: null,
      hallucinated: [],
      elapsed_ms: r.durationMs,
      cost_usd: r.costUsd,
      ...(r.runnerError ? { runner_error: r.runnerError } : {}),
    };
  }

  const score = scoreNegativeCase({
    expected: c.expected,
    category: c.category,
    actualGap: answer.gap === true,
    actualSources: answer.sources,
    forgeRoot,
  });

  return {
    id: c.id,
    category: c.category,
    passed: score.passed,
    reasons: score.reasons,
    actual: {
      sources: answer.sources.map(normalisePath),
      answer: answer.answer,
      confidence: answer.confidence,
      gap: answer.gap,
    },
    hallucinated: score.hallucinated,
    elapsed_ms: r.durationMs,
    cost_usd: r.costUsd,
    ...(r.runnerError ? { runner_error: r.runnerError } : {}),
  };
});

const summary = summariseNegatives(
  results.map((r) => ({ passed: r.passed, category: r.category, hallucinated: r.hallucinated })),
);
const elapsed = results.map((r) => r.elapsed_ms).filter((n) => n > 0);

const out = {
  phase: 'brain-negatives',
  ran_at: ranAt,
  cases: results,
  summary: {
    ...summary,
    p95_ms: p95(elapsed),
    total_cost_usd: totalCostUsd,
    aborted_on_budget: aborted,
  },
};

const resultsDir = resolve(here, 'results-negatives');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, `${ranAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));
process.stdout.write(JSON.stringify(out, null, 2));
process.stdout.write(`\n\n${summary.passed}/${summary.total} negative cases passed (rate ${(summary.pass_rate * 100).toFixed(1)}%)\n`);
process.stdout.write(`per-category: out_of_scope ${summary.by_category.out_of_scope.passed}/${summary.by_category.out_of_scope.total}, `);
process.stdout.write(`forge_adjacent_bait ${summary.by_category.forge_adjacent_bait.passed}/${summary.by_category.forge_adjacent_bait.total}, `);
process.stdout.write(`partial_match ${summary.by_category.partial_match.passed}/${summary.by_category.partial_match.total}\n`);
process.stdout.write(`hallucination rate: ${(summary.hallucination_rate * 100).toFixed(1)}% — cost $${totalCostUsd.toFixed(4)}\n`);
process.stdout.write(`p95 latency: ${out.summary.p95_ms.toFixed(0)}ms\n`);
process.stdout.write(`results: ${outPath}\n`);
